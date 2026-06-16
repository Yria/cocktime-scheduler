import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import {
	type BroadcastPayload,
	createBroadcastChannel,
	dbAssignMatch,
	dbCompleteMatch,
	dbEndSession,
	dbSetMatchRoster,
	dbSetPlayerResting,
	sendBroadcast,
	supabase,
} from "../lib/supabase";
import type { ClientSessionState } from "../lib/supabase";
import { recordHistory } from "../lib/teamSelection";
import type {
	Court,
	GameType,
	GeneratedTeam,
	PairHistory,
	SessionPlayer,
} from "../types";
import type { BoardDraftsPayload } from "../types/board";
import { useAppStore } from "./appStore";
import { getDeviceName } from "../lib/deviceName";

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

/**
 * 양도형 편집 락 — presenceState에서 "현재 접속자 중 가장 최근에 점유(claim)한 기기"를 보유자로 산정.
 * 아무도 claim 안 했으면 lockFree=true(자유, 누구나 편집 가능, 첫 편집이 자동 점유).
 * 모든 클라이언트가 동일 presence 집합을 보므로 결정이 일치. 보유자 이탈 시 presence에서 사라져 자동 자유/인계.
 * isEditor(=편집 가능) = 내가 보유자이거나 lockFree.
 */
type PresenceEntry = { clientId: string; name: string };
function computePresence(
	state: Record<string, Array<Record<string, unknown>>>,
	myClientId: string,
	myClaimAt: number,
): {
	presenceCount: number;
	presenceList: PresenceEntry[];
	holderClientId: string | null;
	holderName: string | null;
	lockFree: boolean;
	isEditor: boolean;
} {
	const byId = new Map<string, { name: string; claimAt: number }>();
	for (const arr of Object.values(state)) {
		for (const p of arr) {
			const cid = p?.clientId;
			if (typeof cid !== "string") continue;
			const claimAt = typeof p?.claimAt === "number" ? (p.claimAt as number) : 0;
			const name = typeof p?.name === "string" ? (p.name as string) : "기기";
			const ex = byId.get(cid);
			if (!ex || claimAt > ex.claimAt) byId.set(cid, { name, claimAt });
		}
	}
	// 내 최신 claim이 presence에 아직 반영 안 됐을 수 있어 로컬 값으로 보정(깜빡임 방지)
	const mine = byId.get(myClientId);
	if (mine && myClaimAt > mine.claimAt) mine.claimAt = myClaimAt;

	const claimants = [...byId.entries()]
		.filter(([, v]) => v.claimAt > 0)
		.sort((a, b) => b[1].claimAt - a[1].claimAt || a[0].localeCompare(b[0]));
	const holder = claimants[0];
	const holderClientId = holder?.[0] ?? null;
	const holderName = holder?.[1].name ?? null;
	const lockFree = holderClientId === null;
	return {
		presenceCount: byId.size,
		presenceList: [...byId.entries()].map(([cid, v]) => ({ clientId: cid, name: v.name })),
		holderClientId,
		holderName,
		lockFree,
		isEditor: lockFree || holderClientId === myClientId,
	};
}

