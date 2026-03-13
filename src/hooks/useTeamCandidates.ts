import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Court, GeneratedTeam, PairHistory, SessionPlayer } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { dbSaveTeamCandidates } from "../lib/supabase/api";
import { sendBroadcast } from "../lib/supabase/broadcast";
import { generateBulkTeamCandidates } from "../lib/teamGenerator";

const TARGET_CANDIDATE_COUNT = 5;

interface UseTeamCandidatesParams {
	sessionId: number;
	waiting: SessionPlayer[];
	courts: Court[];
	matchQueue: GeneratedTeam[];
	singleWomanIds: string[];
	lastMixedPlayerIds: string[];
	lastCoPlayers: Record<string, string[]>;
	pairHistory: PairHistory;
	candidateTeams: GeneratedTeam[];
	setCandidateTeams: (teams: GeneratedTeam[]) => void;
	updateCandidateTeam: (index: number, team: GeneratedTeam) => void;
	handleAssign: (team: GeneratedTeam, courtId: number) => void;
	handleAddToQueue: (team: GeneratedTeam) => void;
}

export function useTeamCandidates({
	sessionId,
	waiting,
	courts,
	matchQueue,
	singleWomanIds,
	lastMixedPlayerIds,
	lastCoPlayers,
	pairHistory,
	candidateTeams,
	setCandidateTeams,
	updateCandidateTeam,
	handleAssign,
	handleAddToQueue,
}: UseTeamCandidatesParams) {
	// 경기중 선수 목록
	const playingPlayers = useMemo(
		() => courts.flatMap((c) => (c.match ? [...c.match.teamA, ...c.match.teamB] : [])),
		[courts],
	);

	// 대기열 선수 ID (큐 예약된 선수 — 생성 풀에서 제외)
	const queueMemberIds = useMemo(
		() => new Set(matchQueue.flatMap((t) => [...t.teamA, ...t.teamB]).map((p) => p.id)),
		[matchQueue],
	);

	// 대기열 선수 목록 (unavailableIds 용)
	const queuedPlayers = useMemo(
		() => matchQueue.flatMap((t) => [...t.teamA, ...t.teamB]),
		[matchQueue],
	);

	// 대기 인원 부족 시에만 경기중 선수를 생성 풀에 포함, 큐 멤버는 항상 제외
	const needExpand = waiting.length < 4;

	const generationPool = useMemo(
		() => {
			const base = needExpand ? [...waiting, ...playingPlayers] : waiting;
			return base.filter((p) => !queueMemberIds.has(p.id));
		},
		[waiting, playingPlayers, needExpand, queueMemberIds],
	);

	// 표시 필터 풀: 생성 풀만 (queued 선수 제외 → 재생성 트리거)
	const allPoolIds = useMemo(
		() => new Set(generationPool.map((p) => p.id)),
		[generationPool],
	);

	// 배정 불가 선수 ID (경기중 + 대기열)
	const unavailableIds = useMemo(
		() => new Set([...playingPlayers, ...queuedPlayers].map((p) => p.id)),
		[playingPlayers, queuedPlayers],
	);

	// 표시용 후보: 전체 풀에 존재하는 선수로 구성된 팀 (최대 5개)
	const { visibleCandidates, originalIndices } = useMemo(() => {
		const filtered: { team: typeof candidateTeams[number]; origIdx: number }[] = [];
		for (let i = 0; i < candidateTeams.length; i++) {
			const team = candidateTeams[i];
			const players = [...team.teamA, ...team.teamB];
			if (players.every((p) => allPoolIds.has(p.id))) {
				filtered.push({ team, origIdx: i });
			}
		}
		const limited = filtered.slice(0, TARGET_CANDIDATE_COUNT);

		return {
			visibleCandidates: limited.map((f) => f.team),
			originalIndices: limited.map((f) => f.origIdx),
		};
	}, [candidateTeams, allPoolIds]);

	// 표시 가능한 후보 수 (보충 트리거용)
	const visibleCount = useMemo(() => {
		let count = 0;
		for (const team of candidateTeams) {
			const players = [...team.teamA, ...team.teamB];
			if (players.every((p) => allPoolIds.has(p.id))) {
				count++;
				if (count >= TARGET_CANDIDATE_COUNT) break;
			}
		}
		return count;
	}, [candidateTeams, allPoolIds]);

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
	 * 대기 선수만으로 부족하면 경기중 선수도 포함하여 생성.
	 * forceRefresh=true면 기존 후보 모두 버리고 전체 재생성.
	 */
	const supplementCandidates = useCallback((forceRefresh = false) => {
		if (generationPool.length < 4) return;

		const existingValid = forceRefresh
			? []
			: candidateTeams.filter((team) => {
				const players = [...team.teamA, ...team.teamB];
				return players.every((p) => allPoolIds.has(p.id));
			});

		const need = TARGET_CANDIDATE_COUNT - existingValid.length;
		if (need <= 0) return;

		const newCandidates = generateBulkTeamCandidates(
			need,
			generationPool,
			singleWomanIds,
			lastMixedPlayerIds,
			lastCoPlayers,
			pairHistory,
			existingValid,
		);

		const allCandidates = [...existingValid, ...newCandidates];
		saveCandidates(allCandidates);
	}, [generationPool, candidateTeams, allPoolIds, singleWomanIds, lastMixedPlayerIds, lastCoPlayers, pairHistory, saveCandidates]);

	/** 수동 새로고침: 전체 재생성 */
	const handleRefreshCandidates = useCallback(() => {
		supplementCandidates(true);
	}, [supplementCandidates]);

	// 자동 보충: 유효 후보 부족 시 또는 풀 변경 시
	const prevPoolIdsRef = useRef("");
	useEffect(() => {
		const poolIds = generationPool.map((p) => p.id).sort().join(",");
		const poolChanged = poolIds !== prevPoolIdsRef.current;
		prevPoolIdsRef.current = poolIds;

		if (generationPool.length < 4) return;

		const needSupplement = visibleCount < TARGET_CANDIDATE_COUNT;

		if (needSupplement && poolChanged) {
			supplementCandidates();
		}
	}, [generationPool, visibleCount, supplementCandidates]);

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

	const handleQueueCandidate = useCallback(
		(candidateIndex: number) => {
			const origIndex = originalIndices[candidateIndex];
			const team = candidateTeams[origIndex];
			if (!team) return;
			handleAddToQueue(team);
		},
		[originalIndices, candidateTeams, handleAddToQueue],
	);

	return {
		visibleCandidates,
		unavailableIds,
		handleRefreshCandidates,
		handleCandidatePlayerReplace,
		handleAssignCandidate,
		handleQueueCandidate,
	};
}
