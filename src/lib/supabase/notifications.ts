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
		case "schedule_added": {
			const label =
				n.payload && typeof n.payload.label === "string"
					? n.payload.label
					: null;
			return label
				? `새 일정이 추가되었어요: ${label}`
				: "새 일정이 추가되었어요";
		}
		default:
			return "새 알림이 있어요";
	}
}

/** 본인 알림 목록을 최신순으로 조회한다. RLS로 본인 것만 반환된다. */
export async function fetchNotifications(
	memberId: string,
	limit = 30,
): Promise<NotificationRow[]> {
	const { data, error } = await supabase
		.from("notifications")
		.select("*")
		.eq("recipient_member_id", memberId)
		.order("created_at", { ascending: false })
		.limit(limit);
	if (error) throw error;
	return (data ?? []) as NotificationRow[];
}

/** 본인의 미읽음 알림을 모두 읽음 처리한다. */
export async function markAllNotificationsRead(memberId: string): Promise<void> {
	const { error } = await supabase
		.from("notifications")
		.update({ read_at: new Date().toISOString() })
		.eq("recipient_member_id", memberId)
		.is("read_at", null);
	if (error) throw error;
}

/** 본인 알림 1건 삭제. RLS로 본인 것만 삭제된다. */
export async function deleteNotification(id: string): Promise<void> {
	const { error } = await supabase.from("notifications").delete().eq("id", id);
	if (error) throw error;
}

/** 본인 알림 전체 삭제. */
export async function clearAllNotifications(memberId: string): Promise<void> {
	const { error } = await supabase
		.from("notifications")
		.delete()
		.eq("recipient_member_id", memberId);
	if (error) throw error;
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
