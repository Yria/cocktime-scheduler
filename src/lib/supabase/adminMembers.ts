import type { PlayerSkills } from "../../types";
import { supabase } from "./client";

// 운영진 전용 회원 관리 데이터 레이어. 권한 가드는 RPC(SECURITY DEFINER + is_admin) 및 members RLS 가 강제.

export interface AdminMemberRow {
	id: string;
	name: string;
	gender: "M" | "F" | null;
	birthYear: number | null;
	residence: string | null;
	skills: PlayerSkills | null;
	authUserId: string | null;
	isActive: boolean;
	isAdmin: boolean;
	isGuest: boolean;
	isHonorary: boolean; // 명예회원(회비 면제). 사유는 member_honorary(관리자 전용) 별도 조회.
}

interface RawMemberRow {
	id: string;
	name: string;
	gender: "M" | "F" | null;
	birth_year: number | null;
	residence: string | null;
	skills: PlayerSkills | null;
	auth_user_id: string | null;
	is_active: boolean;
	is_guest: boolean;
	is_honorary: boolean;
	user_roles: { role: string }[] | null;
}

/**
 * 전체 회원 + 운영진 여부(중첩 user_roles). 운영진만 user_roles 전체 조회 가능(RLS).
 * includeGuests=true 면 게스트(계정 없는 RSVP 게스트)도 포함 — 입금확인(게스트 대관비 입금 매칭)용.
 */
export async function fetchMembersForAdmin(includeGuests = false): Promise<AdminMemberRow[]> {
	let query = supabase
		.from("members")
		.select(
			"id, name, gender, birth_year, residence, skills, auth_user_id, is_active, is_guest, is_honorary, user_roles(role)",
		)
		.order("name", { ascending: true });
	if (!includeGuests) query = query.eq("is_guest", false);
	const { data, error } = await query;
	if (error) {
		console.error("fetchMembersForAdmin:", error);
		return [];
	}
	return ((data ?? []) as RawMemberRow[]).map((m) => ({
		id: m.id,
		name: m.name,
		gender: m.gender,
		birthYear: m.birth_year,
		residence: m.residence,
		skills: m.skills,
		authUserId: m.auth_user_id,
		isActive: m.is_active,
		isAdmin: (m.user_roles ?? []).some((r) => r.role === "admin"),
		isGuest: m.is_guest,
		isHonorary: m.is_honorary,
	}));
}

interface RpcResult {
	ok: boolean;
	error?: string;
}

export async function grantAdmin(memberId: string): Promise<RpcResult> {
	const { error } = await supabase.rpc("grant_admin", { p_member_id: memberId });
	if (error) {
		console.error("grantAdmin:", error);
		return { ok: false, error: error.message };
	}
	return { ok: true };
}

export async function revokeAdmin(memberId: string): Promise<RpcResult> {
	const { error } = await supabase.rpc("revoke_admin", {
		p_member_id: memberId,
	});
	if (error) {
		console.error("revokeAdmin:", error);
		return { ok: false, error: error.message };
	}
	return { ok: true };
}

// deleteMember(delete_member RPC) 폐지 — 회원 하드삭제는 dues/attendances CASCADE 유실로 정산을
// 꼬이게 해 UI·서버 양쪽에서 차단. 탈퇴는 setMemberActive(false)로, 재가입은 재활성화로 처리.

/**
 * 회원 활성/비활성 토글 — members.is_active 직접 UPDATE(members_update RLS).
 * is_active=false 면 세션 셋업 명단(fetchMembers)·회비 월정액 자동부과(dues_generate_monthly)·
 * 실력 비교 앵커에서 제외된다. 회원관리 목록(fetchMembersForAdmin)에는 계속 노출돼 재활성화할 수 있다.
 *
 * RLS USING 절로 걸러진 UPDATE 는 0행이 갱신돼도 error 를 던지지 않으므로(updateMemberProfile 과 동일),
 * `.select()` 로 실제 갱신 행을 확인해 "권한 없음 = 조용한 실패"를 false 로 잡는다.
 */
export async function setMemberActive(
	memberId: string,
	isActive: boolean,
): Promise<boolean> {
	const { data, error } = await supabase
		.from("members")
		.update({ is_active: isActive, updated_at: new Date().toISOString() })
		.eq("id", memberId)
		.select("id");
	if (error) {
		console.error("setMemberActive:", error);
		return false;
	}
	if (!data || data.length === 0) {
		console.error("setMemberActive: 갱신된 행 없음(RLS 거부 추정)", memberId);
		return false;
	}
	return true;
}

/** 회원 실력 편집(members.skills 직접 UPDATE — members_update RLS). */
export async function updateMemberSkills(
	memberId: string,
	skills: PlayerSkills,
): Promise<boolean> {
	const { error } = await supabase
		.from("members")
		.update({ skills, updated_at: new Date().toISOString() })
		.eq("id", memberId);
	if (error) {
		console.error("updateMemberSkills:", error);
		return false;
	}
	return true;
}
