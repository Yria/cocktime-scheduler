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
		// 다른 기기가 먼저 같은 코트를 배정한 경우(부분 유니크 인덱스 충돌)
		if (error.message?.includes("court already assigned")) {
			console.warn("dbAssignMatch: Court already assigned by another client");
			return false;
		}
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

/**
 * 경기 수정 — 진행중 매치의 최종 로스터를 설정(직접 테이블 UPDATE).
 * matches RLS(anon_all)가 직접 쓰기를 허용하므로 RPC 불필요. 동기화는 하지 않고 결과만 반영.
 * 카운트(game_count/mixed_count)는 경기 완료 시 최종 로스터 기준으로 집계되므로 여기서 건드리지 않는다.
 */
export async function dbSetMatchRoster(
	matchId: string,
	teamA: [string, string],
	teamB: [string, string],
	removedIds: string[],
	addedIds: string[],
): Promise<boolean> {
	const { error: mErr } = await supabase
		.from("matches")
		.update({ team_a_p1: teamA[0], team_a_p2: teamA[1], team_b_p1: teamB[0], team_b_p2: teamB[1] })
		.eq("id", matchId);
	if (mErr) {
		console.error("dbSetMatchRoster matches:", mErr);
		return false;
	}
	if (removedIds.length > 0) {
		// 빠진 선수 → 대기(완료 전 이탈이라 game_count 변동 없음), 대기 시작 갱신
		const { error } = await supabase
			.from("session_players")
			.update({ status: "waiting", wait_since: new Date().toISOString() })
			.in("id", removedIds);
		if (error) {
			console.error("dbSetMatchRoster removed:", error);
			return false;
		}
	}
	if (addedIds.length > 0) {
		const { error } = await supabase
			.from("session_players")
			.update({ status: "playing" })
			.in("id", addedIds);
		if (error) {
			console.error("dbSetMatchRoster added:", error);
			return false;
		}
	}
	return true;
}

/** 콕 제출 확인 — session_players.cock_checked=true. 갱신 선수 반환. */
export async function dbSetCockChecked(
	sessionPlayerId: string,
): Promise<SessionPlayer | null> {
	const { data, error } = await supabase
		.from("session_players")
		.update({ cock_checked: true })
		.eq("id", sessionPlayerId)
		.select()
		.single();
	if (error) {
		console.error("dbSetCockChecked:", error);
		return null;
	}
	return rowToSessionPlayer(data as SessionPlayerRow);
}

export async function dbSetPlayerResting(
	sessionPlayerId: string,
	sessionId: number,
	resting: boolean,
): Promise<SessionPlayer | null> {
	// RPC: status 전환 + 복귀 시 deficit 보정(joined_at_match 전진) + wait_since 리셋
	const { data, error } = await supabase.rpc("set_player_resting", {
		p_session_player_id: sessionPlayerId,
		p_session_id: sessionId,
		p_resting: resting,
	});
	if (error) {
		console.error("dbSetPlayerResting:", error);
		return null;
	}
	const rows = (data ?? []) as SessionPlayerRow[];
	return rows[0] ? rowToSessionPlayer(rows[0]) : null;
}

export async function dbEndSession(sessionId: number): Promise<void> {
	const { error } = await supabase
		.from("sessions")
		.update({ is_active: false, ended_at: new Date().toISOString() })
		.eq("id", sessionId);
	if (error) console.error("dbEndSession:", error);
}
