import { supabase } from "./client";
import type { AttendanceRow, PlaceRow, SessionRow } from "./types";

export interface CreateScheduleInput {
	title: string;
	scheduledAt: string; // ISO
	courtCount: number;
	capacity: number | null;
	placeId: number | null;
}

/** 예정/진행 중 일정 목록 (모집중 open + 진행중 active). 즉석 세션은 scheduled_at이 null이라 뒤로. */
export async function fetchSchedules(): Promise<SessionRow[]> {
	const { data, error } = await supabase
		.from("sessions")
		.select("*")
		.in("status", ["open", "active"])
		.order("scheduled_at", { ascending: true, nullsFirst: false });
	if (error) {
		console.error("fetchSchedules:", error);
		return [];
	}
	return (data ?? []) as SessionRow[];
}

/** 일정 생성(운영진). status='open'(모집), is_active=false(아직 진행 아님). */
export async function createSchedule(
	input: CreateScheduleInput,
	createdBy: string | null,
): Promise<SessionRow | null> {
	const { data, error } = await supabase
		.from("sessions")
		.insert({
			title: input.title,
			scheduled_at: input.scheduledAt,
			court_count: input.courtCount,
			capacity: input.capacity,
			place_id: input.placeId,
			status: "open",
			is_active: false,
			created_by: createdBy,
		})
		.select()
		.single();
	if (error) {
		console.error("createSchedule:", error);
		return null;
	}
	return data as SessionRow;
}

export async function deleteSchedule(sessionId: number): Promise<boolean> {
	const { error } = await supabase
		.from("sessions")
		.delete()
		.eq("id", sessionId);
	if (error) {
		console.error("deleteSchedule:", error);
		return false;
	}
	return true;
}

export async function fetchPlaces(): Promise<PlaceRow[]> {
	const { data, error } = await supabase
		.from("places")
		.select("*")
		.eq("is_active", true)
		.order("name", { ascending: true });
	if (error) {
		console.error("fetchPlaces:", error);
		return [];
	}
	return (data ?? []) as PlaceRow[];
}

export async function createPlace(
	name: string,
	address: string | null,
	defaultCourtCount: number | null,
	createdBy: string | null,
): Promise<PlaceRow | null> {
	const { data, error } = await supabase
		.from("places")
		.insert({
			name,
			address,
			default_court_count: defaultCourtCount,
			created_by: createdBy,
		})
		.select()
		.single();
	if (error) {
		console.error("createPlace:", error);
		return null;
	}
	return data as PlaceRow;
}

// ── 참석(attendances) ─────────────────────────────────

/** 여러 세션의 참석 현황(취소 제외). 클라에서 세션별 집계. */
export async function fetchAttendances(
	sessionIds: number[],
): Promise<AttendanceRow[]> {
	if (sessionIds.length === 0) return [];
	const { data, error } = await supabase
		.from("attendances")
		.select("*")
		.in("session_id", sessionIds)
		.neq("status", "cancelled")
		.order("position", { ascending: true });
	if (error) {
		console.error("fetchAttendances:", error);
		return [];
	}
	return (data ?? []) as AttendanceRow[];
}

/** 참석 신청. 정원 여유면 confirmed, 아니면 waitlisted (RPC가 판정). */
export async function joinSession(
	sessionId: number,
): Promise<{ ok: boolean; error?: string }> {
	const { error } = await supabase.rpc("join_session", {
		p_session_id: sessionId,
	});
	if (error) {
		console.error("joinSession:", error);
		return { ok: false, error: error.message };
	}
	return { ok: true };
}

/** 참석 취소. confirmed였으면 대기 1순위 자동 승급(RPC). */
export async function cancelAttendance(
	sessionId: number,
): Promise<{ ok: boolean; error?: string }> {
	const { error } = await supabase.rpc("cancel_attendance", {
		p_session_id: sessionId,
	});
	if (error) {
		console.error("cancelAttendance:", error);
		return { ok: false, error: error.message };
	}
	return { ok: true };
}
