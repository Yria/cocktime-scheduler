/**
 * rankCandidates.ts
 *
 * 원자 함수: 이미 확정된 N명이 있을 때, 풀에서 가장 어울리는 후보 순위를 반환한다.
 *
 * - confirmed가 0명이면 경기수(gameCount) 기준 정렬
 * - 순수 함수 (랜덤 없음)
 * - 풀 구성(성별 필터, 대기/경기중 혼합 등)은 호출자 책임
 */
import type { PairHistory, PlayerSkills, SessionPlayer } from "../../types";

// ─────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────

export interface RankContext {
	/** 같은 4명 그룹으로 함께 뛴 누적 횟수. 직전 1게임이 아니라 전체 누적이므로 자주 뛴 상대일수록 회피된다. */
	pairHistory: PairHistory;
}

/** 점수 항목별 기여도(가중치까지 곱한 실제 가산값). 디버그 표시용. 합 = score. */
export interface ScoreBreakdown {
	/** 실력 차이 × W_SKILL */
	skill: number;
	/** 동반 누적 횟수 × W_PAIR */
	pair: number;
	/** gameCount × W_GAME (적게 뛴 사람 우선 — 절대 판수). 늦참/휴식 복귀자는 합류 시점 평균 판수로 보정됨. */
	game: number;
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
	/** 의도적 그룹 재편성 회피 페널티(decay) — recommendTeammates에서만 채움 */
	forced?: number;
}

export interface RankedCandidate {
	player: SessionPlayer;
	score: number;
	/** 점수 기여 분해(디버그용). rankCandidates/recommendTeammates가 채운다. */
	breakdown?: ScoreBreakdown;
}

export interface Weights {
	/** 실력 유사 — 후순위. 4명 안의 2v2 실력 균형은 pairPlayers가 따로 잡으므로 선발 단계에선 약하게 본다. */
	W_SKILL: number;
	/** 중복 회피 — 같은 4명 그룹으로 함께 뛴 누적 횟수(pairHistory)에 대한 가중. 직전/과거를 통합한 단일 지표. */
	W_PAIR: number;
	/** 경기수 — 최우선. 적게 뛴 사람(절대 판수 gameCount)부터 선발. */
	W_GAME: number;
	W_MIXED: number;
	W_WAIT: number;
}

// ─────────────────────────────────────────────
// 가중치 프로필
// ─────────────────────────────────────────────

// 우선순위: 경기수(W_GAME) > 중복 회피(W_PAIR) > 실력(W_SKILL).
// 4명 선발 단계에선 적게 뛴 사람 우선(경기수)과 같은 4명 반복 회피(중복)가 우선이고,
// 실력 균형은 2v2 페어 편성(pairPlayers)이 따로 잡으므로 가장 약하게만 본다.
// W_SKILL 0.67: skillScore 범위가 등급(1~10, 폭 9)으로 바뀌며 실력차가 구 모델(1~3, 폭 2) 대비
// 4.5배 커졌으므로, 선발 단계 실력 기여를 종전 수준으로 유지하려 3.0/4.5 ≈ 0.67로 보정.
const DEFAULT_WEIGHTS: Weights = { W_SKILL: 0.67, W_PAIR: 8.0, W_GAME: 10.0, W_MIXED: 0, W_WAIT: 0 };

// ─────────────────────────────────────────────
// 스킬 점수 유틸
// ─────────────────────────────────────────────

// 구 6종 스킬(O/V/X · 상/중/하) → 점수 매핑. 마이그레이션 전 데이터나 과거 매치 스냅샷 하위호환용.
const LEGACY_SKILL_VALUES: Record<string, number> = {
	O: 3, V: 2, X: 1, 상: 3, 중: 2, 하: 1,
};

/**
 * skills → 실력 등급(1~10). 신 모델 `{ grade }`는 그대로, 구 6종 형태는 선형 환산.
 * skills가 없거나 판독 불가면 0.
 */
export function skillScoreOf(skills?: PlayerSkills | Record<string, unknown> | null): number {
	if (!skills) return 0;
	const grade = (skills as PlayerSkills).grade;
	if (typeof grade === "number") return grade;
	// 구 6종 하위호환: present 값 평균(1~3) → 등급(1~10) 선형 환산.
	const vals = Object.values(skills)
		.filter((v): v is string => typeof v === "string" && v.toUpperCase() in LEGACY_SKILL_VALUES)
		.map((v) => LEGACY_SKILL_VALUES[v.toUpperCase()]);
	if (vals.length === 0) return 0;
	const avg = vals.reduce((sum, s) => sum + s, 0) / vals.length; // 1..3
	return Math.round(1 + ((avg - 1) / 2) * 9); // 1..10
}

