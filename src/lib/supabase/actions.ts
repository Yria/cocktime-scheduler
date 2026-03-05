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
	_removedGroupId: string | null,
	usedCandidateId?: string | null,
): Promise<boolean> {
	const allIds = [
		team.teamA[0].id,
		team.teamA[1].id,
		team.teamB[0].id,
		team.teamB[1].id,
	];

	const { error: me } = await supabase.from("matches").insert({
		id: matchId,
		session_id: sessionId,
		court_id: courtId,
		game_type: team.gameType,
		team_a_p1: team.teamA[0].id,
		team_a_p2: team.teamA[1].id,
		team_b_p1: team.teamB[0].id,
		team_b_p2: team.teamB[1].id,
		status: "playing",
	});
	if (me) {
		console.error("dbAssignMatch matches:", me);
		return false;
	}

	const { error: pe } = await supabase
		.from("session_players")
		.update({ status: "playing", force_mixed: false, force_hard_game: false })
		.in("id", allIds);
	if (pe) {
		console.error("dbAssignMatch players:", pe);
		return false;
	}

	// 사용한 팀 후보 삭제
	if (usedCandidateId) {
		await supabase.from("team_candidates").delete().eq("id", usedCandidateId);
	}

	return true;
}

export async function dbReserveMatch(
	sessionId: number,
	matchId: string,
	team: GeneratedTeam,
	courtId: number,
): Promise<boolean> {
	// 동일 코트에 기존 예약이 있는지 확인
	const { data: existing } = await supabase
		.from("matches")
		.select("id")
		.eq("session_id", sessionId)
		.eq("court_id", courtId)
		.eq("status", "reserved")
		.maybeSingle();

	if (existing) {
		console.error("dbReserveMatch: court already has a reservation");
		return false;
	}

	const { error } = await supabase.from("matches").insert({
		id: matchId,
		session_id: sessionId,
		court_id: courtId,
		game_type: team.gameType,
		team_a_p1: team.teamA[0].id,
		team_a_p2: team.teamA[1].id,
		team_b_p1: team.teamB[0].id,
		team_b_p2: team.teamB[1].id,
		status: "reserved",
		started_at: new Date().toISOString(),
	});

	if (error) {
		console.error("dbReserveMatch:", error.code, error.message, error.details, error.hint);
		return false;
	}

	return true;
}

export async function dbCancelReservation(matchId: string): Promise<boolean> {
	const { error } = await supabase
		.from("matches")
		.delete()
		.eq("id", matchId)
		.eq("status", "reserved");

	if (error) {
		console.error("dbCancelReservation:", error);
		return false;
	}

	return true;
}

export async function dbPromoteReservation(
	matchId: string,
	playerIds: string[],
): Promise<boolean> {
	const { error: me } = await supabase
		.from("matches")
		.update({ status: "playing", started_at: new Date().toISOString() })
		.eq("id", matchId)
		.eq("status", "reserved");

	if (me) {
		console.error("dbPromoteReservation match:", me);
		return false;
	}

	const { error: pe } = await supabase
		.from("session_players")
		.update({ status: "playing", force_mixed: false, force_hard_game: false })
		.in("id", playerIds);

	if (pe) {
		console.error("dbPromoteReservation players:", pe);
		return false;
	}

	return true;
}

export async function dbCompleteMatch(
	sessionId: number,
	match: ActiveMatch,
): Promise<{
	updatedPlayers: SessionPlayer[];
	groupUpdates: Array<{ groupId: string; readyIds: string[] }>;
} | null> {
	const allPlayers = [...match.teamA, ...match.teamB];
	const isMixed = match.gameType === "혼복";

	// matches 완료 처리 (동시성 제어: status='playing'인 경우만 업데이트)
	const { data: updated, error: me } = await supabase
		.from("matches")
		.update({ status: "completed", ended_at: new Date().toISOString() })
		.eq("id", match.id)
		.eq("status", "playing") // 이미 완료된 경기는 차단
		.select();

	if (me) {
		console.error("dbCompleteMatch matches:", me);
		return null;
	}

	// 이미 다른 클라이언트가 완료 처리한 경우
	if (!updated || updated.length === 0) {
		console.warn("dbCompleteMatch: Match already completed by another client");
		return null;
	}

	// pair_history upsert
	const pairs: [string, string][] = [
		[match.teamA[0].id, match.teamA[1].id],
		[match.teamB[0].id, match.teamB[1].id],
	];
	for (const [a, b] of pairs) {
		const [pa, pb] = a < b ? [a, b] : [b, a];
		const { data: existing } = await supabase
			.from("pair_history")
			.select("count")
			.eq("session_id", sessionId)
			.eq("player_a", pa)
			.eq("player_b", pb)
			.maybeSingle();

		if (existing) {
			await supabase
				.from("pair_history")
				.update({ count: (existing as { count: number }).count + 1 })
				.eq("session_id", sessionId)
				.eq("player_a", pa)
				.eq("player_b", pb);
		} else {
			await supabase.from("pair_history").insert({
				session_id: sessionId,
				player_a: pa,
				player_b: pb,
				count: 1,
			});
		}
	}

	// 모든 선수를 대기로 복귀
	const now = new Date().toISOString();
	const updatedPlayers: SessionPlayer[] = [];

	for (const p of allPlayers) {
		const updates: Record<string, unknown> = {
			status: "waiting",
			wait_since: now,
			game_count: p.gameCount + 1,
		};
		if (isMixed && p.gender === "M") {
			updates.mixed_count = p.mixedCount + 1;
		}
		const { data } = await supabase
			.from("session_players")
			.update(updates)
			.eq("id", p.id)
			.select()
			.single();
		if (data) updatedPlayers.push(rowToSessionPlayer(data as SessionPlayerRow));
	}

	return { updatedPlayers, groupUpdates: [] };
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

export async function dbToggleResting(
	player: SessionPlayer,
): Promise<SessionPlayer | null> {
	const isResting = player.status === "resting";
	const updates: Record<string, unknown> = isResting
		? { status: "waiting", wait_since: new Date().toISOString() }
		: { status: "resting", wait_since: null };

	const { data, error } = await supabase
		.from("session_players")
		.update(updates)
		.eq("id", player.id)
		.select()
		.single();

	if (error) {
		console.error("dbToggleResting:", error);
		return null;
	}
	return rowToSessionPlayer(data as SessionPlayerRow);
}

export async function dbToggleForceMixed(
	player: SessionPlayer,
): Promise<SessionPlayer | null> {
	const { data, error } = await supabase
		.from("session_players")
		.update({ force_mixed: !player.forceMixed })
		.eq("id", player.id)
		.select()
		.single();

	if (error) {
		console.error("dbToggleForceMixed:", error);
		return null;
	}
	return rowToSessionPlayer(data as SessionPlayerRow);
}

export async function dbToggleForceHardGame(
	player: SessionPlayer,
): Promise<SessionPlayer | null> {
	const { data, error } = await supabase
		.from("session_players")
		.update({ force_hard_game: !player.forceHardGame })
		.eq("id", player.id)
		.select()
		.single();

	if (error) {
		console.error("dbToggleForceHardGame:", error);
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
