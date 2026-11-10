import { describe, expect, it } from "vitest";
import { isRevealQuietWindow } from "./schedule";

// 일요일 18:00 KST = 09:00Z. 창은 17:55 이상 18:05 미만(KST).
describe("isRevealQuietWindow", () => {
	it("일요일 17:55~18:04 KST 는 창 안", () => {
		expect(isRevealQuietWindow(new Date("2026-11-15T08:55:00Z"))).toBe(true);
		expect(isRevealQuietWindow(new Date("2026-11-15T09:00:00Z"))).toBe(true);
		expect(isRevealQuietWindow(new Date("2026-11-15T09:04:59Z"))).toBe(true);
	});

	it("창 경계 밖과 다른 요일은 창 밖", () => {
		expect(isRevealQuietWindow(new Date("2026-11-15T08:54:59Z"))).toBe(false);
		expect(isRevealQuietWindow(new Date("2026-11-15T09:05:00Z"))).toBe(false);
		// 토요일 같은 시각
		expect(isRevealQuietWindow(new Date("2026-11-14T09:00:00Z"))).toBe(false);
		// UTC 로는 일요일이지만 KST 로는 월요일 새벽
		expect(isRevealQuietWindow(new Date("2026-11-15T17:58:00Z"))).toBe(false);
	});
});

describe("isRevealQuietWindow(afterMin=10) — 진입 안내창 보류 창", () => {
	it("18:05~18:09 는 sync 창 밖이지만 안내창 창 안", () => {
		const t = new Date("2026-11-15T09:07:00Z");
		expect(isRevealQuietWindow(t)).toBe(false);
		expect(isRevealQuietWindow(t, 10)).toBe(true);
		expect(isRevealQuietWindow(new Date("2026-11-15T09:10:00Z"), 10)).toBe(false);
	});
});
