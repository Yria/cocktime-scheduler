import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./client";
import type { NotificationRow, PlaceRow, SessionRow } from "./types";

/** 알림 메시지를 풍부하게 만들기 위한 컨텍스트(세션/장소 정보). 없으면 기본 문구로 폴백. */
export interface NotificationContext {
	sessionTitle?: string | null;
	scheduledAt?: string | null;
	/** 일정 장소(session.place_id) */
	placeName?: string | null;
	/** 카풀 집결지(payload.place_id) */
	carpoolPlaceName?: string | null;
}

/** ISO 시각 → "6월 25일 (목) 오후 7:00" 형식(Asia/Seoul). 없으면 빈 문자열. */
function formatWhen(iso?: string | null): string {
	if (!iso) return "";
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return "";
	return new Intl.DateTimeFormat("ko-KR", {
		timeZone: "Asia/Seoul",
		month: "long",
		day: "numeric",
		weekday: "short",
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(t));
}

/** 알림 row + 로드된 일정/장소에서 표시 컨텍스트를 만든다(클라이언트용). */
export function notificationContext(
	n: NotificationRow,
	schedules: SessionRow[],
	places: PlaceRow[],
): NotificationContext {
	const sess =
		n.session_id != null ? schedules.find((s) => s.id === n.session_id) : undefined;
	// 일정 장소(세션의 place_id)
	const sessPlace =
		sess?.place_id != null
			? places.find((p) => p.id === sess.place_id)
			: undefined;
	// 카풀 집결지(payload.place_id)
	const carpoolPlaceId =
		n.payload && typeof n.payload.place_id === "number"
			? n.payload.place_id
			: null;
	const carpoolPlace =
		carpoolPlaceId != null
			? places.find((p) => p.id === carpoolPlaceId)
			: undefined;
	return {
		sessionTitle: sess?.title ?? null,
		scheduledAt: sess?.scheduled_at ?? null,
		placeName: sessPlace?.name ?? null,
		carpoolPlaceName: carpoolPlace?.name ?? null,
	};
}

/** 알림 type(+컨텍스트) → 사용자 표시 메시지. ctx가 있으면 세션 제목·날짜·장소를 포함한다. */
export function notificationMessage(
	n: NotificationRow,
	ctx?: NotificationContext,
): string {
	const when = formatWhen(ctx?.scheduledAt);
	// 일정엔 '제목' 항목이 없으므로 제목(있으면) 또는 장소명 + 시각으로 식별한다.
	// "○○체육관 (6월 25일 (목) 오후 7:00)". 둘 다 없으면 빈 문자열(기본 문구로 폴백).
	const head = ctx?.sessionTitle ? `'${ctx.sessionTitle}'` : ctx?.placeName;
	const sess = head ? `${head}${when ? ` (${when})` : ""}` : when;

	switch (n.type) {
		case "promoted":
			return sess
				? `${sess} 대기자에서 참석이 확정됐어요!`
				: "대기자에서 참석이 확정되었어요!";
		case "session_cancelled":
			return sess ? `${sess} 일정이 취소됐어요` : "참석 예정 일정이 취소되었어요";
		case "session_closed":
			return sess ? `${sess} 모집이 마감됐어요` : "일정 모집이 마감되었어요";
		case "session_open":
			return sess
				? `${sess} 일정이 열렸어요. 참석 신청하세요!`
				: "새 일정이 열렸어요. 참석 신청하세요!";
		case "carpool_muster": {
			const at = formatWhen(
				n.payload && typeof n.payload.at === "string" ? n.payload.at : null,
			);
			const place = ctx?.carpoolPlaceName;
			if (place && at)
				return `카풀 안내: '${place}'(으)로 ${at}까지 모여주세요`;
			if (place) return `카풀 안내: '${place}' 집결 안내가 도착했어요`;
			return "카풀 집결 안내가 도착했어요";
		}
		case "schedule_added": {
			if (sess) return `새 일정이 추가됐어요: ${sess}`;
			const label =
				n.payload && typeof n.payload.label === "string"
					? n.payload.label
					: null;
			return label
				? `새 일정이 추가됐어요: ${label}`
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
