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
	clientId: string | null,
	name: string | null,
): Promise<boolean> {
	// 단일 트랜잭션으로 (편집 락 가드 +) matches INSERT + session_players UPDATE 실행
	const { error } = await supabase.rpc("assign_match", {
		p_match_id: matchId,
		p_session_id: sessionId,
		p_court_id: courtId,
		p_game_type: team.gameType,
		p_team_a_p1: team.teamA[0],
		p_team_a_p2: team.teamA[1],
		p_team_b_p1: team.teamB[0],
		p_team_b_p2: team.teamB[1],
		p_client_id: clientId,
		p_name: name,
	});
	if (error) {
		// 다른 기기가 먼저 같은 코트를 배정한 경우(부분 유니크 인덱스 충돌)
		if (error.message?.includes("court already assigned")) {
			console.warn("dbAssignMatch: Court already assigned by another client");
			return false;
		}
		// 편집 락 미보유(다른 기기가 유효 lease 보유) → 호출자가 서버 권위로 resync
		if (error.message?.includes("not editor")) {
			console.warn("dbAssignMatch: rejected — not the editor");
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
	clientId: string | null,
	name: string | null,
): Promise<{
	updatedPlayers: SessionPlayer[];
} | null> {
	// 단일 트랜잭션으로 (편집 락 가드 +) matches UPDATE + pair_history UPSERT + session_players UPDATE
	const { data, error } = await supabase.rpc("complete_match", {
		p_match_id: match.id,
		p_session_id: sessionId,
		p_game_type: match.gameType,
		p_team_a_p1: match.teamA[0],
		p_team_a_p2: match.teamA[1],
		p_team_b_p1: match.teamB[0],
		p_team_b_p2: match.teamB[1],
		p_client_id: clientId,
		p_name: name,
	});

	if (error) {
		// 이미 다른 클라이언트가 완료 처리한 경우
		if (error.message?.includes("already completed")) {
			console.warn("dbCompleteMatch: Match already completed by another client");
			return null;
		}
		if (error.message?.includes("not editor")) {
			console.warn("dbCompleteMatch: rejected — not the editor");
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
 * 경기 수정 — 진행중 매치의 최종 로스터를 set_match_roster RPC로 원자 설정(마이그레이션 20260622130000).
 * 단일 트랜잭션: matches 로스터 교체 + 빠진 선수→waiting + 들어온 선수→playing + match_state_version++.
 * version++ 가 sessions postgres_changes 신호를 만들어 다른 기기가 catch-up refetch 로 수렴한다(H3 해결).
 * 카운트(game_count/mixed_count)는 경기 완료 시 최종 로스터 기준으로 집계되므로 여기선 건드리지 않는다.
 * 반환: 변경된 선수(removed+added) — 호출자가 broadcast(match_roster_updated)로 즉시 전파. 실패 시 null.
 */
export async function dbSetMatchRoster(
	sessionId: number,
	matchId: string,
	teamA: [string, string],
	teamB: [string, string],
	removedIds: string[],
	addedIds: string[],
	clientId: string | null,
	name: string | null,
): Promise<SessionPlayer[] | null> {
	const { data, error } = await supabase.rpc("set_match_roster", {
		p_match_id: matchId,
		p_session_id: sessionId,
		p_team_a_p1: teamA[0],
		p_team_a_p2: teamA[1],
		p_team_b_p1: teamB[0],
		p_team_b_p2: teamB[1],
		p_removed_ids: removedIds,
		p_added_ids: addedIds,
		p_client_id: clientId,
		p_name: name,
	});
	if (error) {
		if (error.message?.includes("not editor")) {
			console.warn("dbSetMatchRoster: rejected — not the editor");
			return null;
		}
		console.error("dbSetMatchRoster:", error);
		return null;
	}
	return ((data ?? []) as SessionPlayerRow[]).map(rowToSessionPlayer);
}

/**
 * 운영진 실력 편집 — session_players.skills + 연결된 members.skills(member_id 있으면) 동시 갱신.
 * RPC(update_player_skill)가 is_admin 가드. 갱신된 session_player 반환(보드 broadcast 용).
 */
export async function dbUpdatePlayerSkill(
	sessionPlayerId: string,
	skills: PlayerSkills,
): Promise<SessionPlayer | null> {
	const { data, error } = await supabase.rpc("update_player_skill", {
		p_session_player_id: sessionPlayerId,
		p_skills: skills,
	});
	if (error) {
		console.error("dbUpdatePlayerSkill:", error);
		return null;
	}
	return data ? rowToSessionPlayer(data as SessionPlayerRow) : null;
}

/**
 * 콕 제출 확인 = 합류 — session_players.cock_checked=true.
 * RPC가 최초 확인 시 game_count를 그 시점 활성 평균으로 보정(GREATEST)한다(늦참자 공정성).
 * 갱신 선수 반환.
 */
export async function dbSetCockChecked(
	sessionPlayerId: string,
): Promise<SessionPlayer | null> {
	const { data, error } = await supabase.rpc("set_cock_checked", {
		p_session_player_id: sessionPlayerId,
	});
	if (error) {
		console.error("dbSetCockChecked:", error);
		return null;
	}
	const rows = (data ?? []) as SessionPlayerRow[];
	return rows[0] ? rowToSessionPlayer(rows[0]) : null;
}

export async function dbSetPlayerResting(
	sessionPlayerId: string,
	sessionId: number,
	resting: boolean,
): Promise<SessionPlayer | null> {
	// RPC: status 전환 + 복귀 시 평균 판수 보정(game_count=GREATEST(현재, 활성평균)) + wait_since 리셋
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
