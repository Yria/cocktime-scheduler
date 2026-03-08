import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import {
	type BroadcastPayload,
	createBroadcastChannel,
	dbAssignMatch,
	dbCompleteMatch,
	dbEndSession,
	dbToggleForceMixed,
	dbToggleForceHardGame,
	dbToggleResting,
	sendBroadcast,
	supabase,
} from "../lib/supabase";
import type { ClientSessionState } from "../lib/supabase";
import {
	recordHistory,
} from "../lib/teamGenerator";
import type {
	Court,
	GeneratedTeam,
	PairHistory,
	SessionPlayer,
} from "../types";
import { useAppStore } from "./appStore";

export interface SessionState {
	courts: Court[];
	waiting: SessionPlayer[];
	resting: SessionPlayer[];
	pairHistory: PairHistory;
	lastMixedPlayerIds: string[];
	lastCoPlayers: Record<string, string[]>;

	candidateTeams: GeneratedTeam[];
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
	waiting: [] as SessionPlayer[],
	resting: [] as SessionPlayer[],
	pairHistory: {} as PairHistory,
	lastMixedPlayerIds: [] as string[],
	lastCoPlayers: {} as Record<string, string[]>,
	candidateTeams: [] as GeneratedTeam[],
	showEndConfirm: false,
	_channel: null as RealtimeChannel | null,
	_metaChannel: null as RealtimeChannel | null,
};