/** 선수의 실력 등급 (1 ~ 10) */
export function skillScore(player: SessionPlayer): number {
	return skillScoreOf(player.skills);
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
	// 적게 뛴 사람 우선 — 절대 판수(gameCount) 기준 비용. 클수록 후순위(양수 가산).
	// 늦참/휴식 복귀자는 합류(콕확인)·복귀 시점에 그때의 활성 평균 판수로 보정되어(set_cock_checked /
	// set_player_resting RPC) 0판으로 과대 우선되지 않는다.
	const gameCost = candidate.gameCount * weights.W_GAME;

	// confirmed가 0명이면 판수 + 대기시간만 반영
	if (confirmed.length === 0) {
		const waitMinutes = candidate.waitSince
			? (Date.now() - new Date(candidate.waitSince).getTime()) / 60000
			: 0;
		const breakdown: ScoreBreakdown = {
			skill: 0,
			pair: 0,
			game: gameCost,
			mixed: candidate.mixedCount * weights.W_MIXED,
			wait: -waitMinutes * weights.W_WAIT, // 오래 기다릴수록 점수 낮아져야 하므로 음수
		};
		return { score: breakdown.game + breakdown.mixed + breakdown.wait, breakdown };
	}

	// 실력 차이: confirmed 평균 skillScore와의 차이.
	// 혼복(남녀 혼합) 목표 그룹은 "여자만" 실력 균형을 본다 — 혼복은 남녀 실력을 동시에 맞추기 어려우니
	// 남자는 실력 무시하고 넣어도 되고, 여자만 서로 실력을 맞춘다(기획 요구). 즉 그룹이 양성이면:
	//   · 남자 후보 → skillDiff 0 (실력 균형 대상 아님)
	//   · 여자 후보 → 확정된 여자들 평균과의 차이 (여자끼리 균형, 확정 여자 없으면 0)
	// 단일 성별(남복/여복) 그룹은 기존대로 전체 평균과의 차이.
	const hasFemale = candidate.gender === "F" || confirmed.some((p) => p.gender === "F");
	const hasMale = candidate.gender === "M" || confirmed.some((p) => p.gender === "M");
	const mixedTarget = hasFemale && hasMale;
	let skillDiff: number;
	if (mixedTarget && candidate.gender === "M") {
		skillDiff = 0;
	} else if (mixedTarget) {
		const womenConfirmed = confirmed.filter((p) => p.gender === "F");
		skillDiff = womenConfirmed.length
			? Math.abs(
					skillScore(candidate) -
						womenConfirmed.reduce((sum, p) => sum + skillScore(p), 0) / womenConfirmed.length,
				)
			: 0;
	} else {
		const confirmedAvgSkill =
			confirmed.reduce((sum, p) => sum + skillScore(p), 0) / confirmed.length;
		skillDiff = Math.abs(skillScore(candidate) - confirmedAvgSkill);
	}

	// 동반 회피: 같은 4명 그룹으로 함께 뛴 누적 횟수(confirmed 각각과의 합산).
	// 직전 1게임을 따로 보지 않고 누적만으로 판단 — 자주 함께 뛴 상대일수록 회피된다.
	const pairOverlap = confirmed.reduce((count, p) => {
		return count + (context.pairHistory[p.id]?.[candidate.id] ?? 0);
	}, 0);

	// 대기 시간: 오래 기다릴수록 우선 (분 단위, 음수로 점수 감소)
	const waitMinutes = candidate.waitSince
		? (Date.now() - new Date(candidate.waitSince).getTime()) / 60000
		: 0;

	const breakdown: ScoreBreakdown = {
		skill: skillDiff * weights.W_SKILL,
		pair: pairOverlap * weights.W_PAIR,
		game: gameCost,
		mixed: candidate.mixedCount * weights.W_MIXED,
		wait: -waitMinutes * weights.W_WAIT,
	};
	return {
		score: breakdown.skill + breakdown.pair + breakdown.game + breakdown.mixed + breakdown.wait,
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

