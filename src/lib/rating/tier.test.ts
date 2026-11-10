import { describe, expect, it } from "vitest";
import {
	isPlacement,
	nextTier,
	TIERS,
	tierLabel,
	tierOf,
	tierProgress,
} from "./tier";

describe("tierOf 경계", () => {
	it.each([
		[0, "bronze"],
		[1100, "bronze"],
		[1299, "bronze"],
		[1300, "silver"],
		[1499, "silver"],
		[1500, "gold"],
		[1699, "gold"],
		[1700, "platinum"],
		[1899, "platinum"],
		[1900, "diamond"],
		[2099, "diamond"],
		[2100, "master"],
		[3000, "master"],
	] as const)("%i → %s", (r, key) => {
		expect(tierOf(r)).toBe(key);
	});
	it("음수도 브론즈", () => {
		expect(tierOf(-50)).toBe("bronze");
	});
});

describe("TIERS 표", () => {
	it("하한이 오름차순", () => {
		for (let i = 1; i < TIERS.length; i++)
			expect(TIERS[i].min).toBeGreaterThan(TIERS[i - 1].min);
	});
	it("한글명", () => {
		expect(TIERS.map((t) => t.label)).toEqual([
			"브론즈",
			"실버",
			"골드",
			"플래티넘",
			"다이아",
			"마스터",
		]);
		expect(tierLabel("diamond")).toBe("다이아");
	});
});

describe("isPlacement", () => {
	it("반영 5경기 미만", () => {
		expect(isPlacement(0)).toBe(true);
		expect(isPlacement(4)).toBe(true);
		expect(isPlacement(5)).toBe(false);
	});
});

describe("tierProgress", () => {
	it("등급 하한 0, 중간 0.5", () => {
		expect(tierProgress(1500)).toBe(0);
		expect(tierProgress(1600)).toBeCloseTo(0.5);
		expect(tierProgress(1699)).toBeCloseTo(0.995);
	});
	it("브론즈는 1100 바닥, 그 아래는 0", () => {
		expect(tierProgress(1100)).toBe(0);
		expect(tierProgress(1200)).toBeCloseTo(0.5);
		expect(tierProgress(900)).toBe(0);
	});
	it("마스터는 1", () => {
		expect(tierProgress(2100)).toBe(1);
		expect(tierProgress(2500)).toBe(1);
	});
	it("nextTier", () => {
		expect(nextTier(1450)?.key).toBe("gold");
		expect(nextTier(2200)).toBeNull();
	});
});
