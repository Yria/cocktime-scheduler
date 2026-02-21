import type {
	ActiveMatch,
	GeneratedTeam,
	ReservedGroup,
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
	removedGroupId: string | null,
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
		.update({ status: "playing", force_mixed: false })
		.in("id", allIds);
	if (pe) {
		console.error("dbAssignMatch players:", pe);
		return false;
	}

	if (removedGroupId) {
		await supabase.from("reserved_groups").delete().eq("id", removedGroupId);
	}

	return true;
}

export async function dbCompleteMatch(
	sessionId: number,
	match: ActiveMatch,
	reservedGroups: ReservedGroup[],
): Promise<{
	updatedPlayers: SessionPlayer[];
	groupUpdates: Array<{ groupId: string; readyIds: string[] }>;
} | null> {
	const allPlayers = [...match.teamA, ...match.teamB];
	const isMixed = match.gameType === "혼복";

	// matches 완료 처리
	const { error: me } = await supabase
		.from("matches")
		.update({ status: "completed", ended_at: new Date().toISOString() })
		.eq("id", match.id);
	if (me) {
		console.error("dbCompleteMatch matches:", me);
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

	// 예약 그룹 소속 여부
	const reservedMemberIds = new Set(reservedGroups.flatMap((g) => g.memberIds));
	const toWaiting = allPlayers.filter((p) => !reservedMemberIds.has(p.id));
	const toReservedBack = allPlayers.filter((p) => reservedMemberIds.has(p.id));

	const now = new Date().toISOString();
	const updatedPlayers: SessionPlayer[] = [];

	// 대기로 복귀
	for (const p of toWaiting) {
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

	// 예약 그룹으로 복귀
	for (const p of toReservedBack) {
		const updates: Record<string, unknown> = {
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

	// reserved_groups ready_ids 업데이트
	const groupUpdates: Array<{ groupId: string; readyIds: string[] }> = [];
	for (const group of reservedGroups) {
		const backIds = toReservedBack
			.filter((p) => group.memberIds.includes(p.id))
			.map((p) => p.id);
		if (backIds.length > 0) {
			const newReadyIds = [...new Set([...group.readyIds, ...backIds])];
			await supabase
				.from("reserved_groups")
				.update({ ready_ids: newReadyIds })
				.eq("id", group.id);
			groupUpdates.push({ groupId: group.id, readyIds: newReadyIds });
		}
	}

	return { updatedPlayers, groupUpdates };
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

export async function dbCreateReservation(
	sessionId: number,
	groupId: string,
	players: SessionPlayer[],
	readyIds: string[],
): Promise<boolean> {
	const { error: re } = await supabase.from("reserved_groups").insert({
		id: groupId,
		session_id: sessionId,
		member_ids: players.map((p) => p.id),
		ready_ids: readyIds,
	});
	if (re) {
		console.error("dbCreateReservation:", re);
		return false;
	}

	const waitingIds = players
		.filter((p) => readyIds.includes(p.id))
		.map((p) => p.id);
	if (waitingIds.length > 0) {
		await supabase
			.from("session_players")
			.update({ status: "reserved" })
			.in("id", waitingIds);
	}

	return true;
}

export async function dbDisbandGroup(group: ReservedGroup): Promise<boolean> {
	if (group.readyIds.length > 0) {
		const now = new Date().toISOString();
		await supabase
			.from("session_players")
			.update({ status: "waiting", wait_since: now })
			.in("id", group.readyIds);
	}

	const { error } = await supabase
		.from("reserved_groups")
		.delete()
		.eq("id", group.id);
	if (error) {
		console.error("dbDisbandGroup:", error);
		return false;
	}
	return true;
}

export async function dbEndSession(sessionId: number): Promise<void> {
	const { error } = await supabase
		.from("sessions")
		.update({ is_active: false, ended_at: new Date().toISOString() })
		.eq("id", sessionId);
	if (error) console.error("dbEndSession:", error);
}
