/**
 * rankCandidates.ts
 *
 * 원자 함수: 이미 확정된 N명이 있을 때, 풀에서 가장 어울리는 후보 순위를 반환한다.
 *
 * - confirmed가 0명이면 경기수(gameCount) 기준 정렬
 * - 순수 함수 (랜덤 없음)
 * - 풀 구성(성별 필터, 대기/경기중 혼합 등)은 호출자 책임
 */
import type { GeneratedTeam, PairHistory, SessionPlayer, SkillLevel } from "../../types";

// ─────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────

export interface RankContext {
	pairHistory: PairHistory;
	lastCoPlayers: Record<string, string[]>;
}

export interface RankedCandidate {
	player: SessionPlayer;
	score: number;
}

export interface Weights {
	W_SKILL: number;
	W_PAIR: number;
	W_COPLYR: number;
	W_GAME: number;
	W_MIXED: number;
	W_WAIT: number;
}

// ─────────────────────────────────────────────
// 가중치 프로필
// ─────────────────────────────────────────────

const DEFAULT_WEIGHTS: Weights = { W_SKILL: 4.0, W_PAIR: 3.0, W_COPLYR: 6.0, W_GAME: 1.0, W_MIXED: 0, W_WAIT: 0 };

export const WEIGHT_PROFILES: Record<string, { weights: Weights; label: string; icon: string }> = {
	gameCountBalanced: { weights: { W_SKILL: 4.0, W_PAIR: 3.0, W_COPLYR: 6.0, W_GAME: 15.0, W_MIXED: 0, W_WAIT: 0 }, label: "게임수 균등", icon: "hash" },
	newCombination:    { weights: { W_SKILL: 2.0, W_PAIR: 15.0, W_COPLYR: 3.0, W_GAME: 1.0, W_MIXED: 0, W_WAIT: 0 }, label: "새 조합 우선", icon: "sparkles" },
	coPlayerAvoidance: { weights: { W_SKILL: 2.0, W_PAIR: 3.0, W_COPLYR: 15.0, W_GAME: 1.0, W_MIXED: 0, W_WAIT: 0 }, label: "직전 동반 회피", icon: "shuffle" },
	skillBalanced:     { weights: { W_SKILL: 15.0, W_PAIR: 3.0, W_COPLYR: 3.0, W_GAME: 1.0, W_MIXED: 0, W_WAIT: 0 }, label: "실력 균형", icon: "scale" },
	mixedCountBalanced:{ weights: { W_SKILL: 2.0, W_PAIR: 3.0, W_COPLYR: 3.0, W_GAME: 1.0, W_MIXED: 15.0, W_WAIT: 0 }, label: "혼복 참여 균등", icon: "users" },
	waitTimePriority:  { weights: { W_SKILL: 2.0, W_PAIR: 3.0, W_COPLYR: 3.0, W_GAME: 1.0, W_MIXED: 0, W_WAIT: 15.0 }, label: "대기 시간 우선", icon: "clock" },
};

// ─────────────────────────────────────────────
// 스킬 점수 유틸
// ─────────────────────────────────────────────

const SKILL_VALUES: Record<SkillLevel, number> = { O: 3, V: 2, X: 1 };

/** 선수의 전체 스킬 평균 점수 (1.0 ~ 3.0) */
export function skillScore(player: SessionPlayer): number {
	const values = Object.values(player.skills) as SkillLevel[];
	return values.reduce((sum, s) => sum + SKILL_VALUES[s], 0) / values.length;
}

// ─────────────────────────────────────────────
// 점수 계산
// ─────────────────────────────────────────────

