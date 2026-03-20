import { useCallback, useEffect, useMemo, useRef } from "react";
import type { GeneratedTeam, SessionPlayer, TeamStrategy } from "../types";
import { useAppStore } from "../store/appStore";
import { useSessionStore } from "../store/sessionStore";
import { dbSaveTeamCandidates } from "../lib/supabase/api";
import { sendBroadcast } from "../lib/supabase/broadcast";
import { generateBulkTeamCandidates } from "../lib/teamGenerator";
import { getPlayingPlayers, getUnavailableIds } from "../lib/sessionUtils";

const TARGET_CANDIDATE_COUNT = 5;

interface UseTeamCandidatesParams {
	strategyFilter: TeamStrategy | null;
}

export function useTeamCandidates({ strategyFilter }: UseTeamCandidatesParams) {
	const sessionId = useAppStore((s) => s.sessionMeta?.sessionId) ?? 0;
	const singleWomanIds = useAppStore((s) => s.sessionMeta?.singleWomanIds) ?? EMPTY_SINGLE_WOMAN_IDS;

	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);
	const waitingIds = useSessionStore((s) => s.waitingIds);
	const courts = useSessionStore((s) => s.courts);
	const matchQueue = useSessionStore((s) => s.matchQueue);
	const pairHistory = useSessionStore((s) => s.pairHistory);
	const candidateTeams = useSessionStore((s) => s.candidateTeams);
	const setCandidateTeams = useSessionStore((s) => s.setCandidateTeams);
	const updateCandidateTeam = useSessionStore((s) => s.updateCandidateTeam);
	const handleAssign = useSessionStore((s) => s.handleAssign);
	const handleAddToQueue = useSessionStore((s) => s.handleAddToQueue);
	const lastMixedPlayerIds = useSessionStore((s) => s.lastMixedPlayerIds);
	const lastCoPlayers = useSessionStore((s) => s.lastCoPlayers);

	// waiting 선수 목록 (Map에서 파생)
	const waiting = useMemo(
		() => waitingIds.map((id) => sessionPlayers.get(id)).filter((p): p is SessionPlayer => p !== undefined),
		[waitingIds, sessionPlayers],
	);

	// 경기중 선수 목록
	const playingPlayers = useMemo(
		() => getPlayingPlayers(courts, sessionPlayers),
		[courts, sessionPlayers],
	);

	// 대기열 선수 ID (큐 예약된 선수 — 생성 풀에서 제외)
	const queueMemberIds = useMemo(
		() => new Set(matchQueue.flatMap((t) => [...t.teamA, ...t.teamB])),
		[matchQueue],
	);

	// 대기열 선수 목록 (unavailableIds 용)
	const queuedPlayers = useMemo(
		() =>
			matchQueue
				.flatMap((t) => [...t.teamA, ...t.teamB])
				.map((id) => sessionPlayers.get(id))
				.filter((p): p is SessionPlayer => p !== undefined),
		[matchQueue, sessionPlayers],
	);

	// 항상 경기중 선수를 생성 풀에 포함 (경기중 = 곧 가용), 큐 멤버는 제외
	const generationPool = useMemo(
		() => {
			const base = [...waiting, ...playingPlayers];
			return base.filter((p) => !queueMemberIds.has(p.id));
		},
		[waiting, playingPlayers, queueMemberIds],
	);

	// 표시 필터 풀: 생성 풀만 (queued 선수 제외 → 재생성 트리거)
	const allPoolIds = useMemo(
		() => new Set(generationPool.map((p) => p.id)),
		[generationPool],
	);

	// 배정 불가 선수 ID (경기중 + 대기열)
	const unavailableIds = useMemo(
		() => getUnavailableIds(playingPlayers, queuedPlayers),
		[playingPlayers, queuedPlayers],
	);

	// 표시용 후보 + 표시 가능 수: 단일 순회로 계산
	const { visibleCandidates, visibleCount, originalIndices } = useMemo(() => {
		const limited: { team: typeof candidateTeams[number]; origIdx: number }[] = [];
		let count = 0;
		for (let i = 0; i < candidateTeams.length; i++) {
			const team = candidateTeams[i];
			if (team.teamA.every((id) => allPoolIds.has(id)) && team.teamB.every((id) => allPoolIds.has(id))) {
				count++;
				if (limited.length < TARGET_CANDIDATE_COUNT) {
					limited.push({ team, origIdx: i });
				}
				if (count >= TARGET_CANDIDATE_COUNT) break;
			}
		}
		return {
			visibleCandidates: limited.map((f) => f.team),
			visibleCount: count,
			originalIndices: limited.map((f) => f.origIdx),
		};
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
			: candidateTeams.filter((team) =>
				[...team.teamA, ...team.teamB].every((id) => allPoolIds.has(id)),
			);

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
			strategyFilter ?? undefined,
		);

		const allCandidates = [...existingValid, ...newCandidates];
		saveCandidates(allCandidates);
	}, [generationPool, candidateTeams, allPoolIds, singleWomanIds, lastMixedPlayerIds, lastCoPlayers, pairHistory, saveCandidates, strategyFilter]);

	/** 수동 새로고침: 전체 재생성 */
	const handleRefreshCandidates = useCallback(() => {
		supplementCandidates(true);
	}, [supplementCandidates]);

	// 전략 필터 변경 시 전체 재생성
	const prevStrategyRef = useRef<TeamStrategy | null>(strategyFilter);
	useEffect(() => {
		if (prevStrategyRef.current !== strategyFilter) {
			prevStrategyRef.current = strategyFilter;
			if (generationPool.length >= 4) {
				supplementCandidates(true);
			}
		}
	}, [strategyFilter, generationPool, supplementCandidates]);

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

		const replaceId = (id: string) => (id === oldPlayer.id ? newPlayer.id : id);
		updateCandidateTeam(origIndex, {
			...team,
			teamA: team.teamA.map(replaceId) as [string, string],
			teamB: team.teamB.map(replaceId) as [string, string],
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
		playingPlayers,
		waiting,
		courts,
		pairHistory,
		handleAddToQueue,
		handleRefreshCandidates,
		handleCandidatePlayerReplace,
		handleAssignCandidate,
		handleQueueCandidate,
	};
}

const EMPTY_SINGLE_WOMAN_IDS: string[] = [];
