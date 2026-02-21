import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import {
	type BroadcastPayload,
	createBroadcastChannel,
	dbAssignMatch,
	dbCompleteMatch,
	dbCreateReservation,
	dbDisbandGroup,
	dbEndSession,
	dbToggleForceMixed,
	dbToggleResting,
	sendBroadcast,
	supabase,
} from "../lib/supabase";
import type { ClientSessionState } from "../lib/supabaseClient";
import {
	generateTeam,
	generateTeamWithGroup,
	recordHistory,
} from "../lib/teamGenerator";
import type {
	Court,
	GeneratedTeam,
	PairHistory,
	ReservedGroup,
	SessionPlayer,
} from "../types";
import { useAppStore } from "./appStore";

export interface SessionState {
	courts: Court[];
	waiting: SessionPlayer[];
	resting: SessionPlayer[];
	reservedGroups: ReservedGroup[];
	pairHistory: PairHistory;
	lastMixedPlayerIds: string[];

	pendingTeam: GeneratedTeam | null;
	pendingGroupId: string | null;
	showEndConfirm: boolean;
	showReserveModal: boolean;
	reservingSelected: Set<string>;

	// Internal channel reference (not reactive)
	_channel: RealtimeChannel | null;
	_metaChannel: RealtimeChannel | null;

	initialize: (initial: ClientSessionState) => void;
	reset: () => void;

	// DB Actions
	handleGenerate: () => void;
	handleAssignGroup: (groupId: string) => void;
	handleAssign: (courtId: number) => Promise<void>;
	handleComplete: (courtId: number) => Promise<void>;
	toggleResting: (playerId: string) => Promise<void>;
	toggleForceMixed: (playerId: string) => Promise<void>;
	handleCreateReservation: () => void;
	handleDisbandGroup: (groupId: string) => Promise<void>;
	handleEndSession: (onEnd: () => void) => Promise<void>;
	toggleReservingPlayer: (playerId: string) => void;

	// Channel management
	subscribe: (sessionId: number, onEnd: () => void) => void;
	unsubscribe: () => void;
	applyBroadcast: (ev: BroadcastPayload, onEnd: () => void) => void;
}

const initialState = {
	courts: [] as Court[],
	waiting: [] as SessionPlayer[],
	resting: [] as SessionPlayer[],
	reservedGroups: [] as ReservedGroup[],
	pairHistory: {} as PairHistory,
	lastMixedPlayerIds: [] as string[],
	pendingTeam: null as GeneratedTeam | null,
	pendingGroupId: null as string | null,
	showEndConfirm: false,
	showReserveModal: false,
	reservingSelected: new Set<string>(),
	_channel: null as RealtimeChannel | null,
	_metaChannel: null as RealtimeChannel | null,
};

