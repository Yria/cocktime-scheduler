import { describe, expect, it } from "vitest";
import { type MatchItem, matchExactSubset } from "./reconcileMatch";

// 풀은 우선순위 순(회비 먼저, 그다음 대관 이번달기존0·다른달기존1·예정2).
const monthly = (a = 5000): MatchItem => ({ key: "monthly", amount: a });
const court = (key: string, a: number): MatchItem => ({ key, amount: a });

describe("matchExactSubset — 입금확인 자동선택", () => {
	it("엔빵 7,500 정확 매칭(원인 회귀 방지): 6,000 배수가 아니어도 실제 부과로 맞춘다", () => {
		// 오상진/김주영 케이스: 7,500 입금 = 7.17 SM 엔빵 대관비 7,500
		const pool = [monthly(5000), court("sm", 7500), court("upcoming", 6000)];
		expect(matchExactSubset(pool, 7500)).toEqual(["sm"]);
	});

	it("정액 6,000 → 대관 1개(기존 동작 보존)", () => {
		expect(matchExactSubset([monthly(5000), court("c1", 6000)], 6000)).toEqual(["c1"]);
	});

	it("11,000 → 회비 + 대관 6,000", () => {
		expect(matchExactSubset([monthly(5000), court("c1", 6000)], 11000)).toEqual(["monthly", "c1"]);
	});

	it("회비 + 엔빵: 12,500 → 회비 5,000 + 대관 7,500", () => {
		expect(matchExactSubset([monthly(5000), court("sm", 7500)], 12500)).toEqual(["monthly", "sm"]);
	});

	it("엔빵 2개: 15,000 → 7,500 + 7,500", () => {
		const pool = [monthly(5000), court("a", 7500), court("b", 7500)];
		expect(matchExactSubset(pool, 15000)).toEqual(["a", "b"]);
	});

	it("백트래킹: 고우선 6,000이 막아도 정확한 7,500 조합을 찾는다", () => {
		// greedy 라면 6,000을 먼저 집어 1,500이 남아 실패하지만, 완전탐색은 7,500을 찾는다.
		const pool = [court("c6", 6000), court("c75", 7500)];
		expect(matchExactSubset(pool, 7500)).toEqual(["c75"]);
	});

	it("정확히 안 떨어지면 null(오선택 방지 → 수동)", () => {
		expect(matchExactSubset([court("c6", 6000)], 7500)).toBeNull();
		expect(matchExactSubset([monthly(5000)], 7500)).toBeNull();
	});

	it("target 0/음수는 null", () => {
		expect(matchExactSubset([court("c", 6000)], 0)).toBeNull();
		expect(matchExactSubset([court("c", 6000)], -100)).toBeNull();
	});

	it("금액 0 항목은 건너뛴다(무한 선택 방지)", () => {
		expect(matchExactSubset([court("zero", 0), court("c", 7500)], 7500)).toEqual(["c"]);
	});
});
