import type {
	ActiveMatch,
	Gender,
	GeneratedTeam,
	PlayerSkills,
	SessionPlayer,
} from "../../types";
import { supabase } from "./client";
import { rowToSessionPlayer } from "./transformers";
import type { SessionPlayerRow } from "./types";

export async function dbAssignMatch(
	sessionId: number,
	matchId: string,
	team: GeneratedTeam,
	courtId: number,
): Promise<boolean> {
	// 단일 트랜잭션으로 matches INSERT + session_players UPDATE 실행
	const { error } = await supabase.rpc("assign_match", {
		p_match_id: matchId,
		p_session_id: sessionId,
		p_court_id: courtId,
		p_game_type: team.gameType,
		p_team_a_p1: team.teamA[0],
		p_team_a_p2: team.teamA[1],
		p_team_b_p1: team.teamB[0],
		p_team_b_p2: team.teamB[1],
	});
	if (error) {
		console.error("dbAssignMatch:", error);
		return false;
	}
	return true;
}

export async function dbCompleteMatch(
	sessionId: number,
	match: ActiveMatch,
): Promise<{
	updatedPlayers: SessionPlayer[];
} | null> {
	// 단일 트랜잭션으로 matches UPDATE + pair_history UPSERT + session_players UPDATE
	const { data, error } = await supabase.rpc("complete_match", {
		p_match_id: match.id,
		p_session_id: sessionId,
		p_game_type: match.gameType,
		p_team_a_p1: match.teamA[0],
		p_team_a_p2: match.teamA[1],
		p_team_b_p1: match.teamB[0],
		p_team_b_p2: match.teamB[1],
	});

	if (error) {
		// 이미 다른 클라이언트가 완료 처리한 경우
		if (error.message?.includes("already completed")) {
			console.warn("dbCompleteMatch: Match already completed by another client");
			return null;
		}
		console.error("dbCompleteMatch:", error);
		return null;
	}

	const updatedPlayers = ((data ?? []) as SessionPlayerRow[]).map(rowToSessionPlayer);
	return { updatedPlayers };
}

export async function dbUpdateSessionPlayer(
	sessionPlayerId: string,
	gender: Gender,
	skills: PlayerSkills,
): Promise<SessionPlayer | null> {
	const { data, error } = await supabase
		.from("session_players")
		.update({ gender, skills })
		.eq("id", sessionPlayerId)
		.select()
		.single();

	if (error) {
		console.error("dbUpdateSessionPlayer:", error);
		return null;
	}
	return rowToSessionPlayer(data as SessionPlayerRow);
}

export async function dbEndSession(sessionId: number): Promise<void> {
	const { error } = await supabase
		.from("sessions")
		.update({ is_active: false, ended_at: new Date().toISOString() })
		.eq("id", sessionId);
	if (error) console.error("dbEndSession:", error);
}
