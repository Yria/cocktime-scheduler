import { disassemble, getChoseong } from "es-hangul";
import type { Court, Gender, PairHistory, SessionPlayer } from "../types";
import { skillScore } from "./teamGenerator";

/**
 * 현재 경기중인 선수 ID 목록을 반환합니다.
 * courts.match.teamA/B는 ID 참조이므로 직접 반환합니다.
 */
export function getPlayingPlayerIds(courts: Court[]): string[] {
	return courts.flatMap((c) =>
		c.match ? [...c.match.teamA, ...c.match.teamB] : [],
	);
}

/**
 * 현재 경기중인 선수 목록을 반환합니다.
 * sessionPlayers Map과 함께 사용합니다.
 */
export function getPlayingPlayers(courts: Court[], sessionPlayers: Map<string, SessionPlayer>): SessionPlayer[] {
	return getPlayingPlayerIds(courts)
		.map((id) => sessionPlayers.get(id))
		.filter((p): p is SessionPlayer => p !== undefined);
}

/**
 * 배정 불가 선수 ID 집합을 반환합니다.
 * 경기중 선수와 대기열 선수를 합산합니다.
 */
export function getUnavailableIds(
	playingPlayers: SessionPlayer[],
	queuedPlayers: SessionPlayer[],
): Set<string> {
	return new Set([...playingPlayers, ...queuedPlayers].map((p) => p.id));
}

export interface RankedPlayer {
	player: SessionPlayer;
	fitness: number;
	isPlaying: boolean;
	balanceDiff: number;
}

/**
 * 교체 후보 선수 목록을 밸런스/페어히스토리/경기수 기준으로 랭킹합니다.
 * 낮은 fitness 값이 더 좋은 후보입니다.
 */
export function rankReplaceCandidates(
	availablePlayers: SessionPlayer[],
	selectedPlayer: SessionPlayer,
	currentTeam: SessionPlayer[],
	opponentTeam: SessionPlayer[],
	pairHistory: PairHistory,
	unavailableIds: Set<string>,
): RankedPlayer[] {
	const partner = currentTeam.find((p) => p.id !== selectedPlayer.id);
	const partnerScore = partner ? skillScore(partner) : skillScore(selectedPlayer);
	const opponentTotal = opponentTeam.reduce((sum, p) => sum + skillScore(p), 0);

	return availablePlayers
		.map((player) => {
			const score = skillScore(player);
			const isPlaying = unavailableIds.has(player.id);

			const teamTotal = partnerScore + score;
			const balanceDiff = Math.abs(teamTotal - opponentTotal);

			const partnerPairCount = partner && pairHistory[partner.id]?.has(player.id) ? 1 : 0;
			const opponentPairCount = opponentTeam.reduce(
				(n, op) => n + (pairHistory[op.id]?.has(player.id) ? 1 : 0),
				0,
			);

			const fitness =
				balanceDiff * 10 +
				partnerPairCount * 5 +
				opponentPairCount * 2 +
				player.gameCount * 1 +
				(isPlaying ? 3 : 0);

			return { player, fitness, isPlaying, balanceDiff };
		})
		.sort((a, b) => a.fitness - b.fitness);
}

/**
 * 랭킹된 선수 목록을 이름 검색 및 성별 필터로 필터링합니다.
 */
export function filterReplaceCandidates(
	ranked: RankedPlayer[],
	query: string,
	genderFilter: Gender | null,
): RankedPlayer[] {
	const q = query.trim().toLowerCase();
	return ranked.filter(({ player }) => {
		if (q) {
			const name = player.name.toLowerCase();
			if (!name.includes(q)) {
				// 초성 검색: 입력이 모두 자음이면 초성 매칭
				const decomposed = disassemble(q);
				const isAllChoseong = /^[ㄱ-ㅎ]+$/.test(decomposed);
				if (!isAllChoseong || !getChoseong(name).includes(decomposed)) {
					return false;
				}
			}
		}
		if (genderFilter && player.gender !== genderFilter) return false;
		return true;
	});
}

export type ReplaceSortBy = "fitness" | "waitTime" | "gameCount";

/**
 * 필터링된 선수 목록을 정렬합니다.
 * rank → filter → sort 파이프라인의 마지막 단계.
 */
export function sortReplaceCandidates(
	filtered: RankedPlayer[],
	sortBy: ReplaceSortBy,
): RankedPlayer[] {
	if (sortBy === "fitness") return filtered; // rankReplaceCandidates에서 이미 fitness 순 정렬
	return [...filtered].sort((a, b) => {
		if (sortBy === "gameCount") {
			return a.player.gameCount - b.player.gameCount;
		}
		// waitTime: waitSince가 빠를수록(오래 기다릴수록) 우선
		const aWait = a.player.waitSince ? new Date(a.player.waitSince).getTime() : Date.now();
		const bWait = b.player.waitSince ? new Date(b.player.waitSince).getTime() : Date.now();
		return aWait - bWait;
	});
}
