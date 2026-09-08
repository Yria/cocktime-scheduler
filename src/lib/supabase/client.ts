import { createClient } from "@supabase/supabase-js";

// Vite 밖(번들러·툴링·프리뷰 런타임)에서 이 모듈이 로드될 수 있다. 그때 env 가 비면
// createClient 가 모듈 스코프에서 던져 임포트 그래프 전체가 죽으므로, 값이 없을 때만
// 통하지 않는 자리값으로 대체한다(실제 빌드에는 항상 env 가 있다).
const SUPABASE_URL =
	(import.meta.env?.VITE_SUPABASE_URL as string) ??
	"https://unset.supabase.invalid";
const SUPABASE_ANON_KEY =
	(import.meta.env?.VITE_SUPABASE_ANON_KEY as string) ?? "unset-anon-key";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
	auth: {
		// 정적 SPA(GitHub Pages)용: 토큰이 URL 해시에 노출되는 implicit 대신 PKCE.
		flowType: "pkce",
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true,
	},
});
