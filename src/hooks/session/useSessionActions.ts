import type { RealtimeChannel } from "@supabase/supabase-js";
import {
	dbAssignMatch,
	dbCompleteMatch,
	dbCreateReservation,
	dbDisbandGroup,
	dbEndSession,
	dbToggleForceMixed,
	dbToggleResting,
	sendBroadcast,
} from "../../lib/supabase";
import {
	generateTeam,
	generateTeamWithGroup,
	recordHistory,
} from "../../lib/teamGenerator";
import type {
	Court,
	GeneratedTeam,
	PairHistory,
	ReservedGroup,
	SessionPlayer,
} from "../../types";

export interface UseSessionActionsProps {
	sessionId: number;
	courts: Court[];
	setCourts: React.Dispatch<React.SetStateAction<Court[]>>;
	waiting: SessionPlayer[];
	setWaiting: React.Dispatch<React.SetStateAction<SessionPlayer[]>>;
	resting: SessionPlayer[];
	setResting: React.Dispatch<React.SetStateAction<SessionPlayer[]>>;
	reservedGroups: ReservedGroup[];
	setReservedGroups: React.Dispatch<React.SetStateAction<ReservedGroup[]>>;
	pairHistory: PairHistory;
	setPairHistory: React.Dispatch<React.SetStateAction<PairHistory>>;
	lastMixedPlayerIds: string[];
	setLastMixedPlayerIds: React.Dispatch<React.SetStateAction<string[]>>;
	pendingTeam: GeneratedTeam | null;
	setPendingTeam: React.Dispatch<React.SetStateAction<GeneratedTeam | null>>;
	pendingGroupId: string | null;
	setPendingGroupId: React.Dispatch<React.SetStateAction<string | null>>;
	reservingSelected: Set<string>;
	setReservingSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
	setShowReserveModal: React.Dispatch<React.SetStateAction<boolean>>;
	channelRef: React.MutableRefObject<RealtimeChannel | null>;
	singleWomanIds: string[];
	onEnd: () => void;
}

