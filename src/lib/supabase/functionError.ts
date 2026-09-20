export async function functionErrorMessage(error: {
	message: string;
	context?: Response;
}): Promise<string> {
	const response = error.context;
	if (!response || typeof response.json !== "function") return error.message;
	let detail: string | undefined;
	let code: string | undefined;
	try {
		const body = await response.clone().json();
		detail = [body?.error, body?.message].find(
			(value) => typeof value === "string" && value.trim(),
		);
		code = body?.code;
	} catch {
		// 플랫폼 오류는 JSON 본문이 없을 수도 있다. HTTP 상태는 남긴다.
	}
	if (
		response.status === 546 ||
		code === "WORKER_LIMIT" ||
		code === "WORKER_RESOURCE_LIMIT"
	) {
		return "통장 엑셀 처리 중 서버 실행 한도를 초과했습니다. 일부 내역은 저장됐을 수 있으니 새로고침 후 다시 가져와 주세요. (546)";
	}
	return `${detail ?? error.message} (HTTP ${response.status})`;
}
