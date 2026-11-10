import { ELO } from "./elo";

// 점수 → 등급(표시 전용). 등급은 뱃지 테두리 **모양**으로만 드러난다(TierFrame).
// 경계는 docs/MATCH_RESULT_ELO_SPEC.md §1 '등급(표시)' 표. 서버는 등급을 모른다 — 점수만 준다.

export type TierKey =
	| "bronze"
	| "silver"
	| "gold"
	| "platinum"
	| "diamond"
	| "master";

export interface TierDef {
	key: TierKey;
	/** 이 등급의 하한(포함). */
	min: number;
	/** 한글 표시명 */
	label: string;
}

/** 낮은 등급부터. bronze 하한 0 은 '바닥 없음'의 표기다(진행률 계산은 BRONZE_FLOOR 를 쓴다). */
export const TIERS: readonly TierDef[] = [
	{ key: "bronze", min: 0, label: "브론즈" },
	{ key: "silver", min: 1300, label: "실버" },
	{ key: "gold", min: 1500, label: "골드" },
	{ key: "platinum", min: 1700, label: "플래티넘" },
	{ key: "diamond", min: 1900, label: "다이아" },
	{ key: "master", min: 2100, label: "마스터" },
] as const;

/**
 * 브론즈 진행률의 바닥. 최저 seed(grade 1 = 1100)를 바닥으로 두면 다른 등급과 같은 200점 폭이 된다.
 * 그보다 낮은 점수는 0 으로 붙인다.
 */
const BRONZE_FLOOR = ELO.BASE + ELO.PER_GRADE;

export function tierOf(rating: number): TierKey {
	let key: TierKey = "bronze";
	for (const t of TIERS) if (rating >= t.min) key = t.key;
	return key;
}

export function tierLabel(key: TierKey): string {
	return TIERS.find((t) => t.key === key)?.label ?? key;
}

/** 반영 경기 < 5 → 배치 중(테두리 흐리게 + '배치 n/5'). */
export function isPlacement(games: number): boolean {
	return games < ELO.PLACEMENT_SHOW_GAMES;
}

/** 다음 등급까지 진행률 0~1. 마스터는 다음이 없으므로 1. */
export function tierProgress(rating: number): number {
	const idx = TIERS.findIndex((t) => t.key === tierOf(rating));
	const next = TIERS[idx + 1];
	if (!next) return 1;
	const lo = idx === 0 ? BRONZE_FLOOR : TIERS[idx].min;
	const p = (rating - lo) / (next.min - lo);
	return Math.min(1, Math.max(0, p));
}

/** 다음 등급(마스터면 null) — '골드까지 42점' 같은 문구용. */
export function nextTier(rating: number): TierDef | null {
	const idx = TIERS.findIndex((t) => t.key === tierOf(rating));
	return TIERS[idx + 1] ?? null;
}