export const useSessionStore = create<SessionState>((set, get) => ({
	...initialState,

	initialize: (initial) => {
		set({
			...initialState,
			_channel: get()._channel,
			_metaChannel: get()._metaChannel,
			courts: initial.courts,
			waiting: initial.waiting,
			resting: initial.resting,
			pairHistory: initial.pairHistory,
			candidateTeams: initial.candidateTeams,
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

		const sessionMeta = useAppStore.getState().sessionMeta;
		const sessionId = sessionMeta?.sessionId ?? 0;
		const matchId = crypto.randomUUID();

		const ok = await dbAssignMatch(
			sessionId,
			matchId,
			team,
			courtId,
		);

		if (ok) {
			const payload: BroadcastPayload = {
				event: "match_started",
				payload: {
					matchId,
					courtId,
					gameType: team.gameType,
					teamA: team.teamA,
					teamB: team.teamB,
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

		const sessionMeta = useAppStore.getState().sessionMeta;
		const sessionId = sessionMeta?.sessionId ?? 0;
		const match = court.match;

		const result = await dbCompleteMatch(sessionId, match);
		if (!result) { console.error(`[store] handleComplete dbCompleteMatch FAILED court=${courtId}`); return; }

		const payload: BroadcastPayload = {
			event: "match_completed",
			payload: {
				matchId: match.id,
				courtId,
				gameType: match.gameType,
				teamA: match.teamA,
				teamB: match.teamB,
				updatedPlayers: result.updatedPlayers,
			},
		};
		get().applyBroadcast(payload, () => { });
		sendBroadcast(_channel, payload);
	},

	toggleResting: async (playerId: string) => {
		const { waiting, resting, _channel } = get();
		if (!_channel) return;
		const player =
			waiting.find((p) => p.id === playerId) ??
			resting.find((p) => p.id === playerId);
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
		const { waiting, _channel } = get();
		if (!_channel) return;
		const player = waiting.find((p) => p.id === playerId);
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
		const { waiting, _channel } = get();
		if (!_channel) return;
		const player = waiting.find((p) => p.id === playerId);
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
		const sessionMeta = useAppStore.getState().sessionMeta;
		const sessionId = sessionMeta?.sessionId ?? 0;
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
		switch (ev.event) {
			case "match_started": {
				const { matchId, courtId, gameType, teamA, teamB } =
					ev.payload;
				const allIds = new Set([
					teamA[0].id,
					teamA[1].id,
					teamB[0].id,
					teamB[1].id,
				]);
				set((state) => ({
					courts: state.courts.map((c) =>
						c.id === courtId
							? {
								...c,
								match: {
									id: matchId,
									courtId,
									gameType,
									teamA,
									teamB,
									startedAt: new Date().toISOString(),
								},
							}
							: c,
					),
					waiting: state.waiting.filter((p) => !allIds.has(p.id)),
					pairHistory: recordHistory(state.pairHistory, {
						teamA,
						teamB,
						gameType,
					} as GeneratedTeam),
					candidateTeams: state.candidateTeams.filter((team) => {
						const ids = new Set([
							...team.teamA.map((p) => p.id),
							...team.teamB.map((p) => p.id),
						]);
						return !(allIds.size === ids.size && [...allIds].every((id) => ids.has(id)));
					}),
				}));
				break;
			}

			case "match_completed": {
				const {
					courtId,
					gameType,
					teamA,
					teamB,
					updatedPlayers,
				} = ev.payload;
				const updatedMap = new Map(
					updatedPlayers.map((p: SessionPlayer) => [p.id, p]),
				);
				const toWaiting = updatedPlayers.filter(
					(p: SessionPlayer) => p.status === "waiting",
				);

				set((state) => {
					// Deep-clone Sets to avoid mutating existing state
					const newPairHistory: Record<string, Set<string>> = {};
					for (const key of Object.keys(state.pairHistory)) {
						newPairHistory[key] = new Set(state.pairHistory[key]);
					}
					for (const [a, b] of [teamA, teamB] as [
						[SessionPlayer, SessionPlayer],
						[SessionPlayer, SessionPlayer],
					]) {
						if (!newPairHistory[a.id]) newPairHistory[a.id] = new Set();
						if (!newPairHistory[b.id]) newPairHistory[b.id] = new Set();
						newPairHistory[a.id].add(b.id);
						newPairHistory[b.id].add(a.id);
					}

					const newWaiting = [
						...state.waiting.map((p) => updatedMap.get(p.id) ?? p),
						...toWaiting.filter(
							(p: SessionPlayer) =>
								!state.waiting.some((pp) => pp.id === p.id),
						),
					];

					return {
						courts: state.courts.map((c) => {
							if (c.id !== courtId) return c;
							return { ...c, match: null };
						}),
						waiting: newWaiting,
						pairHistory: newPairHistory,
						lastMixedPlayerIds:
							gameType === "혼복"
								? [...teamA, ...teamB].map((p: SessionPlayer) => p.id)
								: state.lastMixedPlayerIds,
						lastCoPlayers: (() => {
							const allPlayers = [...teamA, ...teamB];
							const next = { ...state.lastCoPlayers };
							for (const player of allPlayers) {
								next[player.id] = allPlayers
									.filter((p: SessionPlayer) => p.id !== player.id)
									.map((p: SessionPlayer) => p.id);
							}
							return next;
						})(),
					};
				});
				break;
			}

			case "player_status_changed": {
				const { player } = ev.payload;
				if (player.status === "resting") {
					set((state) => ({
						waiting: state.waiting.filter((p) => p.id !== player.id),
						resting: state.resting.some((p) => p.id === player.id)
							? state.resting
							: [...state.resting, player],
					}));
				} else if (player.status === "waiting") {
					set((state) => ({
						resting: state.resting.filter((p) => p.id !== player.id),
						waiting: state.waiting.some((p) => p.id === player.id)
							? state.waiting
							: [...state.waiting, player],
					}));
				}
				break;
			}

			case "player_force_mixed_changed": {
				const { player } = ev.payload;
				set((state) => ({
					waiting: state.waiting.map((p) => (p.id === player.id ? player : p)),
				}));
				break;
			}

			case "player_force_hard_game_changed": {
				const { player } = ev.payload;
				set((state) => ({
					waiting: state.waiting.map((p) => (p.id === player.id ? player : p)),
				}));
				break;
			}

			case "player_updated": {
				const { player } = ev.payload;
				set((state) => ({
					waiting: state.waiting.map((p) => (p.id === player.id ? player : p)),
					resting: state.resting.map((p) => (p.id === player.id ? player : p)),
					courts: state.courts.map((c) =>
						c.match
							? {
								...c,
								match: {
									...c.match,
									teamA: c.match.teamA.map((p) =>
										p.id === player.id ? player : p,
									) as [SessionPlayer, SessionPlayer],
									teamB: c.match.teamB.map((p) =>
										p.id === player.id ? player : p,
									) as [SessionPlayer, SessionPlayer],
								},
							}
							: c,
					),
				}));
				break;
			}

			case "session_ended": {
				onEnd();
				break;
			}

			case "session_refresh_required": {
				// DB 상태를 다시 로드
				const sessionMeta = useAppStore.getState().sessionMeta;
				if (sessionMeta) {
					import("../lib/supabase")
						.then(({ fetchSessionSnapshot, snapshotToClientState }) =>
							fetchSessionSnapshot(sessionMeta.sessionId).then((snapshot) => {
								if (snapshot) {
									const clientState = snapshotToClientState(snapshot);
									get().initialize(clientState);
								}
							}),
						)
						.catch((err) => console.error("Failed to refresh session:", err));
				}
				break;
			}

			case "candidates_updated": {
			const { candidates: newCandidates } = ev.payload;
			set({ candidateTeams: newCandidates });
			break;
		}

		}
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
