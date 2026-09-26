/**
 * matchAvoid.ts
 *
 * 같이 매칭하지 않기 묶음 DB 접근. (마이그레이션 20260926000000)
 * - 목록(match_avoid_groups): 지정된 주인 계정만 읽고 쓴다(RLS is_match_avoid_owner). 다른 계정은 빈 목록.
 * - 선발 규칙(board_selection_rules): 활성 운영진 기기가 이번 회차 사람끼리의 묶음만 받는다(자동편성용).
 */
import { supabase } from "./client";

export interface BoardSelectionRules {
	/** 이 계정이 목록 주인인지 — 주인만 설정 화면을 연다. */
	owner: boolean;
	/** 이번 회차에 2명 이상 있는 묶음의 회원 id들. */
	groups: string[][];
}

/** 보드 편집 기기용 선발 규칙. 실패하면 null. */
export async function fetchBoardSelectionRules(sessionId: number): Promise<BoardSelectionRules | null> {
	const { data, error } = await supabase.rpc("board_selection_rules", { p_session_id: sessionId });
	if (error || !data) {
		if (error) console.error("fetchBoardSelectionRules:", error);
		return null;
	}
	const rules = data as { owner?: boolean; groups?: string[][] };
	return { owner: rules.owner === true, groups: Array.isArray(rules.groups) ? rules.groups : [] };
}

export interface MatchAvoidGroup {
	id: string;
	/** members.id 2~4명. 묶음 안 두 사람은 자동편성·추천에서 같은 경기에 넣지 않는다. */
	memberIds: string[];
	createdAt: string;
}

/** 묶음 목록과 표시용 회원 이름(현재 회차에 없는 회원 포함). 실패하면 null. */
export async function fetchMatchAvoidGroups(): Promise<{ groups: MatchAvoidGroup[]; names: Map<string, string> } | null> {
	const { data, error } = await supabase
		.from("match_avoid_groups")
		.select("id, member_ids, created_at")
		.order("created_at", { ascending: true });
	if (error || !data) {
		if (error) console.error("fetchMatchAvoidGroups:", error);
		return null;
	}
	const groups = data.map(row => ({ id: row.id as string, memberIds: row.member_ids as string[], createdAt: row.created_at as string }));
	const ids = [...new Set(groups.flatMap(group => group.memberIds))];
	const names = new Map<string, string>();
	if (ids.length) {
		const { data: members, error: nameError } = await supabase.from("members").select("id, name").in("id", ids);
		if (nameError) console.error("fetchMatchAvoidGroups names:", nameError);
		for (const member of members ?? []) names.set(member.id as string, member.name as string);
	}
	return { groups, names };
}

/** 묶음 추가. 같은 사람 구성이 이미 있으면(unique, 순서 무관) "duplicate". */
export async function createMatchAvoidGroup(memberIds: string[]): Promise<MatchAvoidGroup | "duplicate" | null> {
	const { data, error } = await supabase
		.from("match_avoid_groups")
		.insert({ member_ids: memberIds })
		.select("id, member_ids, created_at")
		.single();
	if (error?.code === "23505") return "duplicate";
	if (error || !data) {
		if (error) console.error("createMatchAvoidGroup:", error);
		return null;
	}
	return { id: data.id as string, memberIds: data.member_ids as string[], createdAt: data.created_at as string };
}

/** 묶음 삭제. 성공 시 true. */
export async function deleteMatchAvoidGroup(id: string): Promise<boolean> {
	const { error } = await supabase.from("match_avoid_groups").delete().eq("id", id);
	if (error) {
		console.error("deleteMatchAvoidGroup:", error);
		return false;
	}
	return true;
}
