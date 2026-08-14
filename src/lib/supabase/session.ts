import type {
	Gender,
	Player,
	PlayerSkills,
	SessionPlayer,
} from "../../types";
import { isGuestId } from "../player";
import { supabase } from "./client";
import { diffSessionPlayers } from "./sessionSync";
import { rowToSessionPlayer } from "./transformers";
import type {
	CompletedMatchTeamRow,
	MatchRow,
	SessionPlayerRow,
	SessionRow,
	SessionSnapshot,
} from "./types";
import { COMPLETED_MATCH_TEAM_COLUMNS } from "./types";

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
	const [sessionRes, playersRes, matchesRes, completedRes] = await Promise.all([
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
		// 완료 매치는 그룹 이력(재결성 회피)·lastGameType 시드용 — 최소 컬럼만(세션 후반 ~70판의
		// player_snapshot jsonb 전송 방지). (구) pair_history 조회는 그룹 이력 개편(2026-07)으로 제거.
		supabase
			.from("matches")
			.select(COMPLETED_MATCH_TEAM_COLUMNS)
			.eq("session_id", sessionId)
			.eq("status", "completed"),
	]);

	if (!sessionRes.data) return null;

	return {
		session: sessionRes.data as SessionRow,
		players: ((playersRes.data ?? []) as SessionPlayerRow[]).map(
			rowToSessionPlayer,
		),
		matches: (matchesRes.data ?? []) as MatchRow[],
		completedMatches: (completedRes.data ?? []) as unknown as CompletedMatchTeamRow[],
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
		// 회원(members.id)은 member_id 로 링크 — 게스트(guest-*)는 null.
		member_id: isGuestId(p.id) ? null : p.id,
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
		// draft(매치 시작 전 일정 회차)·cancelled(취소 회차)는 매치 로그에 노출하지 않는다.
		// sessions는 일정=세션 통합 테이블이라 status 필터가 없으면 미시작/취소 일정 회차가 새어든다.
		// open은 유지(모집 중 회차도 로그 탭에서 확인 가능).
		.neq("status", "draft")
		.neq("status", "cancelled")
		.order("started_at", { ascending: false })
		.limit(30);
	return (data ?? []) as SessionRow[];
}

/** 매치 로그 요약의 참가자 1명(세션 스냅샷 기준 + 회원 년생). */
export interface SessionParticipant {
	/** session_players.id — 동명이인이 있어 이름은 목록 key 로 쓸 수 없다. */
	id: string;
	name: string;
	gender: Gender;
	game_count: number;
	skills: PlayerSkills;
	/** 이름 뒤 년생 표기용. 게스트·미입력 회원은 null. */
	birthYear: number | null;
}

export async function fetchSessionPlayers(
	sessionId: number,
): Promise<SessionParticipant[]> {
	// 년생은 session_players 스냅샷에 없어 회원 링크로 임베드(게스트는 member_id null → 년생 없음).
	const { data } = await supabase
		.from("session_players")
		.select("id, name, gender, game_count, skills, member:member_id(birth_year)")
		.eq("session_id", sessionId)
		.order("name", { ascending: true });
	// member 임베드(to-one)는 supabase 타입 추론이 약해 unknown 경유 캐스팅.
	const rows = (data ?? []) as unknown as {
		id: string;
		name: string;
		gender: Gender;
		game_count: number;
		skills: PlayerSkills;
		member: { birth_year: number | null } | null;
	}[];
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		gender: r.gender,
		game_count: r.game_count,
		skills: r.skills,
		birthYear: r.member?.birth_year ?? null,
	}));
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
