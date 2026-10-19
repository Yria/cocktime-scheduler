import { GRACE_MS, kstDateKey } from "./sessionSettle";
import type { BillingGroup, Charge } from "./types";

/** 회차 참석 변경 이력 한 줄(ops_audit attendance). count = 변경 직후 확정 인원. */
export interface AttendanceEvent {
	at: string;
	memberId: string;
	op: string;
	from: string | null;
	to: string | null;
	count: number;
	actor: string | null;
	path: string | null;
}

export interface SessionAttendanceLog {
	scheduledAt: string | null;
	startedAt: string | null;
	endedAt: string | null;
	capacity: number | null;
	events: AttendanceEvent[];
}

const STATUS_LABEL: Record<string, string> = {
	confirmed: "확정",
	late_pool: "늦참",
	waitlisted: "대기",
	cancelled: "취소",
};

export function statusText(status: string | null): string {
	return status ? (STATUS_LABEL[status] ?? status) : "삭제";
}

/** "신청→확정", "확정→취소", "확정→삭제". */
export function transitionText(e: AttendanceEvent): string {
	return e.op === "INSERT"
		? `${statusText(e.to)}(신청)`
		: `${statusText(e.from)}→${statusText(e.to)}`;
}

/** 상태가 실제로 바뀐 이력만(늦참 시간 수정 같은 같은-상태 UPDATE 는 뺀다). */
export function memberTrail(
	log: SessionAttendanceLog,
	memberId: string,
): AttendanceEvent[] {
	return log.events.filter((e) => e.memberId === memberId && e.from !== e.to);
}

/** 이 변경을 누가 했나. 본인 RPC 가 아니면 운영진 처리로 본다. */
export function actorText(e: AttendanceEvent): string {
	// 대기→확정은 남의 취소·정원 변경 요청 안에서 일어난다(actor = 그 요청자).
	if (e.from === "waitlisted" && e.to === "confirmed" && e.actor !== e.memberId)
		return "자동승격";
	if (e.path === "/rpc/admin_cancel_attendance") return "운영진";
	if (e.path === "/rpc/add_guest_attendance") return "초대자";
	if (e.path === "/rpc/cancel_guest_attendance") return "초대자";
	if (e.actor && e.actor === e.memberId) return "본인";
	return e.actor ? "운영진" : "시스템";
}

export function isCancelEvent(e: AttendanceEvent): boolean {
	return e.to === "cancelled" || (e.op === "DELETE" && e.from !== "cancelled");
}

/** "8시간 2분" 형태. 음수면 절댓값. */
export function spanText(ms: number): string {
	const min = Math.round(Math.abs(ms) / 60000);
	const d = Math.floor(min / 1440);
	const h = Math.floor((min % 1440) / 60);
	const m = min % 60;
	if (d) return h ? `${d}일 ${h}시간` : `${d}일`;
	if (h) return m ? `${h}시간 ${m}분` : `${h}시간`;
	return `${m}분`;
}

