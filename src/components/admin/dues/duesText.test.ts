import { describe, it, expect } from "vitest";
import { subjectJosa } from "./duesText";

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
