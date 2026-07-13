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
			"id, name, gender, birth_year, residence, skills, auth_user_id, is_active, is_guest, user_roles(role)",
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

export async function deleteMember(memberId: string): Promise<RpcResult> {
	const { error } = await supabase.rpc("delete_member", {
		p_member_id: memberId,
	});
	if (error) {
		console.error("deleteMember:", error);
		return { ok: false, error: error.message };
	}
	return { ok: true };
}

/** 회원 실력 편집(members.skills 직접 UPDATE — members_admin_write RLS). */
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
