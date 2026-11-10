// ELO 점수 계산 — **서버(마이그레이션 20261109000000_match_results_elo.sql)가 권위**이고 여기는 미러다.
// 실제 반영은 전부 RPC 안에서 일어난다. 클라가 이 값을 쓰는 곳은 "예상 승률"·"예상 변동" 같은
// 미리보기뿐이므로, 서버와 어긋나면 화면이 거짓말을 한다 → elo.test.ts 가 SQL 텍스트에서 상수를 뽑아
// 이 표와 같은지 확인한다. 상수를 바꾸면 SQL 과 같은 커밋에서 바꿀 것.
// 규칙 원문: docs/MATCH_RESULT_ELO_SPEC.md §1

export const ELO = {
	/** seed = BASE + PER_GRADE × grade (grade 1~10) */
	BASE: 1000,
	PER_GRADE: 100,
	/** grade 가 없거나 0 이면 이 점수로 시작(중간값 — 모르는 사람을 바닥에서 시작시키지 않는다) */
	DEFAULT: 1500,
	/** 팀 전력 가중치. 복식은 약한 쪽이 집중 공략당하므로 약한 쪽에 더 무게를 둔다. */
	WEAK_W: 0.6,
	STRONG_W: 0.4,
	/** 기대 승률 로지스틱 스케일 */
	SCALE: 400,
	/** 반영 경기 수 < PLACEMENT_K_GAMES 이면 K_PLACEMENT(배치 — 빨리 제자리를 찾게) */
	K_PLACEMENT: 40,
	K_NORMAL: 20,
	PLACEMENT_K_GAMES: 10,
	/** 반영 경기 수 < PLACEMENT_SHOW_GAMES 이면 화면에 '배치 중' 으로 표시 */
	PLACEMENT_SHOW_GAMES: 5,
} as const;

/**
 * 시작 점수. SQL elo_seed 와 같이 grade 가 1~10 일 때만 공식을 쓰고, 없음/0/범위 밖/숫자 아님 → DEFAULT.
 * SQL 인자가 integer 라 소수 grade 는 반올림돼 들어간다 — 여기서도 반올림.
 */
export function seedRating(grade: number | null | undefined): number {
	if (grade == null || !Number.isFinite(grade)) return ELO.DEFAULT;
	const g = Math.round(grade);
	if (g < 1 || g > 10) return ELO.DEFAULT;
	return ELO.BASE + ELO.PER_GRADE * g;
}

/** 팀 전력 R_team = 0.6 × min + 0.4 × max. 순서 무관. */
export function teamStrength(r1: number, r2: number): number {
	return ELO.WEAK_W * Math.min(r1, r2) + ELO.STRONG_W * Math.max(r1, r2);
}

/** A 가 B 를 이길 기대 확률(0~1). */
export function expectedWin(rA: number, rB: number): number {
	return 1 / (1 + 10 ** ((rB - rA) / ELO.SCALE));
}

/** 개인 K. games = 지금까지 **반영된** 경기 수(이번 경기 제외). */
export function kFactor(games: number): number {
	return games < ELO.PLACEMENT_K_GAMES ? ELO.K_PLACEMENT : ELO.K_NORMAL;
}

/**
 * 점수 변동 Δ = round(K × (S − E)).
 * 반올림은 SQL numeric round() 와 같은 **0에서 먼 쪽(half away from zero)** 으로 맞춘다 —
 * JS Math.round 는 -2.5 → -2 라서 패배 쪽 정확히 .5 경계에서 서버와 1점 어긋난다.
 */
export function ratingDelta(k: number, won: boolean, expected: number): number {
	const raw = k * ((won ? 1 : 0) - expected);
	return Math.sign(raw) * Math.round(Math.abs(raw));
}

/**
 * 두 팀 점수로 A팀 기대 승률 — 승패 입력 화면의 '예상 승률' 미리보기용.
 * 4명이 다 안 채워진 경기는 서버도 미반영이므로 호출부가 애초에 부르지 않는다.
 */
export function matchExpectedA(
	teamA: readonly [number, number],
	teamB: readonly [number, number],
): number {
	return expectedWin(
		teamStrength(teamA[0], teamA[1]),
		teamStrength(teamB[0], teamB[1]),
	);
}
