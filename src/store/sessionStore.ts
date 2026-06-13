import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import {
	type BroadcastPayload,
	createBroadcastChannel,
	dbAssignMatch,
	dbCompleteMatch,
	dbEndSession,
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
	set((state) => ({
		sessionPlayers: upsertPlayers(state.sessionPlayers, [player]),
	}));
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

	// Internal channel reference (not reactive)
	_channel: RealtimeChannel | null;
	_metaChannel: RealtimeChannel | null;

	initialize: (initial: ClientSessionState) => void;
	reset: () => void;

	// DB Actions
	handleAssign: (team: GeneratedTeam, courtId: number) => Promise<void>;
	handleComplete: (courtId: number) => Promise<void>;
	handleEndSession: (onEnd: () => void) => Promise<void>;

	notifySessionRefresh: () => void;

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
	_channel: null as RealtimeChannel | null,
	_metaChannel: null as RealtimeChannel | null,
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
		const { courts, _channel } = get();
		if (!_channel) { return; }

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
		const { courts, _channel } = get();
		const court = courts.find((c) => c.id === courtId);
		if (!court?.match || !_channel) return;

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

	handleEndSession: async (onEnd: () => void) => {
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

	subscribe: (sessionId: number, onEnd: () => void) => {
		const { applyBroadcast } = get();

		// Broadcast channel
		const channel = createBroadcastChannel(sessionId);
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
		channel.subscribe();

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

		set({ _channel: channel, _metaChannel: metaChannel });
	},

	unsubscribe: () => {
		const { _channel, _metaChannel } = get();
		if (_channel) supabase.removeChannel(_channel);
		if (_metaChannel) supabase.removeChannel(_metaChannel);
		set({ _channel: null, _metaChannel: null });
	},
}));
