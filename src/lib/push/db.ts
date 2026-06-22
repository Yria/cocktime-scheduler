import { supabase } from "../supabase/client";

export interface PushKeys {
	endpoint: string;
	p256dh: string;
	auth: string;
}

/** 본인 구독 저장(기기 재구독 시 갱신). RLS가 member_id를 본인으로 강제. */
export async function saveSubscription(memberId: string, s: PushKeys) {
	const { error } = await supabase.from("push_subscriptions").upsert(
		{
			member_id: memberId,
			endpoint: s.endpoint,
			p256dh: s.p256dh,
			auth: s.auth,
			user_agent: navigator.userAgent,
			last_seen_at: new Date().toISOString(),
		},
		{ onConflict: "member_id,endpoint" },
	);
	if (error) throw error;
}

export async function deleteSubscription(memberId: string, endpoint: string) {
	const { error } = await supabase
		.from("push_subscriptions")
		.delete()
		.eq("member_id", memberId)
		.eq("endpoint", endpoint);
	if (error) throw error;
}
