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
	user_roles: { role: string }[] | null;
}

/** 전체 회원 + 운영진 여부(중첩 user_roles). 운영진만 user_roles 전체 조회 가능(RLS). */
export async function fetchMembersForAdmin(): Promise<AdminMemberRow[]> {
	const { data, error } = await supabase
		.from("members")
		.select(
			"id, name, gender, birth_year, residence, skills, auth_user_id, is_active, user_roles(role)",
		)
		.order("name", { ascending: true });
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
