/** 기존 계정 로그인에는 가입 정책(비밀번호 최소 길이 등)을 새로 강제하지 않는다. */
export function validateEmailPassword(email: string, password: string): string | null {
	const normalizedEmail = email.trim();
	if (!normalizedEmail) return "이메일을 입력해 주세요.";
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return "올바른 이메일 주소를 입력해 주세요.";
	if (password.length === 0) return "비밀번호를 입력해 주세요.";
	return null;
}

/** 서버 원문(계정 정보·내부 오류)을 그대로 노출하지 않는다. */
export function emailPasswordErrorMessage(error: unknown): string {
	if (error && typeof error === "object") {
		const { code, status, name } = error as { code?: string; status?: number; name?: string };
		if (code === "invalid_credentials") return "이메일 또는 비밀번호를 확인해 주세요.";
		if (code === "email_not_confirmed") return "이메일 인증을 완료한 뒤 로그인해 주세요.";
		if (status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit") {
			return "로그인 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.";
		}
		if (code === "user_banned") return "로그인할 수 없는 계정이에요. 운영진에게 문의해 주세요.";
		if (name === "AuthRetryableFetchError" || name === "TypeError" || code === "request_timeout") {
			return "연결을 확인한 뒤 다시 시도해 주세요.";
		}
	}
	return "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.";
}
