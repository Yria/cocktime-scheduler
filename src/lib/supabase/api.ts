import type {
	GameType,
	Gender,
	Player,
	PlayerSkills,
	SessionPlayer,
} from "../../types";
import type { BoardDraftsPayload } from "../../types/board";
import { supabase } from "./client";
import { diffSessionPlayers } from "./sessionSync";
import { matchLogTeams, rowToSessionPlayer } from "./transformers";
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
	cockCheckEnabled: boolean,
): Promise<{ sessionId: number; sessionPlayers: SessionPlayer[] } | null> {
	// 기존 활성 세션 종료
	await supabase
		.from("sessions")
		.update({ is_active: false, ended_at: new Date().toISOString() })
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

	// 로그는 "그 시점 스냅샷"(player_snapshot) 우선 — 선수가 삭제돼도 당시 이름 유지.
	// 스냅샷 없는 구 매치만 현재 선수 맵으로 폴백, 그래도 없으면 "?".
	return matches.map((m) => {
		const { teamA, teamB } = matchLogTeams(m, playerMap);
		return {
			id: m.id,
			courtId: m.court_id,
			gameType: m.game_type,
			teamA,
			teamB,
			startedAt: m.started_at,
			endedAt: m.ended_at,
		};
	});
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

// ── 보드 drafts 저장 ──────────────────────────────────

/**
 * board_drafts + matches + 버전 + 편집 락을 단일 트랜잭션 스냅샷으로 반환한다(load_session_state RPC).
 * 재구독 catch-up / board_save_drafts 충돌 복구에서 두 권위(팀 편성·코트 배정)를 "같은 시점"으로 수렴.
 */
export interface SessionStateSnapshot {
	drafts: BoardDraftsPayload;
	version: number;
	/** 코트 배정(matches) 동기화 단조 버전. */
	matchStateVersion: number;
	courtCount: number;
	matches: MatchRow[];
	editorClientId: string | null;
	editorName: string | null;
	editorLeaseUntil: string | null;
}

export async function dbLoadSessionState(
	sessionId: number,
): Promise<SessionStateSnapshot | null> {
	const { data, error } = await supabase.rpc("load_session_state", {
		p_session_id: sessionId,
	});
	if (error || data == null) {
		if (error) console.error("dbLoadSessionState:", error);
		return null;
	}
	const d = data as {
		board_drafts: BoardDraftsPayload | null;
		board_drafts_version: number | null;
		match_state_version: number | null;
		court_count: number | null;
		matches: MatchRow[] | null;
		editor_client_id: string | null;
		editor_name: string | null;
		editor_lease_until: string | null;
	};
	return {
		drafts: d.board_drafts ?? { teams: [], reservations: [] },
		version: d.board_drafts_version ?? 0,
		matchStateVersion: d.match_state_version ?? 0,
		courtCount: d.court_count ?? 0,
		matches: d.matches ?? [],
		editorClientId: d.editor_client_id ?? null,
		editorName: d.editor_name ?? null,
		editorLeaseUntil: d.editor_lease_until ?? null,
	};
}

/**
 * 진행중(playing) 매치를 권위 재조회한다 — match_state_version 갭 감지(catch-up) 시 코트 배정 상태를
 * DB 권위로 수렴시키는 가벼운 단일 SELECT. broadcast 유실/역전과 무관하게 정합 보장.
 */
export async function dbLoadMatches(sessionId: number): Promise<MatchRow[]> {
	const { data, error } = await supabase
		.from("matches")
		.select("*")
		.eq("session_id", sessionId)
		.eq("status", "playing");
	if (error) {
		console.error("dbLoadMatches:", error);
		return [];
	}
	return (data ?? []) as MatchRow[];
}

/** board_claim_editor/handoff RPC 결과(보유자 1행). 0행이면 null(획득/양도 실패). */
export interface EditorLockResult {
	clientId: string;
	name: string | null;
	leaseUntil: string | null;
}

function firstLockRow(data: unknown): EditorLockResult | null {
	const rows = data as
		| Array<{ o_client_id: string | null; o_name: string | null; o_lease_until: string | null }>
		| null;
	const row = rows?.[0];
	if (!row?.o_client_id) return null;
	return { clientId: row.o_client_id, name: row.o_name, leaseUntil: row.o_lease_until };
}

/**
 * board_drafts 낙관적 버전 CAS 쓰기(+self-claim). 성공 시 새 version, 충돌(0행)이면 null.
 * (Phase 3: last-writer-wins 손실·조용한 실패 차단 — 원인3/5)
 */
export async function dbBoardSaveDrafts(
	sessionId: number,
	clientId: string,
	name: string,
	payload: BoardDraftsPayload,
	baseVersion: number,
	leaseSeconds = 20,
): Promise<number | null> {
	const { data, error } = await supabase.rpc("board_save_drafts", {
		p_session_id: sessionId,
		p_client_id: clientId,
		p_name: name,
		p_payload: payload,
		p_base_version: baseVersion,
		p_lease_seconds: leaseSeconds,
	});
	if (error) {
		console.error("dbBoardSaveDrafts:", error);
		return null;
	}
	// 0행 → null(충돌/락 점유 실패). bigint가 number 또는 string("1")로 올 수 있어 Number로 정규화.
	if (data == null) return null;
	const v = Number(data);
	return Number.isFinite(v) ? v : null;
}

/** 편집권 획득/연장(heartbeat) CAS. 성공 시 보유자 정보, 실패(다른 사람이 유효 lease)면 null. (Phase 4 — 원인2) */
export async function dbBoardClaimEditor(
	sessionId: number,
	clientId: string,
	name: string,
	leaseSeconds = 20,
): Promise<EditorLockResult | null> {
	const { data, error } = await supabase.rpc("board_claim_editor", {
		p_session_id: sessionId,
		p_client_id: clientId,
		p_name: name,
		p_lease_seconds: leaseSeconds,
	});
	if (error) {
		console.error("dbBoardClaimEditor:", error);
		return null;
	}
	return firstLockRow(data);
}

/** 편집권 강제 탈취(명시 "가져오기"). lease 조건 없이 호출자를 편집자로 덮어쓴다. 성공 시 보유자(=나), 실패면 null. */
export async function dbBoardTakeoverEditor(
	sessionId: number,
	clientId: string,
	name: string,
	leaseSeconds = 20,
): Promise<EditorLockResult | null> {
	const { data, error } = await supabase.rpc("board_takeover_editor", {
		p_session_id: sessionId,
		p_client_id: clientId,
		p_name: name,
		p_lease_seconds: leaseSeconds,
	});
	if (error) {
		console.error("dbBoardTakeoverEditor:", error);
		return null;
	}
	return firstLockRow(data);
}

/** 편집권 명시 양도(보유자 본인만). 성공 시 새 보유자, 실패면 null. (Phase 4) */
export async function dbBoardHandoffEditor(
	sessionId: number,
	fromClientId: string,
	toClientId: string,
	toName: string,
	leaseSeconds = 20,
): Promise<EditorLockResult | null> {
	const { data, error } = await supabase.rpc("board_handoff_editor", {
		p_session_id: sessionId,
		p_from_client_id: fromClientId,
		p_to_client_id: toClientId,
		p_to_name: toName,
		p_lease_seconds: leaseSeconds,
	});
	if (error) {
		console.error("dbBoardHandoffEditor:", error);
		return null;
	}
	return firstLockRow(data);
}

/** 편집권 해제(보유자 본인). crash 시는 lease 만료가 백업. (Phase 4) */
export async function dbBoardReleaseEditor(
	sessionId: number,
	clientId: string,
): Promise<void> {
	const { error } = await supabase.rpc("board_release_editor", {
		p_session_id: sessionId,
		p_client_id: clientId,
	});
	if (error) console.error("dbBoardReleaseEditor:", error);
}

