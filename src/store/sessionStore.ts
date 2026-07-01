import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import {
	type BroadcastPayload,
	dbAssignMatch,
	dbBoardClaimEditor,
	dbBoardHandoffEditor,
	dbBoardReleaseEditor,
	dbBoardTakeoverEditor,
	dbCompleteMatch,
	dbEndSession,
	dbLoadMatches,
	dbLoadSessionState,
	dbSetCockChecked,
	dbSetMatchRoster,
	dbSetPlayerResting,
	sendBroadcast,
	supabase,
} from "../lib/supabase";
import type { ClientSessionState } from "../lib/supabase";
import { createSessionChannels } from "../lib/supabase/sessionChannels";
import { matchRowsToCourts, rowToSessionPlayer } from "../lib/supabase/transformers";
import type { SessionPlayerRow } from "../lib/supabase/types";
import { matchPlayerIds } from "../lib/board/membership";
import {
	computeLockFromRow,
	computePresenceList,
	detectEditorLoss,
	type EditorCache,
} from "../lib/editLock";
import { recordTeam } from "../lib/pairHistory";
import type {
	Court,
	GameType,
	GeneratedTeam,
	GroupSettings,
	PairHistory,
	SessionPlayer,
} from "../types";
import type { BoardDraftsPayload } from "../types/board";
import { fetchGroupSettings, grantCockSupport } from "../lib/supabase/clubSettings";
import { monthKST } from "../lib/schedule/calendar";
import { useAppStore } from "./appStore";
import { getClientId, getDeviceName } from "../lib/deviceName";
import { randomId } from "../lib/randomId";
import { useAuthStore } from "./authStore";

function getSessionId(): number {
	return useAppStore.getState().sessionMeta?.sessionId ?? 0;
}

