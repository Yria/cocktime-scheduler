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
	// teamA/B는 [string, string] ID 참조
	const allIds = [...team.teamA, ...team.teamB];

	const { error: me } = await supabase.from("matches").insert({
		id: matchId,
		session_id: sessionId,
		court_id: courtId,
		game_type: team.gameType,
		team_a_p1: team.teamA[0],
		team_a_p2: team.teamA[1],
		team_b_p1: team.teamB[0],
		team_b_p2: team.teamB[1],
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

	return true;
}

export async function dbCompleteMatch(
	sessionId: number,
	match: ActiveMatch,
): Promise<{
	updatedPlayers: SessionPlayer[];
} | null> {
	const allPlayerIds = [...match.teamA, ...match.teamB];
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
		[match.teamA[0], match.teamA[1]],
		[match.teamB[0], match.teamB[1]],
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

	// 현재 선수 데이터 조회 (gameCount, mixedCount 등 최신 값 필요)
	const { data: currentRows } = await supabase
		.from("session_players")
		.select("*")
		.in("id", allPlayerIds);

	const currentMap = new Map(
		((currentRows ?? []) as SessionPlayerRow[]).map((r) => [r.id, r]),
	);

	// 모든 선수를 대기로 복귀
	const now = new Date().toISOString();
	const updatedPlayers: SessionPlayer[] = [];

	for (const pid of allPlayerIds) {
		const current = currentMap.get(pid);
		if (!current) continue;

		const updates: Record<string, unknown> = {
			status: "waiting",
			wait_since: now,
			game_count: current.game_count + 1,
		};
		if (isMixed && current.gender === "M") {
			updates.mixed_count = current.mixed_count + 1;
		}
		const { data } = await supabase
			.from("session_players")
			.update(updates)
			.eq("id", pid)
			.select()
			.single();
		if (data) updatedPlayers.push(rowToSessionPlayer(data as SessionPlayerRow));
	}

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
