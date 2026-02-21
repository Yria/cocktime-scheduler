import type { GameType, Gender, Player, SessionPlayer } from "../../types";
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

export interface MatchLogEntry {
	id: string;
	courtId: number;
	gameType: GameType;
	teamA: { name: string; gender: Gender }[];
	teamB: { name: string; gender: Gender }[];
	startedAt: string;
	endedAt: string | null;
}

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
	// 1. Fetch existing session_players
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

	// 추가할 플레이어
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

	// 변경된 플레이어만 upsert, 삭제할 플레이어 id 수집
	const playersToUpsert: object[] = [];
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
				playersToUpsert.push({
					...ep,
					name: newP.name,
					gender: newP.gender,
					skills: newP.skills,
					allow_mixed_single: allowedMixedSingle,
				});
			}
		}
	}

	// add / upsert / delete 병렬 처리
	const ops: PromiseLike<void>[] = [];
	if (playersToAdd.length > 0) {
		ops.push(
			supabase
				.from("session_players")
				.insert(playersToAdd)
				.then((res) => {
					if (res.error)
						console.error("session_players insert error:", res.error);
				}),
		);
	}
	if (playersToUpsert.length > 0) {
		ops.push(
			supabase
				.from("session_players")
				.upsert(playersToUpsert)
				.then((res) => {
					if (res.error)
						console.error("session_players upsert error:", res.error);
				}),
		);
	}
	if (playersToRemoveIds.length > 0) {
		ops.push(
			supabase
				.from("session_players")
				.delete()
				.in("id", playersToRemoveIds)
				.then((res) => {
					if (res.error)
						console.error("session_players delete error:", res.error);
				}),
		);
	}
	await Promise.all(ops);

	// 2. Update sessions table LAST — this triggers postgres_changes on other clients.
	// All session_players changes must be complete before this fires so that
	// other clients fetch a consistent snapshot when they receive the event.
	const { error: sessionErr } = await supabase
		.from("sessions")
		.update({ court_count: courtCount })
		.eq("id", sessionId);

	if (sessionErr) {
		console.error("updateSession error:", sessionErr);
		return false;
	}

	return true;
}

export async function fetchAllSessions(): Promise<SessionRow[]> {
	const { data } = await supabase
		.from("sessions")
		.select("*")
		.order("started_at", { ascending: false })
		.limit(30);
	return (data ?? []) as SessionRow[];
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
			.select("id, name, gender")
			.eq("session_id", sessionId),
	]);

	const matches = (matchesRes.data ?? []) as MatchRow[];
	const players = (playersRes.data ?? []) as {
		id: string;
		name: string;
		gender: Gender;
	}[];
	const playerMap = new Map(players.map((p) => [p.id, p]));

	return matches.map((m) => ({
		id: m.id,
		courtId: m.court_id,
		gameType: m.game_type,
		teamA: [m.team_a_p1, m.team_a_p2].map(
			(id) => playerMap.get(id) ?? { name: "?", gender: "M" as Gender },
		),
		teamB: [m.team_b_p1, m.team_b_p2].map(
			(id) => playerMap.get(id) ?? { name: "?", gender: "M" as Gender },
		),
		startedAt: m.started_at,
		endedAt: m.ended_at,
	}));
}

export async function fetchSessionPlayers(
	sessionId: number,
): Promise<{ name: string; gender: Gender; game_count: number }[]> {
	const { data } = await supabase
		.from("session_players")
		.select("name, gender, game_count")
		.eq("session_id", sessionId)
		.order("name", { ascending: true });
	return (data ?? []) as { name: string; gender: Gender; game_count: number }[];
}

export async function dbClearSessionLogs(sessionId: number): Promise<boolean> {
	const [{ error: matchErr }, { error: playerErr }] = await Promise.all([
		supabase
			.from("matches")
			.delete()
			.eq("session_id", sessionId)
			.eq("status", "completed"),
		supabase
			.from("session_players")
			.update({ game_count: 0, mixed_count: 0 })
			.eq("session_id", sessionId),
	]);

	if (matchErr) console.error("dbClearSessionLogs matches:", matchErr);
	if (playerErr) console.error("dbClearSessionLogs players:", playerErr);

	await supabase.from("pair_history").delete().eq("session_id", sessionId);

	return !matchErr && !playerErr;
}
