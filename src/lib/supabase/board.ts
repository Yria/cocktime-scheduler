import type { BoardDraftsPayload } from "../../types/board";
import type { SessionPlayer } from "../../types";
import { supabase } from "./client";
import { rowToSessionPlayer } from "./transformers";
import type { CompletedMatchTeamRow, MatchRow, SessionPlayerRow } from "./types";
import { COMPLETED_MATCH_TEAM_COLUMNS } from "./types";

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
	/** 세션 공유상태 단일 리비전 시계 — Broadcast 힌트(v)와 비교해 갭이면 pull. */
	syncVersion: number;
	courtCount: number;
	matches: MatchRow[];
	/** 세션 전체 선수(권위 스냅샷). resyncFromServer 가 sessionPlayers 를 전량 교체해 놓친 delta 를 치유한다. */
	players: SessionPlayer[];
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
		sync_version: number | null;
		court_count: number | null;
		matches: MatchRow[] | null;
		session_players: SessionPlayerRow[] | null;
		editor_client_id: string | null;
		editor_name: string | null;
		editor_lease_until: string | null;
	};
	return {
		drafts: d.board_drafts ?? { teams: [], reservations: [] },
		version: d.board_drafts_version ?? 0,
		matchStateVersion: d.match_state_version ?? 0,
		syncVersion: d.sync_version ?? 0,
		courtCount: d.court_count ?? 0,
		matches: d.matches ?? [],
		players: (d.session_players ?? []).map(rowToSessionPlayer),
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

/**
 * 완료(completed) 매치의 4인 구성만 권위 재조회한다 — 그룹 이력(재결성 회피) resync용.
 * match_completed broadcast 유실·편집권 이양 후에도 추천이 최신 이력을 보도록 resyncFromServer가 호출.
 */
export async function dbLoadCompletedMatchTeams(
	sessionId: number,
): Promise<CompletedMatchTeamRow[]> {
	const { data, error } = await supabase
		.from("matches")
		.select(COMPLETED_MATCH_TEAM_COLUMNS)
		.eq("session_id", sessionId)
		.eq("status", "completed");
	if (error) {
		console.error("dbLoadCompletedMatchTeams:", error);
		return [];
	}
	return (data ?? []) as unknown as CompletedMatchTeamRow[];
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
