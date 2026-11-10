import { createClient } from "@supabase/supabase-js";

// Vite 밖(번들러·툴링·프리뷰 런타임)에서 이 모듈이 로드될 수 있다. 그때 env 가 비면
// createClient 가 모듈 스코프에서 던져 임포트 그래프 전체가 죽으므로, 값이 없을 때만
// 통하지 않는 자리값으로 대체한다(실제 빌드에는 항상 env 가 있다).
const SUPABASE_URL =
	(import.meta.env?.VITE_SUPABASE_URL as string) ??
	"https://unset.supabase.invalid";
const SUPABASE_ANON_KEY =
	(import.meta.env?.VITE_SUPABASE_ANON_KEY as string) ?? "unset-anon-key";

/** REST(PostgREST) 요청 응답 대기 상한. 서버가 몇 초씩 멈추는 순간(무료 Nano VM 스왑, 2026-11-08 공개 때
 *  2.5초 응답 0건) 상한이 없으면 화면이 끝없이 '처리 중'에 묶인다. 상한을 넘기면 오류로 돌려 재시도·안내를 한다.
 *  인증·스토리지(업로드)·Realtime 은 건드리지 않는다. */
const REST_TIMEOUT_MS = 15_000;

function fetchWithRestTimeout(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	if (!url.includes("/rest/v1/") || typeof AbortSignal.timeout !== "function") {
		return fetch(input, init);
	}
	const timeout = AbortSignal.timeout(REST_TIMEOUT_MS);
	let signal: AbortSignal = timeout;
	if (init?.signal) {
		if (typeof AbortSignal.any !== "function") return fetch(input, init); // 호출자 신호 우선
		signal = AbortSignal.any([init.signal, timeout]);
	}
	return fetch(input, { ...init, signal });
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
	global: { fetch: fetchWithRestTimeout },
	auth: {
		// 정적 SPA(GitHub Pages)용: 토큰이 URL 해시에 노출되는 implicit 대신 PKCE.
		flowType: "pkce",
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true,
	},
});
