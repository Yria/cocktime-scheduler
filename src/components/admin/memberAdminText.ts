import type { AdminMemberRow } from "../../lib/supabase/adminMembers";

// 회원 관리(MemberAdminPage·MemberRow) 공용 텍스트 헬퍼 묶음.

export function genderText(g: AdminMemberRow["gender"]): string {
	return g === "M" ? "남" : g === "F" ? "여" : "";
}