export const useSessionStore = create<SessionState>((set, get) => ({
	...initialState,

	initialize: (initial) =>
		set({
			...initialState,
			_channel: get()._channel,
			_metaChannel: get()._metaChannel,
			courts: initial.courts,
			waiting: initial.waiting,
			resting: initial.resting,
			reservedGroups: initial.reservedGroups,
			pairHistory: initial.pairHistory,
		}),
	reset: () => {
		get().unsubscribe();
		set(initialState);
	},

	// ── DB Actions ──────────────────────────────────────────
	handleGenerate: () => {
		const { waiting, pairHistory, lastMixedPlayerIds } = get();
		const sessionMeta = useAppStore.getState().sessionMeta;
		const singleWomanIds = sessionMeta?.singleWomanIds ?? [];
		const team = generateTeam(
			waiting,
			pairHistory,
			singleWomanIds,
			lastMixedPlayerIds,
		);
		if (!team) return;
		set({ pendingTeam: team, pendingGroupId: null });
	},

	handleAssignGroup: (groupId: string) => {
		const { reservedGroups, waiting, pairHistory } = get();
		const sessionMeta = useAppStore.getState().sessionMeta;
		const singleWomanIds = sessionMeta?.singleWomanIds ?? [];
		const group = reservedGroups.find((g) => g.id === groupId);
		if (!group || group.readyIds.length !== group.memberIds.length) return;

		const waitingExcludeGroup = waiting.filter(
			(p) => !group.memberIds.includes(p.id),
		);
		const team = generateTeamWithGroup(
			group.players.filter((p) => group.readyIds.includes(p.id)),
			waitingExcludeGroup,
			pairHistory,
			singleWomanIds,
		);
		if (!team) return;
		set({ pendingTeam: team, pendingGroupId: groupId });
	},

	handleAssign: async (courtId: number) => {
		const { pendingTeam, pendingGroupId, _channel } = get();
		if (!pendingTeam || !_channel) return;

		const sessionMeta = useAppStore.getState().sessionMeta;
		const sessionId = sessionMeta?.sessionId ?? 0;
		const matchId = crypto.randomUUID();
		const removedGroupId = pendingGroupId;

		const allIds = new Set([
			pendingTeam.teamA[0].id,
			pendingTeam.teamA[1].id,
			pendingTeam.teamB[0].id,
			pendingTeam.teamB[1].id,
		]);

		set((state) => ({
			courts: state.courts.map((c) =>
				c.id === courtId
					? {
							...c,
							match: {
								id: matchId,
								courtId,
								gameType: pendingTeam.gameType,
								teamA: pendingTeam.teamA,
								teamB: pendingTeam.teamB,
								startedAt: new Date().toISOString(),
							},
						}
					: c,
			),
			waiting: state.waiting.filter((p) => !allIds.has(p.id)),
			reservedGroups: removedGroupId
				? state.reservedGroups.filter((g) => g.id !== removedGroupId)
				: state.reservedGroups,
			pairHistory: recordHistory(state.pairHistory, pendingTeam),
			pendingTeam: null,
			pendingGroupId: null,
		}));

		const ok = await dbAssignMatch(
			sessionId,
			matchId,
			pendingTeam,
			courtId,
			removedGroupId,
		);
		if (ok) {
			sendBroadcast(_channel, {
				event: "match_started",
				payload: {
					matchId,
					courtId,
					gameType: pendingTeam.gameType,
					teamA: pendingTeam.teamA,
					teamB: pendingTeam.teamB,
					removedGroupId,
				},
			});
		}
	},

	handleComplete: async (courtId: number) => {
		const { courts, reservedGroups, _channel } = get();
		const court = courts.find((c) => c.id === courtId);
		if (!court?.match || !_channel) return;

		const sessionMeta = useAppStore.getState().sessionMeta;
		const sessionId = sessionMeta?.sessionId ?? 0;
		const match = court.match;
		const reservedMemberIds = new Set(
			reservedGroups.flatMap((g) => g.memberIds),
		);
		const allPlayers = [...match.teamA, ...match.teamB];
		const toWaiting = allPlayers.filter((p) => !reservedMemberIds.has(p.id));
		const toReservedBack = allPlayers.filter((p) =>
			reservedMemberIds.has(p.id),
		);
		const isMixed = match.gameType === "혼복";
		const now = new Date().toISOString();

		const optimisticWaiting = toWaiting.map((p) => ({
			...p,
			status: "waiting" as const,
			waitSince: now,
			gameCount: p.gameCount + 1,
			mixedCount: isMixed && p.gender === "M" ? p.mixedCount + 1 : p.mixedCount,
		}));

		const optimisticUpdatedPlayers: SessionPlayer[] = [...optimisticWaiting];
		for (const p of toReservedBack) {
			optimisticUpdatedPlayers.push({
				...p,
				gameCount: p.gameCount + 1,
				mixedCount:
					isMixed && p.gender === "M" ? p.mixedCount + 1 : p.mixedCount,
			});
		}

		set((state) => {
			const updMap = new Map(optimisticUpdatedPlayers.map((p) => [p.id, p]));
			const newPairHistory = { ...state.pairHistory };
			for (const pair of [match.teamA, match.teamB]) {
				const [a, b] = pair;
				if (!newPairHistory[a.id]) newPairHistory[a.id] = new Set();
				if (!newPairHistory[b.id]) newPairHistory[b.id] = new Set();
				newPairHistory[a.id].add(b.id);
				newPairHistory[b.id].add(a.id);
			}
			return {
				courts: state.courts.map((c) =>
					c.id === courtId ? { ...c, match: null } : c,
				),
				waiting: [...state.waiting, ...optimisticWaiting],
				reservedGroups: state.reservedGroups.map((g) => {
					const backIds = toReservedBack
						.filter((p) => g.memberIds.includes(p.id))
						.map((p) => p.id);
					if (backIds.length === 0) return g;
					const newReadyIds = [...new Set([...g.readyIds, ...backIds])];
					return {
						...g,
						readyIds: newReadyIds,
						players: g.players.map((p) => updMap.get(p.id) ?? p),
					};
				}),
				pairHistory: newPairHistory,
				lastMixedPlayerIds: isMixed
					? allPlayers.map((p) => p.id)
					: state.lastMixedPlayerIds,
			};
		});

		const result = await dbCompleteMatch(sessionId, match, reservedGroups);
		if (result && _channel) {
			sendBroadcast(_channel, {
				event: "match_completed",
				payload: {
					matchId: match.id,
					courtId,
					gameType: match.gameType,
					teamA: match.teamA,
					teamB: match.teamB,
					updatedPlayers: result.updatedPlayers,
					groupUpdates: result.groupUpdates,
				},
			});
		}
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

		if (player.status === "resting") {
			set((state) => ({
				resting: state.resting.filter((p) => p.id !== playerId),
				waiting: [...state.waiting, updated],
			}));
		} else {
			set((state) => ({
				waiting: state.waiting.filter((p) => p.id !== playerId),
				resting: [...state.resting, updated],
			}));
		}

		sendBroadcast(_channel, {
			event: "player_status_changed",
			payload: { player: updated },
		});
	},

	toggleForceMixed: async (playerId: string) => {
		const { waiting, _channel } = get();
		if (!_channel) return;
		const player = waiting.find((p) => p.id === playerId);
		if (!player || player.status !== "waiting") return;

		const updated = await dbToggleForceMixed(player);
		if (!updated) return;

		set((state) => ({
			waiting: state.waiting.map((p) => (p.id === playerId ? updated : p)),
		}));

		sendBroadcast(_channel, {
			event: "player_force_mixed_changed",
			payload: { player: updated },
		});
	},

	handleCreateReservation: () => {
		const { courts, waiting, reservingSelected, _channel } = get();
		if (!_channel) return;
		if (reservingSelected.size < 2 || reservingSelected.size > 4) return;

		const sessionMeta = useAppStore.getState().sessionMeta;
		const sessionId = sessionMeta?.sessionId ?? 0;

		const onCourtPlayers = courts.flatMap((c) =>
			c.match ? [...c.match.teamA, ...c.match.teamB] : [],
		);
		const allAvailable = [...waiting, ...onCourtPlayers];
		const players = allAvailable.filter((p) => reservingSelected.has(p.id));
		const readyIds = players
			.filter((p) => p.status === "waiting")
			.map((p) => p.id);

		const groupId = `reserved-${Date.now()}`;
		const group: ReservedGroup = {
			id: groupId,
			memberIds: players.map((p) => p.id),
			readyIds,
			players,
		};

		set((state) => ({
			reservedGroups: [...state.reservedGroups, group],
			waiting: state.waiting.filter((p) => !reservingSelected.has(p.id)),
			reservingSelected: new Set(),
			showReserveModal: false,
		}));

		dbCreateReservation(sessionId, groupId, players, readyIds).then((ok) => {
			const ch = get()._channel;
			if (ok && ch) {
				sendBroadcast(ch, {
					event: "group_reserved",
					payload: { group, reservedPlayerIds: readyIds },
				});
			}
		});
	},

	handleDisbandGroup: async (groupId: string) => {
		const { reservedGroups, _channel } = get();
		if (!_channel) return;
		const group = reservedGroups.find((g) => g.id === groupId);
		if (!group) return;

		const readyPlayers = group.players.filter((p) =>
			group.readyIds.includes(p.id),
		);

		set((state) => ({
			waiting: [...state.waiting, ...readyPlayers],
			reservedGroups: state.reservedGroups.filter((g) => g.id !== groupId),
		}));

		const ok = await dbDisbandGroup(group);
		if (ok && _channel) {
			sendBroadcast(_channel, {
				event: "group_disbanded",
				payload: { groupId, readyPlayers },
			});
		}
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

	toggleReservingPlayer: (playerId: string) => {
		set((state) => {
			const next = new Set(state.reservingSelected);
			if (next.has(playerId)) {
				next.delete(playerId);
			} else if (next.size < 4) {
				next.add(playerId);
			}
			return { reservingSelected: next };
		});
	},

	// ── Channel management ──────────────────────────────────
	applyBroadcast: (ev: BroadcastPayload, onEnd: () => void) => {
		switch (ev.event) {
			case "match_started": {
				const { matchId, courtId, gameType, teamA, teamB, removedGroupId } =
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
					reservedGroups: removedGroupId
						? state.reservedGroups.filter((g) => g.id !== removedGroupId)
						: state.reservedGroups,
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
					groupUpdates,
				} = ev.payload;
				const updatedMap = new Map(
					updatedPlayers.map((p: SessionPlayer) => [p.id, p]),
				);
				const toWaiting = updatedPlayers.filter(
					(p: SessionPlayer) => p.status === "waiting",
				);

				set((state) => {
					const newPairHistory = { ...state.pairHistory };
					for (const [a, b] of [teamA, teamB] as [
						[SessionPlayer, SessionPlayer],
						[SessionPlayer, SessionPlayer],
					]) {
						if (!newPairHistory[a.id]) newPairHistory[a.id] = new Set();
						if (!newPairHistory[b.id]) newPairHistory[b.id] = new Set();
						newPairHistory[a.id].add(b.id);
						newPairHistory[b.id].add(a.id);
					}
					return {
						courts: state.courts.map((c) =>
							c.id === courtId ? { ...c, match: null } : c,
						),
						waiting: [
							...state.waiting.map((p) => updatedMap.get(p.id) ?? p),
							...toWaiting.filter(
								(p: SessionPlayer) =>
									!state.waiting.some((pp) => pp.id === p.id),
							),
						],
						reservedGroups: state.reservedGroups.map((g) => {
							const upd = groupUpdates.find(
								(u: { groupId: string; readyIds: string[] }) =>
									u.groupId === g.id,
							);
							if (!upd) return g;
							return {
								...g,
								readyIds: upd.readyIds,
								players: g.players.map((p) => updatedMap.get(p.id) ?? p),
							};
						}),
						pairHistory: newPairHistory,
						lastMixedPlayerIds:
							gameType === "혼복"
								? [...teamA, ...teamB].map((p: SessionPlayer) => p.id)
								: state.lastMixedPlayerIds,
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

			case "group_reserved": {
				const { group, reservedPlayerIds } = ev.payload;
				set((state) => ({
					reservedGroups: [...state.reservedGroups, group],
					waiting: state.waiting.filter(
						(p) => !reservedPlayerIds.includes(p.id),
					),
				}));
				break;
			}

			case "group_disbanded": {
				const { groupId, readyPlayers } = ev.payload;
				set((state) => ({
					waiting:
						readyPlayers.length > 0
							? [...state.waiting, ...readyPlayers]
							: state.waiting,
					reservedGroups: state.reservedGroups.filter((g) => g.id !== groupId),
				}));
				break;
			}

			case "session_ended": {
				onEnd();
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
			"group_reserved",
			"group_disbanded",
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
