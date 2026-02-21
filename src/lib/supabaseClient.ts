import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import type {
	ActiveMatch,
	Court,
	GameType,
	GeneratedTeam,
	Gender,
	PairHistory,
	Player,
	PlayerSkills,
	PlayerStatus,
	ReservedGroup,
	SessionPlayer,
} from "../types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── DB Row 타입 ──────────────────────────────────────────────

export interface SessionRow {
	id: number;
	is_active: boolean;
	court_count: number;
	script_url: string | null;
	started_at: string;
	ended_at: string | null;
}

interface SessionPlayerRow {
	id: string;
	session_id: number;
	player_id: string;
	name: string;
	gender: Gender;
	skills: PlayerSkills;
	allow_mixed_single: boolean;
	status: PlayerStatus;
	force_mixed: boolean;
	game_count: number;
	mixed_count: number;
	wait_since: string | null;
	joined_at: string;
}

interface MatchRow {
	id: string;
	session_id: number;
	court_id: number;
	game_type: GameType;
	team_a_p1: string;
	team_a_p2: string;
	team_b_p1: string;
	team_b_p2: string;
	status: "playing" | "completed";
	started_at: string;
	ended_at: string | null;
}

interface PairHistoryRow {
	session_id: number;
	player_a: string;
	player_b: string;
	count: number;
}

interface ReservedGroupRow {
	id: string;
	session_id: number;
	member_ids: string[];
	ready_ids: string[];
	created_at: string;
}

// ── 변환 헬퍼 ───────────────────────────────────────────────

function rowToSessionPlayer(row: SessionPlayerRow): SessionPlayer {
	return {
		id: row.id,
		playerId: row.player_id,
		name: row.name,
		gender: row.gender,
		skills: row.skills,
		allowMixedSingle: row.allow_mixed_single,
		status: row.status,
		forceMixed: row.force_mixed,
		gameCount: row.game_count,
		mixedCount: row.mixed_count,
		waitSince: row.wait_since,
	};
}

// ── 세션 조회 / 시작 ─────────────────────────────────────────

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

export interface SessionSnapshot {
	session: SessionRow;
	players: SessionPlayer[];
	matches: MatchRow[];
	pairHistory: PairHistoryRow[];
	reservedGroups: ReservedGroupRow[];
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
			supabase
				.from("pair_history")
				.select("*")
				.eq("session_id", sessionId),
			supabase
				.from("reserved_groups")
				.select("*")
				.eq("session_id", sessionId),
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

// ── 클라이언트 상태 ──────────────────────────────────────────

export interface ClientSessionState {
	courts: Court[];
	waiting: SessionPlayer[];
	resting: SessionPlayer[];
	reservedGroups: ReservedGroup[];
	pairHistory: PairHistory;
}

export function snapshotToClientState(
	snapshot: SessionSnapshot,
): ClientSessionState {
	const courtCount = snapshot.session.court_count;
	const playerMap = new Map(snapshot.players.map((p) => [p.id, p]));

	// Courts
	const courts: Court[] = Array.from({ length: courtCount }, (_, i) => ({
		id: i + 1,
		match: null,
	}));

	for (const m of snapshot.matches) {
		const court = courts.find((c) => c.id === m.court_id);
		if (!court) continue;
		const p1 = playerMap.get(m.team_a_p1);
		const p2 = playerMap.get(m.team_a_p2);
		const p3 = playerMap.get(m.team_b_p1);
		const p4 = playerMap.get(m.team_b_p2);
		if (!p1 || !p2 || !p3 || !p4) continue;
		court.match = {
			id: m.id,
			courtId: m.court_id,
			gameType: m.game_type,
			teamA: [p1, p2],
			teamB: [p3, p4],
			startedAt: m.started_at,
		};
	}

	// Reserved groups
	const reservedGroups: ReservedGroup[] = snapshot.reservedGroups.map((g) => ({
		id: g.id,
		memberIds: g.member_ids,
		readyIds: g.ready_ids,
		players: g.member_ids
			.map((id) => playerMap.get(id))
			.filter((p): p is SessionPlayer => !!p),
	}));

	// Waiting / Resting by status
	const waiting = snapshot.players.filter((p) => p.status === "waiting");
	const resting = snapshot.players.filter((p) => p.status === "resting");

	// PairHistory
	const pairHistory = buildPairHistory(snapshot.pairHistory);

	return { courts, waiting, resting, reservedGroups, pairHistory };
}

export function buildPairHistory(
	rows: PairHistoryRow[],
): PairHistory {
	const history: PairHistory = {};
	for (const row of rows) {
		if (!history[row.player_a]) history[row.player_a] = new Set();
		if (!history[row.player_b]) history[row.player_b] = new Set();
		for (let i = 0; i < row.count; i++) {
			history[row.player_a].add(row.player_b);
			history[row.player_b].add(row.player_a);
		}
	}
	return history;
}

// ── Broadcast 이벤트 타입 ────────────────────────────────────

export type BroadcastPayload =
	| {
			event: "match_started";
			payload: {
				matchId: string;
				courtId: number;
				gameType: GameType;
				teamA: [SessionPlayer, SessionPlayer];
				teamB: [SessionPlayer, SessionPlayer];
				removedGroupId: string | null;
			};
	  }
	| {
			event: "match_completed";
			payload: {
				matchId: string;
				courtId: number;
				gameType: GameType;
				teamA: [SessionPlayer, SessionPlayer];
				teamB: [SessionPlayer, SessionPlayer];
				updatedPlayers: SessionPlayer[];
				groupUpdates: Array<{ groupId: string; readyIds: string[] }>;
			};
	  }
	| {
			event: "player_status_changed";
			payload: { player: SessionPlayer };
	  }
	| {
			event: "player_force_mixed_changed";
			payload: { player: SessionPlayer };
	  }
	| {
			event: "group_reserved";
			payload: { group: ReservedGroup; reservedPlayerIds: string[] };
	  }
	| {
			event: "group_disbanded";
			payload: { groupId: string; readyPlayers: SessionPlayer[] };
	  }
	| { event: "session_ended" };

// ── Broadcast 채널 ───────────────────────────────────────────

export function createBroadcastChannel(sessionId: number): RealtimeChannel {
	return supabase.channel(`session-bc:${sessionId}`, {
		config: { broadcast: { self: false } },
	});
}

export function sendBroadcast(
	channel: RealtimeChannel,
	ev: BroadcastPayload,
): void {
	channel.send({ type: "broadcast", event: ev.event, payload: (ev as { payload: unknown }).payload });
}

// ── 이벤트별 DB 함수 ─────────────────────────────────────────

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
		await supabase
			.from("reserved_groups")
			.delete()
			.eq("id", removedGroupId);
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

	// pair_history upsert (경기 완료 시 teamA, teamB 쌍 기록)
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
			await supabase
				.from("pair_history")
				.insert({ session_id: sessionId, player_a: pa, player_b: pb, count: 1 });
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

	// 예약 그룹으로 복귀 (game_count만 증가, status=reserved 유지)
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

	// 대기 중인 구성원 status=reserved 업데이트
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
