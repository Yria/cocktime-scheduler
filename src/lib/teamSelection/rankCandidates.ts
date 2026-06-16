/**
 * rankCandidates.ts
 *
 * 원자 함수: 이미 확정된 N명이 있을 때, 풀에서 가장 어울리는 후보 순위를 반환한다.
 *
 * - confirmed가 0명이면 경기수(gameCount) 기준 정렬
 * - 순수 함수 (랜덤 없음)
 * - 풀 구성(성별 필터, 대기/경기중 혼합 등)은 호출자 책임
 */
import type { PairHistory, PlayerSkills, SessionPlayer, SkillLevel } from "../../types";

// ─────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────

export interface RankContext {
	/** 같은 4명 그룹으로 함께 뛴 누적 횟수. 직전 1게임이 아니라 전체 누적이므로 자주 뛴 상대일수록 회피된다. */
	pairHistory: PairHistory;
	totalMatchCount: number;
	/** 세션 전체 활성 선수 목록 (deficit 기대 경기수 분모 계산용) */
	allSessionPlayers: SessionPlayer[];
}

/** 점수 항목별 기여도(가중치까지 곱한 실제 가산값). 디버그 표시용. 합 = score. */
export interface ScoreBreakdown {
	/** 실력 차이 × W_SKILL */
	skill: number;
	/** 동반 누적 횟수 × W_PAIR */
	pair: number;
	/** −deficit × W_GAME (참여율) */
	deficit: number;
	/** mixedCount × W_MIXED */
	mixed: number;
	/** −대기분 × W_WAIT */
	wait: number;
	/** 게임타입 로테이션 합(시드+후보) — recommendTeammates에서만 채움 */
	rotate?: number;
	/** 혼복 성별 초과 페널티 — recommendTeammates에서만 채움 */
	gender?: number;
	/** 경기중 페널티 — recommendTeammates에서만 채움 */
	playing?: number;
}

export interface RankedCandidate {
	player: SessionPlayer;
	score: number;
	/** 점수 기여 분해(디버그용). rankCandidates/recommendTeammates가 채운다. */
	breakdown?: ScoreBreakdown;
}

export interface Weights {
	W_SKILL: number;
	/** 동반 회피 — 같은 4명 그룹으로 함께 뛴 누적 횟수(pairHistory)에 대한 가중. 직전/과거를 통합한 단일 지표. */
	W_PAIR: number;
	W_GAME: number;
	W_MIXED: number;
	W_WAIT: number;
}

// ─────────────────────────────────────────────
// 가중치 프로필
// ─────────────────────────────────────────────

const DEFAULT_WEIGHTS: Weights = { W_SKILL: 4.0, W_PAIR: 6.0, W_GAME: 1.0, W_MIXED: 0, W_WAIT: 0 };

// ─────────────────────────────────────────────
// 스킬 점수 유틸
// ─────────────────────────────────────────────

export const SKILL_VALUES: Record<SkillLevel, number> = { O: 3, V: 2, X: 1 };

/** PlayerSkills 객체의 평균 점수 (1.0 ~ 3.0). skills가 없으면 0. */
export function skillScoreOf(skills?: PlayerSkills): number {
	if (!skills) return 0;
	const values = Object.values(skills) as SkillLevel[];
	return values.reduce((sum, s) => sum + SKILL_VALUES[s], 0) / values.length;
}

/** 선수의 전체 스킬 평균 점수 (1.0 ~ 3.0) */
export function skillScore(player: SessionPlayer): number {
	return skillScoreOf(player.skills);
}

// ─────────────────────────────────────────────
// deficit 계산
// ─────────────────────────────────────────────

/**
 * 기대 경기수 대비 적자(deficit)를 계산한다.
 * deficit > 0: 기대보다 적게 뜀 (우선 선발 대상)
 * deficit = 0: 적정
 * deficit < 0: 기대보다 많이 뜀 (후순위)
 */
function computeDeficit(
	candidate: SessionPlayer,
	totalMatchCount: number,
	allPlayers: SessionPlayer[],
): number {
	const eligibleRounds = totalMatchCount - candidate.joinedAtMatch;
	const totalEligible = allPlayers.reduce(
		(sum, p) => sum + (totalMatchCount - p.joinedAtMatch), 0
	);
	if (totalEligible === 0 || totalMatchCount === 0) return 0;
	const playProbability = (totalMatchCount * 4) / totalEligible;
	const expectedGames = eligibleRounds * playProbability;
	return expectedGames - candidate.gameCount;
}

// ─────────────────────────────────────────────
// 점수 계산
// ─────────────────────────────────────────────

function computeScore(
	candidate: SessionPlayer,
	confirmed: SessionPlayer[],
	context: RankContext,
	weights: Weights = DEFAULT_WEIGHTS,
): { score: number; breakdown: ScoreBreakdown } {
	// confirmed가 0명이면 deficit + 대기시간만 반영
	if (confirmed.length === 0) {
		const waitMinutes = candidate.waitSince
			? (Date.now() - new Date(candidate.waitSince).getTime()) / 60000
			: 0;
		const deficit = computeDeficit(candidate, context.totalMatchCount, context.allSessionPlayers);
		const breakdown: ScoreBreakdown = {
			skill: 0,
			pair: 0,
			deficit: -deficit * weights.W_GAME,
			mixed: candidate.mixedCount * weights.W_MIXED,
			wait: -waitMinutes * weights.W_WAIT, // 오래 기다릴수록 점수 낮아져야 하므로 음수
		};
		return { score: breakdown.deficit + breakdown.mixed + breakdown.wait, breakdown };
	}

	// 실력 차이: confirmed 평균 skillScore와의 차이
	const confirmedAvgSkill =
		confirmed.reduce((sum, p) => sum + skillScore(p), 0) / confirmed.length;
	const skillDiff = Math.abs(skillScore(candidate) - confirmedAvgSkill);

	// 동반 회피: 같은 4명 그룹으로 함께 뛴 누적 횟수(confirmed 각각과의 합산).
	// 직전 1게임을 따로 보지 않고 누적만으로 판단 — 자주 함께 뛴 상대일수록 회피된다.
	const pairOverlap = confirmed.reduce((count, p) => {
		return count + (context.pairHistory[p.id]?.[candidate.id] ?? 0);
	}, 0);

	// 대기 시간: 오래 기다릴수록 우선 (분 단위, 음수로 점수 감소)
	const waitMinutes = candidate.waitSince
		? (Date.now() - new Date(candidate.waitSince).getTime()) / 60000
		: 0;

	const deficit = computeDeficit(candidate, context.totalMatchCount, context.allSessionPlayers);
	const breakdown: ScoreBreakdown = {
		skill: skillDiff * weights.W_SKILL,
		pair: pairOverlap * weights.W_PAIR,
		deficit: -deficit * weights.W_GAME,
		mixed: candidate.mixedCount * weights.W_MIXED,
		wait: -waitMinutes * weights.W_WAIT,
	};
	return {
		score: breakdown.skill + breakdown.pair + breakdown.deficit + breakdown.mixed + breakdown.wait,
		breakdown,
	};
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
		.map((player) => {
			const { score, breakdown } = computeScore(player, confirmed, context, weights);
			return { player, score, breakdown };
		})
		.sort((a, b) => a.score - b.score);
}

