import type {
	GameType,
	Gender,
	Player,
	PlayerSkills,
	SessionPlayer,
} from "../../types";
import type { BoardDraftsPayload } from "../../types/board";
import { supabase } from "./client";
import { rowToSessionPlayer } from "./transformers";
import type {
	MatchRow,
	PairHistoryRow,
	SessionPlayerRow,
	SessionRow,
	SessionSnapshot,
} from "./types";

export interface MatchLogEntry {
	id: string;
	courtId: number;
	gameType: GameType;
	teamA: { name: string; gender: Gender; skills?: PlayerSkills }[];
	teamB: { name: string; gender: Gender; skills?: PlayerSkills }[];
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
	const [sessionRes, playersRes, matchesRes, pairHistRes] =
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
		]);

	if (!sessionRes.data) return null;

	return {
		session: sessionRes.data as SessionRow,
		players: ((playersRes.data ?? []) as SessionPlayerRow[]).map(
			rowToSessionPlayer,
		),
		matches: (matchesRes.data ?? []) as MatchRow[],
		pairHistory: (pairHistRes.data ?? []) as PairHistoryRow[],
	};
}

export async function startSession(
	courtCount: number,
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
		.insert({ court_count: courtCount })
		.select()
		.single();

	if (error || !session) {
		console.error("startSession:", error);
		return null;
	}

	const singleWomanIdSet = new Set(singleWomanIds);
	const nowIso = new Date().toISOString();
	const rows = players.map((p) => ({
		session_id: session.id,
		player_id: p.id,
		name: p.name,
		gender: p.gender,
		skills: p.skills,
		allow_mixed_single: p.gender === "F" && singleWomanIdSet.has(p.id),
		status: "waiting",
		wait_since: nowIso,
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

	const nowIso = new Date().toISOString();

	// 추가할 플레이어 (waiting 상태로 삽입)
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
			wait_since: nowIso,
			joined_at_match: 0,
		}));

	// 변경된 플레이어만 upsert, 삭제할 플레이어 id 수집
	const playersToUpsert: object[] = [];
	const playersToRemoveIds: string[] = [];

	for (const ep of existingPlayers) {
		const newP = newPlayerMap.get(ep.player_id);
		if (!newP) {
			// 새 목록에 없는 플레이어 → 삭제 대상
			// 단, status가 playing이 아니어야 함
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

	// DB에 ON DELETE SET NULL이 설정되어 있으므로 매치 참조 체크 불필요
	// 삭제 시 매치의 참조만 NULL이 되고 매치 기록은 보존됨

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
					if (res.error) {
						console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
						console.error("❌ session_players 삭제 실패!");
						console.error("에러 코드:", res.error.code);
						console.error("에러 메시지:", res.error.message);
						console.error("에러 상세:", res.error.details);
						console.error("에러 힌트:", res.error.hint);
						console.error("삭제 시도한 ID 수:", playersToRemoveIds.length);
						console.error("삭제 시도한 ID 샘플:", playersToRemoveIds.slice(0, 3));
						console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
					}
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
): Promise<{ name: string; gender: Gender; game_count: number; skills: PlayerSkills }[]> {
	const { data } = await supabase
		.from("session_players")
		.select("name, gender, game_count, skills")
		.eq("session_id", sessionId)
		.order("name", { ascending: true });
	return (data ?? []) as { name: string; gender: Gender; game_count: number; skills: PlayerSkills }[];
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

// ── 충돌 감지용 서버 상태 조회 ──────────────────────────

export interface ServerSessionSettings {
	courtCount: number;
	playerIds: string[]; // player_id 목록
	playerNames: { playerId: string; name: string; gender: Gender }[];
	singleWomanIds: string[]; // allow_mixed_single=true인 player_id 목록
}

export async function fetchSessionSettingsForConflictCheck(
	sessionId: number,
): Promise<ServerSessionSettings | null> {
	const [sessionRes, playersRes] = await Promise.all([
		supabase
			.from("sessions")
			.select("court_count")
			.eq("id", sessionId)
			.single(),
		supabase
			.from("session_players")
			.select("player_id, name, gender, allow_mixed_single")
			.eq("session_id", sessionId),
	]);

	if (!sessionRes.data || !playersRes.data) return null;

	const players = playersRes.data as {
		player_id: string;
		name: string;
		gender: Gender;
		allow_mixed_single: boolean;
	}[];

	return {
		courtCount: (sessionRes.data as { court_count: number }).court_count,
		playerIds: players.map((p) => p.player_id),
		playerNames: players.map((p) => ({
			playerId: p.player_id,
			name: p.name,
			gender: p.gender,
		})),
		singleWomanIds: players
			.filter((p) => p.allow_mixed_single)
			.map((p) => p.player_id),
	};
}

export interface ServerPlayerData {
	gender: Gender;
	skills: PlayerSkills;
}

export async function fetchSessionPlayerForConflictCheck(
	sessionPlayerId: string,
): Promise<ServerPlayerData | null> {
	const { data, error } = await supabase
		.from("session_players")
		.select("gender, skills")
		.eq("id", sessionPlayerId)
		.single();

	if (error || !data) return null;

	const row = data as { gender: Gender; skills: PlayerSkills };
	return { gender: row.gender, skills: row.skills };
}

// ── 보드 drafts 저장 ──────────────────────────────────

/**
 * 보드 "팀 구성중"(drafts)/예약 멤버십을 세션에 저장한다(위치 제외).
 * sessions.board_drafts JSONB 한 컬럼을 통째로 교체.
 */
export async function dbSaveBoardDrafts(
	sessionId: number,
	payload: BoardDraftsPayload,
): Promise<boolean> {
	const { error } = await supabase
		.from("sessions")
		.update({ board_drafts: payload })
		.eq("id", sessionId);

	if (error) {
		console.error("dbSaveBoardDrafts:", error);
		return false;
	}
	return true;
}

