import { supabase } from "./client";
import type { RecurringScheduleRow, SessionRow } from "./types";

/** 일정 추가 알림: 로그인 회원 전원(추가한 본인 제외)에게 'schedule_added' 알림 발송(운영진). */
export async function notifyScheduleAdded(
	sessionId: number | null,
	label: string,
): Promise<void> {
	const { error } = await supabase.rpc("notify_members_schedule_added", {
		p_session_id: sessionId,
		p_label: label,
	});
	if (error) console.error("notifyScheduleAdded:", error);
}

// ── 반복 규칙(recurring_schedules) CRUD ───────────────────────

export interface RecurringRuleInput {
	dayOfWeek: number; // 0=일 .. 6=토
	weekOrdinals: number[]; // 매주=[1,2,3,4,5]
	includeLast: boolean;
	startTime: string; // "19:00"
	endTime: string; // "22:00"
	carpoolEnabled: boolean;
	capacity: number | null;
	placeId: number | null;
}

export async function fetchRecurringRules(): Promise<RecurringScheduleRow[]> {
	const { data, error } = await supabase
		.from("recurring_schedules")
		.select("*")
		.order("day_of_week", { ascending: true })
		.order("start_time", { ascending: true });
	if (error) {
		console.error("fetchRecurringRules:", error);
		return [];
	}
	return (data ?? []) as RecurringScheduleRow[];
}

export async function createRecurringRule(
	input: RecurringRuleInput,
	createdBy: string | null,
): Promise<RecurringScheduleRow | null> {
	const { data, error } = await supabase
		.from("recurring_schedules")
		.insert({
			day_of_week: input.dayOfWeek,
			week_ordinals: input.weekOrdinals,
			include_last: input.includeLast,
			start_time: input.startTime,
			end_time: input.endTime,
			carpool_enabled: input.carpoolEnabled,
			capacity: input.capacity,
			place_id: input.placeId,
			created_by: createdBy,
		})
		.select()
		.single();
	if (error) {
		console.error("createRecurringRule:", error);
		return null;
	}
	return data as RecurringScheduleRow;
}

export async function updateRecurringRule(
	id: number,
	patch: Partial<RecurringRuleInput> & { isActive?: boolean },
): Promise<RecurringScheduleRow | null> {
	const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (patch.dayOfWeek != null) row.day_of_week = patch.dayOfWeek;
	if (patch.weekOrdinals != null) row.week_ordinals = patch.weekOrdinals;
	if (patch.includeLast != null) row.include_last = patch.includeLast;
	if (patch.startTime != null) row.start_time = patch.startTime;
	if (patch.endTime != null) row.end_time = patch.endTime;
	if (patch.carpoolEnabled != null) row.carpool_enabled = patch.carpoolEnabled;
	if (patch.capacity !== undefined) row.capacity = patch.capacity;
	if (patch.placeId !== undefined) row.place_id = patch.placeId;
	if (patch.isActive != null) row.is_active = patch.isActive;
	const { data, error } = await supabase
		.from("recurring_schedules")
		.update(row)
		.eq("id", id)
		.select()
		.single();
	if (error) {
		console.error("updateRecurringRule:", error);
		return null;
	}
	return data as RecurringScheduleRow;
}

export async function deleteRecurringRule(id: number): Promise<boolean> {
	const { error } = await supabase
		.from("recurring_schedules")
		.delete()
		.eq("id", id);
	if (error) {
		console.error("deleteRecurringRule:", error);
		return false;
	}
	return true;
}

// ── 회차(sessions) 조회/개별 편집 ─────────────────────────────

