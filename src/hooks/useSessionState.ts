import { useEffect, useRef, useState } from "react";
import {
	deserializePairHistory,
	serializePairHistory,
	supabase,
	updateSessionState,
	type SessionRow,
	type SessionStateData,
} from "../lib/supabaseClient";
import {
	generateTeam,
	generateTeamWithGroup,
	recordGameCount,
	recordHistory,
	recordMixedHistory,
} from "../lib/teamGenerator";
import type {
	Court,
	GameCountHistory,
	GeneratedTeam,
	MatchRecord,
	MixedHistory,
	PairHistory,
	Player,
	ReservedGroup,
	SessionSettings,
} from "../types";

export interface UseSessionStateProps {
	initialPlayers: Player[];
	settings: SessionSettings;
	initialStateData: SessionStateData | null;
	clientId: string;
	sessionId: number;
	onEnd: () => void;
}

export function useSessionState({
	initialPlayers,
	settings,
	initialStateData,
	clientId,
	sessionId,
	onEnd,
}: UseSessionStateProps) {
	const [courts, setCourts] = useState<Court[]>(
		() =>
			initialStateData?.courts ??
			Array.from({ length: settings.courtCount }, (_, i) => ({
				id: i + 1,
				team: null,
			})),
	);
	const [waiting, setWaiting] = useState<Player[]>(
		() => initialStateData?.waiting ?? initialPlayers,
	);
	const [resting, setResting] = useState<Player[]>(
		() => initialStateData?.resting ?? [],
	);
	const [history, setHistory] = useState<PairHistory>(() =>
		initialStateData?.history
			? deserializePairHistory(initialStateData.history)
			: {},
	);
	const [mixedHistory, setMixedHistory] = useState<MixedHistory>(
		() => initialStateData?.mixedHistory ?? {},
	);
	const [gameCountHistory, setGameCountHistory] = useState<GameCountHistory>(
		() => initialStateData?.gameCountHistory ?? {},
	);
	const [matchLog, setMatchLog] = useState<MatchRecord[]>(
		() => initialStateData?.matchLog ?? [],
	);
	const [pendingTeam, setPendingTeam] = useState<GeneratedTeam | null>(null);
	const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
	const [showEndConfirm, setShowEndConfirm] = useState(false);
	const [reservedGroups, setReservedGroups] = useState<ReservedGroup[]>(
		() => initialStateData?.reservedGroups ?? [],
	);
	const [showReserveModal, setShowReserveModal] = useState(false);
	const [reservingSelected, setReservingSelected] = useState<Set<string>>(
		new Set(),
	);
	const [prevInitialPlayers, setPrevInitialPlayers] = useState<Player[]>([]);
	const [prevCourtCount, setPrevCourtCount] = useState(() => courts.length);

	const courtsRef = useRef(courts);
	const reservedGroupsRef = useRef(reservedGroups);
	const restingRef = useRef(resting);

	useEffect(() => {
		courtsRef.current = courts;
		reservedGroupsRef.current = reservedGroups;
		restingRef.current = resting;
	}, [courts, reservedGroups, resting]);

	const processingRemoteUpdate = useRef(false);

	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		if (processingRemoteUpdate.current) {
			processingRemoteUpdate.current = false;
			return;
		}

		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => {
			const stateData: SessionStateData = {
				courts,
				waiting,
				history: serializePairHistory(history),
				mixedHistory,
				gameCountHistory,
				reservedGroups,
				resting,
				matchLog,
			};
			console.log(
				"[SAVE] 저장 courts:",
				JSON.stringify(
					courts.map((c) => ({
						id: c.id,
						team: c.team
							? c.team.teamA.map((p) => p.name) +
								" vs " +
								c.team.teamB.map((p) => p.name)
							: null,
					})),
				),
			);
			updateSessionState(sessionId, stateData, clientId);
		}, 500);
		return () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		};
	}, [
		courts,
		waiting,
		history,
		mixedHistory,
		gameCountHistory,
		reservedGroups,
		resting,
		matchLog,
		clientId,
		sessionId,
	]);

	useEffect(() => {
		const channel = supabase
			.channel("session-state-changes")
			.on(
				"postgres_changes",
				{
					event: "UPDATE",
					schema: "public",
					table: "sessions",
					filter: `id=eq.${sessionId}`,
				},
				(payload) => {
					const row = payload.new as SessionRow;
					if (row.last_client_id === clientId) {
						console.log("[REALTIME] 내 업데이트 → 무시");
						return;
					}
					if (!row.is_active) {
						onEnd();
						return;
					}
					if (!row.state_data) return;

					processingRemoteUpdate.current = true;

					const {
						courts: rc,
						waiting: rw,
						history: rh,
						mixedHistory: rm,
						gameCountHistory: rgc,
						reservedGroups: rr,
						resting: rrs,
						matchLog: rml = [],
					} = row.state_data;
					console.log(
						"[REALTIME] 상태 적용 courts:",
						JSON.stringify(
							rc.map((c) => ({
								id: c.id,
								team: c.team
									? c.team.teamA.map((p) => p.name) +
										" vs " +
										c.team.teamB.map((p) => p.name)
									: null,
							})),
						),
					);
					setCourts(rc);
					setWaiting(rw);
					setHistory(deserializePairHistory(rh));
					setMixedHistory(rm);
					setGameCountHistory(rgc);
					setReservedGroups(rr);
					setResting(rrs);
					setMatchLog(rml);
				},
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, [clientId, sessionId, onEnd]);

	if (initialPlayers !== prevInitialPlayers) {
		setPrevInitialPlayers(initialPlayers);

		const onCourtIds = new Set(
			courts.flatMap((c) =>
				c.team ? [...c.team.teamA, ...c.team.teamB].map((p) => p.id) : [],
			),
		);
		const reservedIds = new Set(
			reservedGroups.flatMap((g) => g.players.map((p) => p.id)),
		);
		const restingIds = new Set(resting.map((p) => p.id));
		const newIds = new Set(initialPlayers.map((p) => p.id));

		setResting((prev) => {
			const next = prev.filter((p) => newIds.has(p.id));
			if (next.length === prev.length) return prev;
			return next;
		});

		setWaiting((prev) => {
			const kept = prev.filter((p) => newIds.has(p.id));
			const keptIds = new Set(kept.map((p) => p.id));
			const added = initialPlayers.filter(
				(p) =>
					!keptIds.has(p.id) &&
					!onCourtIds.has(p.id) &&
					!reservedIds.has(p.id) &&
					!restingIds.has(p.id),
			);
			const next = [...kept, ...added];
			if (
				next.length === prev.length &&
				next.every((p, i) => p.id === prev[i].id)
			)
				return prev;
			return next;
		});
	}

	if (settings.courtCount !== prevCourtCount) {
		setPrevCourtCount(settings.courtCount);
		setCourts((prev) => {
			if (settings.courtCount > prev.length) {
				const added = Array.from(
					{ length: settings.courtCount - prev.length },
					(_, i) => ({
						id: prev.length + i + 1,
						team: null,
					}),
				);
				return [...prev, ...added];
			}
			if (settings.courtCount < prev.length) {
				const next = [...prev];
				while (
					next.length > settings.courtCount &&
					next[next.length - 1].team === null
				) {
					next.pop();
				}
				return next;
			}
			return prev;
		});
	}

	function toggleResting(playerId: string) {
		const isResting = resting.some((p) => p.id === playerId);
		if (isResting) {
			const player = resting.find((p) => p.id === playerId);
			if (!player) return;
			setResting((prev) => prev.filter((p) => p.id !== playerId));
			setWaiting((prev) => [...prev, player]);
		} else {
			const player = waiting.find((p) => p.id === playerId);
			if (!player) return;
			setWaiting((prev) => prev.filter((p) => p.id !== playerId));
			setResting((prev) => [...prev, player]);
		}
	}

	function handleGenerate() {
		const team = generateTeam(
			waiting,
			history,
			mixedHistory,
			gameCountHistory,
			settings.singleWomanIds,
		);
		if (!team) return;
		setPendingTeam(team);
		setPendingGroupId(null);
	}

	function handleAssignGroup(groupId: string) {
		const group = reservedGroups.find((g) => g.id === groupId);
		if (!group || group.readyIds.length !== group.players.length) return;

		const team = generateTeamWithGroup(
			group.players,
			waiting,
			history,
			gameCountHistory,
			settings.singleWomanIds,
		);
		if (!team) return;

		setPendingTeam(team);
		setPendingGroupId(groupId);
	}

	function handleAssign(courtId: number) {
		if (!pendingTeam) return;
		const assigned = [...pendingTeam.teamA, ...pendingTeam.teamB];
		console.log("[handleAssign] 코트", courtId, "배정");
		setCourts((prev) =>
			prev.map((c) => (c.id === courtId ? { ...c, team: pendingTeam } : c)),
		);
		setWaiting((prev) =>
			prev.filter((p) => !assigned.some((a) => a.id === p.id)),
		);
		setHistory((prev) => recordHistory(prev, pendingTeam));
		setMixedHistory((prev) => recordMixedHistory(prev, pendingTeam));
		setGameCountHistory((prev) => recordGameCount(prev, pendingTeam));

		const matchId = crypto.randomUUID();
		setMatchLog((prev) => [
			...prev,
			{
				id: matchId,
				courtId,
				team: pendingTeam,
				startTime: new Date().toISOString(),
				status: "playing",
			},
		]);

		if (pendingGroupId) {
			setReservedGroups((prev) => prev.filter((g) => g.id !== pendingGroupId));
			setPendingGroupId(null);
		}
		setPendingTeam(null);
	}

	function handleComplete(courtId: number) {
		const court = courts.find((c) => c.id === courtId);
		if (!court?.team) return;
		const returning = [...court.team.teamA, ...court.team.teamB];
		setCourts((prev) => {
			const next = prev.map((c) =>
				c.id === courtId ? { ...c, team: null } : c,
			);
			while (
				next.length > settings.courtCount &&
				next[next.length - 1].team === null
			) {
				next.pop();
			}
			return next;
		});

		setMatchLog((prev) =>
			prev.map((m) =>
				m.courtId === courtId && m.status === "playing"
					? { ...m, status: "completed", endTime: new Date().toISOString() }
					: m,
			),
		);

		const reservedGroupPlayerIds = new Set(
			reservedGroups.flatMap((g) => g.players.map((p) => p.id)),
		);
		const toReserved = returning.filter((p) =>
			reservedGroupPlayerIds.has(p.id),
		);
		const toWaiting = returning.filter(
			(p) => !reservedGroupPlayerIds.has(p.id),
		);

		if (toReserved.length > 0) {
			setReservedGroups((prev) =>
				prev.map((g) => {
					const newReady = [...g.readyIds];
					for (const p of toReserved) {
						if (
							g.players.some((gp) => gp.id === p.id) &&
							!newReady.includes(p.id)
						) {
							newReady.push(p.id);
						}
					}
					return { ...g, readyIds: newReady };
				}),
			);
		}

		setWaiting((prev) => [...prev, ...toWaiting]);
	}

	function handleCreateReservation() {
		if (reservingSelected.size < 2 || reservingSelected.size > 4) return;

		const waitingIds = new Set(waiting.map((p) => p.id));
		const onCourtPlayers = courts.flatMap((c) =>
			c.team ? [...c.team.teamA, ...c.team.teamB] : [],
		);
		const allPlayers = [...waiting, ...onCourtPlayers];
		const players = allPlayers.filter((p) => reservingSelected.has(p.id));
		const readyIds = [...reservingSelected].filter((id) => waitingIds.has(id));

		const groupId = `reserved-${Date.now()}`;
		setReservedGroups((prev) => [...prev, { id: groupId, players, readyIds }]);
		setWaiting((prev) => prev.filter((p) => !reservingSelected.has(p.id)));
		setReservingSelected(new Set());
		setShowReserveModal(false);
	}

	function handleDisbandGroup(groupId: string) {
		const group = reservedGroups.find((g) => g.id === groupId);
		if (!group) return;
		const readyPlayers = group.players.filter((p) =>
			group.readyIds.includes(p.id),
		);
		setWaiting((prev) => [...prev, ...readyPlayers]);
		setReservedGroups((prev) => prev.filter((g) => g.id !== groupId));
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

	const canGenerate =
		waiting.length >= 4 && courts.some((c) => c.team === null);
	const canReserve = (() => {
		const onCourtCount = courts.reduce((n, c) => n + (c.team ? 4 : 0), 0);
		return waiting.length + onCourtCount >= 2;
	})();

	const reservedPlayerIds = new Set(
		reservedGroups.flatMap((g) => g.players.map((p) => p.id)),
	);

	const onCourtPlayers = courts.flatMap((c) =>
		c.team ? [...c.team.teamA, ...c.team.teamB] : [],
	);
	const courtPlayerMap = new Map<string, number>();
	courts.forEach((c) => {
		if (c.team) {
			[...c.team.teamA, ...c.team.teamB].forEach((p) =>
				courtPlayerMap.set(p.id, c.id),
			);
		}
	});
	const modalPlayers = [
		...waiting.filter((p) => !reservedPlayerIds.has(p.id)),
		...onCourtPlayers.filter((p) => !reservedPlayerIds.has(p.id)),
	];

	const playingCount = courts.reduce(
		(n, c) => n + (c.team ? c.team.teamA.length + c.team.teamB.length : 0),
		0,
	);
	const reservedReadyCount = reservedGroups.reduce(
		(n, g) => n + g.readyIds.length,
		0,
	);
	const totalCount =
		waiting.length + resting.length + playingCount + reservedReadyCount;

	return {
		courts,
		waiting,
		resting,
		history,
		mixedHistory,
		gameCountHistory,
		matchLog,
		pendingTeam,
		setPendingTeam,
		pendingGroupId,
		setPendingGroupId,
		showEndConfirm,
		setShowEndConfirm,
		reservedGroups,
		showReserveModal,
		setShowReserveModal,
		reservingSelected,
		setReservingSelected,
		toggleResting,
		handleGenerate,
		handleAssignGroup,
		handleAssign,
		handleComplete,
		handleCreateReservation,
		handleDisbandGroup,
		toggleReservingPlayer,
		canGenerate,
		canReserve,
		courtPlayerMap,
		modalPlayers,
		playingCount,
		reservedReadyCount,
		totalCount,
	};
}
