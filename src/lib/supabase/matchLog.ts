import type { GameType, Gender, PlayerSkills } from "../../types";
import { supabase } from "./client";
import { matchLogTeams, type LogPlayer } from "./transformers";
import type { MatchRow } from "./types";

export interface MatchLogEntry {
	id: string;
	courtId: number;
	gameType: GameType;
	teamA: LogPlayer[];
	teamB: LogPlayer[];
	startedAt: string;
	endedAt: string | null;
	/** 경기 시작(편성)한 사람 실명. 구 매치/미기록은 null. */
	assignedBy: string | null;
}

export async function fetchMatchLogs(
	sessionId: number,
): Promise<MatchLogEntry[]> {
	const [matchesRes, playersRes] = await Promise.all([
		supabase
			.from("matches")
			.select("*")
			.eq("session_id", sessionId)
			.eq("status", "completed")
			.order("ended_at", { ascending: false }),
		supabase
			.from("session_players")
			.select("id, name, gender, skills, member:member_id(birth_year)")
			.eq("session_id", sessionId),
	]);

	const matches = (matchesRes.data ?? []) as MatchRow[];
	// member 임베드(to-one)는 supabase 타입 추론이 약해 unknown 경유 캐스팅.
	const players = (playersRes.data ?? []) as unknown as {
		id: string;
		name: string;
		gender: Gender;
		skills: PlayerSkills;
		member: { birth_year: number | null } | null;
	}[];
	const playerMap = new Map(
		players.map((p) => [
			p.id,
			{ name: p.name, gender: p.gender, skills: p.skills, birthYear: p.member?.birth_year ?? null },
		]),
	);

	// 로그는 "그 시점 스냅샷"(player_snapshot) 우선 — 선수가 삭제돼도 당시 이름 유지.
	// 스냅샷 없는 구 매치만 현재 선수 맵으로 폴백, 그래도 없으면 "?".
	return matches.map((m) => {
		const { teamA, teamB } = matchLogTeams(m, playerMap);
		return {
			id: m.id,
			courtId: m.court_id,
			gameType: m.game_type,
			teamA,
			teamB,
			startedAt: m.started_at,
			endedAt: m.ended_at,
			assignedBy: m.assigned_by ?? null,
		};
	});
}