export function useSessionActions({
	sessionId,
	courts,
	setCourts,
	waiting,
	setWaiting,
	resting,
	setResting,
	reservedGroups,
	setReservedGroups,
	pairHistory,
	setPairHistory,
	lastMixedPlayerIds,
	setLastMixedPlayerIds,
	pendingTeam,
	setPendingTeam,
	pendingGroupId,
	setPendingGroupId,
	reservingSelected,
	setReservingSelected,
	setShowReserveModal,
	channelRef,
	singleWomanIds,
	onEnd,
}: UseSessionActionsProps) {
	function handleGenerate() {
		const team = generateTeam(
			waiting,
			pairHistory,
			singleWomanIds,
			lastMixedPlayerIds,
		);
		if (!team) return;
		setPendingTeam(team);
		setPendingGroupId(null);
	}

	function handleAssignGroup(groupId: string) {
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

		setPendingTeam(team);
		setPendingGroupId(groupId);
	}

	async function handleAssign(courtId: number) {
		if (!pendingTeam || !channelRef.current) return;

		const matchId = crypto.randomUUID();
		const removedGroupId = pendingGroupId;

		// 낙관적 UI 업데이트
		const allIds = new Set([
			pendingTeam.teamA[0].id,
			pendingTeam.teamA[1].id,
			pendingTeam.teamB[0].id,
			pendingTeam.teamB[1].id,
		]);
		setCourts((prev) =>
			prev.map((c) =>
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
		);
		setWaiting((prev) => prev.filter((p) => !allIds.has(p.id)));
		if (removedGroupId) {
			setReservedGroups((prev) => prev.filter((g) => g.id !== removedGroupId));
		}
		setPairHistory((prev) => recordHistory(prev, pendingTeam));
		setPendingTeam(null);
		setPendingGroupId(null);

		// DB + Broadcast
		const ok = await dbAssignMatch(
			sessionId,
			matchId,
			pendingTeam,
			courtId,
			removedGroupId,
		);
		if (ok) {
			sendBroadcast(channelRef.current, {
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
	}

	async function handleComplete(courtId: number) {
		const court = courts.find((c) => c.id === courtId);
		if (!court?.match || !channelRef.current) return;

		const match = court.match;

		// 낙관적 UI 업데이트
		setCourts((prev) =>
			prev.map((c) => (c.id === courtId ? { ...c, match: null } : c)),
		);

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

		// 낙관적 대기 복귀
		const optimisticWaiting = toWaiting.map((p) => ({
			...p,
			status: "waiting" as const,
			waitSince: now,
			gameCount: p.gameCount + 1,
			mixedCount: isMixed && p.gender === "M" ? p.mixedCount + 1 : p.mixedCount,
		}));
		setWaiting((prev) => [...prev, ...optimisticWaiting]);

		const optimisticUpdatedPlayers: SessionPlayer[] = [...optimisticWaiting];
		const groupUpdates: Array<{ groupId: string; readyIds: string[] }> = [];

		for (const p of toReservedBack) {
			const updated = {
				...p,
				gameCount: p.gameCount + 1,
				mixedCount:
					isMixed && p.gender === "M" ? p.mixedCount + 1 : p.mixedCount,
			};
			optimisticUpdatedPlayers.push(updated);
		}
		setReservedGroups((prev) =>
			prev.map((g) => {
				const backIds = toReservedBack
					.filter((p) => g.memberIds.includes(p.id))
					.map((p) => p.id);
				if (backIds.length === 0) return g;
				const newReadyIds = [...new Set([...g.readyIds, ...backIds])];
				groupUpdates.push({ groupId: g.id, readyIds: newReadyIds });
				const updMap = new Map(optimisticUpdatedPlayers.map((p) => [p.id, p]));
				return {
					...g,
					readyIds: newReadyIds,
					players: g.players.map((p) => updMap.get(p.id) ?? p),
				};
			}),
		);

		// PairHistory 업데이트
		setPairHistory((prev) => {
			const next = { ...prev };
			for (const pair of [match.teamA, match.teamB]) {
				const [a, b] = pair;
				if (!next[a.id]) next[a.id] = new Set();
				if (!next[b.id]) next[b.id] = new Set();
				next[a.id].add(b.id);
				next[b.id].add(a.id);
			}
			return next;
		});

		// 혼복 완료 시 규칙 1.5용 lastMixedPlayerIds 갱신
		if (isMixed) {
			setLastMixedPlayerIds([...match.teamA, ...match.teamB].map((p) => p.id));
		}

		// DB + Broadcast
		const result = await dbCompleteMatch(sessionId, match, reservedGroups);
		if (result && channelRef.current) {
			sendBroadcast(channelRef.current, {
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
	}

	async function toggleResting(playerId: string) {
		if (!channelRef.current) return;
		const player =
			waiting.find((p) => p.id === playerId) ??
			resting.find((p) => p.id === playerId);
		if (!player) return;

		const updated = await dbToggleResting(player);
		if (!updated) return;

		// 낙관적 UI 업데이트
		if (player.status === "resting") {
			setResting((prev) => prev.filter((p) => p.id !== playerId));
			setWaiting((prev) => [...prev, updated]);
		} else {
			setWaiting((prev) => prev.filter((p) => p.id !== playerId));
			setResting((prev) => [...prev, updated]);
		}

		sendBroadcast(channelRef.current, {
			event: "player_status_changed",
			payload: { player: updated },
		});
	}

	async function toggleForceMixed(playerId: string) {
		if (!channelRef.current) return;
		const player = waiting.find((p) => p.id === playerId);
		if (!player || player.status !== "waiting") return;

		const updated = await dbToggleForceMixed(player);
		if (!updated) return;

		setWaiting((prev) => prev.map((p) => (p.id === playerId ? updated : p)));

		sendBroadcast(channelRef.current, {
			event: "player_force_mixed_changed",
			payload: { player: updated },
		});
	}

	function handleCreateReservation() {
		if (!channelRef.current) return;
		if (reservingSelected.size < 2 || reservingSelected.size > 4) return;

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

		// 낙관적 UI 업데이트
		setReservedGroups((prev) => [...prev, group]);
		setWaiting((prev) => prev.filter((p) => !reservingSelected.has(p.id)));
		setReservingSelected(new Set());
		setShowReserveModal(false);

		// DB + Broadcast
		dbCreateReservation(sessionId, groupId, players, readyIds).then((ok) => {
			if (ok && channelRef.current) {
				sendBroadcast(channelRef.current, {
					event: "group_reserved",
					payload: { group, reservedPlayerIds: readyIds },
				});
			}
		});
	}

	async function handleDisbandGroup(groupId: string) {
		if (!channelRef.current) return;
		const group = reservedGroups.find((g) => g.id === groupId);
		if (!group) return;

		// 낙관적 UI 업데이트
		const readyPlayers = group.players.filter((p) =>
			group.readyIds.includes(p.id),
		);
		setWaiting((prev) => [...prev, ...readyPlayers]);
		setReservedGroups((prev) => prev.filter((g) => g.id !== groupId));

		const ok = await dbDisbandGroup(group);
		if (ok && channelRef.current) {
			sendBroadcast(channelRef.current, {
				event: "group_disbanded",
				payload: { groupId, readyPlayers },
			});
		}
	}

	async function handleEndSession() {
		if (!channelRef.current) return;
		await dbEndSession(sessionId);
		sendBroadcast(channelRef.current, { event: "session_ended" });
		onEnd();
	}

	function toggleReservingPlayer(playerId: string) {
		setReservingSelected((prev) => {
			const next = new Set(prev);
			if (next.has(playerId)) {
				next.delete(playerId);
			} else if (next.size < 4) {
				next.add(playerId);
			}
			return next;
		});
	}

	return {
		handleGenerate,
		handleAssignGroup,
		handleAssign,
		handleComplete,
		toggleResting,
		toggleForceMixed,
		handleCreateReservation,
		handleDisbandGroup,
		handleEndSession,
		toggleReservingPlayer,
	};
}