/** KST "10/18 10:58". */
export function kstStamp(iso: string): string {
	const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export interface CancelFacts {
	event: AttendanceEvent;
	/** 취소 직전 확정 시점(서버 confirmed_at 과 같은 값 — late_pool 에서 취소면 null). */
	confirmedAt: string | null;
	/** 시작 기준 몇 ms 전(음수면 시작 후 취소). */
	beforeStartMs: number | null;
	/** 서버 dues_is_day_cancel_chargeable 판정과 같은 술어. */
	dayCancel: boolean;
	/** 당일이지만 확정 후 1시간 안 철회(부과 대상 아님). */
	grace: boolean;
}

/** 회원의 마지막 취소 사실. 그 뒤 다시 확정됐으면 null(최종 상태가 취소가 아님). */
export function lastCancel(
	log: SessionAttendanceLog,
	memberId: string,
): CancelFacts | null {
	const trail = memberTrail(log, memberId);
	const last = trail.at(-1);
	if (!last || !isCancelEvent(last)) return null;
	// 서버 attendances.confirmed_at 미러: 가장 최근 →confirmed 순간만 기록되고,
	// late_pool·대기로 옮기면 NULL 이 된다(set_late_minutes). 그래서 직전 전이만 본다.
	const prev = trail.at(-2);
	const confirmedAt = prev?.to === "confirmed" ? prev.at : null;
	const start = log.scheduledAt;
	const sameDay = !!start && kstDateKey(last.at) === kstDateKey(start);
	const held =
		confirmedAt !== null
			? new Date(last.at).getTime() - new Date(confirmedAt).getTime()
			: null;
	return {
		event: last,
		confirmedAt,
		beforeStartMs: start
			? new Date(start).getTime() - new Date(last.at).getTime()
			: null,
		dayCancel: sameDay && held !== null && held >= GRACE_MS,
		grace: sameDay && held !== null && held < GRACE_MS,
	};
}

/** 부과 행의 상태 사유. kind 는 화면 분기용, text 는 한 줄 설명. */
export type ChargeReason =
	| { kind: "replaced"; text: string; by: Charge }
	| { kind: "cancelled"; text: string }
	| { kind: "waived"; text: string }
	| { kind: "dayCancel"; text: string; facts: CancelFacts | null }
	| { kind: "other"; text: string; facts: CancelFacts | null }
	| { kind: "plain"; text: string };

/** 이 부과를 대체한 새 부과(같은 사람·previous_id 사슬). 총액 수정/부과 변경이 남기는 흔적. */
export function replacementOf(
	charge: Charge,
	charges: Charge[],
): Charge | undefined {
	return charges.find((c) => c.previous_id === charge.id);
}

/** 서버가 부과 근거에 남긴 당일취소 플래그. 없으면 null(기록으로 추정). */
function dayCancelFlag(c: Charge): boolean | null {
	const line = c.basis?.line;
	const v =
		typeof line === "object" && line !== null && "is_day_cancel" in line
			? (line as { is_day_cancel?: unknown }).is_day_cancel
			: c.basis?.is_day_cancel;
	return typeof v === "boolean" ? v : null;
}

/**
 * 부과 명단 한 줄의 '왜'. 핵심은 '취소' 가 세 가지를 뭉뚱그리고 있었다는 것:
 *  ① 재발행으로 대체(총액 수정·부과 변경 — 같은 사람에게 새 부과가 살아 있음)
 *  ② 운영진이 부과 자체를 취소
 *  ③ (live 인데) 참석을 당일취소한 사람 — 부과 상태가 아니라 참석 상태의 취소
 */
export function chargeReason(
	charge: Charge,
	charges: Charge[],
	group: BillingGroup,
	log: SessionAttendanceLog | null,
): ChargeReason {
	if (charge.state === "cancelled") {
		const by = replacementOf(charge, charges);
		if (by) {
			const reset = group.basis?.fee_reset_at;
			const why =
				typeof reset === "string" &&
				Math.abs(new Date(reset).getTime() - new Date(by.issued_at).getTime()) <
					60_000
					? "총액 수정"
					: "부과 변경";
			return {
				kind: "replaced",
				text: `${why}으로 재발행됨 · ${kstStamp(by.issued_at)}`,
				by,
			};
		}
		return { kind: "cancelled", text: "부과 취소" };
	}
	if (charge.state === "waived") return { kind: "waived", text: "면제" };
	const facts = log ? lastCancel(log, charge.member_id) : null;
	// 서버 판정이 우선 — 당일취소했어도 보드에 올라 뛰었으면 서버가 false 로 남긴다.
	if (dayCancelFlag(charge) ?? facts?.dayCancel)
		return { kind: "dayCancel", text: "당일취소", facts };
	if (facts) return { kind: "other", text: "참석 취소", facts };
	return { kind: "plain", text: "" };
}

/** "10/18 10:58 본인 취소 · 시작 8시간 2분 전 · 확정 후 21시간" */
export function cancelFactsText(f: CancelFacts): string {
	const parts = [`${kstStamp(f.event.at)} ${actorText(f.event)} 취소`];
	if (f.beforeStartMs !== null)
		parts.push(
			f.beforeStartMs >= 0
				? `시작 ${spanText(f.beforeStartMs)} 전`
				: `시작 ${spanText(f.beforeStartMs)} 후`,
		);
	if (f.confirmedAt)
		parts.push(
			`확정 후 ${spanText(new Date(f.event.at).getTime() - new Date(f.confirmedAt).getTime())}`,
		);
	if (f.grace) parts.push("1시간 내 철회");
	return parts.join(" · ");
}
