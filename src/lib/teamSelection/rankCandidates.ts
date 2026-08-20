/**
 * rankCandidates.ts
 *
 * 원자 함수: 이미 확정된 N명이 있을 때, 풀에서 가장 어울리는 후보 순위를 반환한다.
 *
 * - confirmed가 0명이면 경기수(gameCount) 기준 정렬
 * - 순수 함수 (랜덤 없음)
 * - 풀 구성(성별 필터, 대기/경기중 혼합 등)은 호출자 책임
 */
import type { GroupHistory, PlayerSkills, SessionPlayer } from "../../types";

// ─────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────

export interface RankContext {
	/**
	 * 완료 경기별 4인 그룹 이력 — 재결성 회피 벌점의 원천.
	 * 회피 단위는 쌍(2명) 누적이 아니라 "과거 경기 4인과 새 팀의 겹침 수"다(2026-07 개편):
	 * 후보 합류로 과거 그룹과 2명(약)·3명(중)·4명(재결성, 강) 겹치는 만큼 단계적으로 벌점한다.
	 */
	groupHistory: GroupHistory;
	/**
	 * 현재 코트에서 경기중인 session_player.id — 대기 항(W_WAIT)을 끄는 데만 쓴다(2026-08).
	 *
	 * wait_since는 `complete_match`에서만 갱신되고 `assign_match`는 손대지 않는다. 그래서 경기중인
	 * 선수는 코트에 서 있는 내내 "기다린 시간"이 계속 쌓여, 대기 우선 보너스를 부당하게 받는다.
	 * 실측(프로덕션 23세션 편성시점 후보): 경기중 후보의 대기 중앙값 12.7분 vs 대기 후보 3.5분 —
	 * 격차 +9.3점이 경기중 페널티(W_PLAYING 30)를 그만큼 상쇄해, 진행 중 판이 gameCount에 아직
	 * 안 잡히는 −10과 합쳐 실효 페널티가 약 11(≈W_GROUP2)까지 내려간다. 게다가 경기가 길수록
	 * 더 싸지는(분당 1점) 변동값이다.
	 * 여기서 대기 항을 0으로 두면 실효 페널티가 20으로 **고정**된다 — DB 수정 없이 고칠 수 있어
	 * `assign_match`에서 wait_since를 리셋하는 마이그레이션은 불필요하다(그 값은 playing인 동안에만
	 * 읽히고 완료 시 덮어써지므로, 이 가드가 있으면 점수에 도달하지 못한다).
	 * 미지정이면 가드 없음(구 동작) — 순수 함수 단위 테스트 편의.
	 */
	playingIds?: ReadonlySet<string>;
}

/** 점수 항목별 기여도(가중치까지 곱한 실제 가산값). 디버그 표시용. 합 = score. */
export interface ScoreBreakdown {
	/** 스프레드 증가분(팀 등급 밴드를 넓히는 폭) × W_SKILL */
	skill: number;
	/** 그룹 재결성 벌점 합 — 과거 그룹과 2명 겹침×W_GROUP2 + 3명×W_GROUP3 + 4명×W_GROUP4 */
	group: number;
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
}

export interface RankedCandidate {
	player: SessionPlayer;
	score: number;
	/** 점수 기여 분해(디버그용). rankCandidates/recommendTeammates가 채운다. */
	breakdown?: ScoreBreakdown;
}

export interface Weights {
	/** 실력(스프레드 증가분) — 팀 등급 밴드를 넓히는 후보만 벌점, 2v2 균형은 pairPlayers가 맡는다. */
	W_SKILL: number;
	/**
	 * 실력 벌점의 지수 — `skillDiff = 확장폭 ** W_SKILL_EXP`. 미지정이면 1(선형).
	 * 확장폭이 클수록 초선형으로 무거워져 "많이 벌어진 팀"을 강하게 억제하는 튜닝 knob이다.
	 * (선형에서는 6등급 확장이 3등급 확장의 2배 벌점뿐이라 판수 2~3판 차이에 밀려 벌어진 시드가 그대로 생겼다.)
	 */
	W_SKILL_EXP?: number;
	/** 재결성 회피(약) — 후보 합류로 과거 그룹과 2명이 겹치는 경우(2명 유지+2명 교체) 그룹당 벌점. */
	W_GROUP2: number;
	/** 재결성 회피(중) — 과거 그룹과 3명이 겹치는 경우(3명 유지+1명 교체) 그룹당 벌점. */
	W_GROUP3: number;
	/** 재결성 회피(강) — 과거 그룹 4명이 그대로 다시 뭉치는 경우 그룹당 벌점. 사실상 금지 수준으로 크게. */
	W_GROUP4: number;
	/** 경기수 — 최우선. 적게 뛴 사람(절대 판수 gameCount)부터 선발. */
	W_GAME: number;
	W_MIXED: number;
	W_WAIT: number;
}

