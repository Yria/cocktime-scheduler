import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
	auth: {
		// 정적 SPA(GitHub Pages)용: 토큰이 URL 해시에 노출되는 implicit 대신 PKCE.
		flowType: "pkce",
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true,
	},
});
