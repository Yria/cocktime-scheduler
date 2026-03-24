import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import {
	type BroadcastPayload,
	createBroadcastChannel,
	dbAssignMatch,
	dbCompleteMatch,
	dbEndSession,
	dbSaveMatchQueue,
	dbToggleForceMixed,
	dbToggleForceHardGame,
	dbToggleResting,
	sendBroadcast,
	supabase,
} from "../lib/supabase";
import type { ClientSessionState } from "../lib/supabase";
import { recordHistory } from "../lib/teamSelection";
import { getPlayingPlayerIds } from "../lib/sessionUtils";
import type {
	Court,
	GeneratedTeam,
	PairHistory,
	SessionPlayer,
} from "../types";
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
	queuedPlayerIds: Set<string> = new Set(),
): { waitingIds: string[]; restingIds: string[] } {
	const waitingIds: string[] = [];
	const restingIds: string[] = [];
	for (const [id, p] of sessionPlayers) {
		if (p.status === "waiting" && !queuedPlayerIds.has(id)) waitingIds.push(id);
		else if (p.status === "resting") restingIds.push(id);
	}
	return { waitingIds, restingIds };
}

function handleMatchStarted(payload: BroadcastPayloadData, set: SetFn, _get: GetFn) {
	const { matchId, courtId, gameType, teamA, teamB } = payload;
	// teamA/B는 여전히 SessionPlayer 객체로 수신 (브로드캐스트 형식 유지)
	const teamAPlayers = teamA as [SessionPlayer, SessionPlayer];
	const teamBPlayers = teamB as [SessionPlayer, SessionPlayer];
	const teamAIds: [string, string] = [teamAPlayers[0].id, teamAPlayers[1].id];
	const teamBIds: [string, string] = [teamBPlayers[0].id, teamBPlayers[1].id];
	const allIds = new Set([...teamAIds, ...teamBIds]);
	const safeMatchId = matchId as string;
	const safeCourtId = courtId as number;
	const safeGameType = gameType as import("../types").GameType;

	set((state) => {
		// Map에 먼저 upsert (status='playing'으로 수신됨), courts에는 ID 참조 저장 (단일 배치)
		const newMap = upsertPlayers(state.sessionPlayers, [...teamAPlayers, ...teamBPlayers]);
		// matchQueue.teamA/B는 이제 [string, string] — 직접 ID 비교
		const newMatchQueue = state.matchQueue.filter((team) => {
			const teamIds = [...team.teamA, ...team.teamB];
			return !teamIds.every((id) => allIds.has(id));
		});
		const queuedIds = new Set(newMatchQueue.flatMap((t) => [...t.teamA, ...t.teamB]));
		const { waitingIds, restingIds } = rebuildDerivedIds(newMap, queuedIds);

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
			matchQueue: newMatchQueue,
			pairHistory: recordHistory(state.pairHistory, { teamA: teamAIds, teamB: teamBIds, gameType: safeGameType }),
			// candidateTeams.teamA/B도 [string, string] — 직접 ID 비교
			candidateTeams: state.candidateTeams.filter((team) => {
				const ids = new Set([...team.teamA, ...team.teamB]);
				return !(allIds.size === ids.size && [...allIds].every((id) => ids.has(id)));
			}),
		};
	});
}

function handleMatchCompleted(payload: BroadcastPayloadData, set: SetFn) {
	const { courtId, gameType, teamA, teamB, updatedPlayers } = payload;
	const teamAPlayers = teamA as [SessionPlayer, SessionPlayer];
	const teamBPlayers = teamB as [SessionPlayer, SessionPlayer];
	const allPlayers = [...teamAPlayers, ...teamBPlayers];

	set((state) => {
		const newPairHistory: Record<string, Set<string>> = {};
		for (const key of Object.keys(state.pairHistory)) {
			newPairHistory[key] = new Set(state.pairHistory[key]);
		}
		for (const [a, b] of [teamAPlayers, teamBPlayers] as [[SessionPlayer, SessionPlayer], [SessionPlayer, SessionPlayer]]) {
			if (!newPairHistory[a.id]) newPairHistory[a.id] = new Set();
			if (!newPairHistory[b.id]) newPairHistory[b.id] = new Set();
			newPairHistory[a.id].add(b.id);
			newPairHistory[b.id].add(a.id);
		}

		// matchQueue.teamA/B는 [string, string] — 직접 spread
		const queuedIds = new Set(
			state.matchQueue.flatMap((t: GeneratedTeam) => [...t.teamA, ...t.teamB]),
		);

		// Map 업데이트 후 rebuildDerivedIds로 파생 상태 재계산
		const newMap = upsertPlayers(state.sessionPlayers, updatedPlayers as SessionPlayer[]);
		const { waitingIds, restingIds } = rebuildDerivedIds(newMap, queuedIds);

		const nextCoPlayers = { ...state.lastCoPlayers };
		for (const player of allPlayers) {
			nextCoPlayers[player.id] = allPlayers
				.filter((p: SessionPlayer) => p.id !== player.id)
				.map((p: SessionPlayer) => p.id);
		}

		return {
			sessionPlayers: newMap,
			courts: state.courts.map((c) => (c.id !== courtId ? c : { ...c, match: null })),
			waitingIds,
			restingIds,
			pairHistory: newPairHistory,
			lastMixedPlayerIds:
				gameType === "혼복"
					? allPlayers.map((p: SessionPlayer) => p.id)
					: state.lastMixedPlayerIds,
			lastCoPlayers: nextCoPlayers,
		};
	});
}