// ─────────────────────────────────────────────
// 가중치 프로필
// ─────────────────────────────────────────────

// 우선순위: 경기수(W_GAME) > 재결성 회피(W_GROUP2, 겹침이 클수록 W_GROUP3·4로 급증) > 실력(W_SKILL).
// - 재결성 회피(2026-07 개편): 쌍 단위 누적(Σc²·pair_history) 대신 "과거 경기 4인과의 겹침 수"로 벌점.
//   W_GROUP2=8은 "경기수 1판(10)을 못 뒤집는다" 불변식을 지키는 최대값(구 Σc²의 1회 동반 벌점과 등가),
//   3명 겹침(W_GROUP3=24)은 1판을 훌쩍 넘어서고, 4명 재결성(W_GROUP4=60)은 사실상 금지 수준
//   (경기중 ghost 페널티 W_PLAYING 30·혼복 성별 페널티 W_GENDER 50보다도 크게).
//   200시드 스윕 근거: (2,12,40)은 2인 겹침 회피가 구 Σc²의 1/4로 약해져 순후퇴(overlap3 3.9% vs 기준 1.3%),
//   (8,24,60)에서 overlap3 0.7%·overlap2 67%·고유 동반 16.2명으로 전 지표가 기준선을 넘어선다.
// - W_SKILL 1.5 · W_SKILL_EXP 2 (스프레드 증가분의 제곱, 2026-07-29): 밴드 안 후보는 전부 0이라 실력 항은
//   "밴드를 넓히는 후보"에만 작동한다. 확장폭 k에 대해 벌점 = 1.5·k² → k=2는 6(경기수 1판 10 미만, 경기수
//   우선), k=3은 13.5, k=4는 24, k=6은 54로 초선형 급증. 구 선형(3.0k)은 k=6이 18(1.8판)에 불과해
//   판수 2판 차이에 밀려 "많이 벌어진 팀"이 그대로 편성됐다 — 특히 남녀 등급 분포가 어긋난 로스터의
//   혼복(2남2녀 강제)에서 밴드가 벌어지고, 그 뒤로는 밴드 안 후보가 전부 0점이라 실력 심사가 꺼졌다.
//   (300시드·로스터 3종 스윕 근거: 혼복 스프레드 4.49→4.11 / 3.07→2.92 / 5.14→4.37, 전체 3.70→3.39,
//    판수 형평 비용 gcStd +0.00, 3인 겹침 0.4→0.8%, interDiff 1.33→1.15. 같은 스프레드를 선형 W6.0으로
//    달성하면 gcStd +0.02·interDiff 1.26으로 열위 — 제곱이 파레토 우월. 상세: docs/MATCH_LOG_ANALYSIS.md §4b)
//   W_GROUP4(60) > k=6 확장(54)은 유지 — "재결성될 바엔 벌어진 팀" 순서가 뒤집히지 않는다.
const DEFAULT_WEIGHTS: Weights = { W_SKILL: 1.5, W_SKILL_EXP: 2, W_GROUP2: 8.0, W_GROUP3: 24.0, W_GROUP4: 60.0, W_GAME: 10.0, W_MIXED: 0, W_WAIT: 0 };

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

/**
 * 대기 분(分) — 경기중인 후보는 0. (근거는 RankContext.playingIds 주석)
 * 코트에 서 있는 시간은 "기다린 시간"이 아니다.
 */
function waitMinutesOf(candidate: SessionPlayer, context: RankContext): number {
	if (context.playingIds?.has(candidate.id)) return 0;
	if (!candidate.waitSince) return 0;
	return (Date.now() - new Date(candidate.waitSince).getTime()) / 60000;
}