function computeScore(
	candidate: SessionPlayer,
	confirmed: SessionPlayer[],
	context: RankContext,
	weights: Weights = DEFAULT_WEIGHTS,
): number {
	// confirmed가 0명이면 경기수 + 대기시간만 반영
	if (confirmed.length === 0) {
		const waitMinutes = candidate.waitSince
			? (Date.now() - new Date(candidate.waitSince).getTime()) / 60000
			: 0;
		return (
			candidate.gameCount * weights.W_GAME +
			candidate.mixedCount * weights.W_MIXED +
			-waitMinutes * weights.W_WAIT // 오래 기다릴수록 점수 낮아져야 하므로 음수
		);
	}

	// 실력 차이: confirmed 평균 skillScore와의 차이
	const confirmedAvgSkill =
		confirmed.reduce((sum, p) => sum + skillScore(p), 0) / confirmed.length;
	const skillDiff = Math.abs(skillScore(candidate) - confirmedAvgSkill);

	// 파트너 이력 겹침: pairHistory에서 confirmed와 겹치는 수
	const pairOverlap = confirmed.reduce((count, p) => {
		return count + (context.pairHistory[p.id]?.has(candidate.id) ? 1 : 0);
	}, 0);

	// 직전 동반자 겹침: lastCoPlayers에서 confirmed와 겹치는 수
	const coPlayerOverlap = confirmed.reduce((count, p) => {
		const coPlayers = context.lastCoPlayers[p.id];
		return count + (coPlayers?.includes(candidate.id) ? 1 : 0);
	}, 0);

	// 대기 시간: 오래 기다릴수록 우선 (분 단위, 음수로 점수 감소)
	const waitMinutes = candidate.waitSince
		? (Date.now() - new Date(candidate.waitSince).getTime()) / 60000
		: 0;

	return (
		skillDiff * weights.W_SKILL +
		pairOverlap * weights.W_PAIR +
		coPlayerOverlap * weights.W_COPLYR +
		candidate.gameCount * weights.W_GAME +
		candidate.mixedCount * weights.W_MIXED +
		-waitMinutes * weights.W_WAIT
	);
}

// ─────────────────────────────────────────────
// 원자 함수
// ─────────────────────────────────────────────

/**
 * 이미 확정된 N명(confirmed)이 있을 때,
 * 풀(pool)에서 가장 어울리는 후보를 점수 오름차순으로 반환한다.
 *
 * @param confirmed 같은 경기에 확정된 0~3명 (pool에 포함되지 않아야 함)
 * @param pool 후보 풀 (외부에서 주입, 필터링 완료 상태)
 * @param context 히스토리 정보
 * @returns 점수 오름차순 정렬된 후보 목록 (낮을수록 좋음)
 */
export function rankCandidates(
	confirmed: SessionPlayer[],
	pool: SessionPlayer[],
	context: RankContext,
	weights?: Weights,
): RankedCandidate[] {
	return pool
		.map((player) => ({
			player,
			score: computeScore(player, confirmed, context, weights),
		}))
		.sort((a, b) => a.score - b.score);
}

// ─────────────────────────────────────────────
// 히스토리 업데이트 유틸
// ─────────────────────────────────────────────

/**
 * 코트 배정 시 PairHistory를 업데이트한다 (클라이언트 상태용).
 * teamA/teamB 각 페어 내 두 선수를 서로 파트너로 기록한다.
 */
export function recordHistory(
	history: PairHistory,
	team: GeneratedTeam,
): PairHistory {
	const next: PairHistory = {};
	for (const key of Object.keys(history)) {
		next[key] = new Set(history[key]);
	}
	for (const [aId, bId] of [team.teamA, team.teamB] as [string, string][]) {
		if (!next[aId]) next[aId] = new Set();
		if (!next[bId]) next[bId] = new Set();
		next[aId].add(bId);
		next[bId].add(aId);
	}
	return next;
}

/**
 * 직전 게임 동반자 기록을 갱신한다.
 * 4명 각각에 대해 나머지 3명을 기록한다.
 */
export function updateLastCoPlayers(
	lastCoPlayers: Record<string, string[]>,
	team: GeneratedTeam,
): Record<string, string[]> {
	const allIds = [...team.teamA, ...team.teamB];
	const next = { ...lastCoPlayers };
	for (const id of allIds) {
		next[id] = allIds.filter((otherId) => otherId !== id);
	}
	return next;
}
