import type { Player, SessionPlayer } from "../../types";
import { supabase } from "./client";
import { rowToSessionPlayer } from "./transformers";
import type {
	MatchRow,
	PairHistoryRow,
	ReservedGroupRow,
	SessionPlayerRow,
	SessionRow,
	SessionSnapshot,
} from "./types";

export async function fetchActiveSession(): Promise<SessionRow | null> {
	const { data } = await supabase
		.from("sessions")
		.select("*")
		.eq("is_active", true)
		.order("started_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	return data as SessionRow | null;
}

export async function fetchSessionSnapshot(
	sessionId: number,
): Promise<SessionSnapshot | null> {
	const [sessionRes, playersRes, matchesRes, pairHistRes, reservedRes] =
		await Promise.all([
			supabase.from("sessions").select("*").eq("id", sessionId).single(),
			supabase
				.from("session_players")
				.select("*")
				.eq("session_id", sessionId)
				.order("game_count", { ascending: true })
				.order("wait_since", { ascending: true }),
			supabase
				.from("matches")
				.select("*")
				.eq("session_id", sessionId)
				.eq("status", "playing"),
			supabase.from("pair_history").select("*").eq("session_id", sessionId),
			supabase.from("reserved_groups").select("*").eq("session_id", sessionId),
		]);

	if (!sessionRes.data) return null;

	return {
		session: sessionRes.data as SessionRow,
		players: ((playersRes.data ?? []) as SessionPlayerRow[]).map(
			rowToSessionPlayer,
		),
		matches: (matchesRes.data ?? []) as MatchRow[],
		pairHistory: (pairHistRes.data ?? []) as PairHistoryRow[],
		reservedGroups: (reservedRes.data ?? []) as ReservedGroupRow[],
	};
}

export async function startSession(
	courtCount: number,
	scriptUrl: string | null,
	players: Player[],
	singleWomanIds: string[],
): Promise<{ sessionId: number; sessionPlayers: SessionPlayer[] } | null> {
	// 기존 활성 세션 종료
	await supabase
		.from("sessions")
		.update({ is_active: false, ended_at: new Date().toISOString() })
		.eq("is_active", true);

	const { data: session, error } = await supabase
		.from("sessions")
		.insert({ court_count: courtCount, script_url: scriptUrl })
		.select()
		.single();

	if (error || !session) {
		console.error("startSession:", error);
		return null;
	}

	const singleWomanIdSet = new Set(singleWomanIds);
	const now = new Date().toISOString();
	const rows = players.map((p) => ({
		session_id: session.id,
		player_id: p.id,
		name: p.name,
		gender: p.gender,
		skills: p.skills,
		allow_mixed_single: p.gender === "F" && singleWomanIdSet.has(p.id),
		status: "waiting",
		wait_since: now,
	}));

	const { data: playerRows, error: pe } = await supabase
		.from("session_players")
		.insert(rows)
		.select();

	if (pe || !playerRows) {
		console.error("session_players insert:", pe);
		return null;
	}

	return {
		sessionId: session.id,
		sessionPlayers: (playerRows as SessionPlayerRow[]).map(rowToSessionPlayer),
	};
}

export async function updateSession(
	sessionId: number,
	courtCount: number,
	players: Player[],
	singleWomanIds: string[],
): Promise<boolean> {
	// 1. Update court_count in sessions table
	const { error: sessionErr } = await supabase
		.from("sessions")
		.update({ court_count: courtCount })
		.eq("id", sessionId);

	if (sessionErr) {
		console.error("updateSession error:", sessionErr);
		return false;
	}

	// 2. Fetch existing session_players
	const { data: existingPlayers, error: playersErr } = await supabase
		.from("session_players")
		.select("*")
		.eq("session_id", sessionId);

	if (playersErr || !existingPlayers) {
		console.error("fetch session_players error:", playersErr);
		return false;
	}

	const existingMap = new Map(existingPlayers.map((p) => [p.player_id, p]));
	const newPlayerMap = new Map(players.map((p) => [p.id, p]));
	const singleWomanIdSet = new Set(singleWomanIds);

	const now = new Date().toISOString();

	// find added
	const playersToAdd = players
		.filter((p) => !existingMap.has(p.id))
		.map((p) => ({
			session_id: sessionId,
			player_id: p.id,
			name: p.name,
			gender: p.gender,
			skills: p.skills,
			allow_mixed_single: p.gender === "F" && singleWomanIdSet.has(p.id),
			status: "waiting",
			wait_since: now,
		}));

	if (playersToAdd.length > 0) {
		await supabase.from("session_players").insert(playersToAdd);
	}

	// update existing or remove
	const playersToRemoveIds: string[] = [];

	for (const ep of existingPlayers) {
		const newP = newPlayerMap.get(ep.player_id);
		if (!newP) {
			if (ep.status !== "playing") {
				playersToRemoveIds.push(ep.id);
			}
		} else {
			const allowedMixedSingle =
				newP.gender === "F" && singleWomanIdSet.has(newP.id);
			const changed =
				ep.allow_mixed_single !== allowedMixedSingle ||
				ep.name !== newP.name ||
				ep.gender !== newP.gender ||
				JSON.stringify(ep.skills) !== JSON.stringify(newP.skills);

			if (changed) {
				await supabase
					.from("session_players")
					.update({
						name: newP.name,
						gender: newP.gender,
						skills: newP.skills,
						allow_mixed_single: allowedMixedSingle,
					})
					.eq("id", ep.id);
			}
		}
	}

	if (playersToRemoveIds.length > 0) {
		await supabase
			.from("session_players")
			.delete()
			.in("id", playersToRemoveIds);
	}

	return true;
}
