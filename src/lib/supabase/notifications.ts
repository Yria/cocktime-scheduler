import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./client";
import type { NotificationRow } from "./types";

/** 알림 type → 사용자 표시 메시지 */
export function notificationMessage(n: NotificationRow): string {
	switch (n.type) {
		case "promoted":
			return "대기자에서 참석이 확정되었어요!";
		case "session_cancelled":
			return "참석 예정 일정이 취소되었어요";
		case "session_closed":
			return "일정 모집이 마감되었어요";
		case "carpool_muster":
			return "카풀 집결 안내가 도착했어요";
		default:
			return "새 알림이 있어요";
	}
}

/** 로그인 회원의 새 알림(INSERT)을 실시간 구독한다. */
export function subscribeNotifications(
	memberId: string,
	onInsert: (n: NotificationRow) => void,
): RealtimeChannel {
	return supabase
		.channel(`notifications:${memberId}`)
		.on(
			"postgres_changes",
			{
				event: "INSERT",
				schema: "public",
				table: "notifications",
				filter: `recipient_member_id=eq.${memberId}`,
			},
			(payload) => {
				onInsert(payload.new as NotificationRow);
			},
		)
		.subscribe();
}
