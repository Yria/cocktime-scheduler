import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import {
	type BroadcastPayload,
	createBroadcastChannel,
	dbAssignMatch,
	dbCancelReservation,
	dbCompleteMatch,
	dbEndSession,
	dbPromoteReservation,
	dbReserveMatch,
	dbToggleForceMixed,
	dbToggleForceHardGame,
	dbToggleResting,
	sendBroadcast,
	supabase,
} from "../lib/supabase";
import type { ClientSessionState } from "../lib/supabaseClient";
import {
	recordHistory,
} from "../lib/teamGenerator";
import type {
	Court,
	GeneratedTeam,
	PairHistory,
	ReservedMatch,
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
	candidateIds: string[]; // team_candidates.id (UUID) 배열
	showEndConfirm: boolean;

	// Internal channel reference (not reactive)
	_channel: RealtimeChannel | null;
	_metaChannel: RealtimeChannel | null;

	initialize: (initial: ClientSessionState) => void;
	reset: () => void;

	// DB Actions
	setCandidateTeams: (teams: GeneratedTeam[], ids?: string[]) => void;
	updateCandidateTeam: (index: number, updatedTeam: GeneratedTeam) => void;
	handleReserveOrAssign: (team: GeneratedTeam, courtId: number) => Promise<void>;
	handleCancelReservation: (courtId: number) => Promise<void>;
	handleComplete: (courtId: number) => Promise<void>;
	toggleResting: (playerId: string) => Promise<void>;
	toggleForceMixed: (playerId: string) => Promise<void>;
	toggleForceHardGame: (playerId: string) => Promise<void>;
	handleEndSession: (onEnd: () => void) => Promise<void>;

	// Settings sync
	syncSettings: (
		courtCount: number,
		singleWomanIds: string[],
		addedPlayers: SessionPlayer[],
		removedPlayerIds: string[],
	) => void;
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
	candidateIds: [] as string[],
	showEndConfirm: false,
	_channel: null as RealtimeChannel | null,
	_metaChannel: null as RealtimeChannel | null,
};

function adjustCourts(
	courts: Court[],
	targetCount: number,
): ReturnType<typeof courts.map> {
	const current = courts.length;
	if (targetCount > current) {
		const extra = Array.from({ length: targetCount - current }, (_, i) => ({
			id: current + i + 1,
			match: null as null,
			reserved: null as null,
		}));
		return [...courts, ...extra];
	}
	if (targetCount < current) {
		let toRemove = current - targetCount;
		return [...courts]
			.reverse()
			.filter((c) => {
				if (!c.match && !c.reserved && toRemove > 0) {
					toRemove--;
					return false;
				}
				return true;
			})
			.reverse();
	}
	return courts;
}