/** 편집 권한 점유/인계 — 현재 보유자보다 큰 claim을 부여(시계 오차 무관). 낙관적 즉시 반영. */
function doClaim(get: GetFn, set: SetFn) {
	const { _channel, _clientId, _myName, _myClaimAt } = get();
	if (!_channel || !_clientId) return;
	const state = _channel.presenceState() as unknown as Record<string, Array<Record<string, unknown>>>;
	let maxClaim = _myClaimAt;
	for (const arr of Object.values(state)) {
		for (const p of arr) {
			const c = p?.claimAt;
			if (typeof c === "number" && c > maxClaim) maxClaim = c;
		}
	}
	const myClaimAt = Math.max(Date.now(), maxClaim + 1);
	const name = _myName ?? "기기";
	void _channel.track({ clientId: _clientId, name, claimAt: myClaimAt });
	set({ _myClaimAt: myClaimAt, isEditor: true, lockFree: false, holderClientId: _clientId, holderName: name });
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
		const newPairHistory = recordHistory(state.pairHistory, {
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

function handleBoardDraftsUpdated(payload: BroadcastPayloadData, set: SetFn) {
	// 캐시만 갱신. 실제 보드 반영은 SessionBoard가 boardDrafts 변화를 감지해 applyRemoteDrafts로 수행.
	set({ boardDrafts: payload as unknown as BoardDraftsPayload });
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

	// ── 편집 락(presence, 양도형) ──────────────────────────
	/** 편집 가능 여부(= 내가 보유자이거나 락이 비어있음). false면 보기 전용. */
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

	// Internal channel reference (not reactive)
	_channel: RealtimeChannel | null;
	_metaChannel: RealtimeChannel | null;
	/** 이 클라이언트의 presence 식별자. */
	_clientId: string | null;
	/** 이 기기 이름. */
	_myName: string | null;
	/** 이 기기의 최신 claim 시각(ms, 0=미점유). */
	_myClaimAt: number;

	initialize: (initial: ClientSessionState) => void;
	reset: () => void;

	// DB Actions
	handleAssign: (team: GeneratedTeam, courtId: number) => Promise<void>;
	handleComplete: (courtId: number) => Promise<void>;
	/** 휴식 토글. resting=true 휴식 진입 / false 복귀(deficit 보정). player_updated 브로드캐스트. */
	setResting: (playerId: string, resting: boolean) => Promise<void>;
	/** 경기 수정: 진행중 매치의 최종 로스터 설정(직접 DB 반영, 동기화 없음, 로컬만 갱신). */
	handleSetMatchRoster: (
		courtId: number,
		teamA: [string, string],
		teamB: [string, string],
	) => Promise<void>;
	handleEndSession: (onEnd: () => void) => Promise<void>;

	notifySessionRefresh: () => void;

	// 편집 락 — 명시적 인계(권한 가져오기) / 자유 상태에서 자동 점유
	claimEditor: () => void;
	claimEditingIfFree: () => void;

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
	isEditor: false,
	presenceCount: 0,
	presenceList: [] as { clientId: string; name: string }[],
	holderClientId: null as string | null,
	holderName: null as string | null,
	lockFree: true,
	_channel: null as RealtimeChannel | null,
	_metaChannel: null as RealtimeChannel | null,
	_clientId: null as string | null,
	_myName: null as string | null,
	_myClaimAt: 0,
};

export const useSessionStore = create<SessionState>((set, get) => ({
	...initialState,

	initialize: (initial) => {
		const playerMap = new Map(initial.players.map((p) => [p.id, p]));
		const { waitingIds, restingIds } = rebuildDerivedIds(playerMap);
		set({
			...initialState,
			_channel: get()._channel,
			_metaChannel: get()._metaChannel,
			courts: initial.courts,
			sessionPlayers: playerMap,
			waitingIds,
			restingIds,
			pairHistory: initial.pairHistory,
			matchAssignCount: initial.matchAssignCount,
			lastGameType: initial.lastGameType,
			boardDrafts: initial.boardDrafts,
		});
	},
	reset: () => {
		get().unsubscribe();
		set(initialState);
	},

	// ── DB Actions ──────────────────────────────────────────
	handleAssign: async (team: GeneratedTeam, courtId: number) => {
		const { courts, _channel, isEditor } = get();
		if (!_channel || !isEditor) { return; } // 보기 전용 차단

		const court = courts.find((c) => c.id === courtId);
		if (!court || court.match) { return; }

		const sessionId = getSessionId();
		const matchId = crypto.randomUUID();

		const ok = await dbAssignMatch(
			sessionId,
			matchId,
			team,
			courtId,
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
		}
	},

	handleComplete: async (courtId: number) => {
		const { courts, _channel, isEditor } = get();
		const court = courts.find((c) => c.id === courtId);
		if (!court?.match || !_channel || !isEditor) return; // 보기 전용 차단

		const sessionId = getSessionId();
		const match = court.match;

		const result = await dbCompleteMatch(sessionId, match);
		if (!result) { console.error(`[store] handleComplete dbCompleteMatch FAILED court=${courtId}`); return; }

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
		const { _channel, isEditor } = get();
		if (!isEditor) return; // 보기 전용 차단
		const sessionId = getSessionId();
		if (!sessionId) return;
		const updated = await dbSetPlayerResting(playerId, sessionId, resting);
		if (!updated) {
			console.error(`[store] setResting FAILED player=${playerId} resting=${resting}`);
			return;
		}
		const payload: BroadcastPayload = { event: "player_updated", payload: { player: updated } };
		get().applyBroadcast(payload);
		if (_channel) sendBroadcast(_channel, payload);
	},

	handleSetMatchRoster: async (courtId, teamA, teamB) => {
		const { courts, isEditor } = get();
		if (!isEditor) return; // 보기 전용 차단
		const court = courts.find((c) => c.id === courtId);
		if (!court?.match) return;
		const oldIds = [...court.match.teamA, ...court.match.teamB];
		const newIds = [...teamA, ...teamB];
		const removed = oldIds.filter((id) => !newIds.includes(id));
		const added = newIds.filter((id) => !oldIds.includes(id));
		if (removed.length === 0) return; // 변경 없음

		const ok = await dbSetMatchRoster(court.match.id, teamA, teamB, removed, added);
		if (!ok) {
			console.error(`[store] handleSetMatchRoster FAILED court=${courtId}`);
			return;
		}
		// 동기화 안 함(결과만 서버 반영) — 편집자 로컬 상태만 갱신. 다른 기기는 다음 로드 시 반영.
		set((state) => {
			const newMap = new Map(state.sessionPlayers);
			const nowIso = new Date().toISOString();
			for (const id of removed) {
				const p = newMap.get(id);
				if (p) newMap.set(id, { ...p, status: "waiting", waitSince: nowIso });
			}
			for (const id of added) {
				const p = newMap.get(id);
				if (p) newMap.set(id, { ...p, status: "playing" });
			}
			const { waitingIds, restingIds } = rebuildDerivedIds(newMap);
			return {
				sessionPlayers: newMap,
				waitingIds,
				restingIds,
				courts: state.courts.map((c) =>
					c.id === courtId && c.match ? { ...c, match: { ...c.match, teamA, teamB } } : c,
				),
			};
		});
	},

	handleEndSession: async (onEnd: () => void) => {
		if (!get().isEditor) return; // 보기 전용 차단
		const sessionId = getSessionId();
		if (!sessionId) return;
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
			player_updated: (p, s) => handlePlayerUpdated(p, s),
			session_refresh_required: (p, s, g) => handleSessionRefreshRequired(p, s, g),
			board_drafts_updated: (p, s) => handleBoardDraftsUpdated(p, s),
		};

		const evWithPayload = ev as { payload?: BroadcastPayloadData };
		handlers[ev.event]?.(evWithPayload.payload ?? {}, set, get);
	},

	claimEditor: () => {
		doClaim(get, set); // 명시적 인계(권한 가져오기)
	},
	claimEditingIfFree: () => {
		if (!get().lockFree) return; // 자유일 때만 자동 점유(이미 점유됐으면 그대로)
		doClaim(get, set);
	},

	subscribe: (sessionId: number, onEnd: () => void) => {
		const { applyBroadcast } = get();

		// 편집 락용 presence 식별자 — 이 연결의 clientId + 기기 이름
		const myClientId = crypto.randomUUID();
		const myName = getDeviceName();

		// Broadcast + presence channel
		const channel = createBroadcastChannel(sessionId, myClientId);
		const events = [
			"match_started",
			"match_completed",
			"player_updated",
			"board_drafts_updated",
			"session_refresh_required",
		] as const;
		for (const event of events) {
			channel.on("broadcast", { event }, ({ payload }) =>
				applyBroadcast({ event, payload } as BroadcastPayload),
			);
		}
		// presence 변경(sync/join/leave) → 보유자/접속자 재산정.
		// join/leave도 명시 구독해 보유자 이탈 시 인계가 지연되지 않게 한다.
		const syncPresence = () => {
			const state = channel.presenceState() as unknown as Record<
				string,
				Array<Record<string, unknown>>
			>;
			const info = computePresence(state, myClientId, get()._myClaimAt);
			set(info);
			// 자유(아무도 점유 안 함) 상태면 접속자 중 clientId 최소 1명이 즉시 자동 점유 →
			// "접속하면 곧바로 편집자 1명 확정, 나머지는 보기 전용". 보유자 이탈 시에도 남은 최소 1명이 인계.
			if (info.lockFree && info.presenceList.length > 0) {
				const lowest = info.presenceList.map((p) => p.clientId).sort()[0];
				if (lowest === myClientId) doClaim(get, set);
			}
		};
		channel.on("presence", { event: "sync" }, syncPresence);
		channel.on("presence", { event: "join" }, syncPresence);
		channel.on("presence", { event: "leave" }, syncPresence);
		channel.subscribe((status) => {
			if (status === "SUBSCRIBED") {
				// 입장만 track(claimAt=0, 미점유). 첫 편집/인계 시 doClaim이 claimAt을 올린다.
				void channel
					.track({ clientId: myClientId, name: myName, claimAt: 0 })
					.then(() => syncPresence())
					.catch((e) => console.error("presence track failed:", e));
			}
		});

		// Session meta channel — 다른 클라이언트의 세션 종료(is_active=false) 및 match_assign_count 동기화
		const metaChannel = supabase
			.channel(`session-meta:${sessionId}`)
			.on(
				"postgres_changes",
				{
					event: "UPDATE",
					schema: "public",
					table: "sessions",
					filter: `id=eq.${sessionId}`,
				},
				(payload) => {
					const row = payload.new as { is_active: boolean; match_assign_count?: number };
					if (!row.is_active) { onEnd(); return; }
					if (row.match_assign_count !== undefined) {
						set({ matchAssignCount: row.match_assign_count });
					}
				},
			)
			.subscribe();

		set({ _channel: channel, _metaChannel: metaChannel, _clientId: myClientId, _myName: myName, _myClaimAt: 0 });
	},

	unsubscribe: () => {
		const { _channel, _metaChannel } = get();
		if (_channel) supabase.removeChannel(_channel);
		if (_metaChannel) supabase.removeChannel(_metaChannel);
		set({
			_channel: null,
			_metaChannel: null,
			_clientId: null,
			_myName: null,
			_myClaimAt: 0,
			isEditor: false,
			presenceCount: 0,
			presenceList: [],
			holderClientId: null,
			holderName: null,
			lockFree: true,
		});
	},
}));
