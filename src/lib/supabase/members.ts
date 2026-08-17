import { DEFAULT_SKILLS } from "../constants";
import type { Gender, Player, PlayerSkills } from "../../types";
import { skillScoreOf } from "../teamSelection";
import { supabase } from "./client";

// 회원(members) 기반 선수 명단·프로필 데이터 레이어. 구 Google Sheets 로스터를 대체.
// members RLS: 로그인 사용자는 전원 조회(members_select), 쓰기는 본인/운영진(members_update 한 정책이 둘 다 담당).

interface RawMember {
	id: string;
	name: string;
	gender: Gender | null;
	skills: PlayerSkills | null;
	birth_year: number | null;
}

/**
 * 세션 셋업용 선수 명단 — 활성 회원(게스트 제외, 성별 입력됨)을 Player[] 로.
 * 성별 미입력 회원은 편성 알고리즘이 성별을 요구하므로 제외한다.
 */
export async function fetchMembers(): Promise<Player[]> {
	const { data, error } = await supabase
		.from("members")
		.select("id, name, gender, skills, birth_year")
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
			birthYear: m.birth_year,
		}));
}

/**
 * 최근 monthsBack 개월 내에 참석(confirmed/late_pool)한 회원 id 집합.
 * 실력 비교 표본을 "최근 활동 회원"으로 좁히는 데 쓴다(오래 안 나온 회원 제외).
 * attendances_select RLS = authenticated 전체 허용, sessions 는 RLS 미적용이라 조인 가능.
 * 실패하거나 참석 이력이 없으면 빈 Set(호출부에서 "비었으면 미필터"로 폴백).
 */
export async function fetchRecentActiveMemberIds(
	monthsBack = 3,
): Promise<Set<string>> {
	const cutoff = new Date();
	cutoff.setMonth(cutoff.getMonth() - monthsBack);
	const { data, error } = await supabase
		.from("attendances")
		.select("member_id, sessions!inner(scheduled_at)")
		.in("status", ["confirmed", "late_pool"])
		.gte("sessions.scheduled_at", cutoff.toISOString());
	if (error) {
		console.error("fetchRecentActiveMemberIds:", error);
		return new Set();
	}
	return new Set(
		(data ?? []).map((r) => (r as { member_id: string }).member_id),
	);
}

/**
 * 회원별 "가장 최근 참가일"(member_id → 세션 scheduled_at ISO).
 * 최근참가순 정렬 + 주/달 구간 그룹핑에 쓴다. 지난 daysBack 일 내(그리고 이미 지난) 세션만 집계 —
 * 그보다 오래됐거나 이력이 없는 회원은 Map 에 없다("3달 이전 · 기록 없음").
 * confirmed/late_pool 만 실제 참가로 본다. 실패 시 빈 Map.
 */
export async function fetchLastParticipationByMember(
	daysBack = 100,
): Promise<Map<string, string>> {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - daysBack);
	const nowIso = new Date().toISOString();
	const { data, error } = await supabase
		.from("attendances")
		.select("member_id, sessions!inner(scheduled_at)")
		.in("status", ["confirmed", "late_pool"])
		.gte("sessions.scheduled_at", cutoff.toISOString())
		.lte("sessions.scheduled_at", nowIso);
	if (error) {
		console.error("fetchLastParticipationByMember:", error);
		return new Map();
	}
	const map = new Map<string, string>();
	for (const row of (data ?? []) as Array<{
		member_id: string;
		sessions:
			| { scheduled_at: string | null }
			| { scheduled_at: string | null }[]
			| null;
	}>) {
		const s = Array.isArray(row.sessions) ? row.sessions[0] : row.sessions;
		const at = s?.scheduled_at;
		if (!at) continue;
		const prev = map.get(row.member_id);
		// 같은 timestamptz 포맷이라 문자열 비교로 최신 판별 가능.
		if (!prev || at > prev) map.set(row.member_id, at);
	}
	return map;
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
