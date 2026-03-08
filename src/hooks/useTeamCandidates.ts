import { useCallback, useEffect, useMemo, useRef } from "react";
import type { GeneratedTeam, PairHistory, SessionPlayer } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { dbSaveTeamCandidates } from "../lib/supabase/api";
import { sendBroadcast } from "../lib/supabase/broadcast";
import { generateBulkTeamCandidates } from "../lib/teamGenerator";

const TARGET_CANDIDATE_COUNT = 5;

interface UseTeamCandidatesParams {
	sessionId: number;
	waiting: SessionPlayer[];
	singleWomanIds: string[];
	lastMixedPlayerIds: string[];
	lastCoPlayers: Record<string, string[]>;
	pairHistory: PairHistory;
	candidateTeams: GeneratedTeam[];
	setCandidateTeams: (teams: GeneratedTeam[]) => void;
	updateCandidateTeam: (index: number, team: GeneratedTeam) => void;
	handleAssign: (team: GeneratedTeam, courtId: number) => void;
}

export function useTeamCandidates({
	sessionId,
	waiting,
	singleWomanIds,
	lastMixedPlayerIds,
	lastCoPlayers,
	pairHistory,
	candidateTeams,
	setCandidateTeams,
	updateCandidateTeam,
	handleAssign,
}: UseTeamCandidatesParams) {
	// 유효한 후보 필터 (4명 모두 대기 중)
	const validCandidates = useMemo(() => {
		const waitingIds = new Set(waiting.map((p) => p.id));
		return candidateTeams.filter((team) => {
			const players = [...team.teamA, ...team.teamB];
			return players.every((p) => waitingIds.has(p.id));
		});
	}, [candidateTeams, waiting]);

	// 표시용: 최대 5개
	const { visibleCandidates, originalIndices } = useMemo(() => {
		const waitingIds = new Set(waiting.map((p) => p.id));
		const filtered: { team: typeof candidateTeams[number]; origIdx: number }[] = [];
		for (let i = 0; i < candidateTeams.length; i++) {
			const team = candidateTeams[i];
			const players = [...team.teamA, ...team.teamB];
			const allWaiting = players.every((p) => waitingIds.has(p.id));
			if (allWaiting) {
				filtered.push({ team, origIdx: i });
			}
		}
		const limited = filtered.slice(0, TARGET_CANDIDATE_COUNT);

		return {
			visibleCandidates: limited.map((f) => f.team),
			originalIndices: limited.map((f) => f.origIdx),
		};
	}, [candidateTeams, waiting]);

	/** 후보 저장 + DB 반영 + 브로드캐스트 */
	const saveCandidates = useCallback(async (allCandidates: GeneratedTeam[]) => {
		setCandidateTeams(allCandidates);

		if (sessionId) {
			await dbSaveTeamCandidates(sessionId, allCandidates);
		}

		const channel = useSessionStore.getState()._channel;
		if (channel) {
			sendBroadcast(channel, {
				event: "candidates_updated",
				payload: { candidates: allCandidates },
			});
		}
	}, [sessionId, setCandidateTeams]);

	/**
	 * 보충 모드: 유효한 기존 후보를 유지하고 부족분만 새로 생성.
	 * forceRefresh=true면 기존 후보 모두 버리고 전체 재생성.
	 */
	const supplementCandidates = useCallback((forceRefresh = false) => {
		if (waiting.length < 4) return;

		const existing = forceRefresh ? [] : validCandidates;
		const need = TARGET_CANDIDATE_COUNT - existing.length;

		if (need <= 0) return;

		const newCandidates = generateBulkTeamCandidates(
			need,
			waiting,
			singleWomanIds,
			lastMixedPlayerIds,
			lastCoPlayers,
			pairHistory,
			existing,
		);

		const allCandidates = [...existing, ...newCandidates];
		saveCandidates(allCandidates);
	}, [waiting, validCandidates, singleWomanIds, lastMixedPlayerIds, lastCoPlayers, pairHistory, saveCandidates]);

	/** 수동 새로고침: 전체 재생성 */
	const handleRefreshCandidates = useCallback(() => {
		supplementCandidates(true);
	}, [supplementCandidates]);

	// 자동 보충: 유효 후보 부족 시 또는 대기 인원 변경 시
	const prevWaitingIdsRef = useRef("");
	useEffect(() => {
		const waitingIds = waiting.map((p) => p.id).sort().join(",");
		const waitingChanged = waitingIds !== prevWaitingIdsRef.current;
		prevWaitingIdsRef.current = waitingIds;

		if (waiting.length < 4) return;

		const needSupplement = validCandidates.length < TARGET_CANDIDATE_COUNT;

		if (needSupplement && waitingChanged) {
			supplementCandidates();
		}
	}, [waiting, validCandidates.length, supplementCandidates]);

	const handleCandidatePlayerReplace = (visibleIndex: number, oldPlayer: SessionPlayer, newPlayer: SessionPlayer) => {
		const origIndex = originalIndices[visibleIndex];
		const team = candidateTeams[origIndex];
		if (!team) return;

		const newTeamA = team.teamA.map((p) =>
			p.id === oldPlayer.id ? newPlayer : p,
		) as [SessionPlayer, SessionPlayer];

		const newTeamB = team.teamB.map((p) =>
			p.id === oldPlayer.id ? newPlayer : p,
		) as [SessionPlayer, SessionPlayer];

		updateCandidateTeam(origIndex, {
			...team,
			teamA: newTeamA,
			teamB: newTeamB,
		});
	};

	const handleAssignCandidate = useCallback(
		(candidateIndex: number, courtId: number) => {
			const origIndex = originalIndices[candidateIndex];
			const team = candidateTeams[origIndex];
			if (!team) return;
			handleAssign(team, courtId);
		},
		[originalIndices, candidateTeams, handleAssign],
	);

	return {
		visibleCandidates,
		handleRefreshCandidates,
		handleCandidatePlayerReplace,
		handleAssignCandidate,
	};
}
