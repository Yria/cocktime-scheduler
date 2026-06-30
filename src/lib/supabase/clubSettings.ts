/**
 * clubSettings.ts
 *
 * 클럽 전역 설정(group_settings 싱글톤)과 월별 콕 지원(cock_support_grants) DB 접근.
 * - 그룹 설정: 성별 콕 쿼터(남2/여1) + 월 지원량(1). 읽기=누구나, 쓰기=운영진(RLS is_admin).
 * - 콕 지원: 회원이 그 달 지원을 소진했는지(member_id, ym). 그 달 첫 콕체크 확인이 upsert로 소진(멱등).
 * (마이그레이션 20260630030000)
 */
import { DEFAULT_GROUP_SETTINGS, type GroupSettings } from "../../types";
import { supabase } from "./client";

/** 그룹 설정 조회. 행이 없거나 에러면 기본값(남2/여1/지원1). */
export async function fetchGroupSettings(): Promise<GroupSettings> {
	const { data, error } = await supabase
		.from("group_settings")
		.select("cock_quota_male, cock_quota_female, cock_support_per_month")
		.eq("id", 1)
		.maybeSingle();
	if (error || !data) {
		if (error) console.error("fetchGroupSettings:", error);
		return { ...DEFAULT_GROUP_SETTINGS };
	}
	return {
		cockQuotaMale: data.cock_quota_male,
		cockQuotaFemale: data.cock_quota_female,
		cockSupportPerMonth: data.cock_support_per_month,
	};
}

/** 그룹 설정 저장(운영진). 성공 시 true. */
export async function updateGroupSettings(s: GroupSettings): Promise<boolean> {
	const { error } = await supabase
		.from("group_settings")
		.update({
			cock_quota_male: s.cockQuotaMale,
			cock_quota_female: s.cockQuotaFemale,
			cock_support_per_month: s.cockSupportPerMonth,
			updated_at: new Date().toISOString(),
		})
		.eq("id", 1);
	if (error) {
		console.error("updateGroupSettings:", error);
		return false;
	}
	return true;
}

/** 주어진 회원들 중 그 달(ym) 콕 지원을 이미 소진한 member_id 집합. */
export async function fetchCockSupportUsed(
	memberIds: string[],
	ym: string,
): Promise<Set<string>> {
	if (memberIds.length === 0) return new Set();
	const { data, error } = await supabase
		.from("cock_support_grants")
		.select("member_id")
		.eq("ym", ym)
		.in("member_id", memberIds);
	if (error) {
		console.error("fetchCockSupportUsed:", error);
		return new Set();
	}
	return new Set((data ?? []).map((r) => r.member_id as string));
}

/** 회원의 그 달 콕 지원 소진 기록(멱등 upsert). 이미 있으면 no-op. */
export async function grantCockSupport(
	memberId: string,
	ym: string,
	sessionId: number,
): Promise<void> {
	const { error } = await supabase
		.from("cock_support_grants")
		.upsert(
			{ member_id: memberId, ym, session_id: sessionId },
			{ onConflict: "member_id,ym", ignoreDuplicates: true },
		);
	if (error) console.error("grantCockSupport:", error);
}
