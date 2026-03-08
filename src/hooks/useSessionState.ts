import { useCallback, useEffect, useMemo } from "react";
import { useAppStore } from "../store/appStore";
import {
	setShowEndConfirm,
} from "../store/sessionSetters";
import { useSessionStore } from "../store/sessionStore";

interface UseSessionStateProps {
	onEnd: () => void;
}

export function useSessionState({ onEnd }: UseSessionStateProps) {
	const sessionMeta = useAppStore((s) => s.sessionMeta);
	if (!sessionMeta) {
		throw new Error(
			"No session metadata found. Cannot use useSessionState without active session.",
		);
	}
	const { sessionId } = sessionMeta;

	const subscribe = useSessionStore((s) => s.subscribe);
	const unsubscribe = useSessionStore((s) => s.unsubscribe);

	const courts = useSessionStore((s) => s.courts);
	const waiting = useSessionStore((s) => s.waiting);
	const resting = useSessionStore((s) => s.resting);
	const showEndConfirm = useSessionStore((s) => s.showEndConfirm);

	const handleAssign = useSessionStore((s) => s.handleAssign);
	const handleComplete = useSessionStore((s) => s.handleComplete);
	const toggleResting = useSessionStore((s) => s.toggleResting);
	const toggleForceMixed = useSessionStore((s) => s.toggleForceMixed);
	const toggleForceHardGame = useSessionStore((s) => s.toggleForceHardGame);
	const handleEndSessionAction = useSessionStore((s) => s.handleEndSession);
	const pairHistory = useSessionStore((s) => s.pairHistory);
	const candidateTeams = useSessionStore((s) => s.candidateTeams);
	const setCandidateTeams = useSessionStore((s) => s.setCandidateTeams);
	const updateCandidateTeam = useSessionStore((s) => s.updateCandidateTeam);
	const lastMixedPlayerIds = useSessionStore((s) => s.lastMixedPlayerIds);
	const lastCoPlayers = useSessionStore((s) => s.lastCoPlayers);

	useEffect(() => {
		subscribe(sessionId, onEnd);
		return () => {
			unsubscribe();
		};
	}, [sessionId, onEnd, subscribe, unsubscribe]);

	// ── 파생 상태 ────────────────────────────────────────────────

	const playingCount = useMemo(
		() => courts.reduce((n, c) => n + (c.match ? 4 : 0), 0),
		[courts],
	);

	const totalCount = waiting.length + resting.length + playingCount;

	const handleEndSession = useCallback(
		() => handleEndSessionAction(onEnd),
		[handleEndSessionAction, onEnd],
	);

	return {
		courts,
		waiting,
		resting,
		candidateTeams,
		setCandidateTeams,
		updateCandidateTeam,
		showEndConfirm,
		setShowEndConfirm,
		toggleResting,
		toggleForceMixed,
		toggleForceHardGame,
		handleAssign,
		handleComplete,
		handleEndSession,
		playingCount,
		totalCount,
		pairHistory,
		lastMixedPlayerIds,
		lastCoPlayers,
	};
}
