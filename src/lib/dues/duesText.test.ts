import { describe, it, expect } from "vitest";
import { fmtMDDow, subjectJosa } from "./duesText";

// 부과 이름이 데이터에서 오므로(운영진이 붙인 수동 부과 이름) 조사를 고정할 수 없다.
// 미납 진입 알림 제목("미납 {이름}{조사} 있어요")이 이 함수를 쓴다.
describe("subjectJosa — 주격 조사", () => {
	it("종성이 없으면 '가'", () => {
		expect(subjectJosa("회비")).toBe("가");
		expect(subjectJosa("대관비")).toBe("가");
		expect(subjectJosa("회비·대관비")).toBe("가");
		expect(subjectJosa("공동구매")).toBe("가");
		expect(subjectJosa("부과")).toBe("가");
	});

	it("종성이 있으면 '이'", () => {
		expect(subjectJosa("회식")).toBe("이");
		expect(subjectJosa("셔틀콕")).toBe("이");
		// "… 외 2건" 처럼 뭉갠 제목도 마지막 글자를 본다.
		expect(subjectJosa("회비·대관비 외 2건")).toBe("이");
	});

	it("한글이 아니거나 빈 문자열이면 '가'", () => {
		expect(subjectJosa("MVP")).toBe("가");
		expect(subjectJosa("2026")).toBe("가");
		expect(subjectJosa("")).toBe("가");
	});

	it("뒤 공백은 무시한다", () => {
		expect(subjectJosa("회식 ")).toBe("이");
	});
});

// 회원 화면의 날짜 표기. 부과의 발생일은 시각 없는 `date` 열이고 납부일은
// timestamptz 라 두 모양을 같은 함수가 받는다 — 자정 경계에서 날짜가 밀면
// 회원이 보는 회차 날짜가 하루씩 어긋난다.
describe("fmtMDDow — '9/8 (화)'", () => {
	it("date 열(YYYY-MM-DD)은 그 날짜와 요일을 그대로 말한다", () => {
		expect(fmtMDDow("2026-09-08")).toBe("9/8 (화)");
		expect(fmtMDDow("2026-09-12")).toBe("9/12 (토)");
		expect(fmtMDDow("2026-09-03")).toBe("9/3 (목)");
		expect(fmtMDDow("2026-01-01")).toBe("1/1 (목)");
	});

	it("timestamptz 는 KST 기준으로 읽는다", () => {
		expect(fmtMDDow("2026-09-12T10:00:00+09:00")).toBe("9/12 (토)");
		// 같은 순간의 UTC 표기 — 하루 밀리면 안 된다.
		expect(fmtMDDow("2026-09-12T01:00:00Z")).toBe("9/12 (토)");
		// KST 자정 직후·직전
		expect(fmtMDDow("2026-09-11T15:00:00Z")).toBe("9/12 (토)");
		expect(fmtMDDow("2026-09-11T14:59:00Z")).toBe("9/11 (금)");
	});
});
