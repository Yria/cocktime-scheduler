import { describe, expect, it } from "vitest";
import { normalizeDepositName, suggestMembers } from "./matching";

// 2026-07 토스 실입금 적요 표본 → 기대 이름
const CASES: [string, string][] = [
	["김태혁0719", "김태혁"],
	["7월회비 이한비", "이한비"],
	["7월회비장세훈", "장세훈"],
	["7월회비이찬환", "이찬환"],
	["고은림(게스트", "고은림"],
	["채진", "채진"],
	["전준형", "전준형"],
	["712영민홍희", "영민홍희"],
	["712성재경", "성재경"],
	["7/12차성민", "차성민"],
	["7/12 송유현", "송유현"],
	["7월12일황서진", "황서진"],
	["김태혁0712", "김태혁"],
	["0712정재욱", "정재욱"],
	["12일김영주", "김영주"],
	["7월회비양수진", "양수진"],
	["심상욱0712", "심상욱"],
	["정재욱콕1타", "정재욱"],
	["7월 회비 이수민", "이수민"],
	["7월 남궁우열", "남궁우열"],
	["7월이도현", "이도현"],
	["7월회비박세경", "박세경"],
];

describe("normalizeDepositName", () => {
	for (const [raw, expected] of CASES) {
		it(`"${raw}" → "${expected}"`, () => {
			expect(normalizeDepositName(raw)).toBe(expected);
		});
	}
});

describe("suggestMembers", () => {
	const members = [
		{ id: "a", name: "이한비", gender: "F" as const, birthYear: 1990 },
		{ id: "b", name: "김태혁", gender: "M" as const, birthYear: 1988 },
		{ id: "c", name: "김태혁", gender: "M" as const, birthYear: 1995 }, // 동명이인
	];
	it("정확일치 회원을 최상위로", () => {
		const r = suggestMembers("7월회비 이한비", members);
		expect(r[0].name).toBe("이한비");
		expect(r[0].score).toBe(3);
	});
	it("동명이인은 둘 다 후보로", () => {
		const r = suggestMembers("김태혁0719", members);
		expect(r.filter((m) => m.name === "김태혁")).toHaveLength(2);
	});
});