/** 달력용: 기간 내 모든 회차(draft 포함, scheduled_at 보유). 즉석 세션(scheduled_at NULL)은 제외. */
export async function fetchOccurrences(
	fromISO: string,
	toISO: string,
): Promise<SessionRow[]> {
	const { data, error } = await supabase
		.from("sessions")
		.select("*")
		.not("scheduled_at", "is", null)
		.neq("status", "cancelled") // 삭제(취소)된 회차는 달력에서 숨김 — tombstone 은 재생성 방지용으로만 잔존
		.gte("scheduled_at", fromISO)
		.lte("scheduled_at", toISO)
		.order("scheduled_at", { ascending: true });
	if (error) {
		console.error("fetchOccurrences:", error);
		return [];
	}
	return (data ?? []) as SessionRow[];
}

export interface OccurrencePatch {
	scheduledAt?: string; // ISO
	endsAt?: string; // ISO
	carpoolEnabled?: boolean;
	placeId?: number | null;
	capacity?: number | null;
}

/** 한 회차만 개별 수정(장소/시간/인원/카풀). is_overridden=true 로 sync 덮어쓰기 방지. */
export async function updateOccurrence(
	sessionId: number,
	patch: OccurrencePatch,
): Promise<SessionRow | null> {
	const row: Record<string, unknown> = { is_overridden: true };
	if (patch.scheduledAt != null) row.scheduled_at = patch.scheduledAt;
	if (patch.endsAt != null) row.ends_at = patch.endsAt;
	if (patch.carpoolEnabled != null) row.carpool_enabled = patch.carpoolEnabled;
	if (patch.placeId !== undefined) row.place_id = patch.placeId;
	if (patch.capacity !== undefined) row.capacity = patch.capacity;
	const { data, error } = await supabase
		.from("sessions")
		.update(row)
		.eq("id", sessionId)
		.select()
		.single();
	if (error) {
		console.error("updateOccurrence:", error);
		return null;
	}
	return data as SessionRow;
}

/**
 * 반복 규칙 회차 삭제(tombstone): status='cancelled'. 행 자체는 남겨 sync 의 재생성을 막는다.
 * (그냥 delete 하면 sync_schedule_occurrences B단계가 56일 창 안에서 다시 생성함)
 * fetchOccurrences 가 cancelled 를 제외하므로 달력에는 노출되지 않아 "삭제된 것"처럼 보인다.
 * 일회성 회차는 규칙이 없어 deleteSchedule 로 완전 삭제한다.
 */
export async function cancelOccurrence(
	sessionId: number,
): Promise<SessionRow | null> {
	const { data, error } = await supabase
		.from("sessions")
		.update({ status: "cancelled", is_active: false, is_overridden: true })
		.eq("id", sessionId)
		.select()
		.single();
	if (error) {
		console.error("cancelOccurrence:", error);
		return null;
	}
	return data as SessionRow;
}

export interface OneOffInput {
	scheduledAt: string; // ISO
	endsAt: string; // ISO
	carpoolEnabled: boolean;
	occurrenceDate: string; // YYYY-MM-DD (Asia/Seoul 달력 날짜)
	placeId: number | null;
	capacity: number | null;
	courtCount?: number;
}

/**
 * 규칙 없는 일회성 회차 추가(달력에서 직접). draft 로 만들고 노출(1주 전 open) 판정은
 * sync_schedule_occurrences 의 E 단계에 단일 위임 — 클라/서버 노출 기준 불일치 방지.
 * (호출부 adminScheduleActions.addOneOff 가 직후 sync 를 돌려 즉시 반영)
 */
export async function createOneOffOccurrence(
	input: OneOffInput,
	createdBy: string | null,
): Promise<SessionRow | null> {
	const { data, error } = await supabase
		.from("sessions")
		.insert({
			scheduled_at: input.scheduledAt,
			ends_at: input.endsAt,
			carpool_enabled: input.carpoolEnabled,
			occurrence_date: input.occurrenceDate,
			place_id: input.placeId,
			capacity: input.capacity,
			court_count: input.courtCount ?? 4,
			status: "draft",
			is_active: false,
			is_overridden: false,
			recurring_schedule_id: null,
			created_by: createdBy,
		})
		.select()
		.single();
	if (error) {
		console.error("createOneOffOccurrence:", error);
		return null;
	}
	return data as SessionRow;
}
