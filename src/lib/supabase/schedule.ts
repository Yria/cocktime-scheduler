import { supabase } from "./client";
import type { Gender, PlayerSkills } from "../../types";
import type { AttendanceRow, CarpoolRole, PlaceRow, SessionRow } from "./types";

/** 반복 규칙 → 회차 동기화(생성/갱신/정리 + 1주 전 노출). 멱등 RPC. 앱 로드 시 호출. */
export async function syncOccurrences(): Promise<void> {
	const { error } = await supabase.rpc("sync_schedule_occurrences");
	if (error) console.error("syncOccurrences:", error);
}

/** 회차 단건 조회(정모 안내 페이지 직접 진입/새로고침 대비). 없으면 null. */
export async function fetchSessionById(
	sessionId: number,
): Promise<SessionRow | null> {
	const { data, error } = await supabase
		.from("sessions")
		.select("*")
		.eq("id", sessionId)
		.maybeSingle();
	if (error) {
		console.error("fetchSessionById:", error);
		return null;
	}
	return (data ?? null) as SessionRow | null;
}

/** 예정/진행 중 일정 목록 (노출된 open + 진행중 active). 즉석 세션은 scheduled_at이 null이라 뒤로. */
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

export interface CreatePlaceInput {
	name: string;
	address?: string | null;
	lat?: number | null;
	lng?: number | null;
	mapUrl?: string | null;
}

export async function createPlace(
	input: CreatePlaceInput,
	createdBy: string | null,
): Promise<PlaceRow | null> {
	const { data, error } = await supabase
		.from("places")
		.insert({
			name: input.name,
			address: input.address ?? null,
			lat: input.lat ?? null,
			lng: input.lng ?? null,
			map_url: input.mapUrl ?? null,
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
	// member 임베드 — 게스트 이름/게스트여부/성별(아바타 색) 표시용. attendances→members FK가 둘(member_id, invited_by)이라
	// FK 컬럼(member_id)으로 명시 disambiguate해야 한다(없으면 PGRST201로 전체 조회가 실패).
	const { data, error } = await supabase
		.from("attendances")
		.select("*, member:member_id(name, is_guest, gender)")
		.in("session_id", sessionIds)
		.neq("status", "cancelled")
		.order("position", { ascending: true });
	if (error) {
		console.error("fetchAttendances:", error);
		return [];
	}
	return (data ?? []) as AttendanceRow[];
}

/** 게스트 신청. 회원이 게스트(이름+성별+실력)를 일정에 신청 — 정원 여유면 confirmed, 아니면 waitlisted(RPC 판정). */
export async function addGuestAttendance(
	sessionId: number,
	guest: { name: string; gender: Gender; skills: PlayerSkills },
): Promise<{ ok: boolean; error?: string }> {
	const { error } = await supabase.rpc("add_guest_attendance", {
		p_session_id: sessionId,
		p_name: guest.name,
		p_gender: guest.gender,
		p_skills: guest.skills,
	});
	if (error) {
		console.error("addGuestAttendance:", error);
		return { ok: false, error: error.message };
	}
	return { ok: true };
}

/** 게스트 취소(초대 회원만). confirmed였으면 대기 1순위 자동 승급(RPC). */
export async function cancelGuestAttendance(
	sessionId: number,
	guestMemberId: string,
): Promise<{ ok: boolean; error?: string }> {
	const { error } = await supabase.rpc("cancel_guest_attendance", {
		p_session_id: sessionId,
		p_guest_member_id: guestMemberId,
	});
	if (error) {
		console.error("cancelGuestAttendance:", error);
		return { ok: false, error: error.message };
	}
	return { ok: true };
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

/** 운영진: 일정 confirmed 참석자를 session_players로 편입하고 세션 활성화(브릿지 RPC). */
export async function startSessionFromSchedule(
	sessionId: number,
): Promise<{ ok: boolean; error?: string }> {
	const { error } = await supabase.rpc("start_session_from_schedule", {
		p_session_id: sessionId,
	});
	if (error) {
		console.error("startSessionFromSchedule:", error);
		return { ok: false, error: error.message };
	}
	return { ok: true };
}

/** 본인 카풀 의향 설정(참석자). */
export async function setCarpoolRole(
	sessionId: number,
	role: CarpoolRole,
): Promise<{ ok: boolean; error?: string }> {
	const { error } = await supabase.rpc("set_carpool_role", {
		p_session_id: sessionId,
		p_role: role,
	});
	if (error) {
		console.error("setCarpoolRole:", error);
		return { ok: false, error: error.message };
	}
	return { ok: true };
}
