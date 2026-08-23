// 발행 대기 부과 초안 — 조건부 자동 발행에서 "사람이 봐야 할 것"만 담긴다.
//
// 부과는 발행된 사실이고(dues_charges), 규칙은 초안을 만드는 도구다. 초안이 평소와 같으면 규칙이
// 바로 발행하고, 이상하면 여기로 남겨 운영진이 [발행] 또는 [폐기]를 결정한다.
// 초안은 회원에게 보이지 않는다(RLS: 운영진만 select).

import { supabase } from "./client";

/** 대기 사유 — 서버 dues_generate_session_court 의 hold_reason 과 1:1. */
export type HoldReason = "amount_out_of_range" | "new_members";

export const HOLD_LABEL: Record<string, string> = {
	amount_out_of_range: "인당 금액이 평소와 크게 달라요",
	new_members: "발행한 뒤에 대상이 된 사람이 있어요",
};

export const HOLD_HINT: Record<string, string> = {
	amount_out_of_range: "총액을 잘못 입력했을 수 있어요. 금액을 확인하고 발행하세요.",
	new_members: "이미 발행된 회차에 추가로 부과할 사람입니다. 실제로 참여했는지 확인하세요.",
};

/** 대기 초안의 판정 근거 — 화면이 숫자를 그대로 보여줘 운영진이 이상함을 눈으로 확인하게 한다. */
export interface HoldDetail {
	per_head?: number;
	flat?: number;
	total?: number | null;
	head?: number;
	already_issued?: number;
}

/** 발행 단위 하나(= draft_group). 화면의 한 카드. */
export interface PendingDraftGroup {
	group: string;
	kind: string;
	label: string;
	chargedOn: string | null;
	sessionId: number | null;
	holdReason: string;
	holdDetail: HoldDetail | null;
	perHead: number;
	head: number;
	total: number;
	members: { memberId: string; amountDue: number; isDayCancel: boolean }[];
}

interface RawDraft {
	draft_group: string;
	kind: string;
	label: string | null;
	charged_on: string | null;
	session_id: number | null;
	member_id: string;
	amount_due: number;
	is_day_cancel: boolean;
	hold_reason: string;
	hold_detail: HoldDetail | null;
}

/** 대기 중인 초안 전체(운영진). 월과 무관 — 대기는 밀리면 안 되는 일이라 항상 전부 보여준다. */
export async function fetchPendingDrafts(): Promise<PendingDraftGroup[]> {
	const { data, error } = await supabase
		.from("dues_charge_drafts")
		.select(
			"draft_group, kind, label, charged_on, session_id, member_id, amount_due, is_day_cancel, hold_reason, hold_detail",
		)
		.order("created_at", { ascending: true });
	if (error) {
		console.error("fetchPendingDrafts:", error);
		return [];
	}
	const byGroup = new Map<string, RawDraft[]>();
	for (const row of (data ?? []) as unknown as RawDraft[]) {
		const arr = byGroup.get(row.draft_group);
		if (arr) arr.push(row);
		else byGroup.set(row.draft_group, [row]);
	}
	return [...byGroup.entries()].map(([group, rows]) => ({
		group,
		kind: rows[0].kind,
		label: rows[0].label ?? group,
		chargedOn: rows[0].charged_on,
		sessionId: rows[0].session_id,
		holdReason: rows[0].hold_reason,
		holdDetail: rows[0].hold_detail,
		perHead: Math.min(...rows.map((r) => r.amount_due)),
		head: rows.length,
		total: rows.reduce((s, r) => s + r.amount_due, 0),
		members: rows.map((r) => ({
			memberId: r.member_id,
			amountDue: r.amount_due,
			isDayCancel: r.is_day_cancel,
		})),
	}));
}

export async function issueDrafts(
	group: string,
): Promise<{ ok: true; issued: number; skipped: number } | { ok: false; error: string }> {
	const { data, error } = await supabase.rpc("dues_issue_drafts", { p_group: group });
	if (error) {
		console.error("issueDrafts:", error);
		return { ok: false, error: error.message };
	}
	const r = data as { issued: number; skipped: number };
	return { ok: true, issued: r.issued, skipped: r.skipped };
}

export async function discardDrafts(
	group: string,
): Promise<{ ok: true; discarded: number } | { ok: false; error: string }> {
	const { data, error } = await supabase.rpc("dues_discard_drafts", { p_group: group });
	if (error) {
		console.error("discardDrafts:", error);
		return { ok: false, error: error.message };
	}
	return { ok: true, discarded: (data as { discarded: number }).discarded };
}
