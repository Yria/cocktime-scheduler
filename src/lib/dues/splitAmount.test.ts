import { describe, expect, it } from "vitest";
import { diffHint, splitAmount } from "./splitAmount";

describe("splitAmount — 총액 엔빵", () => {
	const split = (total: number | null, head: number, unit: 10 | 100 | 1000 = 1000) =>
		splitAmount({ mode: "total", total, perHead: null, head, unit });

	it("딱 나눠지면 차액이 0", () => {
		expect(split(442000, 17, 10)).toEqual({ perHead: 26000, head: 17, charged: 442000, diff: 0 });
	});

	it("절상한다 — 총액보다 더 걷히고 그 차액을 돌려준다", () => {
		// 100,000 ÷ 17 = 5,882.35 → 1,000원 절상 6,000 → 102,000 (2,000원 더 걷힘)
		expect(split(100000, 17)).toEqual({ perHead: 6000, head: 17, charged: 102000, diff: 2000 });
	});

	it("절상 단위가 차액을 바꾼다", () => {
		expect(split(100000, 17, 10).perHead).toBe(5890);
		expect(split(100000, 17, 100).perHead).toBe(5900);
		expect(split(100000, 17, 1000).perHead).toBe(6000);
	});

	it("대상 0명이면 나눗셈을 하지 않고 전액을 '모자람'으로 둔다", () => {
		expect(split(442000, 0)).toEqual({ perHead: 0, head: 0, charged: 0, diff: -442000 });
	});

	it("총액 미입력이면 인당 0", () => {
		expect(split(null, 10)).toEqual({ perHead: 0, head: 10, charged: 0, diff: 0 });
	});

	it("총액 0·음수는 미입력과 같게 다룬다(부과에 음수가 흘러가지 않는다)", () => {
		expect(split(0, 10).perHead).toBe(0);
		expect(split(-5000, 10)).toEqual({ perHead: 0, head: 10, charged: 0, diff: 0 });
	});

	it("1명이면 총액을 그 사람이 다 낸다(절상 단위로 올림)", () => {
		expect(split(33500, 1, 1000)).toEqual({ perHead: 34000, head: 1, charged: 34000, diff: 500 });
		expect(split(33500, 1, 10).perHead).toBe(33500);
	});
});

describe("splitAmount — 인당 직접", () => {
	const per = (perHead: number, head: number, total: number | null = null) =>
		splitAmount({ mode: "perHead", total, perHead, head, unit: 1000 });

	it("입력한 금액을 그대로 쓰고 절상 단위를 무시한다", () => {
		expect(per(15000, 12)).toEqual({ perHead: 15000, head: 12, charged: 180000, diff: 0 });
		expect(per(12345, 2).perHead).toBe(12345); // 1,000 단위로 올리지 않는다
	});

	it("총액을 함께 주면 차액을 계산한다(모자람도 보인다)", () => {
		expect(per(10000, 10, 120000).diff).toBe(-20000);
		expect(per(13000, 10, 120000).diff).toBe(10000);
	});

	it("음수·소수 인당은 정리된다", () => {
		expect(per(-1000, 5).perHead).toBe(0);
		expect(per(999.6, 2).perHead).toBe(1000);
	});

	it("대상 0명이면 부과합 0", () => {
		expect(per(10000, 0).charged).toBe(0);
	});
});

describe("diffHint", () => {
	it("0 이면 문구가 없다", () => {
		expect(diffHint(0)).toBeNull();
	});

	it("부호에 따라 더 걷힘/모자람", () => {
		expect(diffHint(2000)).toBe("2,000원 더 걷힘");
		expect(diffHint(-3400)).toBe("3,400원 모자람");
	});
});
