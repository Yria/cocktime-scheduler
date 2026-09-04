import { supabase } from "./client";

// 대기 포인트 / 우선참여권(티켓) 데이터 레이어. 규칙과 권한은 전부 서버(마이그레이션 20260904000000)에
// 있고 여기서는 RPC 를 감싸기만 한다. 상수(7점·회차당 2명)의 클라 미러는 src/lib/schedule/waitStatus.ts.

/** 원장 한 줄의 종류. earn=대기로 끝나 적립 / spend=티켓 사용 / refund=환원 / penalty=불참 차감 / adjust=운영진 보정. */
export type WaitPointKind = "earn" | "spend" | "refund" | "penalty" | "adjust";

export interface WaitPointStatus {
	balance: number;
	max: number;
	cost: number;
	sessionCap: number;
	hasTicket: boolean;
}

export interface WaitPointEntry {
	id: number;
	sessionId: number | null;
	kind: WaitPointKind;
	/** clamp 후 **실제로 적용된** 증감. 상한에 막혀 0인 행도 온다(detail.capped=true). */
	delta: number;
	balanceAfter: number;
	/** 서버가 남긴 사유. reason 값: waitlisted_at_close / backfill / join / early_cancel / admin_cancel / session_cancelled / day_cancel / noshow. */
	reason: string | null;
	capped: boolean;
	note: string | null;
	createdAt: string;
	/** 그 회차 시각. 회차가 삭제됐으면 원장 detail 의 스냅샷에서 온다. */
	sessionAt: string | null;
	placeName: string | null;
}

/**
 * 이 회차에서 우선참여권을 쓸 수 있는지에 대한 **서버의 답**.
 * 화면이 추측하지 않는다 — 부과 여부·다른 사람의 티켓 사용량은 클라 스토어에 없다.
 */
export interface TicketOptions {
	reason:
		| "ok"
		| "already_spent"
		| "not_open"
		| "not_full"
		| "free_pass"
		| "insufficient"
		| "session_cap";
	balance: number;
	cost: number;
	/** 이 회차에서 이미 티켓으로 확정된 인원. */
	used: number;
	sessionCap: number;
}

/** 내 포인트 잔액·규칙 상수. 실패하면 null(화면은 티켓 UI 를 감춘다 — 없는 것처럼 보이는 쪽이 안전). */
export async function fetchWaitPointStatus(): Promise<WaitPointStatus | null> {
	const { data, error } = await supabase.rpc("wait_points_my_status");
	if (error || !data) {
		if (error) console.error("fetchWaitPointStatus:", error);
		return null;
	}
	const d = data as Record<string, unknown>;
	return {
		balance: Number(d.balance ?? 0),
		max: Number(d.max ?? 7),
		cost: Number(d.cost ?? 7),
		sessionCap: Number(d.session_cap ?? 2),
		hasTicket: Boolean(d.has_ticket),
	};
}

/** 내 포인트 내역(최신순). RLS 로 본인 행만 보이지만 조회 자체는 RPC 가 조인해 회차 라벨까지 준다. */
export async function fetchWaitPointLedger(
	limit = 60,
): Promise<WaitPointEntry[]> {
	const { data, error } = await supabase.rpc("wait_points_my_ledger", {
		p_limit: limit,
	});
	if (error) {
		console.error("fetchWaitPointLedger:", error);
		return [];
	}
	return (data ?? []).map((r: Record<string, unknown>) => {
		const detail = (r.detail ?? {}) as Record<string, unknown>;
		return {
			id: Number(r.id),
			sessionId: r.session_id == null ? null : Number(r.session_id),
			kind: r.kind as WaitPointKind,
			delta: Number(r.delta),
			balanceAfter: Number(r.balance_after),
			reason: typeof detail.reason === "string" ? detail.reason : null,
			capped: detail.capped === true,
			note: typeof detail.note === "string" && detail.note ? detail.note : null,
			createdAt: String(r.created_at),
			sessionAt: r.session_at == null ? null : String(r.session_at),
			placeName: r.place_name == null ? null : String(r.place_name),
		};
	});
}

/** 이 회차에서 티켓을 쓸 수 있는가 — 확인 다이얼로그를 띄우기 직전에만 부른다(호출 절약). */
export async function fetchTicketOptions(
	sessionId: number,
): Promise<TicketOptions | null> {
	const { data, error } = await supabase.rpc("wait_ticket_options", {
		p_session_id: sessionId,
	});
	if (error || !data) {
		if (error) console.error("fetchTicketOptions:", error);
		return null;
	}
	const d = data as Record<string, unknown>;
	return {
		reason: String(d.reason) as TicketOptions["reason"],
		balance: Number(d.balance ?? 0),
		cost: Number(d.cost ?? 7),
		used: Number(d.used ?? 0),
		sessionCap: Number(d.session_cap ?? 2),
	};
}
