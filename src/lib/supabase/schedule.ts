import { supabase } from "./client";
import type { Gender, PlayerSkills } from "../../types";
import type {
	AttendanceRow,
	AttendanceStatus,
	CarpoolRole,
	PlaceRow,
	SessionRow,
	SessionWithPlace,
} from "./types";

/** 반복 규칙 → 회차 동기화(생성/갱신/정리 + 일요일 18:00 KST 일괄 노출). 멱등 RPC. 앱 로드 시 호출(+pg_cron 일 18:00). */
export async function syncOccurrences(): Promise<void> {
	const { error } = await supabase.rpc("sync_schedule_occurrences");
	if (error) console.error("syncOccurrences:", error);
}

/** 회차 단건 조회(정모 안내 페이지 직접 진입/새로고침 대비). 없으면 null. */
export async function fetchSessionById(
	sessionId: number,
): Promise<SessionWithPlace | null> {
	// places(name) 을 join 해서 스토어가 비어 있어도 장소명을 함께 받는다.
	const { data, error } = await supabase
		.from("sessions")
		.select("*, places(name)")
		.eq("id", sessionId)
		.maybeSingle();
	if (error) {
		console.error("fetchSessionById:", error);
		return null;
	}
	if (!data) return null;
	const { places, ...row } = data as SessionRow & {
		places: { name: string } | null;
	};
	return { ...row, place_name: places?.name ?? null };
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
	/** 대관장소 여부(대관비 부과 대상). places.charges_court_fee. 실제 총액은 일정(반복 규칙)에서 입력. */
	chargesCourtFee?: boolean;
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
			charges_court_fee: input.chargesCourtFee ?? false,
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
	// inviter:invited_by(name) — 게스트를 데려온(신청한) 회원 이름. 본인 참석 행은 invited_by=null → inviter=null.
	// user_roles(role) — 운영진 뱃지용. RLS(user_roles_select_admin_public)로 admin 행은 전 회원 공개.
	const { data, error } = await supabase
		.from("attendances")
		.select(
			"*, member:member_id(name, is_guest, gender, user_roles(role)), inviter:invited_by(name)",
		)
		.in("session_id", sessionIds)
		.neq("status", "cancelled")
		.order("position", { ascending: true });
	if (error) {
		console.error("fetchAttendances:", error);
		return [];
	}
	return (data ?? []) as AttendanceRow[];
}

/** 게스트 신청. 회원이 게스트(이름+성별+실력)를 일정에 신청.
 *  확정 게스트는 세션당 최대 2명(RPC가 상한 판정) — 정원 여유 + 확정 게스트 2명 미만이면 confirmed, 아니면
 *  waitlisted(확정 게스트가 빠질 때 승급). 동명 활성 회원이 있으면 신청 거부(name_is_member). 이미 확정
 *  게스트가 2명이면 "대기로 접수된다"는 경고를 클라(GuestSection)에서 확인받은 뒤 신청한다. */
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

/** 운영진: 참여목록에서 임의 참석자(회원/게스트) 제거. confirmed였고 open이면 대기 1순위 자동 승급(RPC).
 *  제거 당사자(게스트면 초대 회원)에게 'removed' 알림(누가 제거했는지 포함) 발송. is_admin 게이팅은 RPC. */
export async function adminCancelAttendance(
	sessionId: number,
	memberId: string,
): Promise<{ ok: boolean; error?: string }> {
	const { error } = await supabase.rpc("admin_cancel_attendance", {
		p_session_id: sessionId,
		p_member_id: memberId,
	});
	if (error) {
		console.error("adminCancelAttendance:", error);
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

/** 정모 식사(회식) 참여 설정. 대상 미지정=본인, 지정 시 내가 데려온 게스트(계정이 없어 대신 고른다).
 *  서버가 정모(is_regular) + 식사 체크(meal_enabled) 회차인지, 취소 아닌 참석 행인지 게이팅한다. */
export async function setMealJoining(
	sessionId: number,
	joining: boolean,
	memberId?: string,
): Promise<{ ok: boolean; error?: string }> {
	const { error } = await supabase.rpc("set_meal_joining", {
		p_session_id: sessionId,
		p_joining: joining,
		p_member_id: memberId ?? null,
	});
	if (error) {
		console.error("setMealJoining:", error);
		return { ok: false, error: error.message };
	}
	return { ok: true };
}

/** 본인 늦참(도착 오프셋, 분) 설정(참석자). 0=정시.
 *  도착이 8시(KST 20:00) 이상이면 서버가 정원 외 풀(late_pool)로 전환하고, 미만으로 되돌리면 큐로 복귀.
 *  반환 status = 반영된 권위 상태(confirmed/waitlisted/late_pool), promoted = 자동 승급 인원. */
export async function setLateMinutes(
	sessionId: number,
	minutes: number,
): Promise<{
	ok: boolean;
	error?: string;
	status?: AttendanceStatus;
	promoted?: number;
}> {
	const { data, error } = await supabase.rpc("set_late_minutes", {
		p_session_id: sessionId,
		p_minutes: minutes,
	});
	if (error) {
		console.error("setLateMinutes:", error);
		return { ok: false, error: error.message };
	}
	const res = (data ?? {}) as { status?: AttendanceStatus; promoted?: number };
	return { ok: true, status: res.status, promoted: res.promoted };
}
