import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import {
	type BroadcastPayload,
	type ClientSessionState,
	createBroadcastChannel,
	supabase,
} from "../lib/supabase";
import type {
	Court,
	GeneratedTeam,
	PairHistory,
	ReservedGroup,
	SessionPlayer,
} from "../types";
import { useSessionActions } from "./session/useSessionActions";

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
				const allIds = new Set([
					teamA[0].id,
					teamA[1].id,
					teamB[0].id,
					teamB[1].id,
				]);
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
				const {
					courtId,
					gameType,
					teamA,
					teamB,
					updatedPlayers,
					groupUpdates,
				} = ev.payload;
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
				applyBroadcast({
					event: "match_completed",
					payload,
				} as BroadcastPayload),
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
				applyBroadcast({
					event: "group_reserved",
					payload,
				} as BroadcastPayload),
			)
			.on("broadcast", { event: "group_disbanded" }, ({ payload }) =>
				applyBroadcast({
					event: "group_disbanded",
					payload,
				} as BroadcastPayload),
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
	const {
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
	} = useSessionActions({
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
	});

	// ── 파생 상태 ────────────────────────────────────────────────

	const canGenerate =
		waiting.length >= 4 && courts.some((c) => c.match === null);

	const canReserve = (() => {
		const onCourtCount = courts.reduce((n, c) => n + (c.match ? 4 : 0), 0);
		return waiting.length + onCourtCount >= 2;
	})();

	const reservedMemberIds = new Set(reservedGroups.flatMap((g) => g.memberIds));
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

	const playingCount = courts.reduce((n, c) => n + (c.match ? 4 : 0), 0);
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
