import type {
	Gender,
	Player,
	PlayerSkills,
	SessionPlayer,
} from "../../types";
import { supabase } from "./client";
import { diffSessionPlayers } from "./sessionSync";
import { rowToSessionPlayer } from "./transformers";
import type {
	MatchRow,
	PairHistoryRow,
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
	cockCheckEnabled: boolean,
): Promise<{ sessionId: number; sessionPlayers: SessionPlayer[] } | null> {
	// 기존 활성 세션 종료(status='closed'까지 — is_active만 끄면 'active'로 남아 일정 목록에 영구 "진행중" 노출).
	await supabase
		.from("sessions")
		.update({ is_active: false, status: "closed", ended_at: new Date().toISOString() })
		.eq("is_active", true);

	const { data: session, error } = await supabase
		.from("sessions")
		.insert({ court_count: courtCount, cock_check_enabled: cockCheckEnabled })
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
	cockCheckEnabled: boolean,
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

	const nowIso = new Date().toISOString();
	const {
		toAdd: playersToAdd,
		toUpsert: playersToUpsert,
		toRemoveIds: playersToRemoveIds,
	} = diffSessionPlayers(existingPlayers, players, singleWomanIds, sessionId, nowIso);

	// DB에 ON DELETE SET NULL이 설정되어 있으므로 매치 참조 체크 불필요
	// 삭제 시 매치의 참조만 NULL이 되고 매치 기록은 보존됨

	// add / upsert / delete 병렬 처리
	const ops: PromiseLike<void>[] = [];
	if (playersToAdd.length > 0) {
		// 신규 추가는 (session_id, player_id) 충돌 시 무시(DO NOTHING) — 두 기기 동시 추가나
		// stale diff로 인한 중복 row 생성을 막는다(기존 행의 상태를 덮어쓰지 않음).
		ops.push(
			supabase
				.from("session_players")
				.upsert(playersToAdd, { onConflict: "session_id,player_id", ignoreDuplicates: true })
				.then((res) => {
					if (res.error)
						console.error("session_players add error:", res.error);
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
		.update({ court_count: courtCount, cock_check_enabled: cockCheckEnabled })
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

// ── 충돌 감지용 서버 상태 조회 ──────────────────────────

export interface ServerSessionSettings {
	courtCount: number;
	playerIds: string[]; // player_id 목록
	playerNames: { playerId: string; name: string; gender: Gender }[];
	singleWomanIds: string[]; // allow_mixed_single=true인 player_id 목록
	cockCheckEnabled: boolean;
}

export async function fetchSessionSettingsForConflictCheck(
	sessionId: number,
): Promise<ServerSessionSettings | null> {
	const [sessionRes, playersRes] = await Promise.all([
		supabase
			.from("sessions")
			.select("court_count, cock_check_enabled")
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

	const sessionData = sessionRes.data as { court_count: number; cock_check_enabled: boolean };
	return {
		courtCount: sessionData.court_count,
		cockCheckEnabled: sessionData.cock_check_enabled ?? true,
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
