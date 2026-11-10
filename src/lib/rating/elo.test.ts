import { describe, expect, it } from "vitest";
import {
	ELO,
	expectedWin,
	kFactor,
	matchExpectedA,
	ratingDelta,
	seedRating,
	teamStrength,
} from "./elo";

describe("seedRating", () => {
	it("grade 기반 시작 점수", () => {
		expect(seedRating(1)).toBe(1100);
		expect(seedRating(5)).toBe(1500);
		expect(seedRating(10)).toBe(2000);
	});
	it("grade 없음/0 → 1500", () => {
		expect(seedRating(null)).toBe(1500);
		expect(seedRating(undefined)).toBe(1500);
		expect(seedRating(0)).toBe(1500);
		expect(seedRating(Number.NaN)).toBe(1500);
	});
	it("범위 밖(1~10 아님) → 1500 (SQL elo_seed 와 같음)", () => {
		expect(seedRating(11)).toBe(1500);
		expect(seedRating(-3)).toBe(1500);
	});
});

describe("teamStrength", () => {
	it("약한 쪽 0.6 · 강한 쪽 0.4, 순서 무관", () => {
		expect(teamStrength(1400, 1600)).toBeCloseTo(1480);
		expect(teamStrength(1600, 1400)).toBeCloseTo(1480);
		expect(teamStrength(1500, 1500)).toBeCloseTo(1500);
	});
});

describe("expectedWin", () => {
	it("동점 0.5, 400점 차 = 10:1", () => {
		expect(expectedWin(1500, 1500)).toBeCloseTo(0.5);
		expect(expectedWin(1900, 1500)).toBeCloseTo(10 / 11);
		expect(expectedWin(1500, 1900)).toBeCloseTo(1 / 11);
	});
	it("양쪽 합은 1", () => {
		expect(expectedWin(1234, 1567) + expectedWin(1567, 1234)).toBeCloseTo(1);
	});
});

describe("kFactor", () => {
	it("반영 10경기 미만은 배치 K", () => {
		expect(kFactor(0)).toBe(40);
		expect(kFactor(9)).toBe(40);
		expect(kFactor(10)).toBe(20);
		expect(kFactor(200)).toBe(20);
	});
});

describe("ratingDelta", () => {
	it("동점 경기 승 +K/2, 패 −K/2", () => {
		expect(ratingDelta(40, true, 0.5)).toBe(20);
		expect(ratingDelta(40, false, 0.5)).toBe(-20);
		expect(ratingDelta(20, true, 0.5)).toBe(10);
	});
	it(".5 경계는 0에서 먼 쪽(SQL numeric round)", () => {
		// 20 × 0.125 = 2.5 → 3, 20 × −0.125 = −2.5 → −3 (Math.round 면 −2)
		expect(ratingDelta(20, true, 0.875)).toBe(3);
		expect(ratingDelta(20, false, 0.125)).toBe(-3);
	});
	it("예상 밖 승리가 더 크게 오른다", () => {
		const e = matchExpectedA([1300, 1350], [1600, 1650]);
		expect(e).toBeLessThan(0.5);
		expect(ratingDelta(20, true, e)).toBeGreaterThan(10);
	});
});

describe("ELO 상수", () => {
	it("가중치 합 1", () => {
		expect(ELO.WEAK_W + ELO.STRONG_W).toBeCloseTo(1);
	});
	it("배치 표시(5) ≤ 배치 K 구간(10)", () => {
		expect(ELO.PLACEMENT_SHOW_GAMES).toBeLessThanOrEqual(ELO.PLACEMENT_K_GAMES);
	});
});