// ── Broadcast 핸들러 타입 ────────────────────────────────────
type SetFn = (partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void;
type GetFn = () => SessionState;
// BroadcastPayload는 union 타입이라 ["payload"]로 직접 접근 불가 — unknown 사용
type BroadcastPayloadData = Record<string, unknown>;

function upsertPlayers(map: Map<string, SessionPlayer>, players: SessionPlayer[]): Map<string, SessionPlayer> {
	const next = new Map(map);
	for (const p of players) next.set(p.id, p);
	return next;
}

// ── 서버 권위 편집 락 생명주기 (presence 파생 폐기 — 원인2) ──────────────
// 편집 보유자는 sessions.editor_* 단일 row가 결정한다. 클라는 그 row를 cachedEditor에 캐시하고
// computeLockFromRow로 isEditor/holder/lockFree를 산정한다. heartbeat가 lease를 연장하고,
// reeval 타이머가 lease 만료(보유자 crash)를 로컬에서 감지해 lockFree로 떨군다.
const LEASE_SECONDS = 20;
const HEARTBEAT_MS = 7000;
const REEVAL_MS = 4000;

let cachedEditor: EditorCache = { clientId: null, name: null, leaseUntilMs: 0 };
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reevalTimer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;
let pageHideHandler: (() => void) | null = null;
// 락 세대(epoch) — 권위적 락 변경(claim/handoff/resync/row/세션경계)마다 증가. in-flight heartbeat RPC의
// 늦은 .then이 그 사이 바뀐 상태를 덮어쓰지 않게(handoff/크로스세션 stale 콜백) 가드한다.
let lockEpoch = 0;

/** board_drafts 단조 적용 — 내가 아는 버전보다 새(>=) 것만 반영. broadcast/catch-up/저장성공이 공유. */
function applyDraftsIfNewerImpl(
	get: GetFn,
	set: SetFn,
	drafts: BoardDraftsPayload,
	version: number,
) {
	// 멱등: 이미 아는 버전 이하(자기 echo·broadcast/catch-up 중복)는 무시 — 새 객체참조 set로 인한
	// SessionBoard 재적용/깜빡임 방지. CAS라 version이 내용을 유일 식별(같은 버전=같은 멤버십).
	if (version <= get().boardDraftsVersion) return;
	set({ boardDrafts: drafts, boardDraftsVersion: version });
}

/**
 * cachedEditor + 현재 시각으로 락 상태 재산정 + heartbeat 시작/정지 관리.
 * 편집자였다가 다른 사람에게 뺏긴 전이면 editorTakenBy(다이얼로그용)를 세팅한다.
 * suppressLossNotice=true(자발적 양도)면 그 알림을 띄우지 않는다.
 */
function recomputeLock(get: GetFn, set: SetFn, opts?: { suppressLossNotice?: boolean }) {
	const myClientId = get()._clientId;
	const prevIsEditor = get().isEditor;
	const info = computeLockFromRow(cachedEditor, myClientId, Date.now());
	set(info);
	if (info.isEditor) startHeartbeat(get, set);
	else stopHeartbeat();
	if (info.isEditor) {
		// 내가 (다시) 편집자가 되면 떠 있던 뺏김 알림은 닫는다.
		if (get().editorTakenBy) set({ editorTakenBy: null });
	} else if (!opts?.suppressLossNotice) {
		const takenBy = detectEditorLoss(prevIsEditor, info, myClientId);
		if (takenBy) set({ editorTakenBy: takenBy });
	}
}

function startHeartbeat(get: GetFn, set: SetFn) {
	if (heartbeatTimer) return; // 이미 동작 중
	heartbeatTimer = setInterval(() => heartbeatTick(get, set), HEARTBEAT_MS);
	heartbeatTick(get, set); // 즉시 1회 — 실제 서버 락 획득/연장
}

function stopHeartbeat() {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
}

/** lease 연장 RPC. 성공 시 cachedEditor 갱신, 실패(다른 사람이 유효 lease)면 서버 권위로 재동기화. */
function heartbeatTick(get: GetFn, set: SetFn) {
	const { _clientId, _myName } = get();
	if (!_clientId) return;
	const name = _myName ?? "기기";
	const epoch = lockEpoch; // 이 tick 발사 시점의 세대
	void dbBoardClaimEditor(getSessionId(), _clientId, name, LEASE_SECONDS).then((res) => {
		// 그 사이 handoff/resync/세션전환 등 권위적 변경이 있었으면 이 늦은 결과는 폐기(stale).
		if (epoch !== lockEpoch) return;
		if (res) {
			cachedEditor = {
				clientId: _clientId,
				name,
				leaseUntilMs: res.leaseUntil ? Date.parse(res.leaseUntil) : Date.now() + LEASE_SECONDS * 1000,
			};
			recomputeLock(get, set);
		} else {
			void get().resyncFromServer(); // 점유 실패 — 진짜 보유자/자유를 서버에서 다시 읽음
		}
	});
}

/** 낙관적 점유 — cachedEditor를 나로 세팅 후 recomputeLock(→ heartbeat 즉시 실제 RPC). 충돌 시 heartbeat가 되돌림. */
function claimNow(get: GetFn, set: SetFn) {
	const { _clientId, _myName } = get();
	if (!_clientId) return;
	lockEpoch++; // 권위적 변경 — in-flight heartbeat .then 무효화
	cachedEditor = { clientId: _clientId, name: _myName ?? "기기", leaseUntilMs: Date.now() + LEASE_SECONDS * 1000 };
	recomputeLock(get, set);
}

/**
 * 혼자(접속자 ≤1) + 자유(아무도 편집 안 함) + 미편집이면 보기 전용 단계 없이 자동 점유.
 * lockFree 가드가 활성 편집자를 절대 안 뺏고(=남이 편집 중이면 점유 안 함), presenceCount 가드가
 * "혼자일 때만"을 보장한다. 멱등 — 이미 편집자/비자유면 no-op이라 반복 호출 안전.
 */
function maybeClaimIfAlone(get: GetFn, set: SetFn) {
	const s = get();
	if (s.presenceCount <= 1 && s.lockFree && !s.isEditor && s._clientId) {
		claimNow(get, set);
	}
}

function setCachedEditorFromRow(row: {
	editor_client_id?: string | null;
	editor_name?: string | null;
	editor_lease_until?: string | null;
}) {
	lockEpoch++; // 서버 row가 권위 — in-flight heartbeat .then 무효화
	cachedEditor = {
		clientId: row.editor_client_id ?? null,
		name: row.editor_name ?? null,
		leaseUntilMs: row.editor_lease_until ? Date.parse(row.editor_lease_until) : 0,
	};
}

/** sessionPlayers Map에서 waitingIds/restingIds 파생 상태를 동기 재계산 */
function rebuildDerivedIds(
	sessionPlayers: Map<string, SessionPlayer>,
): { waitingIds: string[]; restingIds: string[] } {
	const waitingIds: string[] = [];
	const restingIds: string[] = [];
	for (const [id, p] of sessionPlayers) {
		if (p.status === "waiting") waitingIds.push(id);
		else if (p.status === "resting") restingIds.push(id);
	}
	return { waitingIds, restingIds };
}

function handleMatchStarted(payload: BroadcastPayloadData, set: SetFn) {
	const { matchId, courtId, gameType, teamA, teamB } = payload;
	// teamA/B는 여전히 SessionPlayer 객체로 수신 (브로드캐스트 형식 유지)
	const teamAPlayers = teamA as [SessionPlayer, SessionPlayer];
	const teamBPlayers = teamB as [SessionPlayer, SessionPlayer];
	const teamAIds: [string, string] = [teamAPlayers[0].id, teamAPlayers[1].id];
	const teamBIds: [string, string] = [teamBPlayers[0].id, teamBPlayers[1].id];
	const safeMatchId = matchId as string;
	const safeCourtId = courtId as number;
	const safeGameType = gameType as GameType;

	set((state) => {
		// Map에 먼저 upsert (status='playing'으로 수신됨), courts에는 ID 참조 저장 (단일 배치)
		const newMap = upsertPlayers(state.sessionPlayers, [...teamAPlayers, ...teamBPlayers]);
		const { waitingIds, restingIds } = rebuildDerivedIds(newMap);

		return {
			sessionPlayers: newMap,
			courts: state.courts.map((c) =>
				c.id === safeCourtId
					? {
						...c,
						match: {
							id: safeMatchId,
							courtId: safeCourtId,
							gameType: safeGameType,
							teamA: teamAIds,
							teamB: teamBIds,
							startedAt: new Date().toISOString(),
						},
					}
					: c,
			),
			waitingIds,
			restingIds,
			// 동반 이력(pairHistory)은 경기 완료 시(handleMatchCompleted)에만 1회 누적한다.
			// 경기 시작 시 4명의 직전 게임 타입을 이번 경기 타입으로 기록(완료 후 자유로 돌아와도 유지)
			lastGameType: { ...state.lastGameType, ...Object.fromEntries([...teamAIds, ...teamBIds].map((id) => [id, safeGameType])) },
		};
	});
}

function handleMatchCompleted(payload: BroadcastPayloadData, set: SetFn) {
	const { courtId, gameType, teamA, teamB, updatedPlayers } = payload;
	const teamAPlayers = teamA as [SessionPlayer, SessionPlayer];
	const teamBPlayers = teamB as [SessionPlayer, SessionPlayer];
	const allPlayers = [...teamAPlayers, ...teamBPlayers];

	set((state) => {
		// 같은 경기 4명(teamA+teamB) 그룹 전체의 모든 쌍을 동반 +1. 완료 시점에만 1회 누적(DB와 정합).
		const newPairHistory = recordTeam(state.pairHistory, {
			teamA: [teamAPlayers[0].id, teamAPlayers[1].id],
			teamB: [teamBPlayers[0].id, teamBPlayers[1].id],
			gameType: gameType as GameType,
		});

		// Map 업데이트 후 rebuildDerivedIds로 파생 상태 재계산
		const newMap = upsertPlayers(state.sessionPlayers, updatedPlayers as SessionPlayer[]);
		const { waitingIds, restingIds } = rebuildDerivedIds(newMap);

		return {
			sessionPlayers: newMap,
			courts: state.courts.map((c) => (c.id !== courtId ? c : { ...c, match: null })),
			waitingIds,
			restingIds,
			pairHistory: newPairHistory,
			// 직전 게임 타입 갱신(시작 시 누락된 클라이언트도 완료 시점에 보정)
			lastGameType: { ...state.lastGameType, ...Object.fromEntries(allPlayers.map((p: SessionPlayer) => [p.id, gameType as GameType])) },
		};
	});
}

function handleMatchRosterUpdated(payload: BroadcastPayloadData, set: SetFn) {
	// 경기 로스터 수정의 즉시성 반영(best-effort) — 코트의 teamA/B 참조 갱신 + 상태 바뀐 선수 upsert.
	// 권위 수렴은 match_state_version 갭 → refetchMatches 가 별도로 보장(broadcast 유실/역전 무관).
	const { courtId, teamA, teamB, updatedPlayers } = payload;
	const tA = teamA as [string, string];
	const tB = teamB as [string, string];
	const safeCourtId = courtId as number;
	set((state) => {
		const newMap = upsertPlayers(state.sessionPlayers, (updatedPlayers as SessionPlayer[]) ?? []);
		const { waitingIds, restingIds } = rebuildDerivedIds(newMap);
		return {
			sessionPlayers: newMap,
			waitingIds,
			restingIds,
			courts: state.courts.map((c) =>
				c.id === safeCourtId && c.match ? { ...c, match: { ...c.match, teamA: tA, teamB: tB } } : c,
			),
		};
	});
}

function handlePlayerUpdated(payload: BroadcastPayloadData, set: SetFn) {
	const { player } = payload as { player: SessionPlayer };
	set((state) => {
		// status가 바뀔 수 있으므로(휴식 토글) waitingIds/restingIds 파생도 재계산한다.
		const newMap = upsertPlayers(state.sessionPlayers, [player]);
		const { waitingIds, restingIds } = rebuildDerivedIds(newMap);
		return { sessionPlayers: newMap, waitingIds, restingIds };
	});
}

function handleSessionRefreshRequired(_payload: BroadcastPayloadData, _set: SetFn, get: GetFn) {
	const sessionMeta = useAppStore.getState().sessionMeta;
	if (sessionMeta) {
		import("../lib/supabase")
			.then(({ fetchSessionSnapshot, snapshotToClientState }) =>
				fetchSessionSnapshot(sessionMeta.sessionId).then((snapshot) => {
					if (snapshot) {
						get().initialize(snapshotToClientState(snapshot));
					}
				}),
			)
			.catch((err) => console.error("Failed to refresh session:", err));
	}
}

function handleBoardDraftsUpdated(payload: BroadcastPayloadData, set: SetFn, get: GetFn) {
	// broadcast 페이로드는 { drafts, version }. 단조 가드로 새(>=) 버전만 반영(catch-up과 역전 방지).
	// 실제 보드 반영은 SessionBoard가 boardDrafts 변화를 감지해 applyRemoteDrafts로 수행.
	const { drafts, version } = payload as { drafts?: BoardDraftsPayload; version?: number };
	if (drafts) {
		applyDraftsIfNewerImpl(get, set, drafts, typeof version === "number" ? version : get().boardDraftsVersion);
	}
}

export interface SessionState {
	courts: Court[];
	sessionPlayers: Map<string, SessionPlayer>;
	waitingIds: string[];
	restingIds: string[];
	pairHistory: PairHistory;
	lastGameType: Record<string, GameType>;
	matchAssignCount: number;
	/** 보드 drafts/예약 멤버십(공유). 스냅샷에서 복원해 boardStore가 적용. */
	boardDrafts: BoardDraftsPayload;
	/** board_drafts 낙관적 동시성 버전 — 쓰기 CAS base + 수신 단조 가드 기준(원인3). */
	boardDraftsVersion: number;
	/** 코트 배정(matches) 동기화 단조 버전 — 수신 단조 가드 + 갭이면 refetchMatches 트리거. */
	matchStateVersion: number;
	/** 콕 체크 모드 on/off(세션 설정, 공유). on이면 cockChecked=false 선수는 매칭 대기 아님. */
	cockCheckEnabled: boolean;
	/** 클럽 전역 설정(콕 쿼터/월 지원량). 콕체크 모달의 지원 안내에 사용. 미로딩 시 null. */
	groupSettings: GroupSettings | null;

	// ── 편집 락(서버 권위 — sessions.editor_* row 기반, 원인2) ──────────────
	/** 편집 가능 여부(= 내가 유효 lease 보유자). false면 보기 전용. */
	isEditor: boolean;
	/** 현재 접속 기기 수. */
	presenceCount: number;
	/** 접속 기기 목록(이름) — 접속자 모달용. */
	presenceList: { clientId: string; name: string }[];
	/** 편집 권한 보유자 clientId(아무도 점유 안 했으면 null=자유). */
	holderClientId: string | null;
	/** 보유자 기기 이름. */
	holderName: string | null;
	/** 락이 비어있는지(아무도 점유 안 함). */
	lockFree: boolean;
	/** 편집권을 다른 사람에게 뺏겼을 때 그 사람 이름(다이얼로그 표시용). null=알림 없음. */
	editorTakenBy: string | null;

	/** 서버 권위 재동기화(resyncFromServer) 진행 중 — 포어그라운드 복귀/재연결 시 "동기화 중" 표시용. */
	boardSyncing: boolean;

	// Internal channel reference (not reactive)
	_channel: RealtimeChannel | null;
	_metaChannel: RealtimeChannel | null;
	/** 이 클라이언트의 presence 식별자. */
	_clientId: string | null;
	/** 이 기기 이름. */
	_myName: string | null;

	initialize: (initial: ClientSessionState) => void;
	reset: () => void;

	// DB Actions
	handleAssign: (team: GeneratedTeam, courtId: number) => Promise<void>;
	handleComplete: (courtId: number) => Promise<void>;
	/** 휴식 토글. resting=true 휴식 진입 / false 복귀(평균 판수 보정). player_updated 브로드캐스트. */
	setResting: (playerId: string, resting: boolean) => Promise<void>;
	/** 콕 제출 확인 — cock_checked=true로 매칭 대기 상태로 전환(공유, 편집자만). */
	confirmCock: (playerId: string) => Promise<void>;
	/** 경기 수정: 진행중 매치의 최종 로스터 설정(직접 DB 반영, 동기화 없음, 로컬만 갱신). */
	handleSetMatchRoster: (
		courtId: number,
		teamA: [string, string],
		teamB: [string, string],
	) => Promise<void>;
	handleEndSession: (onEnd: () => void) => Promise<void>;

	notifySessionRefresh: () => void;

	// 편집 락 — 명시적 점유(권한 가져오기) / 첫 편집 시 자유면 점유 / 보유자 본인의 명시 양도
	claimEditor: () => void;
	claimEditingIfFree: () => void;
	handoffEditor: (toClientId: string, toName: string) => Promise<void>;
	/** 편집권 뺏김 다이얼로그 닫기(editorTakenBy=null). */
	dismissEditorTakenNotice: () => void;
	/** board_drafts를 단조(새 버전만) 반영 — boardStore 저장 성공/충돌 복구에서 호출. */
	applyDraftsIfNewer: (drafts: BoardDraftsPayload, version: number) => void;
	/** 서버에서 board_drafts+버전+편집 락을 다시 읽어 수렴(충돌 복구·재구독 catch-up). */
	resyncFromServer: (opts?: { indicate?: boolean }) => Promise<void>;
	/**
	 * 진행중 matches 를 권위 재조회해 courts 를 수렴시킨다(코트 배정 catch-up).
	 * targetVersion 이 현재 matchStateVersion 이하면 멱등 skip(force=true 면 강제 — 재연결 복구용).
	 */
	refetchMatches: (targetVersion: number, force?: boolean) => Promise<void>;

	/** 선수 정보(성별/스킬 등) 변경을 로컬 반영 + 다른 클라이언트로 브로드캐스트. */
	broadcastPlayerUpdated: (player: SessionPlayer) => void;

	// Channel management
	subscribe: (sessionId: number, onEnd: () => void) => void;
	unsubscribe: () => void;
	applyBroadcast: (ev: BroadcastPayload) => void;
}

const initialState = {
	courts: [] as Court[],
	sessionPlayers: new Map<string, SessionPlayer>(),
	waitingIds: [] as string[],
	restingIds: [] as string[],
	pairHistory: {} as PairHistory,
	lastGameType: {} as Record<string, GameType>,
	matchAssignCount: 0,
	boardDrafts: { teams: [], reservations: [] } as BoardDraftsPayload,
	boardDraftsVersion: 0,
	matchStateVersion: 0,
	cockCheckEnabled: true,
	groupSettings: null as GroupSettings | null,
	isEditor: false,
	presenceCount: 0,
	presenceList: [] as { clientId: string; name: string }[],
	holderClientId: null as string | null,
	holderName: null as string | null,
	lockFree: true,
	editorTakenBy: null as string | null,
	boardSyncing: false,
	_channel: null as RealtimeChannel | null,
	_metaChannel: null as RealtimeChannel | null,
	_clientId: null as string | null,
	_myName: null as string | null,
};

export const useSessionStore = create<SessionState>((set, get) => ({
	...initialState,

	initialize: (initial) => {
		const playerMap = new Map(initial.players.map((p) => [p.id, p]));
		const { waitingIds, restingIds } = rebuildDerivedIds(playerMap);
		// 편집 락 캐시/heartbeat 리셋 — 구독 후 onResync가 서버 권위로 다시 채운다.
		lockEpoch++;
		cachedEditor = { clientId: null, name: null, leaseUntilMs: 0 };
		stopHeartbeat();
		set({
			...initialState,
			_channel: get()._channel,
			_metaChannel: get()._metaChannel,
			_clientId: get()._clientId,
			_myName: get()._myName,
			courts: initial.courts,
			sessionPlayers: playerMap,
			waitingIds,
			restingIds,
			pairHistory: initial.pairHistory,
			matchAssignCount: initial.matchAssignCount,
			lastGameType: initial.lastGameType,
			boardDrafts: initial.boardDrafts,
			boardDraftsVersion: initial.boardDraftsVersion,
			matchStateVersion: initial.matchStateVersion,
			cockCheckEnabled: initial.cockCheckEnabled,
		});
		// 클럽 전역 설정(콕 쿼터/지원량) 로드 — 콕체크 모달 지원 안내용. 비차단(실패 시 null→모달이 기본값 폴백).
		void fetchGroupSettings().then((gs) => set({ groupSettings: gs }));
	},
	reset: () => {
		get().unsubscribe();
		set(initialState);
	},

	// ── DB Actions ──────────────────────────────────────────
	handleAssign: async (team: GeneratedTeam, courtId: number) => {
		const { courts, _channel, isEditor, _clientId, _myName } = get();
		if (!_channel || !isEditor) { return; } // 보기 전용 차단

		const court = courts.find((c) => c.id === courtId);
		if (!court || court.match) { return; }

		const sessionId = getSessionId();
		const matchId = randomId();

		const ok = await dbAssignMatch(
			sessionId,
			matchId,
			team,
			courtId,
			_clientId,
			_myName ?? "기기",
		);

		if (ok) {
			// 브로드캐스트 match_started 페이로드는 SessionPlayer 객체 형식 유지
			const { sessionPlayers } = get();
			const toPlayerPair = (ids: [string, string]): [SessionPlayer, SessionPlayer] =>
				ids.map((id) => sessionPlayers.get(id)).filter(Boolean) as [SessionPlayer, SessionPlayer];

			const payload: BroadcastPayload = {
				event: "match_started",
				payload: {
					matchId,
					courtId,
					gameType: team.gameType,
					teamA: toPlayerPair(team.teamA),
					teamB: toPlayerPair(team.teamB),
				},
			};
			get().applyBroadcast(payload);
			sendBroadcast(_channel, payload);
		} else {
			console.error(`[store] assign FAILED court=${courtId}`);
			// 코트 선점/편집 락 미보유 등 실패 → 서버 권위로 수렴(코트·lease 재동기화, 낙관적 편집자는 보기 전용으로).
			void get().resyncFromServer();
		}
	},

	handleComplete: async (courtId: number) => {
		const { courts, _channel, isEditor, _clientId, _myName } = get();
		const court = courts.find((c) => c.id === courtId);
		if (!court?.match || !_channel || !isEditor) return; // 보기 전용 차단

		const sessionId = getSessionId();
		const match = court.match;

		const result = await dbCompleteMatch(sessionId, match, _clientId, _myName ?? "기기");
		if (!result) {
			console.error(`[store] handleComplete dbCompleteMatch FAILED court=${courtId}`);
			void get().resyncFromServer(); // 편집 락 미보유/이미 완료 등 → 서버 권위로 수렴
			return;
		}

		// 브로드캐스트 페이로드에는 기존 형식(SessionPlayer 객체) 유지
		const { sessionPlayers } = get();
		const teamAPlayers = [
			sessionPlayers.get(match.teamA[0]),
			sessionPlayers.get(match.teamA[1]),
		].filter(Boolean) as [SessionPlayer, SessionPlayer];
		const teamBPlayers = [
			sessionPlayers.get(match.teamB[0]),
			sessionPlayers.get(match.teamB[1]),
		].filter(Boolean) as [SessionPlayer, SessionPlayer];

		const payload: BroadcastPayload = {
			event: "match_completed",
			payload: {
				matchId: match.id,
				courtId,
				gameType: match.gameType,
				teamA: teamAPlayers,
				teamB: teamBPlayers,
				updatedPlayers: result.updatedPlayers,
			},
		};
		get().applyBroadcast(payload);
		sendBroadcast(_channel, payload);
	},

	setResting: async (playerId: string, resting: boolean) => {
		const { isEditor } = get();
		if (!isEditor) return; // 보기 전용 차단
		const sessionId = getSessionId();
		if (!sessionId) return;
		const updated = await dbSetPlayerResting(playerId, sessionId, resting);
		if (!updated) {
			console.error(`[store] setResting FAILED player=${playerId} resting=${resting}`);
			return;
		}
		get().broadcastPlayerUpdated(updated);
	},

	confirmCock: async (playerId: string) => {
		if (!get().isEditor) return; // 보기 전용 차단(공유 변경)
		const player = get().sessionPlayers.get(playerId);
		const updated = await dbSetCockChecked(playerId);
		if (!updated) {
			console.error(`[store] confirmCock FAILED player=${playerId}`);
			return;
		}
		// 월별 콕 지원 소진 — 회원이고 지원량>0이면 이번 달 첫 콕체크에서 1회 소진(upsert 멱등 → 같은 달 재확인 no-op).
		const support = get().groupSettings?.cockSupportPerMonth ?? 0;
		if (player?.memberId && support > 0) {
			void grantCockSupport(player.memberId, monthKST(), getSessionId());
		}
		get().broadcastPlayerUpdated(updated); // 로컬 반영 + 타 기기 전파(postgres_changes도 백업)
	},

	broadcastPlayerUpdated: (player) => {
		const { _channel } = get();
		const payload: BroadcastPayload = { event: "player_updated", payload: { player } };
		get().applyBroadcast(payload);
		if (_channel) sendBroadcast(_channel, payload);
	},

	handleSetMatchRoster: async (courtId, teamA, teamB) => {
		const { courts, isEditor, _channel, _clientId, _myName } = get();
		if (!isEditor) return; // 보기 전용 차단
		const court = courts.find((c) => c.id === courtId);
		if (!court?.match) return;
		const oldIds = matchPlayerIds(court.match);
		const newIds = matchPlayerIds({ teamA, teamB });
		const removed = oldIds.filter((id) => !newIds.includes(id));
		const added = newIds.filter((id) => !oldIds.includes(id));
		if (removed.length === 0) return; // 변경 없음

		const sessionId = getSessionId();
		// set_match_roster RPC: (편집 락 가드 +) 로스터 교체 + 선수 상태 + match_state_version++ 를 단일 트랜잭션 원자 처리.
		const updatedPlayers = await dbSetMatchRoster(sessionId, court.match.id, teamA, teamB, removed, added, _clientId, _myName ?? "기기");
		if (!updatedPlayers) {
			console.error(`[store] handleSetMatchRoster FAILED court=${courtId}`);
			void get().resyncFromServer(); // 편집 락 미보유 등 → 서버 권위로 수렴
			return;
		}
		// 즉시성 broadcast(match_roster_updated) — 다른 기기는 이걸로 즉시 반영하고, 놓쳐도 sessions
		// match_state_version 갭으로 refetchMatches 가 수렴(H3 해결: 더 이상 "편집자만 보임"이 아님).
		const payload: BroadcastPayload = {
			event: "match_roster_updated",
			payload: { matchId: court.match.id, courtId, teamA, teamB, updatedPlayers },
		};
		get().applyBroadcast(payload); // 발신측 로컬 반영(broadcast self:false)
		if (_channel) sendBroadcast(_channel, payload);
	},

	handleEndSession: async (onEnd: () => void) => {
		if (!get().isEditor) return; // 보기 전용 차단
		const sessionId = getSessionId();
		if (!sessionId) return;
		// 진행 중인 경기는 먼저 자동 완료 처리 — complete_match RPC로 game_count/혼복/pair_history를 정상 집계하고
		// 다른 클라이언트엔 match_completed 브로드캐스트로 코트를 비운다. (현재 코트 스냅샷으로 순회; handleComplete가
		// 코트를 id로 재조회 + court.match 가드라 이미 비워진 코트는 안전하게 no-op.)
		const activeCourtIds = get().courts.filter((c) => c.match).map((c) => c.id);
		for (const courtId of activeCourtIds) {
			await get().handleComplete(courtId);
		}
		// sessions.is_active=false → 다른 클라이언트는 meta 채널(postgres watch)로 종료 감지.
		// 종료를 실행한 클라이언트는 onEnd로 즉시 이탈.
		await dbEndSession(sessionId);
		onEnd();
	},

	notifySessionRefresh: () => {
		const { _channel } = get();
		if (_channel) {
			const payload: BroadcastPayload = {
				event: "session_refresh_required",
				payload: {},
			};
			sendBroadcast(_channel, payload);
		}
	},

	// ── Channel management ──────────────────────────────────
	applyBroadcast: (ev: BroadcastPayload) => {
		type Handler = (payload: BroadcastPayloadData, set: SetFn, get: GetFn) => void;
		const handlers: Record<string, Handler> = {
			match_started: (p, s) => handleMatchStarted(p, s),
			match_completed: (p, s) => handleMatchCompleted(p, s),
			match_roster_updated: (p, s) => handleMatchRosterUpdated(p, s),
			player_updated: (p, s) => handlePlayerUpdated(p, s),
			session_refresh_required: (p, s, g) => handleSessionRefreshRequired(p, s, g),
			board_drafts_updated: (p, s, g) => handleBoardDraftsUpdated(p, s, g),
		};

		const evWithPayload = ev as { payload?: BroadcastPayloadData };
		handlers[ev.event]?.(evWithPayload.payload ?? {}, set, get);
	},

	claimEditor: async () => {
		// 명시 "편집 권한 가져오기" = 강제 탈취. board_claim_editor(CAS)는 활성 보유자의 유효 lease를 못 뺏으므로
		// (그래서 가져오기가 직전 보유자로 되돌아간다) 전용 board_takeover_editor로 무조건 서버 row를 나로 덮어쓴다.
		// 직전 보유자는 다음 heartbeat(CAS) 거부 + 실시간 row 수신으로 읽기 모드로 떨어진다(단일 편집자 수렴).
		// RPC를 먼저 await 후 점유 확정 — 낙관적 선점이 직전 보유자 heartbeat row 갱신과 겹쳐 되돌아가는 레이스를 피한다.
		// 편집 권한 획득은 운영진(isAdmin)만 — 일반 회원은 읽기 전용이라 점유/탈취 불가.
		if (!useAuthStore.getState().isAdmin) return;
		const { _clientId, _myName, isEditor, presenceCount } = get();
		if (isEditor || !_clientId) return;
		const name = _myName ?? "기기";
		// 체감 지연의 원인: 본래 takeover RPC 왕복을 await한 뒤에야 편집 모드로 전환했다(직전 보유자 heartbeat와
		// 겹쳐 되돌아가는 레이스 회피용). 그런데 혼자(presenceCount<=1)면 경쟁 보유자가 없어 그 레이스가 없으므로,
		// 즉시 낙관적으로 편집 모드로 전환해 버튼 지연을 없앤다. 단 heartbeat(CAS)는 takeover 확정 전엔 띄우지 않는다 —
		// 직전 보유자의 유효 lease를 board_claim_editor(CAS)로는 못 뺏어 즉시 resync로 되돌려지기 때문.
		const solo = presenceCount <= 1;
		if (solo) {
			lockEpoch++;
			cachedEditor = { clientId: _clientId, name, leaseUntilMs: Date.now() + LEASE_SECONDS * 1000 };
			set(computeLockFromRow(cachedEditor, _clientId, Date.now())); // isEditor 즉시 true (heartbeat는 아직 X)
		}
		const res = await dbBoardTakeoverEditor(getSessionId(), _clientId, name, LEASE_SECONDS);
		if (!res) {
			// 탈취 실패(네트워크 등) — 낙관 선점했다면 서버 권위로 되돌리고, 아니면 상태 변경 없음.
			if (solo) void get().resyncFromServer();
			return;
		}
		lockEpoch++; // 권위적 변경 — in-flight heartbeat .then 무효화
		cachedEditor = {
			clientId: _clientId,
			name,
			leaseUntilMs: res.leaseUntil ? Date.parse(res.leaseUntil) : Date.now() + LEASE_SECONDS * 1000,
		};
		recomputeLock(get, set); // 나=보유자 → isEditor + heartbeat 시작(이후 board_claim_editor editor=me로 연장)
	},
	claimEditingIfFree: () => {
		// 첫 편집 시 자유 상태면 점유(boardStore.claimEdit 경로). 남이 유효 lease면 점유 안 함(보기 전용 유지).
		// 편집 권한 획득은 운영진(isAdmin)만 — 일반 회원은 자유 상태여도 점유하지 않고 읽기 전용 유지.
		if (!useAuthStore.getState().isAdmin) return;
		const { isEditor, lockFree, _clientId } = get();
		if (isEditor || !lockFree || !_clientId) return;
		claimNow(get, set);
	},
	handoffEditor: async (toClientId, toName) => {
		const { _clientId, isEditor } = get();
		if (!isEditor || !_clientId) return;
		const res = await dbBoardHandoffEditor(getSessionId(), _clientId, toClientId, toName, LEASE_SECONDS);
		if (!res) return; // 양도 실패(이미 내가 보유자 아님)
		lockEpoch++; // 권위적 변경 — in-flight heartbeat .then 무효화(양도 직후 stale 갱신 방지)
		cachedEditor = {
			clientId: res.clientId,
			name: res.name,
			leaseUntilMs: res.leaseUntil ? Date.parse(res.leaseUntil) : Date.now() + LEASE_SECONDS * 1000,
		};
		recomputeLock(get, set, { suppressLossNotice: true }); // 자발적 양도 → 보기 전용(뺏김 알림 X)
	},
	dismissEditorTakenNotice: () => set({ editorTakenBy: null }),
	applyDraftsIfNewer: (drafts, version) => applyDraftsIfNewerImpl(get, set, drafts, version),
	resyncFromServer: async (opts) => {
		const sid = getSessionId();
		if (!sid) return;
		// load_session_state: board_drafts + matches + 버전 + 편집 락을 단일 트랜잭션 스냅샷으로 — 두 권위가
		// 항상 같은 시점으로 수렴(옵션 B). 재구독 catch-up · board_save_drafts 충돌 복구 공용 경로.
		// indicate=true(포어그라운드 복귀·재연결 catch-up)일 때만 "동기화 중" pill 노출. 실패/충돌 복구
		// resync는 순간적이라 깜빡임을 피하려 표시하지 않는다.
		const indicate = opts?.indicate ?? false;
		let snap: Awaited<ReturnType<typeof dbLoadSessionState>>;
		if (indicate) set({ boardSyncing: true });
		try {
			snap = await dbLoadSessionState(sid);
		} finally {
			if (indicate) set({ boardSyncing: false });
		}
		if (!snap) return;
		lockEpoch++;
		// 강제 적용(<= 멱등 가드 우회): 충돌 복구 시 미저장 로컬 편집을 서버값으로 되돌리려면 boardDrafts
		// 객체참조를 반드시 갈아 SessionBoard의 applyRemoteDrafts(서버 멤버십 reconcile)를 트리거해야 한다.
		// 코트(courts)도 같은 스냅샷의 matches 로 재구성해 board_drafts 와 시점 일치.
		set({
			boardDrafts: snap.drafts,
			boardDraftsVersion: Math.max(get().boardDraftsVersion, snap.version),
			courts: matchRowsToCourts(snap.courtCount || get().courts.length, snap.matches),
			matchStateVersion: Math.max(get().matchStateVersion, snap.matchStateVersion),
		});
		cachedEditor = {
			clientId: snap.editorClientId,
			name: snap.editorName,
			leaseUntilMs: snap.editorLeaseUntil ? Date.parse(snap.editorLeaseUntil) : 0,
		};
		recomputeLock(get, set);
	},
	refetchMatches: async (targetVersion, force = false) => {
		// 멱등 단조 가드 — 이미 최신이면 중복 SELECT 회피(broadcast 정상 구간). force=true 면 우회(재연결).
		if (!force && targetVersion <= get().matchStateVersion) return;
		const sid = getSessionId();
		if (!sid) return;
		const rows = await dbLoadMatches(sid);
		const courtCount = get().courts.length;
		set({
			courts: matchRowsToCourts(courtCount, rows),
			matchStateVersion: Math.max(get().matchStateVersion, targetVersion),
		});
	},

	subscribe: (sessionId: number, onEnd: () => void) => {
		// 편집 락/연결 식별자 — 로그인 사용자 id(사람 단위). 같은 사람의 리로드·다른 탭·다른 기기는 같은 id라
		// 서버 row의 editor=client 분기로 자기 lease를 즉시 재획득하고(자기 잠금 없음), 다른 사람은 다른 id라
		// 단일 편집자(+"편집 권한 가져오기")가 유지된다. user.id 부재(미로그인 등) 시에만 탭 단위 clientId로 폴백.
		// 보유자 이름도 실명(myName)으로 — "OO님이 편집 중" 표시. (presence/broadcast self-echo는 연결 단위라 무영향.)
		const auth = useAuthStore.getState();
		const myClientId = auth.user?.id ?? getClientId();
		const myName = auth.myName ?? getDeviceName();

		const { broadcastChannel, metaChannel } = createSessionChannels(
			sessionId,
			myClientId,
			myName,
			{
				onBroadcast: (payload) => get().applyBroadcast(payload),
				// presence는 접속자 목록 표시 전용(편집권 election 아님 — 편집권은 서버 권위 락).
				// 단, 혼자뿐이면 보기 전용 단계 없이 자동 점유(아래 maybeClaimIfAlone, lockFree 가드로 안전).
				onPresenceSync: (state) => {
					set(computePresenceList(state));
					maybeClaimIfAlone(get, set);
				},
				onEnd,
				// sessions row UPDATE → match_assign_count + board_drafts/version catch-up(원인1) + 편집 락(원인2).
				onSessionRowUpdate: (row) => {
					if (row.match_assign_count != null) set({ matchAssignCount: row.match_assign_count });
					if (row.board_drafts !== undefined) {
						applyDraftsIfNewerImpl(
							get,
							set,
							row.board_drafts ?? { teams: [], reservations: [] },
							row.board_drafts_version ?? 0,
						);
					}
					// 코트 배정 catch-up: match_state_version 갭이면 matches 권위 재조회(H1/H2 해결).
					// broadcast(match_started/completed/roster)를 놓친 기기도 이 sessions UPDATE 한 번이면 수렴.
					if (row.match_state_version != null) {
						void get().refetchMatches(row.match_state_version);
					}
					setCachedEditorFromRow(row);
					recomputeLock(get, set);
				},
				// 재구독(재연결) 직후 1회 재조회 — SUBSCRIBED~첫 UPDATE 공백 보정(drafts+버전+락 모두).
				// 서버 권위 락이 확정된 뒤 혼자뿐이면 자동 점유(보기 전용 단계 생략).
				onResync: () => {
					void get().resyncFromServer({ indicate: true }).then(() => maybeClaimIfAlone(get, set));
				},
				// session_players row 변경(추가/삭제/상태)을 즉시 반영 — broadcast 누락/지연과 무관하게
				// 모든 기기의 sessionPlayers가 DB와 수렴(중복·미동기화·다중상태 방지). 보드는 sessionPlayers
				// 변경 시 initializeFromPool로 자동 재정합(삭제된 선수의 자석·예약 정리).
				onSessionPlayersChange: (payload) => {
					if (payload.eventType === "DELETE") {
						const id = (payload.old as { id?: string }).id;
						if (!id) return;
						set((state) => {
							if (!state.sessionPlayers.has(id)) return {};
							const newMap = new Map(state.sessionPlayers);
							newMap.delete(id);
							// 경기중 선수가 외부에서 삭제되면 코트 match 참조가 끊기므로 그 코트를 비워 정합 유지.
							const affectsCourt = state.courts.some(
								(c) => c.match != null && matchPlayerIds(c.match).includes(id),
							);
							const courts = affectsCourt
								? state.courts.map((c) =>
										c.match != null && matchPlayerIds(c.match).includes(id) ? { ...c, match: null } : c,
									)
								: state.courts;
							return { sessionPlayers: newMap, courts, ...rebuildDerivedIds(newMap) };
						});
						return;
					}
					const row = payload.new as unknown as SessionPlayerRow;
					if (!row?.id) return;
					set((state) => {
						const newMap = upsertPlayers(state.sessionPlayers, [rowToSessionPlayer(row)]);
						return { sessionPlayers: newMap, ...rebuildDerivedIds(newMap) };
					});
				},
			},
		);

		set({ _channel: broadcastChannel, _metaChannel: metaChannel, _clientId: myClientId, _myName: myName });

		// 편집 락 lifecycle 설치(서버 권위 락) — 매 구독마다 초기화.
		lockEpoch++; // 세션 경계 — 이전 세션의 in-flight heartbeat .then 무효화
		cachedEditor = { clientId: null, name: null, leaseUntilMs: 0 };
		recomputeLock(get, set); // 초기 lockFree; SUBSCRIBED 후 onResync가 서버 권위로 채움
		if (reevalTimer) clearInterval(reevalTimer);
		// lease 만료(보유자 crash, row update 없음)를 로컬 시계로 감지해 lockFree로 떨군다.
		// 떨군 직후 혼자뿐이면 자동 점유까지(직전 보유자가 나갔고 나 혼자 남은 경우 보기 전용 고착 방지).
		reevalTimer = setInterval(() => {
			recomputeLock(get, set);
			maybeClaimIfAlone(get, set);
		}, REEVAL_MS);
		// 백그라운드: heartbeat 멈춤(불필요 RPC 방지). 복귀 시에는 "낙관 선점" 대신 서버 권위로 먼저
		// 재동기화한다 — 백그라운드 동안 lease가 만료돼 다른 기기가 점유했을 수 있으므로, 무조건 claimNow하면
		// "두 명이 편집자"인 윈도우가 생긴다(직전 버그). resync 후 내가 여전히 보유자면 isEditor 유지(heartbeat
		// 재가동), 남이 점유했으면 보기 전용으로 정확히 떨어진다.
		if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
		visibilityHandler = () => {
			if (document.hidden) {
				stopHeartbeat();
				return;
			}
			// 복귀: 서버 권위로 재동기만. 자동 점유는 "혼자일 때만"(maybeClaimIfAlone, presenceCount<=1)으로 일원화한다.
			// 2명 이상이면 창 액티브만으로는 편집권을 자동으로 가져오지 않는다 — 인원수와 무관하게 자유 락을 낚아채
			// 다른 사람에게서 뺏기는 것처럼 보이던 재점유 경로 제거. 명시 점유(드래그 편집)/"편집 권한 가져오기"로만 편집자가 된다.
			void get().resyncFromServer({ indicate: true }).then(() => maybeClaimIfAlone(get, set));
		};
		document.addEventListener("visibilitychange", visibilityHandler);
		// 정상 이탈(탭 닫기/이동): 편집 락 즉시 해제 + heartbeat 정지(best-effort). crash/강제종료는 lease 만료가 백업.
		if (pageHideHandler) window.removeEventListener("pagehide", pageHideHandler);
		pageHideHandler = () => {
			const { _clientId, isEditor } = get();
			if (isEditor && _clientId) void dbBoardReleaseEditor(getSessionId(), _clientId);
			stopHeartbeat();
		};
		window.addEventListener("pagehide", pageHideHandler);
	},

	unsubscribe: () => {
		const { _channel, _metaChannel, _clientId, isEditor } = get();
		// 편집 보유자면 명시 해제(best-effort). 실패해도 lease 만료가 백업.
		if (isEditor && _clientId) void dbBoardReleaseEditor(getSessionId(), _clientId);
		stopHeartbeat();
		if (reevalTimer) {
			clearInterval(reevalTimer);
			reevalTimer = null;
		}
		if (visibilityHandler) {
			document.removeEventListener("visibilitychange", visibilityHandler);
			visibilityHandler = null;
		}
		if (pageHideHandler) {
			window.removeEventListener("pagehide", pageHideHandler);
			pageHideHandler = null;
		}
		lockEpoch++;
		cachedEditor = { clientId: null, name: null, leaseUntilMs: 0 };
		if (_channel) supabase.removeChannel(_channel);
		if (_metaChannel) supabase.removeChannel(_metaChannel);
		set({
			_channel: null,
			_metaChannel: null,
			_clientId: null,
			_myName: null,
			isEditor: false,
			presenceCount: 0,
			presenceList: [],
			holderClientId: null,
			holderName: null,
			lockFree: true,
			editorTakenBy: null,
		});
	},
}));