export const useSessionStore = create<SessionState>((set, get) => ({
	...initialState,

	initialize: (initial) => {
		const cs = initial.courts.map((c) => `${c.id}(m=${c.match ? "Y" : "N"},r=${c.reserved ? "Y" : "N"})`).join(" ");
		console.log(`[store] initialize courts=[${cs}] waiting=${initial.waiting.length} resting=${initial.resting.length} candidates=${initial.candidateTeams.length}`);
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
	setCandidateTeams: (teams: GeneratedTeam[], ids?: string[]) => {
		set({ candidateTeams: teams, candidateIds: ids ?? [] });
	},

	updateCandidateTeam: (index: number, updatedTeam: GeneratedTeam) => {
		set((state) => ({
			candidateTeams: state.candidateTeams.map((t, i) => (i === index ? updatedTeam : t)),
		}));
	},

	handleReserveOrAssign: async (team: GeneratedTeam, courtId: number) => {
		const { courts, _channel } = get();
		if (!_channel) { console.warn("[store] handleReserveOrAssign: no channel"); return; }

		const court = courts.find((c) => c.id === courtId);
		if (!court) { console.warn("[store] handleReserveOrAssign: court not found", courtId); return; }

		const sessionMeta = useAppStore.getState().sessionMeta;
		const sessionId = sessionMeta?.sessionId ?? 0;
		const matchId = crypto.randomUUID();

		const names = [...team.teamA, ...team.teamB].map((p) => p.name).join(",");
		console.log(`[store] handleReserveOrAssign court=${courtId} hasMatch=${!!court.match} hasReserved=${!!court.reserved} players=[${names}]`);

		if (!court.match) {
			// 빈 코트 → 직접 배정
			const ok = await dbAssignMatch(
				sessionId,
				matchId,
				team,
				courtId,
				null,
			);

			if (ok) {
				console.log(`[store] assign OK → match_started court=${courtId}`);
				const payload: BroadcastPayload = {
					event: "match_started",
					payload: {
						matchId,
						courtId,
						gameType: team.gameType,
						teamA: team.teamA,
						teamB: team.teamB,
						removedGroupId: null,
					},
				};
				get().applyBroadcast(payload, () => { });
				sendBroadcast(_channel, payload);
			} else {
				console.error(`[store] assign FAILED court=${courtId}`);
			}
		} else {
			// 게임 중인 코트 → 예약
			if (court.reserved) { console.warn("[store] court already reserved", courtId); return; }

			// 옵티미스틱: UI 먼저 업데이트
			console.log(`[store] reserve optimistic court=${courtId}`);
			const reservePayload: BroadcastPayload = {
				event: "team_reserved",
				payload: {
					matchId,
					courtId,
					gameType: team.gameType,
					teamA: team.teamA,
					teamB: team.teamB,
				},
			};
			get().applyBroadcast(reservePayload, () => { });

			const ok = await dbReserveMatch(sessionId, matchId, team, courtId);

			if (ok) {
				console.log(`[store] reserve DB OK court=${courtId}`);
				sendBroadcast(_channel, reservePayload);
			} else {
				console.error(`[store] reserve DB FAILED → rollback court=${courtId}`);
				// DB 실패 → 롤백
				get().applyBroadcast(
					{ event: "reservation_cancelled", payload: { matchId, courtId } },
					() => { },
				);
			}
		}
	},

	handleCancelReservation: async (courtId: number) => {
		const { courts, _channel } = get();
		if (!_channel) return;

		const court = courts.find((c) => c.id === courtId);
		if (!court?.reserved) return;

		const matchId = court.reserved.id;
		const savedReservation = court.reserved;

		// 옵티미스틱: UI 먼저 업데이트
		const cancelPayload: BroadcastPayload = {
			event: "reservation_cancelled",
			payload: { matchId, courtId },
		};
		get().applyBroadcast(cancelPayload, () => { });

		const ok = await dbCancelReservation(matchId);

		if (ok) {
			sendBroadcast(_channel, cancelPayload);
		} else {
			// DB 실패 → 롤백 (예약 복원)
			get().applyBroadcast(
				{
					event: "team_reserved",
					payload: {
						matchId: savedReservation.id,
						courtId,
						gameType: savedReservation.gameType,
						teamA: savedReservation.teamA,
						teamB: savedReservation.teamB,
					},
				},
				() => { },
			);
		}
	},

	handleComplete: async (courtId: number) => {
		const { courts, _channel } = get();
		const court = courts.find((c) => c.id === courtId);
		if (!court?.match || !_channel) return;

		const sessionMeta = useAppStore.getState().sessionMeta;
		const sessionId = sessionMeta?.sessionId ?? 0;
		const match = court.match;
		const reservation = court.reserved;

		console.log(`[store] handleComplete court=${courtId} hasReservation=${!!reservation}`);

		const result = await dbCompleteMatch(sessionId, match);
		if (!result) { console.error(`[store] handleComplete dbCompleteMatch FAILED court=${courtId}`); return; }

		console.log(`[store] handleComplete DB OK, updatedPlayers=${result.updatedPlayers.map((p) => p.name).join(",")}`);

		// 예약이 있으면 자동 승격
		let promotedMatch: ReservedMatch | undefined;
		if (reservation) {
			const reservedPlayerIds = [
				reservation.teamA[0].id,
				reservation.teamA[1].id,
				reservation.teamB[0].id,
				reservation.teamB[1].id,
			];
			const promoted = await dbPromoteReservation(reservation.id, reservedPlayerIds);
			console.log(`[store] promote reservation ${promoted ? "OK" : "FAILED"} court=${courtId}`);
			if (promoted) {
				promotedMatch = reservation;
			}
		}

		const payload: BroadcastPayload = {
			event: "match_completed",
			payload: {
				matchId: match.id,
				courtId,
				gameType: match.gameType,
				teamA: match.teamA,
				teamB: match.teamB,
				updatedPlayers: result.updatedPlayers,
				groupUpdates: result.groupUpdates,
				promotedMatch,
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

	// ── Settings sync ───────────────────────────────────────
	syncSettings: (
		courtCount,
		singleWomanIds,
		addedPlayers,
		removedPlayerIds,
	) => {
		const { _channel } = get();

		const payload: BroadcastPayload = {
			event: "session_updated",
			payload: { courtCount, singleWomanIds, addedPlayers, removedPlayerIds },
		};
		get().applyBroadcast(payload, () => { });

		if (_channel) {
			sendBroadcast(_channel, payload);
		}
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
		const before = get();
		const cs = before.courts.map((c) => `${c.id}(m=${c.match?.id.slice(0, 4) ?? "-"},r=${c.reserved?.id.slice(0, 4) ?? "-"})`).join(" ");
		const ws = before.waiting.map((p) => p.name).join(",");
		console.log(`[broadcast] ${ev.event} | courts=[${cs}] waiting=[${ws}] candidates=${before.candidateTeams.length}`);

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

			case "team_reserved": {
				const { matchId, courtId, gameType, teamA, teamB } = ev.payload;
				// candidateTeams는 제거하지 않음 — SessionMain의 visibleCandidates가
				// reservedPlayerIds로 필터링하므로 UI에서 자동 숨김.
				// 예약 취소 시 자연스럽게 다시 표시됨.
				set((state) => ({
					courts: state.courts.map((c) =>
						c.id === courtId
							? {
								...c,
								reserved: {
									id: matchId,
									courtId,
									gameType,
									teamA,
									teamB,
								},
							}
							: c,
					),
				}));
				break;
			}

			case "reservation_cancelled": {
				const { courtId } = ev.payload;
				set((state) => ({
					courts: state.courts.map((c) =>
						c.id === courtId ? { ...c, reserved: null } : c,
					),
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
					promotedMatch,
				} = ev.payload;
				const updatedMap = new Map(
					updatedPlayers.map((p: SessionPlayer) => [p.id, p]),
				);
				const toWaiting = updatedPlayers.filter(
					(p: SessionPlayer) => p.status === "waiting",
				);

				// 승격된 예약이 있으면 해당 선수들은 waiting에서 제거
				const promotedIds = promotedMatch
					? new Set([
						promotedMatch.teamA[0].id,
						promotedMatch.teamA[1].id,
						promotedMatch.teamB[0].id,
						promotedMatch.teamB[1].id,
					])
					: new Set<string>();

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
					].filter((p) => !promotedIds.has(p.id));

					return {
						courts: state.courts.map((c) => {
							if (c.id !== courtId) return c;
							if (promotedMatch) {
								return {
									...c,
									match: {
										id: promotedMatch.id,
										courtId: promotedMatch.courtId,
										gameType: promotedMatch.gameType,
										teamA: promotedMatch.teamA,
										teamB: promotedMatch.teamB,
										startedAt: new Date().toISOString(),
									},
									reserved: null,
								};
							}
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
					console.log("[session_refresh_required] DB 상태 다시 로드 중...");
					import("../lib/supabaseClient")
						.then(({ fetchSessionSnapshot, snapshotToClientState }) =>
							fetchSessionSnapshot(sessionMeta.sessionId).then((snapshot) => {
								if (snapshot) {
									const clientState = snapshotToClientState(snapshot);
									get().initialize(clientState);
									console.log(
										`[session_refresh_required] 로드 완료 - waiting: ${clientState.waiting.length}명, resting: ${clientState.resting.length}명`,
									);
								}
							}),
						)
						.catch((err) => console.error("Failed to refresh session:", err));
				}
				break;
			}

			case "session_updated": {
				const { courtCount, singleWomanIds, addedPlayers, removedPlayerIds } =
					ev.payload;
				const removedSet = new Set(removedPlayerIds);

				set((state) => ({
					courts: adjustCourts(state.courts, courtCount) as Court[],
					waiting: [
						...state.waiting.filter((p) => !removedSet.has(p.playerId)),
						...addedPlayers,
					],
					resting: state.resting.filter((p) => !removedSet.has(p.playerId)),
				}));

				const appStore = useAppStore.getState();
				const appMeta = appStore.sessionMeta;
				if (appMeta) {
					appStore.setSessionMeta({ ...appMeta, courtCount, singleWomanIds });
				}

				// setup* 필드 동기화 (다른 클라이언트가 설정 화면으로 돌아올 때를 대비)
				const { waiting, resting, courts } = get();
				const allSessionPlayerIds = new Set([
					...waiting.map((p) => p.playerId),
					...resting.map((p) => p.playerId),
					...courts
						.flatMap((c) =>
							c.match ? [...c.match.teamA, ...c.match.teamB] : [],
						)
						.map((p) => p.playerId),
				]);
				const allPlayerIds = new Set(appStore.allPlayers.map((p) => p.id));
				const removedGuestIds = new Set(
					removedPlayerIds.filter((id) => !allPlayerIds.has(id)),
				);
				const newGuests = addedPlayers
					.filter((p) => !allPlayerIds.has(p.playerId))
					.map((p) => ({
						id: p.playerId,
						name: p.name,
						gender: p.gender,
						skills: p.skills,
					}));
				appStore.setSetupCourtCount(courtCount);
				appStore.setSetupSingleWomanIds(new Set(singleWomanIds));
				appStore.setSetupSelectedIds(allSessionPlayerIds);
				if (newGuests.length > 0 || removedGuestIds.size > 0) {
					appStore.setSetupGuests((prev) => [
						...prev.filter((g) => !removedGuestIds.has(g.id)),
						...newGuests,
					]);
				}
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
			"team_reserved",
			"reservation_cancelled",
			"player_status_changed",
			"player_force_mixed_changed",
			"player_force_hard_game_changed",
			"player_updated",
			"session_updated",
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