function handlePlayerStatusChanged(payload: BroadcastPayloadData, set: SetFn) {
	const { player } = payload as { player: SessionPlayer };
	set((state) => {
		const newMap = upsertPlayers(state.sessionPlayers, [player]);
		// matchQueue.teamA/B는 [string, string] — 직접 spread
		const queuedIds = new Set(state.matchQueue.flatMap((t) => [...t.teamA, ...t.teamB]));
		const { waitingIds, restingIds } = rebuildDerivedIds(newMap, queuedIds);
		return { sessionPlayers: newMap, waitingIds, restingIds };
	});
}

function handlePlayerFlagChanged(payload: BroadcastPayloadData, set: SetFn) {
	const { player } = payload as { player: SessionPlayer };
	set((state) => ({
		sessionPlayers: upsertPlayers(state.sessionPlayers, [player]),
	}));
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

function handleQueueUpdated(payload: BroadcastPayloadData, set: SetFn) {
	const { queue, restoredPlayers } = payload;
	const newQueue = queue as GeneratedTeam[];
	// teamA/B는 [string, string] — 직접 spread
	const newQueuedIds = new Set(newQueue.flatMap((t) => [...t.teamA, ...t.teamB]));

	set((state) => {
		let newMap = state.sessionPlayers;
		if (restoredPlayers) {
			newMap = upsertPlayers(newMap, restoredPlayers as SessionPlayer[]);
		}
		const { waitingIds, restingIds } = rebuildDerivedIds(newMap, newQueuedIds);
		return { matchQueue: newQueue, sessionPlayers: newMap, waitingIds, restingIds };
	});
}

function handleCandidatesUpdated(payload: BroadcastPayloadData, set: SetFn) {
	set({ candidateTeams: payload.candidates as GeneratedTeam[] });
}

export interface SessionState {
	courts: Court[];
	sessionPlayers: Map<string, SessionPlayer>;
	waitingIds: string[];
	restingIds: string[];
	pairHistory: PairHistory;
	lastMixedPlayerIds: string[];
	lastCoPlayers: Record<string, string[]>;

	candidateTeams: GeneratedTeam[];
	matchQueue: GeneratedTeam[];
	showEndConfirm: boolean;

	// Internal channel reference (not reactive)
	_channel: RealtimeChannel | null;
	_metaChannel: RealtimeChannel | null;

	initialize: (initial: ClientSessionState) => void;
	reset: () => void;

	// DB Actions
	setCandidateTeams: (teams: GeneratedTeam[]) => void;
	updateCandidateTeam: (index: number, updatedTeam: GeneratedTeam) => void;
	handleAssign: (team: GeneratedTeam, courtId: number) => Promise<void>;
	handleComplete: (courtId: number) => Promise<void>;
	handleAddToQueue: (team: GeneratedTeam) => Promise<void>;
	handleRemoveFromQueue: (index: number) => Promise<void>;
	handleReplaceInQueue: (queueIndex: number, oldPlayer: SessionPlayer, newPlayer: SessionPlayer) => Promise<void>;
	handleAssignFromQueue: (queueIndex: number) => Promise<void>;
	toggleResting: (playerId: string) => Promise<void>;
	toggleForceMixed: (playerId: string) => Promise<void>;
	toggleForceHardGame: (playerId: string) => Promise<void>;
	handleEndSession: (onEnd: () => void) => Promise<void>;

	notifySessionRefresh: () => void;

	// Channel management
	subscribe: (sessionId: number, onEnd: () => void) => void;
	unsubscribe: () => void;
	applyBroadcast: (ev: BroadcastPayload, onEnd: () => void) => void;
}

const initialState = {
	courts: [] as Court[],
	sessionPlayers: new Map<string, SessionPlayer>(),
	waitingIds: [] as string[],
	restingIds: [] as string[],
	pairHistory: {} as PairHistory,
	lastMixedPlayerIds: [] as string[],
	lastCoPlayers: {} as Record<string, string[]>,
	candidateTeams: [] as GeneratedTeam[],
	matchQueue: [] as GeneratedTeam[],
	showEndConfirm: false,
	_channel: null as RealtimeChannel | null,
	_metaChannel: null as RealtimeChannel | null,
};

export const useSessionStore = create<SessionState>((set, get) => ({
	...initialState,

	initialize: (initial) => {
		const playerMap = new Map(initial.players.map((p) => [p.id, p]));
		// matchQueue.teamA/B는 [string, string] — 직접 spread
		const queuedIds = new Set(
			initial.matchQueue.flatMap((t) => [...t.teamA, ...t.teamB]),
		);
		const { waitingIds, restingIds } = rebuildDerivedIds(playerMap, queuedIds);
		set({
			...initialState,
			_channel: get()._channel,
			_metaChannel: get()._metaChannel,
			courts: initial.courts,
			sessionPlayers: playerMap,
			waitingIds,
			restingIds,
			pairHistory: initial.pairHistory,
			candidateTeams: initial.candidateTeams,
			matchQueue: initial.matchQueue,
		});
	},
	reset: () => {
		get().unsubscribe();
		set(initialState);
	},

	// ── DB Actions ──────────────────────────────────────────
	setCandidateTeams: (teams: GeneratedTeam[]) => {
		set({ candidateTeams: teams });
	},

	updateCandidateTeam: (index: number, updatedTeam: GeneratedTeam) => {
		set((state) => ({
			candidateTeams: state.candidateTeams.map((t, i) => (i === index ? updatedTeam : t)),
		}));
	},

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
			get().applyBroadcast(payload, () => { });
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
		get().applyBroadcast(payload, () => { });
		sendBroadcast(_channel, payload);
	},

	handleAddToQueue: async (team: GeneratedTeam) => {
		const { matchQueue, _channel } = get();
		if (!_channel) return;

		const sessionId = getSessionId();

		const newQueue = [...matchQueue, team];

		await dbSaveMatchQueue(sessionId, newQueue);

		const payload: BroadcastPayload = {
			event: "queue_updated",
			payload: { queue: newQueue },
		};
		get().applyBroadcast(payload, () => { });
		sendBroadcast(_channel, payload);
	},

	handleRemoveFromQueue: async (index: number) => {
		const { matchQueue, courts, _channel } = get();
		if (!_channel) return;

		const sessionId = getSessionId();

		const team = matchQueue[index];
		if (!team) return;

		const newQueue = matchQueue.filter((_, i) => i !== index);

		await dbSaveMatchQueue(sessionId, newQueue);

		const playingIds = new Set(getPlayingPlayerIds(courts));
		const { sessionPlayers } = get();
		// teamA/B는 [string, string] — sessionPlayers Map에서 lookup
		const restoredPlayers: SessionPlayer[] = [...team.teamA, ...team.teamB]
			.filter((id) => !playingIds.has(id))
			.flatMap((id) => {
				const p = sessionPlayers.get(id);
				if (!p) return [];
				return [{ ...p, status: "waiting" as const, waitSince: p.waitSince ?? new Date().toISOString() }];
			});

		const payload: BroadcastPayload = {
			event: "queue_updated",
			payload: { queue: newQueue, restoredPlayers },
		};
		get().applyBroadcast(payload, () => { });
		sendBroadcast(_channel, payload);
	},

	handleReplaceInQueue: async (queueIndex: number, oldPlayer: SessionPlayer, newPlayer: SessionPlayer) => {
		const { matchQueue, _channel } = get();
		if (!_channel) return;

		const team = matchQueue[queueIndex];
		if (!team) return;

		// teamA/B는 [string, string] — ID 기반으로 교체
		const replaceIn = (arr: [string, string]): [string, string] =>
			arr.map((id) => (id === oldPlayer.id ? newPlayer.id : id)) as [string, string];

		const updatedTeam: GeneratedTeam = {
			...team,
			teamA: replaceIn(team.teamA),
			teamB: replaceIn(team.teamB),
		};

		const newQueue = matchQueue.map((t, i) => (i === queueIndex ? updatedTeam : t));

		const sessionId = getSessionId();
		await dbSaveMatchQueue(sessionId, newQueue);

		const payload: BroadcastPayload = {
			event: "queue_updated",
			payload: { queue: newQueue },
		};
		get().applyBroadcast(payload, () => { });
		sendBroadcast(_channel, payload);
	},

	handleAssignFromQueue: async (queueIndex: number) => {
		const { matchQueue, courts, _channel } = get();
		if (!_channel) return;

		const team = matchQueue[queueIndex];
		if (!team) return;

		const court = courts.find((c) => !c.match);
		if (!court) return;

		const playingIds = new Set(getPlayingPlayerIds(courts));
		// teamA/B는 [string, string] — 직접 ID 비교
		const allAvailable = [...team.teamA, ...team.teamB].every((id) => !playingIds.has(id));
		if (!allAvailable) return;

		const sessionId = getSessionId();
		const matchId = crypto.randomUUID();

		const ok = await dbAssignMatch(sessionId, matchId, team, court.id);
		if (!ok) return;

		const newQueue = matchQueue.filter((_, i) => i !== queueIndex);
		await dbSaveMatchQueue(sessionId, newQueue);

		// 브로드캐스트 match_started 페이로드는 SessionPlayer 객체 형식 유지
		const { sessionPlayers } = get();
		const toPlayerPair = (ids: [string, string]): [SessionPlayer, SessionPlayer] =>
			ids.map((id) => sessionPlayers.get(id)).filter(Boolean) as [SessionPlayer, SessionPlayer];

		const payload: BroadcastPayload = {
			event: "match_started",
			payload: {
				matchId,
				courtId: court.id,
				gameType: team.gameType,
				teamA: toPlayerPair(team.teamA),
				teamB: toPlayerPair(team.teamB),
			},
		};
		get().applyBroadcast(payload, () => { });
		sendBroadcast(_channel, payload);
	},

	toggleResting: async (playerId: string) => {
		const { sessionPlayers, _channel } = get();
		if (!_channel) return;
		const player = sessionPlayers.get(playerId);
		if (!player) return;

		const updated = await dbToggleResting(player);
		if (!updated) return;

		const payload: BroadcastPayload = {
			event: "player_status_changed",
			payload: { player: updated },
		};
		get().applyBroadcast(payload, () => { });
		sendBroadcast(_channel, payload);
	},

	toggleForceMixed: async (playerId: string) => {
		const { sessionPlayers, _channel } = get();
		if (!_channel) return;
		const player = sessionPlayers.get(playerId);
		if (!player || player.status !== "waiting") return;

		const updated = await dbToggleForceMixed(player);
		if (!updated) return;

		const payload: BroadcastPayload = {
			event: "player_force_mixed_changed",
			payload: { player: updated },
		};
		get().applyBroadcast(payload, () => { });
		sendBroadcast(_channel, payload);
	},

	toggleForceHardGame: async (playerId: string) => {
		const { sessionPlayers, _channel } = get();
		if (!_channel) return;
		const player = sessionPlayers.get(playerId);
		if (!player || player.status !== "waiting") return;

		const updated = await dbToggleForceHardGame(player);
		if (!updated) return;

		const payload: BroadcastPayload = {
			event: "player_force_hard_game_changed",
			payload: { player: updated },
		};
		get().applyBroadcast(payload, () => { });
		sendBroadcast(_channel, payload);
	},

	handleEndSession: async (onEnd: () => void) => {
		const { _channel } = get();
		if (!_channel) return;
		const sessionId = getSessionId();
		await dbEndSession(sessionId);
		sendBroadcast(_channel, { event: "session_ended" });
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
	applyBroadcast: (ev: BroadcastPayload, onEnd: () => void) => {
		if (ev.event === "session_ended") { onEnd(); return; }

		type Handler = (payload: BroadcastPayloadData, set: SetFn, get: GetFn) => void;
		const handlers: Record<string, Handler> = {
			match_started: (p, s, g) => handleMatchStarted(p, s, g),
			match_completed: (p, s) => handleMatchCompleted(p, s),
			player_status_changed: (p, s) => handlePlayerStatusChanged(p, s),
			player_force_mixed_changed: (p, s) => handlePlayerFlagChanged(p, s),
			player_force_hard_game_changed: (p, s) => handlePlayerFlagChanged(p, s),
			player_updated: (p, s) => handlePlayerUpdated(p, s),
			session_refresh_required: (p, s, g) => handleSessionRefreshRequired(p, s, g),
			queue_updated: (p, s) => handleQueueUpdated(p, s),
			candidates_updated: (p, s) => handleCandidatesUpdated(p, s),
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
			"player_status_changed",
			"player_force_mixed_changed",
			"player_force_hard_game_changed",
			"player_updated",
			"candidates_updated",
			"queue_updated",
			"session_refresh_required",
		] as const;
		for (const event of events) {
			channel.on("broadcast", { event }, ({ payload }) =>
				applyBroadcast({ event, payload } as BroadcastPayload, onEnd),
			);
		}
		channel.on("broadcast", { event: "session_ended" }, () =>
			applyBroadcast({ event: "session_ended" }, onEnd),
		);
		channel.subscribe();

		// Session meta channel (detect session end from other clients)
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
					const row = payload.new as { is_active: boolean };
					if (!row.is_active) onEnd();
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

// ── 안정적 참조 액션 (컴포넌트에서 구독 없이 직접 호출) ──────────
export const sessionActions = {
	setShowEndConfirm: (show: boolean) =>
		useSessionStore.setState({ showEndConfirm: show }),
} as const;
