import { describe, expect, it } from "vitest";
import {
	type AttendanceEvent,
	actorText,
	cancelFactsText,
	chargeReason,
	lastCancel,
	type SessionAttendanceLog,
} from "./attendanceLog";
import type { BillingGroup, Charge } from "./types";

// 2026-10-18 19:00 KST #395 실제 이력 일부(ops_audit).
const ev = (
	at: string,
	memberId: string,
	from: string | null,
	to: string | null,
	count: number,
	path = "/rpc/join_session",
): AttendanceEvent => ({
	at,
	memberId,
	op: from === null ? "INSERT" : "UPDATE",
	from,
	to,
	count,
	actor: path === "/rpc/admin_cancel_attendance" ? "admin" : memberId,
	path,
});
const log: SessionAttendanceLog = {
	scheduledAt: "2026-10-18T10:00:00Z",
	startedAt: "2026-10-18T10:00:53Z",
	endedAt: "2026-10-18T13:01:15Z",
	capacity: null,
	events: [
		ev("2026-10-17T04:26:03Z", "yujin", null, "confirmed", 1),
		ev("2026-10-17T04:29:41Z", "minji", null, "confirmed", 2),
		ev(
			"2026-10-18T01:58:23Z",
			"minji",
			"confirmed",
			"cancelled",
			1,
			"/rpc/cancel_attendance",
		),
		ev(
			"2026-10-18T03:38:16Z",
			"yujin",
			"confirmed",
			"cancelled",
			0,
			"/rpc/cancel_attendance",
		),
		ev("2026-10-18T06:50:36Z", "yujin", "cancelled", "confirmed", 1),
		ev("2026-10-18T09:00:03Z", "gil", null, "confirmed", 2),
		ev(
			"2026-10-18T09:08:01Z",
			"gil",
			"confirmed",
			"cancelled",
			1,
			"/rpc/cancel_attendance",
		),
		ev("2026-10-18T09:00:09Z", "hyun", null, "confirmed", 2),
		ev(
			"2026-10-18T09:00:11Z",
			"hyun",
			"confirmed",
			"cancelled",
			1,
			"/rpc/admin_cancel_attendance",
		),
	],
};
const group: BillingGroup = {
	id: "g",
	source_key: "court:395",
	kind: "court",
	label: "10/18 #395",
	occurred_on: "2026-10-18",
	session_id: 395,
	basis: { fee_reset_at: "2026-10-19T02:28:07.149Z" },
};
const charge = (p: Partial<Charge>): Charge => ({
	id: "c",
	legacy_id: null,
	group_id: "g",
	member_id: "minji",
	amount: 6000,
	state: "live",
	previous_id: null,
	payer_hint: null,
	issued_at: "2026-10-18T13:01:15Z",
	...p,
});

describe("lastCancel", () => {
	it("당일 10:58 본인 취소 = 당일취소(확정 후 21시간)", () => {
		const f = lastCancel(log, "minji");
		expect(f?.dayCancel).toBe(true);
		expect(cancelFactsText(f!)).toBe(
			"10/18 10:58 본인 취소 · 시작 8시간 2분 전 · 확정 후 21시간 29분",
		);
	});
	it("취소 후 다시 확정했으면 취소 사실 없음", () => {
		expect(lastCancel(log, "yujin")).toBeNull();
	});
	it("확정 1시간 안 철회 = grace", () => {
		const f = lastCancel(log, "gil");
		expect(f?.dayCancel).toBe(false);
		expect(f?.grace).toBe(true);
	});
	it("운영진 취소는 행위자를 밝힌다", () => {
		expect(cancelFactsText(lastCancel(log, "hyun")!)).toContain("운영진 취소");
	});
});

describe("서버 confirmed_at 미러", () => {
	const lp: SessionAttendanceLog = {
		...log,
		events: [
			ev("2026-10-17T04:00:00Z", "a", null, "confirmed", 1),
			ev(
				"2026-10-18T01:00:00Z",
				"a",
				"confirmed",
				"late_pool",
				1,
				"/rpc/set_late_minutes",
			),
			ev(
				"2026-10-18T05:00:00Z",
				"a",
				"late_pool",
				"cancelled",
				0,
				"/rpc/cancel_attendance",
			),
			ev("2026-10-17T04:00:00Z", "b", null, "confirmed", 1),
			ev(
				"2026-10-18T01:00:00Z",
				"b",
				"confirmed",
				"late_pool",
				1,
				"/rpc/set_late_minutes",
			),
			ev(
				"2026-10-18T09:00:00Z",
				"b",
				"late_pool",
				"confirmed",
				1,
				"/rpc/set_late_minutes",
			),
			ev(
				"2026-10-18T09:30:00Z",
				"b",
				"confirmed",
				"cancelled",
				0,
				"/rpc/cancel_attendance",
			),
		],
	};
	it("늦참에서 취소하면 확정 시점이 없어 당일취소 아님", () => {
		const f = lastCancel(lp, "a");
		expect(f?.confirmedAt).toBeNull();
		expect(f?.dayCancel).toBe(false);
	});
	it("늦참→확정 30분 뒤 취소는 grace", () => {
		expect(lastCancel(lp, "b")?.grace).toBe(true);
	});
	it("남의 취소로 대기→확정은 자동승격", () => {
		expect(
			actorText({
				...ev("2026-10-18T09:00:00Z", "c", "waitlisted", "confirmed", 2),
				actor: "x",
				path: "/rpc/cancel_attendance",
			}),
		).toBe("자동승격");
	});
});

describe("chargeReason", () => {
	it("총액 수정으로 대체된 옛 부과는 '취소'가 아니라 재발행", () => {
		const old = charge({ id: "old", state: "cancelled" });
		const next = charge({
			id: "new",
			previous_id: "old",
			issued_at: "2026-10-19T02:28:07.2Z",
		});
		const r = chargeReason(old, [old, next], group, log);
		expect(r.kind).toBe("replaced");
		expect(r.text).toBe("총액 수정으로 재발행됨 · 10/19 11:28");
	});
	it("대체 없는 취소는 부과 취소", () => {
		const c = charge({ state: "cancelled" });
		expect(chargeReason(c, [c], group, log).kind).toBe("cancelled");
	});
	it("live 당일취소는 기록 기반 사실을 단다", () => {
		const c = charge({ basis: { line: { is_day_cancel: true } } });
		const r = chargeReason(c, [c], group, log);
		expect(r.kind).toBe("dayCancel");
	});
	it("서버가 당일취소 아님으로 남겼으면(보드 출전) 기록보다 우선", () => {
		const c = charge({ basis: { line: { is_day_cancel: false } } });
		expect(chargeReason(c, [c], group, log).kind).toBe("other");
	});
	it("기록이 없어도 basis 플래그로 당일취소", () => {
		const c = charge({ basis: { line: { is_day_cancel: true } } });
		expect(chargeReason(c, [c], group, null).kind).toBe("dayCancel");
	});
});
