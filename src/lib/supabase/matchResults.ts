import type { Gender, SessionPlayer } from "../../types";
import { supabase } from "./client";
import { rowToSessionPlayer } from "./transformers";
import type { SessionPlayerRow } from "./types";

// 경기 결과(승패) · ELO 데이터 레이어. 규칙·권한·점수 계산은 전부 서버(마이그레이션
// 20261109000000_match_results_elo.sql)에 있고 여기서는 RPC 를 감싸 camelCase 로 옮기기만 한다.
// 계약 원문: docs/MATCH_RESULT_ELO_SPEC.md §2(함수) · §3.2(래퍼).
// 실제 편(teamA): 보드는 4명 그룹을 뽑을 뿐이라 코트의 편이 보드 A/B 와 다를 수 있다(20261110000000).
// 결과를 넣는 쪽이 A편 두 사람의 session_players.id 를 함께 보내고, winner 는 그 A편 기준이다. null = 보드 나눔.
// 클라 점수 미러는 src/lib/rating/elo.ts — 여기서 점수를 계산하지 않는다.

export type MatchWinner = "A" | "B";

/** rating_my_summary() — 행이 없으면 서버가 seed 로 계산해 games=0, seeded=true 로 준다. */
export interface MyRating {
	rating: number;
	games: number;
	wins: number;
	losses: number;
	/** 아직 반영 경기가 없어 seed 값을 보여주는 중 */
	seeded: boolean;
}

/** 실제 A편 = session_players.id 두 개. null = 보드 나눔 그대로. */
export type MatchTeamA = readonly [string, string] | null;

export interface MatchSidePlayer {
	/** session_players.id — 보충 때 실제 편(teamA)을 다시 보낼 때 쓴다. 로스터 칸이 비었으면 null */
	spId: string | null;
	memberId: string | null;
	name: string;
	gender: Gender | null;
}

/** match_my_history() 항목 — §2-6 필드 그대로 camelCase. teamA/teamB/mySide 는 실제 편(결과 없으면 보드 나눔). */
export interface MyMatchRecord {
	matchId: string;
	sessionId: number;
	endedAt: string;
	gameType: string | null;
	courtId: number | null;
	mySide: MatchWinner;
	teamA: MatchSidePlayer[];
	teamB: MatchSidePlayer[];
	winner: MatchWinner | null;
	rated: boolean;
	delta: number | null;
	ratingAfter: number | null;
	/** 결과 없음 ∧ 7일 이내 — [결과 입력] 노출 기준(서버 판정) */
	canSubmit: boolean;
}

/** match_results 행(서버가 돌려주는 result json). 서버 표기 차이(snake/camel)를 흡수한다. */
export interface MatchResult {
	matchId: string;
	winner: MatchWinner;
	rated: boolean;
	recordedBy: string | null;
	recordedAt: string | null;
	/** 호출자(나)의 이 경기 점수 변동. 내가 안 뛰었거나 미반영이면 null — 결과 단계(showOutcome)에 바로 쓴다 */
	delta: number | null;
	/** 반영 후 내 점수(rating_events.after). 미반영이면 null */
	ratingAfter: number | null;
	/** 반영 후 내 반영 경기 수(member_ratings.games). 행이 없으면 null */
	games: number | null;
}

type Obj = Record<string, unknown>;

