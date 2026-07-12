import { DEFAULT_SKILLS } from "../constants";
import type { Gender, Player, PlayerSkills } from "../../types";
import { skillScoreOf } from "../teamSelection";
import { supabase } from "./client";

// 회원(members) 기반 선수 명단·프로필 데이터 레이어. 구 Google Sheets 로스터를 대체.
// members RLS: 로그인 사용자는 전원 조회(members_select), 쓰기는 본인/운영진(members_self_update·members_admin_write).

interface RawMember {
	id: string;
	name: string;
	gender: Gender | null;
	skills: PlayerSkills | null;
}

/**
 * 세션 셋업용 선수 명단 — 활성 회원(게스트 제외, 성별 입력됨)을 Player[] 로.
 * 성별 미입력 회원은 편성 알고리즘이 성별을 요구하므로 제외한다.
 */
export async function fetchMembers(): Promise<Player[]> {
	const { data, error } = await supabase
		.from("members")
		.select("id, name, gender, skills")
		.eq("is_guest", false)
		.eq("is_active", true)
		.order("name", { ascending: true });
	if (error) {
		console.error("fetchMembers:", error);
		return [];
	}
	return ((data ?? []) as RawMember[])
		.filter((m): m is RawMember & { gender: Gender } => m.gender === "M" || m.gender === "F")
		.map((m) => ({
			id: m.id,
			name: m.name,
			gender: m.gender,
			skills: normalizeSkills(m.skills),
		}));
}

/** skills(신 `{grade}` 또는 구 6종/null)를 항상 신 모델로 정규화. */
export function normalizeSkills(skills: PlayerSkills | null | undefined): PlayerSkills {
	const grade = skillScoreOf(skills ?? undefined);
	return { grade: grade > 0 ? grade : DEFAULT_SKILLS.grade };
}

/**
 * 회원 프로필(성별·실력) 갱신 — members 직접 UPDATE.
 * 권한은 RLS(본인 또는 운영진)가 강제. 실패 시 false.
 *
 * RLS USING 절로 걸러진 UPDATE는 0행이 갱신돼도 error 를 던지지 않으므로(INSERT/WITH CHECK 과 다름),
 * `.select()` 로 실제 갱신 행을 확인해 "권한 없음 = 조용한 실패"를 false 로 잡는다.
 * members_select 는 로그인 사용자 전원 조회 허용이라, 본인/운영진의 정상 갱신은 항상 행을 돌려준다.
 */
export async function updateMemberProfile(
	memberId: string,
	gender: Gender,
	skills: PlayerSkills,
): Promise<boolean> {
	const { data, error } = await supabase
		.from("members")
		.update({ gender, skills, updated_at: new Date().toISOString() })
		.eq("id", memberId)
		.select("id");
	if (error) {
		console.error("updateMemberProfile:", error);
		return false;
	}
	if (!data || data.length === 0) {
		console.error("updateMemberProfile: 갱신된 행 없음(RLS 거부 추정)", memberId);
		return false;
	}
	return true;
}
