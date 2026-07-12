import { describe, expect, it } from "vitest";
import { skillScoreOf } from "./rankCandidates";
import { normalizeSkills } from "../supabase/members";

describe("skillScoreOf — 등급 + 구 6종 하위호환", () => {
	it("신 모델 {grade}는 그대로 반환", () => {
		expect(skillScoreOf({ grade: 7 })).toBe(7);
		expect(skillScoreOf({ grade: 1 })).toBe(1);
		expect(skillScoreOf({ grade: 10 })).toBe(10);
	});

	it("구 6종: 전부 상(O)→10, 전부 중(V)→6, 전부 하(X)→1", () => {
		const all = (v: string) => ({ 클리어: v, 스매시: v, 로테이션: v, 드랍: v, 헤어핀: v, 푸시: v });
		expect(skillScoreOf(all("O"))).toBe(10);
		expect(skillScoreOf(all("V"))).toBe(6); // avg 2 → round(1+0.5*9)=round(5.5)=6
		expect(skillScoreOf(all("X"))).toBe(1);
	});

	it("한글(상/중/하)·소문자도 인식", () => {
		expect(skillScoreOf({ 클리어: "상", 스매시: "상" })).toBe(10);
		expect(skillScoreOf({ 클리어: "o", 스매시: "o" })).toBe(10);
	});

	it("빈 객체·null·미판독은 0(no-grade sentinel)", () => {
		expect(skillScoreOf({})).toBe(0);
		expect(skillScoreOf(null)).toBe(0);
		expect(skillScoreOf(undefined)).toBe(0);
		expect(skillScoreOf({ foo: "bar" })).toBe(0);
	});
});

describe("normalizeSkills — 항상 유효 등급으로 바닥값", () => {
	it("빈/null/미판독은 기본 등급 5", () => {
		expect(normalizeSkills(null)).toEqual({ grade: 5 });
		expect(normalizeSkills(undefined)).toEqual({ grade: 5 });
		expect(normalizeSkills({} as never)).toEqual({ grade: 5 });
	});

	it("유효 등급/구 6종은 해당 등급 유지·환산", () => {
		expect(normalizeSkills({ grade: 8 })).toEqual({ grade: 8 });
		expect(
			normalizeSkills({ 클리어: "O", 스매시: "O", 로테이션: "O", 드랍: "O", 헤어핀: "O", 푸시: "O" } as never),
		).toEqual({ grade: 10 });
	});
});
