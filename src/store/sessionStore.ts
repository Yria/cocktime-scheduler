import { create } from "zustand";
import {
	type BroadcastPayload,
	dbAssignMatch,
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
import { createSessionChannels } from "../lib/supabase/sessionChannels";
import { matchRowsToCourts, rowToSessionPlayer } from "../lib/supabase/transformers";
import type { SessionPlayerRow } from "../lib/supabase/types";
import { matchPlayerIds } from "../lib/board/membership";
import { computeLockFromRow, computePresenceList } from "../lib/editLock";
import type { GeneratedTeam, SessionPlayer } from "../types";
import { fetchGroupSettings, grantCockSupport } from "../lib/supabase/clubSettings";
import { monthKST } from "../lib/schedule/calendar";
import { getClientId, getDeviceName } from "../lib/deviceName";
import { randomId } from "../lib/randomId";
import { useAuthStore } from "./authStore";
import {
	applyDraftsIfNewerImpl,
	handleMatchCompleted,
	handleMatchRosterUpdated,
	handleMatchStarted,
	handlePlayerUpdated,
	handleSessionRefreshRequired,
	rebuildDerivedIds,
	upsertPlayers,
} from "./sessionBroadcastHandlers";
import {
	claimNow,
	getCachedEditor,
	installLockLifecycle,
	LEASE_SECONDS,
	recomputeLock,
	resetEditorCache,
	setCachedEditorFromRow,
	setEditorCache,
	teardownLockLifecycle,
} from "./sessionEditorLock";
import {
	type BroadcastPayloadData,
	type GetFn,
	getSessionId,
	initialState,
	type SessionState,
	type SetFn,
} from "./sessionStoreState";

export type { SessionState } from "./sessionStoreState";

export const useSessionStore = create<SessionState>((set, get) => ({
	...initialState,

	initialize: (initial) => {
		const playerMap = new Map(initial.players.map((p) => [p.id, p]));
		const { waitingIds, restingIds } = rebuildDerivedIds(playerMap);
		// 편집 락 캐시 리셋 — 구독 후 onResync가 서버 권위로 다시 채운다.
		resetEditorCache();
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
		// 로컬(발신자) 즉시 반영만. 다른 기기는 session_players postgres_changes(같은 write가 트리거)로
		// 수렴 — 별도 broadcast는 중복 전송이라 제거(Realtime 감축). applyBroadcast는 네트워크 안 탐.
		const payload: BroadcastPayload = { event: "player_updated", payload: { player } };
		get().applyBroadcast(payload);
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
			setEditorCache({ clientId: _clientId, name, leaseUntilMs: Date.now() + LEASE_SECONDS * 1000 });
			set(computeLockFromRow(getCachedEditor(), _clientId)); // isEditor 즉시 true (takeover 확정 전 낙관 반영)
		}
		const res = await dbBoardTakeoverEditor(getSessionId(), _clientId, name, LEASE_SECONDS);
		if (!res) {
			// 탈취 실패(네트워크 등) — 낙관 선점했다면 서버 권위로 되돌리고, 아니면 상태 변경 없음.
			if (solo) void get().resyncFromServer();
			return;
		}
		// 권위적 변경 — in-flight heartbeat .then 무효화(setEditorCache가 lockEpoch 증가)
		setEditorCache({
			clientId: _clientId,
			name,
			leaseUntilMs: res.leaseUntil ? Date.parse(res.leaseUntil) : Date.now() + LEASE_SECONDS * 1000,
		});
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
		// 권위적 변경 — in-flight heartbeat .then 무효화(양도 직후 stale 갱신 방지, setEditorCache가 lockEpoch 증가)
		setEditorCache({
			clientId: res.clientId,
			name: res.name,
			leaseUntilMs: res.leaseUntil ? Date.parse(res.leaseUntil) : Date.now() + LEASE_SECONDS * 1000,
		});
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
		// 강제 적용(<= 멱등 가드 우회): 충돌 복구 시 미저장 로컬 편집을 서버값으로 되돌리려면 boardDrafts
		// 객체참조를 반드시 갈아 SessionBoard의 applyRemoteDrafts(서버 멤버십 reconcile)를 트리거해야 한다.
		// 코트(courts)도 같은 스냅샷의 matches 로 재구성해 board_drafts 와 시점 일치.
		set({
			boardDrafts: snap.drafts,
			boardDraftsVersion: Math.max(get().boardDraftsVersion, snap.version),
			courts: matchRowsToCourts(snap.courtCount || get().courts.length, snap.matches),
			matchStateVersion: Math.max(get().matchStateVersion, snap.matchStateVersion),
		});
		// 서버 스냅샷이 권위 — in-flight heartbeat .then 무효화(setEditorCache가 lockEpoch 증가)
		setEditorCache({
			clientId: snap.editorClientId,
			name: snap.editorName,
			leaseUntilMs: snap.editorLeaseUntil ? Date.parse(snap.editorLeaseUntil) : 0,
		});
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
				// 자동 점유 없음 — 편집자가 되려면 편집 동작(드래그)이나 '편집 권한 가져오기' 버튼 필요.
				onPresenceSync: (state) => {
					set(computePresenceList(state));
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
				// 자동 점유 없음 — 편집자가 되려면 편집 동작(드래그)이나 '편집 권한 가져오기' 버튼 필요.
				onResync: () => {
					void get().resyncFromServer({ indicate: true });
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
		resetEditorCache(); // 세션 경계 — 이전 세션의 in-flight heartbeat .then 무효화(lockEpoch 증가)
		recomputeLock(get, set); // 초기 lockFree; SUBSCRIBED 후 onResync가 서버 권위로 채움
		installLockLifecycle(get);
	},

	unsubscribe: () => {
		const { _channel, _metaChannel, _clientId, isEditor } = get();
		// 편집 보유자면 명시 해제(best-effort). 실패(crash 등)해도 "편집 권한 가져오기"(takeover)로 회수.
		if (isEditor && _clientId) void dbBoardReleaseEditor(getSessionId(), _clientId);
		teardownLockLifecycle();
		resetEditorCache();
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
