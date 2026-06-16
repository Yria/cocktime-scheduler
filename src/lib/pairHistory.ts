/**
 * pairHistory.ts
 *
 * 동반 이력(PairHistory) 변경 유틸. 대칭 미러(a↔b 양방향) 불변식을 한곳에서 관리한다.
 * - DB 행 적재(transformers.buildPairHistory)와 경기 완료 누적(recordTeam)이 공유.
 */
import type { GeneratedTeam, PairHistory } from "../types";

/** a-b 동반 카운트를 양방향(대칭)으로 누적한다. history를 in-place 변경. */
export function addPair(
	history: PairHistory,
	a: string,
	b: string,
	count = 1,
): void {
	(history[a] ??= {})[b] = (history[a][b] ?? 0) + count;
	(history[b] ??= {})[a] = (history[b][a] ?? 0) + count;
}

/**
 * 경기 완료 시 PairHistory를 업데이트한다 (클라이언트 상태용).
 * 같은 경기 4명(teamA+teamB) 그룹 전체의 모든 쌍(6쌍)을 서로 동반 +1 누적한다.
 * (같은 팀뿐 아니라 상대팀으로 만난 경우도 동반으로 카운트)
 */
export function recordTeam(
	history: PairHistory,
	team: GeneratedTeam,
): PairHistory {
	const next: PairHistory = {};
	for (const key of Object.keys(history)) {
		next[key] = { ...history[key] };
	}
	const all = [...team.teamA, ...team.teamB];
	for (let i = 0; i < all.length; i++) {
		for (let j = i + 1; j < all.length; j++) {
			addPair(next, all[i], all[j]);
		}
	}
	return next;
}
