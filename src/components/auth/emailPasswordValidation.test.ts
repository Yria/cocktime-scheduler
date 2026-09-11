import { describe, expect, it } from "vitest";
import { emailPasswordErrorMessage, validateEmailPassword } from "./emailPasswordValidation";

describe("email/password login validation", () => {
	it.each(["", "   "])("requires an email before sending %j", (email) => {
		expect(validateEmailPassword(email, "password")).toBe("이메일을 입력해 주세요.");
	});
	it.each(["member", "member@", "@example.com", "a b@example.com", "a@@example.com"])("rejects malformed email %j", (email) => {
		expect(validateEmailPassword(email, "password")).toBe("올바른 이메일 주소를 입력해 주세요.");
	});
	it("requires a nonempty password, without trimming it or imposing signup length rules", () => {
		expect(validateEmailPassword("member@example.com", "")).toBe("비밀번호를 입력해 주세요.");
		expect(validateEmailPassword("  member+board@example.com  ", " ")).toBeNull();
		expect(validateEmailPassword("member@example.com", "x")).toBeNull();
	});
});

describe("email/password login error messages", () => {
	it.each([
		[{ code: "invalid_credentials" }, "이메일 또는 비밀번호를 확인해 주세요."],
		[{ code: "email_not_confirmed" }, "이메일 인증을 완료한 뒤 로그인해 주세요."],
		[{ code: "over_request_rate_limit" }, "로그인 시도가 너무 많아요. 잠시 후 다시 시도해 주세요."],
		[{ status: 429 }, "로그인 시도가 너무 많아요. 잠시 후 다시 시도해 주세요."],
		[{ code: "user_banned" }, "로그인할 수 없는 계정이에요. 운영진에게 문의해 주세요."],
		[{ name: "AuthRetryableFetchError" }, "연결을 확인한 뒤 다시 시도해 주세요."],
		[new TypeError("Failed to fetch"), "연결을 확인한 뒤 다시 시도해 주세요."],
	])("maps supported provider failures safely: %j", (error, message) => {
		expect(emailPasswordErrorMessage(error)).toBe(message);
	});
	it.each([null, undefined, new Error("private details"), { message: "sensitive server response" }])("does not expose unknown server details", (error) => {
		expect(emailPasswordErrorMessage(error)).toBe("로그인하지 못했어요. 잠시 후 다시 시도해 주세요.");
	});
});