const pick = (o: Obj, ...keys: string[]) => {
	for (const k of keys) if (o[k] !== undefined) return o[k];
	return undefined;
};
const numOrNull = (v: unknown) => (v == null || v === "" ? null : Number(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const teamAParam = (teamA: MatchTeamA) => (teamA ? [teamA[0], teamA[1]] : null);
const asWinner = (v: unknown): MatchWinner | null =>
	v === "A" || v === "B" ? v : null;

/** RPC 가 jsonb 를 문자열로 돌려주는 경우도 받는다(PostgREST 설정에 따라). */
function asObj(data: unknown): Obj | null {
	if (data == null) return null;
	if (typeof data === "string") {
		try {
			return JSON.parse(data) as Obj;
		} catch {
			return null;
		}
	}
	return typeof data === "object" ? (data as Obj) : null;
}

export function parseMatchResult(raw: unknown): MatchResult | null {
	const o = asObj(raw);
	if (!o) return null;
	const winner = asWinner(o.winner);
	if (!winner) return null;
	return {
		matchId: String(pick(o, "match_id", "matchId") ?? ""),
		winner,
		rated: pick(o, "rated") === true,
		recordedBy: strOrNull(pick(o, "recorded_by", "recordedBy")),
		recordedAt: strOrNull(pick(o, "recorded_at", "recordedAt")),
		delta: numOrNull(o.delta),
		ratingAfter: numOrNull(pick(o, "ratingAfter", "rating_after")),
		games: numOrNull(o.games),
	};
}

function parseSide(raw: unknown): MatchSidePlayer[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((p: Obj) => ({
		spId: strOrNull(pick(p, "spId", "sp_id")),
		memberId: strOrNull(pick(p, "memberId", "member_id")),
		name: String(p.name ?? "?"),
		gender: p.gender === "M" || p.gender === "F" ? p.gender : null,
	}));
}

export function parseMyMatchRecord(o: Obj): MyMatchRecord {
	return {
		matchId: String(pick(o, "matchId", "match_id")),
		sessionId: Number(pick(o, "sessionId", "session_id")),
		endedAt: String(pick(o, "endedAt", "ended_at") ?? ""),
		gameType: strOrNull(pick(o, "gameType", "game_type")),
		courtId: numOrNull(pick(o, "courtId", "court_id")),
		mySide: asWinner(pick(o, "mySide", "my_side")) ?? "A",
		teamA: parseSide(pick(o, "teamA", "team_a")),
		teamB: parseSide(pick(o, "teamB", "team_b")),
		winner: asWinner(o.winner),
		rated: o.rated === true,
		delta: numOrNull(o.delta),
		ratingAfter: numOrNull(pick(o, "ratingAfter", "rating_after")),
		canSubmit: pick(o, "canSubmit", "can_submit") === true,
	};
}

// ── 회원 완료 ─────────────────────────────────────────────

export type MemberCompleteResult =
	| {
			ok: true;
			/** 완료로 waiting 에 돌아온 선수들(complete_match 반환과 같은 변환) */
			updatedPlayers: SessionPlayer[];
			/** p_winner 를 같이 보냈으면 기록된 결과, 아니면 null */
			result: MatchResult | null;
			courtId: number;
	  }
	| {
			ok: false;
			/** already_completed = 동시 탭 등으로 이미 완료 → "이미 완료된 경기예요" 안내 후 결과만 제출 경로
			 *  not_in_match = 내가 그 경기 4명이 아님(로스터가 바뀐 직후 등)
			 *  error = 그 밖(네트워크·세션 비활성) */
			reason: "already_completed" | "not_in_match" | "error";
			message: string;
	  };

/**
 * 회원이 자기 코트의 [경기완료] — member_complete_match.
 * 실패를 null 하나로 뭉개지 않는다: 보드가 '이미 완료'와 '권한 없음'을 다르게 안내해야 한다.
 */
export async function memberCompleteMatch(
	matchId: string,
	sessionId: number,
	winner: MatchWinner | null = null,
	teamA: MatchTeamA = null,
): Promise<MemberCompleteResult> {
	const { data, error } = await supabase.rpc("member_complete_match", {
		p_match_id: matchId,
		p_session_id: sessionId,
		p_winner: winner,
		// winner 없이 편만 보내지 않는다(서버도 무시한다).
		p_team_a: winner ? teamAParam(teamA) : null,
	});
	if (error) {
		const msg = error.message ?? "";
		if (msg.includes("already completed")) {
			return { ok: false, reason: "already_completed", message: msg };
		}
		if (error.code === "42501" || msg.includes("not in match")) {
			return { ok: false, reason: "not_in_match", message: msg };
		}
		console.error("memberCompleteMatch:", error);
		return { ok: false, reason: "error", message: msg };
	}
	const o = asObj(data) ?? {};
	const rows = (
		Array.isArray(o.players) ? o.players : []
	) as SessionPlayerRow[];
	return {
		ok: true,
		updatedPlayers: rows.map(rowToSessionPlayer),
		result: parseMatchResult(o.result),
		courtId: Number(pick(o, "courtId", "court_id") ?? 0),
	};
}

// ── 결과 제출 · 정정 ──────────────────────────────────────

export interface SubmitMatchResultResponse {
	/** recorded = 이번에 기록됨 / exists = 누가 먼저 입력해 기존 결과(첫 입력이 확정) */
	status: "recorded" | "exists";
	result: MatchResult | null;
}

/**
 * 완료된 경기의 승패 입력(4명 중 누구나·운영진, 7일 이내). 실패 시 throw — 화면이 토스트로 사유를 보여준다.
 * 이미 결과가 있으면 서버는 바꾸지 않고 기존 결과를 status=exists 로 준다.
 */
export async function submitMatchResult(
	matchId: string,
	winner: MatchWinner,
	teamA: MatchTeamA = null,
): Promise<SubmitMatchResultResponse> {
	const { data, error } = await supabase.rpc("match_result_submit", {
		p_match_id: matchId,
		p_winner: winner,
		p_team_a: teamAParam(teamA),
	});
	if (error) {
		console.error("submitMatchResult:", error);
		throw error;
	}
	const o = asObj(data) ?? {};
	return {
		status: o.status === "exists" ? "exists" : "recorded",
		// 서버는 _match_result_json 을 최상위에 펼치고 status 를 덧붙인다. result 키 아래 와도 받는다.
		result: parseMatchResult(o.result ?? o),
	};
}

/**
 * 운영진 정정. winner=null 이면 결과 삭제. 서버가 전체 재계산(ratings_recompute_all)까지 한다.
 * teamA=null 이면 기록된 편 그대로(결과가 없던 경기면 보드 나눔).
 */
export async function adminSetMatchResult(
	matchId: string,
	winner: MatchWinner | null,
	teamA: MatchTeamA = null,
): Promise<MatchResult | null> {
	const { data, error } = await supabase.rpc("match_result_admin_set", {
		p_match_id: matchId,
		p_winner: winner,
		p_team_a: teamAParam(teamA),
	});
	if (error) {
		console.error("adminSetMatchResult:", error);
		throw error;
	}
	const o = asObj(data);
	return o ? parseMatchResult(o.result ?? o) : null;
}

// ── 내 점수 · 내 기록 ─────────────────────────────────────

/** 실패하면 null(화면은 등급 표시를 감춘다 — 틀린 등급보다 없는 쪽이 낫다). */
export async function fetchMyRating(): Promise<MyRating | null> {
	const { data, error } = await supabase.rpc("rating_my_summary");
	const o = asObj(data);
	if (error || !o) {
		if (error) console.error("fetchMyRating:", error);
		return null;
	}
	return {
		rating: Number(o.rating),
		games: Number(o.games ?? 0),
		wins: Number(o.wins ?? 0),
		losses: Number(o.losses ?? 0),
		seeded: o.seeded === true,
	};
}

/** 내가 뛴 완료 경기, 최신순. before = 이전 페이지 마지막 endedAt(커서). 실패 시 throw. */
export async function fetchMyMatchHistory(
	limit = 30,
	before: string | null = null,
): Promise<MyMatchRecord[]> {
	const { data, error } = await supabase.rpc("match_my_history", {
		p_limit: limit,
		p_before: before,
	});
	if (error) {
		console.error("fetchMyMatchHistory:", error);
		throw error;
	}
	const raw = typeof data === "string" ? JSON.parse(data) : data;
	return (Array.isArray(raw) ? raw : []).map((r: Obj) => parseMyMatchRecord(r));
}

// ── 회원 완료 후 보드 편성 1회 커밋 ────────────────────────

/** 서버가 한 번에 받는 후보 수 상한(member_commit_completion_drafts). */
export const COMPLETION_CANDIDATES_MAX = 6;

export type CommitCompletionDraftsResult =
	/** chosen = 저장된 후보의 인덱스(앞에서부터 처음 통과한 것). */
	| { status: "ok"; version: number; chosen: number }
	/** board_drafts_version 이 바뀜 — grant 는 소모되지 않았다. 서버 drafts 재적재 후 재계산해 다시 보낸다. */
	| { status: "stale"; version: number }
	/** 모든 후보가 서버 편성 규칙에 걸림 — 저장 없음, grant 는 소모(검사는 grant 당 1회). 사유는 알려 주지 않는다(코트는 운영진이 채운다). */
	| { status: "rejected" }
	/** 권한 만료(3분)·이미 사용·네트워크 등. 재시도해도 안 되므로 편성 없이 끝낸다. */
	| { status: "error"; message: string };

/**
 * 회원 편성 후보들을 우선순위 순으로 보낸다. 서버가 앞에서부터 검사해 처음 통과한 후보 하나만 저장한다.
 * '같이 매칭하지 않기' 규칙은 회원 기기에 없으므로(숨은 설정) 규칙 판정은 서버만 한다.
 */
export async function commitCompletionDrafts(
	sessionId: number,
	matchId: string,
	baseVersion: number,
	payloads: readonly unknown[],
): Promise<CommitCompletionDraftsResult> {
	if (payloads.length < 1 || payloads.length > COMPLETION_CANDIDATES_MAX) {
		return { status: "error", message: `invalid candidate count: ${payloads.length}` };
	}
	const { data, error } = await supabase.rpc(
		"member_commit_completion_drafts",
		{
			p_session_id: sessionId,
			p_match_id: matchId,
			p_base_version: baseVersion,
			p_payloads: payloads,
		},
	);
	if (error) {
		console.error("commitCompletionDrafts:", error);
		return { status: "error", message: error.message ?? "" };
	}
	const o = asObj(data) ?? {};
	const version = Number(o.version);
	const chosen = Number(o.chosen);
	if (o.status === "ok" && Number.isInteger(chosen) && chosen >= 0 && chosen < payloads.length) return { status: "ok", version, chosen };
	if (o.status === "stale") return { status: "stale", version };
	if (o.status === "rejected") return { status: "rejected" };
	return {
		status: "error",
		message: `unexpected response: ${JSON.stringify(o)}`,
	};
}
