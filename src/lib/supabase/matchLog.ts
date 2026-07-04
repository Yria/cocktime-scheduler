import type { GameType, Gender, PlayerSkills } from "../../types";
import { supabase } from "./client";
import { matchLogTeams } from "./transformers";
import type { MatchRow } from "./types";

export interface MatchLogEntry {
	id: string;
	courtId: number;
	gameType: GameType;
	teamA: { name: string; gender: Gender; skills?: PlayerSkills }[];
	teamB: { name: string; gender: Gender; skills?: PlayerSkills }[];
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
			.select("id, name, gender, skills")
			.eq("session_id", sessionId),
	]);

	const matches = (matchesRes.data ?? []) as MatchRow[];
	const players = (playersRes.data ?? []) as {
		id: string;
		name: string;
		gender: Gender;
		skills: PlayerSkills;
	}[];
	const playerMap = new Map(players.map((p) => [p.id, p]));

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

export async function dbClearSessionLogs(sessionId: number): Promise<boolean> {
	const [{ error: matchErr }, { error: playerErr }, { error: sessionErr }] = await Promise.all([
		supabase
			.from("matches")
			.delete()
			.eq("session_id", sessionId)
			.eq("status", "completed"),
		supabase
			.from("session_players")
			.update({ game_count: 0, mixed_count: 0, joined_at_match: 0 })
			.eq("session_id", sessionId),
		supabase
			.from("sessions")
			.update({ match_assign_count: 0 })
			.eq("id", sessionId),
	]);

	if (matchErr) console.error("dbClearSessionLogs matches:", matchErr);
	if (playerErr) console.error("dbClearSessionLogs players:", playerErr);
	if (sessionErr) console.error("dbClearSessionLogs session:", sessionErr);

	await supabase.from("pair_history").delete().eq("session_id", sessionId);

	return !matchErr && !playerErr && !sessionErr;
}
