import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
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
	type BroadcastPayload,
	type ClientSessionState,
} from "../lib/supabaseClient";
import { generateTeam, generateTeamWithGroup, recordHistory } from "../lib/teamGenerator";
import type {
	Court,
	GeneratedTeam,
	PairHistory,
	ReservedGroup,
	SessionPlayer,
} from "../types";

export interface UseSessionStateProps {
	sessionId: number;
	courtCount: number;
	clientId: string;
	initialState: ClientSessionState;
	singleWomanIds: string[];
	onEnd: () => void;
}

export function useSessionState({
	sessionId,
	courtCount,
	clientId,
	initialState,
	singleWomanIds,
	onEnd,
}: UseSessionStateProps) {
	const [courts, setCourts] = useState<Court[]>(initialState.courts);
	const [waiting, setWaiting] = useState<SessionPlayer[]>(initialState.waiting);
	const [resting, setResting] = useState<SessionPlayer[]>(initialState.resting);
	const [reservedGroups, setReservedGroups] = useState<ReservedGroup[]>(
		initialState.reservedGroups,
	);
	const [pairHistory, setPairHistory] = useState<PairHistory>(
		initialState.pairHistory,
	);

	const [lastMixedPlayerIds, setLastMixedPlayerIds] = useState<string[]>([]);
	const [pendingTeam, setPendingTeam] = useState<GeneratedTeam | null>(null);
	const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
	const [showEndConfirm, setShowEndConfirm] = useState(false);
	const [showReserveModal, setShowReserveModal] = useState(false);
	const [reservingSelected, setReservingSelected] = useState<Set<string>>(
		new Set(),
	);

	const channelRef = useRef<RealtimeChannel | null>(null);

	// Broadcast 수신 핸들러
	function applyBroadcast(ev: BroadcastPayload) {
		switch (ev.event) {
			case "match_started": {
				const { matchId, courtId, gameType, teamA, teamB, removedGroupId } =
					ev.payload;
				const allIds = new Set([teamA[0].id, teamA[1].id, teamB[0].id, teamB[1].id]);
				setCourts((prev) =>
					prev.map((c) =>
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
				);
				setWaiting((prev) => prev.filter((p) => !allIds.has(p.id)));
				if (removedGroupId) {
					setReservedGroups((prev) =>
						prev.filter((g) => g.id !== removedGroupId),
					);
				}
				break;
			}

			case "match_completed": {
				const { courtId, gameType, teamA, teamB, updatedPlayers, groupUpdates } =
					ev.payload;
				const updatedMap = new Map(updatedPlayers.map((p) => [p.id, p]));
				const toWaiting = updatedPlayers.filter((p) => p.status === "waiting");

				setCourts((prev) =>
					prev.map((c) => (c.id === courtId ? { ...c, match: null } : c)),
				);
				setWaiting((prev) => {
					const existing = prev.map((p) => updatedMap.get(p.id) ?? p);
					const newOnes = toWaiting.filter(
						(p) => !prev.some((pp) => pp.id === p.id),
					);
					return [...existing, ...newOnes];
				});
				setReservedGroups((prev) =>
					prev.map((g) => {
						const upd = groupUpdates.find((u) => u.groupId === g.id);
						if (!upd) return g;
						return {
							...g,
							readyIds: upd.readyIds,
							players: g.players.map((p) => updatedMap.get(p.id) ?? p),
						};
					}),
				);
				// 클라이언트 PairHistory 업데이트
				setPairHistory((prev) => {
					const next = { ...prev };
					for (const [a, b] of [teamA, teamB] as [
						[SessionPlayer, SessionPlayer],
						[SessionPlayer, SessionPlayer],
					]) {
						if (!next[a.id]) next[a.id] = new Set();
						if (!next[b.id]) next[b.id] = new Set();
						next[a.id].add(b.id);
						next[b.id].add(a.id);
					}
					return next;
				});
				// 혼복 완료 시 규칙 1.5용 lastMixedPlayerIds 갱신
				if (gameType === "혼복") {
					setLastMixedPlayerIds([...teamA, ...teamB].map((p) => p.id));
				}
				break;
			}

			case "player_status_changed": {
				const { player } = ev.payload;
				if (player.status === "resting") {
					setWaiting((prev) => prev.filter((p) => p.id !== player.id));
					setResting((prev) => {
						if (prev.some((p) => p.id === player.id)) return prev;
						return [...prev, player];
					});
				} else if (player.status === "waiting") {
					setResting((prev) => prev.filter((p) => p.id !== player.id));
					setWaiting((prev) => {
						if (prev.some((p) => p.id === player.id)) return prev;
						return [...prev, player];
					});
				}
				break;
			}

			case "player_force_mixed_changed": {
				const { player } = ev.payload;
				setWaiting((prev) =>
					prev.map((p) => (p.id === player.id ? player : p)),
				);
				break;
			}

			case "group_reserved": {
				const { group, reservedPlayerIds } = ev.payload;
				setReservedGroups((prev) => [...prev, group]);
				setWaiting((prev) =>
					prev.filter((p) => !reservedPlayerIds.includes(p.id)),
				);
				break;
			}

			case "group_disbanded": {
				const { groupId, readyPlayers } = ev.payload;
				if (readyPlayers.length > 0) {
					setWaiting((prev) => [...prev, ...readyPlayers]);
				}
				setReservedGroups((prev) => prev.filter((g) => g.id !== groupId));
				break;
			}

			case "session_ended": {
				onEnd();
				break;
			}
		}
	}

	// Broadcast 채널 구독
	useEffect(() => {
		const channel = createBroadcastChannel(sessionId);
		channel
			.on("broadcast", { event: "match_started" }, ({ payload }) =>
				applyBroadcast({ event: "match_started", payload } as BroadcastPayload),
			)
			.on("broadcast", { event: "match_completed" }, ({ payload }) =>
				applyBroadcast({ event: "match_completed", payload } as BroadcastPayload),
			)
			.on("broadcast", { event: "player_status_changed" }, ({ payload }) =>
				applyBroadcast({
					event: "player_status_changed",
					payload,
				} as BroadcastPayload),
			)
			.on("broadcast", { event: "player_force_mixed_changed" }, ({ payload }) =>
				applyBroadcast({
					event: "player_force_mixed_changed",
					payload,
				} as BroadcastPayload),
			)
			.on("broadcast", { event: "group_reserved" }, ({ payload }) =>
				applyBroadcast({ event: "group_reserved", payload } as BroadcastPayload),
			)
			.on("broadcast", { event: "group_disbanded" }, ({ payload }) =>
				applyBroadcast({ event: "group_disbanded", payload } as BroadcastPayload),
			)
			.on("broadcast", { event: "session_ended" }, () =>
				applyBroadcast({ event: "session_ended" }),
			)
			.subscribe();

		channelRef.current = channel;
		return () => {
			supabase.removeChannel(channel);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionId]);

	// sessions 테이블 변경 감지 (다른 클라이언트의 세션 종료)
	useEffect(() => {
		const channel = supabase
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

		return () => {
			supabase.removeChannel(channel);
		};
	}, [sessionId, onEnd]);

	// ── 이벤트 핸들러 ───────────────────────────────────────────

	function handleGenerate() {
		const team = generateTeam(waiting, pairHistory, singleWomanIds, lastMixedPlayerIds);
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

		// 낙관적 그룹 readyIds 업데이트
		const optimisticUpdatedPlayers = [...optimisticWaiting];
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

	// ── 파생 상태 ────────────────────────────────────────────────

	const canGenerate =
		waiting.length >= 4 && courts.some((c) => c.match === null);

	const canReserve = (() => {
		const onCourtCount = courts.reduce(
			(n, c) => n + (c.match ? 4 : 0),
			0,
		);
		return waiting.length + onCourtCount >= 2;
	})();

	const reservedMemberIds = new Set(
		reservedGroups.flatMap((g) => g.memberIds),
	);
	const onCourtPlayers = courts.flatMap((c) =>
		c.match ? [...c.match.teamA, ...c.match.teamB] : [],
	);
	const courtPlayerMap = new Map<string, number>();
	courts.forEach((c) => {
		if (c.match) {
			[...c.match.teamA, ...c.match.teamB].forEach((p) =>
				courtPlayerMap.set(p.id, c.id),
			);
		}
	});

	const modalPlayers = [
		...waiting.filter((p) => !reservedMemberIds.has(p.id)),
		...onCourtPlayers.filter((p) => !reservedMemberIds.has(p.id)),
	];

	const playingCount = courts.reduce(
		(n, c) => n + (c.match ? 4 : 0),
		0,
	);
	const reservedReadyCount = reservedGroups.reduce(
		(n, g) => n + g.readyIds.length,
		0,
	);
	const totalCount =
		waiting.length + resting.length + playingCount + reservedReadyCount;

	// courts 수가 courtCount와 다를 경우 동기화
	// (세션 설정이 업데이트된 경우는 현재 구조에서 미지원)

	return {
		courts,
		waiting,
		resting,
		pairHistory,
		reservedGroups,
		pendingTeam,
		setPendingTeam,
		pendingGroupId,
		setPendingGroupId,
		showEndConfirm,
		setShowEndConfirm,
		showReserveModal,
		setShowReserveModal,
		reservingSelected,
		setReservingSelected,
		toggleResting,
		toggleForceMixed,
		handleGenerate,
		handleAssignGroup,
		handleAssign,
		handleComplete,
		handleCreateReservation,
		handleDisbandGroup,
		handleEndSession,
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
