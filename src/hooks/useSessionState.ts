import { useCallback, useEffect, useMemo } from "react";
import { useAppStore } from "../store/appStore";
import {
	setPendingGroupId,
	setPendingTeam,
	setReservingSelected,
	setShowEndConfirm,
	setShowReserveModal,
} from "../store/sessionSetters";
import { useSessionStore } from "../store/sessionStore";

export interface UseSessionStateProps {
	onEnd: () => void;
}

export function useSessionState({ onEnd }: UseSessionStateProps) {
	const sessionMeta = useAppStore((s) => s.sessionMeta);
	if (!sessionMeta) {
		throw new Error(
			"No session metadata found. Cannot use useSessionState without active session.",
		);
	}
	const { sessionId, initialState } = sessionMeta;

	const initialize = useSessionStore((s) => s.initialize);
	const subscribe = useSessionStore((s) => s.subscribe);
	const unsubscribe = useSessionStore((s) => s.unsubscribe);

	const courts = useSessionStore((s) => s.courts);
	const waiting = useSessionStore((s) => s.waiting);
	const resting = useSessionStore((s) => s.resting);
	const reservedGroups = useSessionStore((s) => s.reservedGroups);
	const pendingTeam = useSessionStore((s) => s.pendingTeam);
	const pendingGroupId = useSessionStore((s) => s.pendingGroupId);
	const showEndConfirm = useSessionStore((s) => s.showEndConfirm);
	const showReserveModal = useSessionStore((s) => s.showReserveModal);
	const reservingSelected = useSessionStore((s) => s.reservingSelected);

	const handleGenerate = useSessionStore((s) => s.handleGenerate);
	const handleAssignGroup = useSessionStore((s) => s.handleAssignGroup);
	const handleAssign = useSessionStore((s) => s.handleAssign);
	const handleComplete = useSessionStore((s) => s.handleComplete);
	const toggleResting = useSessionStore((s) => s.toggleResting);
	const toggleForceMixed = useSessionStore((s) => s.toggleForceMixed);
	const handleCreateReservation = useSessionStore(
		(s) => s.handleCreateReservation,
	);
	const handleDisbandGroup = useSessionStore((s) => s.handleDisbandGroup);
	const handleEndSessionAction = useSessionStore((s) => s.handleEndSession);
	const toggleReservingPlayer = useSessionStore((s) => s.toggleReservingPlayer);

	useEffect(() => {
		initialize(initialState);
	}, [initialState, initialize]);

	useEffect(() => {
		subscribe(sessionId, onEnd);
		return () => {
			unsubscribe();
		};
	}, [sessionId, onEnd, subscribe, unsubscribe]);

	// ── 파생 상태 ────────────────────────────────────────────────

	const canGenerate = useMemo(
		() => waiting.length >= 4 && courts.some((c) => c.match === null),
		[waiting.length, courts],
	);

	const canReserve = useMemo(() => {
		const onCourtCount = courts.reduce((n, c) => n + (c.match ? 4 : 0), 0);
		return waiting.length + onCourtCount >= 2;
	}, [waiting.length, courts]);

	const courtPlayerMap = useMemo(() => {
		const map = new Map<string, number>();
		courts.forEach((c) => {
			if (c.match) {
				[...c.match.teamA, ...c.match.teamB].forEach((p) =>
					map.set(p.id, c.id),
				);
			}
		});
		return map;
	}, [courts]);

	const modalPlayers = useMemo(() => {
		const reservedMemberIds = new Set(
			reservedGroups.flatMap((g) => g.memberIds),
		);
		const onCourtPlayers = courts.flatMap((c) =>
			c.match ? [...c.match.teamA, ...c.match.teamB] : [],
		);
		return [
			...waiting.filter((p) => !reservedMemberIds.has(p.id)),
			...onCourtPlayers.filter((p) => !reservedMemberIds.has(p.id)),
		];
	}, [waiting, courts, reservedGroups]);

	const playingCount = useMemo(
		() => courts.reduce((n, c) => n + (c.match ? 4 : 0), 0),
		[courts],
	);

	const reservedReadyCount = useMemo(
		() => reservedGroups.reduce((n, g) => n + g.readyIds.length, 0),
		[reservedGroups],
	);

	const totalCount =
		waiting.length + resting.length + playingCount + reservedReadyCount;

	const handleEndSession = useCallback(
		() => handleEndSessionAction(onEnd),
		[handleEndSessionAction, onEnd],
	);

	return {
		courts,
		waiting,
		resting,
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
