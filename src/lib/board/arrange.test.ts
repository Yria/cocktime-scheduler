import { describe, it, expect } from "vitest";
import { requiredBoardHeight, computeFitScale } from "./arrange";

const FIT = { min: 0.5, max: 1, step: 0.05 };

describe("requiredBoardHeight", () => {
	it("자석이 하나도 없으면 0", () => {
		expect(requiredBoardHeight(0, 0, 390)).toBe(0);
	});

	it("자유 자석이 많을수록 필요한 세로 높이가 커진다", () => {
		expect(requiredBoardHeight(0, 30, 390)).toBeGreaterThan(requiredBoardHeight(0, 4, 390));
	});

	it("가로가 넓으면(열이 많아) 같은 인원의 필요 높이가 줄어든다", () => {
		expect(requiredBoardHeight(0, 30, 800)).toBeLessThan(requiredBoardHeight(0, 30, 390));
	});
});

describe("computeFitScale", () => {
	it("적은 인원은 1배에서 다 들어간다", () => {
		expect(computeFitScale(390, 700, 0, 4, FIT)).toBe(1);
	});

	it("많은 인원은 축소 배율을 반환한다(1배 미만, min 이상)", () => {
		const s = computeFitScale(390, 700, 0, 60, FIT);
		expect(s).toBeLessThan(1);
		expect(s).toBeGreaterThanOrEqual(0.5);
	});

	it("작은 화면+아주 많은 인원이면 하한(min)으로 떨어진다", () => {
		expect(computeFitScale(300, 300, 4, 80, FIT)).toBe(0.5);
	});

	it("반환된 배율에선 실제로 requiredBoardHeight ≤ viewH 가 성립한다(단, min 폴백 제외)", () => {
		const s = computeFitScale(390, 700, 2, 24, FIT);
		if (s > FIT.min) {
			expect(requiredBoardHeight(2, 24, 390 / s)).toBeLessThanOrEqual(700 / s);
		}
	});

	it("인원이 줄면 더 큰(또는 같은) 배율로 돌아온다(최대가 베스트)", () => {
		const many = computeFitScale(390, 700, 0, 50, FIT);
		const few = computeFitScale(390, 700, 0, 8, FIT);
		expect(few).toBeGreaterThanOrEqual(many);
	});
});
