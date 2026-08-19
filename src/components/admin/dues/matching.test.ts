import { describe, expect, it } from "vitest";
import { chosungOf, nameMatches, normalizeDepositName, sanitizeCandidatePool, suggestMembers } from "./matching";

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

describe("chosungOf", () => {
	it("한글 음절 → 초성", () => {
		expect(chosungOf("황서진")).toBe("ㅎㅅㅈ");
		expect(chosungOf("김태혁")).toBe("ㄱㅌㅎ");
	});
	it("쌍자음 초성", () => {
		expect(chosungOf("빵까뚜")).toBe("ㅃㄲㄸ");
	});
	it("비한글은 그대로", () => {
		expect(chosungOf("ab 12")).toBe("ab 12");
	});
});

describe("nameMatches", () => {
	it("부분 일치(공백·대소문자 무시)", () => {
		expect(nameMatches("황서진", "서진")).toBe(true);
		expect(nameMatches("황 서진", "황서")).toBe(true);
		expect(nameMatches("황서진", "이도현")).toBe(false);
	});
	it("초성 검색", () => {
		expect(nameMatches("황서진", "ㅎㅅㅈ")).toBe(true);
		expect(nameMatches("황서진", "ㅎㅅ")).toBe(true); // 부분 초성
		expect(nameMatches("황서진", "ㄱㅅㅈ")).toBe(false);
	});
	it("빈 검색어는 통과", () => {
		expect(nameMatches("황서진", "")).toBe(true);
		expect(nameMatches("황서진", "  ")).toBe(true);
	});
});

// ── 후보 위생(동명 게스트 접기) ────────────────────────────────────────
// 프로덕션 실태: 게스트는 방문마다 members 행이 새로 생겨 동명 행이 쌓인다(문병기 4·신현재 4·김지훈 3 …).
// 후보 slice(0,4)·검색 slice(0,6) 안에서 실제 회원이 밀려나던 게 이 규칙의 이유.
const member = (id: string, name: string, extra: Partial<{ isActive: boolean }> = {}) => ({
	id,
	name,
	gender: "M" as const,
	birthYear: 1990,
	isGuest: false,
	isActive: extra.isActive ?? true,
});
const guest = (id: string, name: string, createdAt?: string) => ({
	id,
	name,
	gender: null,
	birthYear: null,
	isGuest: true,
	isActive: true,
	createdAt,
});

describe("sanitizeCandidatePool", () => {
	it("동명 회원+게스트 → 회원만 남는다", () => {
		const r = sanitizeCandidatePool([guest("g1", "김지훈", "2026-07-01"), member("m1", "김지훈"), guest("g2", "김지훈", "2026-08-01")]);
		expect(r.map((m) => m.id)).toEqual(["m1"]);
	});
	it("동명 게스트 3행 → 최신 1행", () => {
		const r = sanitizeCandidatePool([guest("g1", "문병기", "2026-06-01"), guest("g2", "문병기", "2026-08-05"), guest("g3", "문병기", "2026-07-03")]);
		expect(r.map((m) => m.id)).toEqual(["g2"]);
	});
	it("createdAt 이 없으면 원본 첫 행을 대표로(대표가 새로고침마다 바뀌지 않게)", () => {
		const r = sanitizeCandidatePool([guest("g1", "신현재"), guest("g2", "신현재"), guest("g3", "신현재")]);
		expect(r.map((m) => m.id)).toEqual(["g1"]);
	});
	it("비활성 회원은 후보에 남고(부과가 살아 있다), 동명 충돌 시 활성 회원이 앞", () => {
		const r = sanitizeCandidatePool([member("m1", "우창형", { isActive: false }), member("m2", "우창형"), guest("g1", "우창형")]);
		expect(r.map((m) => m.id)).toEqual(["m2", "m1"]);
	});
	it("미납이 걸린 게스트 행은 접지 않는다(배분 경로 보존)", () => {
		const r = sanitizeCandidatePool([guest("g1", "김윤호", "2026-06-01"), guest("g2", "김윤호", "2026-08-01"), guest("g3", "김윤호", "2026-07-01")], { protectedIds: ["g3"] });
		expect(r.map((m) => m.id)).toEqual(["g3"]);
	});
	it("검색 완화 옵션: 동명 회원이 있어도 게스트 대표 1행은 남는다", () => {
		const r = sanitizeCandidatePool([member("m1", "김선예"), guest("g1", "김선예", "2026-06-01"), guest("g2", "김선예", "2026-08-01")], { keepGuestsWithNamesakeMember: true });
		expect(r.map((m) => m.id)).toEqual(["m1", "g2"]);
	});
	it("동명이 아닌 회원의 상대 순서는 흔들지 않는다", () => {
		const pool = [member("a", "이한비"), guest("g1", "문병기", "2026-06-01"), member("b", "장세훈"), guest("g2", "문병기", "2026-08-01"), member("c", "박세경")];
		expect(sanitizeCandidatePool(pool).map((m) => m.id)).toEqual(["a", "g2", "b", "c"]);
	});
	it("이름 정규화(공백·NFC)로 같은 이름을 한 그룹으로 본다", () => {
		const r = sanitizeCandidatePool([member("m1", "김 지훈"), guest("g1", "김지훈", "2026-08-01")]);
		expect(r.map((m) => m.id)).toEqual(["m1"]);
	});
});

describe("suggestMembers × 후보 위생", () => {
	it("동명 게스트 중복행이 실제 회원을 상위 5칸에서 밀어내지 않는다", () => {
		const pool = [
			guest("g1", "김지훈", "2026-05-01"),
			guest("g2", "김지훈", "2026-06-01"),
			guest("g3", "김지훈", "2026-07-01"),
			member("m1", "김지훈"),
		];
		const r = suggestMembers("7월회비 김지훈", pool);
		expect(r.map((m) => m.id)).toEqual(["m1"]);
	});
	it("게스트만 있는 이름은 대표 1행이 후보로 남는다(게스트 대관비 입금 매칭 유지)", () => {
		const pool = [guest("g1", "고은림", "2026-06-01"), guest("g2", "고은림", "2026-08-01")];
		const r = suggestMembers("고은림(게스트", pool);
		expect(r.map((m) => m.id)).toEqual(["g2"]);
		expect(r[0].score).toBe(3);
	});
});