/** 대기 항 비용 — 오래 기다릴수록 낮은 점수(음수). 대기 0은 −0이 아닌 0으로 정규화(디버그 표시용). */
function waitCostOf(candidate: SessionPlayer, context: RankContext, weights: Weights): number {
	const waitMinutes = waitMinutesOf(candidate, context);
	return waitMinutes > 0 ? -waitMinutes * weights.W_WAIT : 0;
}

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
		const breakdown: ScoreBreakdown = {
			skill: 0,
			group: 0,
			game: gameCost,
			mixed: candidate.mixedCount * weights.W_MIXED,
			wait: waitCostOf(candidate, context, weights), // 오래 기다릴수록 점수 낮아져야 하므로 음수
		};
		return { score: breakdown.game + breakdown.mixed + breakdown.wait, breakdown };
	}

	// 실력 차이: 후보 합류 시 팀 등급 밴드(min~max)의 "스프레드 증가분"을 W_SKILL_EXP 제곱한 값.
	// 기존 밴드 안(min ≤ 후보 ≤ max) 후보는 전부 0으로 동일하고, 밴드를 넓히는 후보만 벌점 —
	// 제곱이라 조금 넓히는 건 여전히 경기수에 밀리고(k=2 → 6 < 1판 10), 크게 넓히는 건 강하게 배제된다.
	// confirmed 1명일 때는 |후보 − 확정| 로 평균 방식과 동일하게 동작한다.
	// (구) "confirmed 평균과의 거리"는 이미 벌어진 팀(예: {2,8} 평균 5)에서 중간 등급(5)을 항상
	// '최적합(0)'으로 판정해 중간 등급이 이질 팀의 필러로 흡수되는 비대칭이 있었다 — 스프레드
	// 증가분은 벌어진 팀을 중간 등급으로 가리는 대신, 팀이 처음부터 벌어지는 것 자체를 막는다.
	// (구) 혼복(남녀 혼합) 목표 시 "남자 skillDiff=0 · 여자끼리만 균형" 규칙은 제거됨 —
	// 혼복에서도 남녀 구분 없이 4명 전원의 실력을 맞춘다(2026-07 기획 변경).
	// 미등급(skillScore 0 = 판독 불가)은 "정보 없음"으로 취급: confirmed 쪽 미등급은 밴드 계산에서
	// 제외하고(0이 밴드 하한을 무너뜨려 하방 판별이 꺼지는 것 방지), 미등급 후보 본인도 벌점하지 않는다.
	const candidateGrade = skillScore(candidate);
	const grades = confirmed.map(skillScore).filter((g) => g > 0);
	const spreadGrowth =
		candidateGrade > 0 && grades.length > 0
			? Math.max(0, Math.min(...grades) - candidateGrade, candidateGrade - Math.max(...grades))
			: 0;
	const skillDiff = spreadGrowth > 0 ? spreadGrowth ** (weights.W_SKILL_EXP ?? 1) : 0;

	// 그룹 재결성 회피: 과거 완료 경기의 4인 그룹 G(후보가 속했던 것) 각각에 대해 k = |G ∩ confirmed|.
	// 후보 합류로 새 팀이 그 그룹과 2명(k=1)·3명(k=2)·4명(k=3) 겹치게 되는 만큼 단계적으로 벌점한다.
	// 쌍 단위 누적(Σc², pair_history)은 폐기(2026-07) — 목적은 "같은 4명이 다시 뭉치기 힘들게"이며,
	// 2명 유지+2명 교체(약)·3명 유지+1명 교체(중)·완전 재결성(강)을 모두 회피하되 강도를 차등한다.
	// 같은 조합이 여러 번 있었으면 그룹 수만큼 중복 가산된다(반복일수록 강한 회피).
	let regroup2 = 0;
	let regroup3 = 0;
	let regroup4 = 0;
	const confirmedIds = new Set(confirmed.map((p) => p.id));
	for (const g of context.groupHistory) {
		if (!g.members.includes(candidate.id)) continue;
		let k = 0;
		for (const id of g.members) if (id !== candidate.id && confirmedIds.has(id)) k++;
		if (k === 1) regroup2++;
		else if (k === 2) regroup3++;
		else if (k >= 3) regroup4++;
	}
	const groupCost =
		regroup2 * weights.W_GROUP2 + regroup3 * weights.W_GROUP3 + regroup4 * weights.W_GROUP4;

	// 대기 시간: 오래 기다릴수록 우선 (분 단위, 음수로 점수 감소). 경기중 후보는 0.
	const breakdown: ScoreBreakdown = {
		skill: skillDiff * weights.W_SKILL,
		group: groupCost,
		game: gameCost,
		mixed: candidate.mixedCount * weights.W_MIXED,
		wait: waitCostOf(candidate, context, weights),
	};
	return {
		score: breakdown.skill + breakdown.group + breakdown.game + breakdown.mixed + breakdown.wait,
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

