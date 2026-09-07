import { describe, expect, it } from "vitest";
import {
	groupParticipation,
	type AccountingParticipation,
} from "./participation";
import type { AccountingData, BillingGroup } from "./types";

function fixture(kind: BillingGroup["kind"] = "court") {
	const group: BillingGroup = {
		id: "g",
		source_key: "court:1",
		kind,
		label: "대관",
		occurred_on: "2026-09-06",
		session_id: kind === "court" ? 1 : null,
		basis: {},
	};
	const data: AccountingData = {
		mode: {
			available: true,
			enabled: true,
			paused: false,
			revision: 1,
			epoch: "test",
		},
		groups: [group],
		charges: [],
		due: [],
		positions: [],
		allocations: [],
		refunds: [],
		expenses: [],
		bank: [],
		operations: [],
		active_operations: 0,
		drafts: [],
		members: ["a", "b", "admin", "grace", "day", "board"].map((id, index) => ({
			id,
			name: id === "a" || id === "b" ? "김지훈" : id,
			birth_year: 1990 + index,
			gender: null,
			guest: id === "board",
			active: id !== "b",
		})),
	};
	const context: AccountingParticipation = {
		adminIds: ["admin"],
		flatFee: 6000,
		sessions: [
			{
				id: 1,
				title: "대관",
				status: "closed",
				scheduledAt: "2026-09-06T19:00:00+09:00",
				courtFee: null,
				ruleCourtFee: null,
				courtCount: null,
				hours: null,
				placeName: null,
				attendeeIds: ["a", "b", "admin"],
				boardMemberIds: ["b", "board", "board"],
				attendances: [
					...["a", "b", "admin"].map((memberId) => ({
						memberId,
						status: memberId === "b" ? "late_pool" : "confirmed",
						confirmedAt: null,
						cancelledAt: null,
					})),
					{
						memberId: "grace",
						status: "cancelled",
						confirmedAt: "2026-09-06T10:00:00+09:00",
						cancelledAt: "2026-09-06T10:30:00+09:00",
					},
					{
						memberId: "day",
						status: "cancelled",
						confirmedAt: "2026-09-06T10:00:00+09:00",
						cancelledAt: "2026-09-06T12:00:00+09:00",
					},
				],
			},
		],
	};
	function charge(memberId: string, paid = 0) {
		const id = `charge-${data.charges.length}`;
		data.charges.push({
			id,
			legacy_id: null,
			group_id: group.id,
			member_id: memberId,
			amount: 6000,
			state: "live",
			previous_id: null,
			payer_hint: null,
			issued_at: "2026-09-01",
			basis: { is_day_cancel: memberId === "day" },
		});
		data.due.push({
			id: `due-${id}`,
			charge_id: id,
			due_ym: "2026-09",
			remaining: 6000 - paid,
		});
		if (paid)
			data.allocations.push({
				id: `pay-${id}`,
				bank_tx_id: 1,
				owner_id: memberId,
				charge_id: id,
				due_id: `due-${id}`,
				amount: paid,
				reversed: 0,
				created_at: "2026-09-06",
			});
		return data.charges.at(-1)!;
	}
	return { data, group, context, charge };
}

describe("group participation based on 30ddf07", () => {
	it("separates flat-fee admins and grace withdrawals from real payments, retaining namesakes, late arrivals, day cancellations and board guests", () => {
		const { data, group, context, charge } = fixture();
		charge("a", 6000);
		charge("b", 2000);
		charge("day");
		charge("board");
		const before = JSON.stringify(data);
		const result = groupParticipation(data, group, "2026-09", context);
		expect(result).toMatchObject({
			totalCount: 6,
			chargedCount: 4,
			excludedCount: 2,
			unissuedCount: 0,
			progress: { paidCount: 1, paid: 8000 },
			attendance: {
				attendCount: 3,
				targetDayCancelCount: 1,
				boardAddedCount: 1,
			},
		});
		expect(result.exclusions).toEqual(
			expect.arrayContaining([
				{ label: "운영진", count: 1 },
				{ label: "1시간 내 철회", count: 1 },
			]),
		);
		expect(new Set(result.rows.map((r) => r.memberId)).size).toBe(6);
		expect(result.rows.find((r) => r.memberId === "b")?.label).toBe(
			"부분 납부",
		);
		expect(JSON.stringify(data)).toBe(before);
	});
	it("includes admins in split fees and distinguishes issued, pending and missing targets", () => {
		const { data, group, context, charge } = fixture();
		context.sessions[0].courtFee = 117000;
		charge("a", 6000);
		charge("b");
		charge("day");
		charge("board");
		let result = groupParticipation(data, group, "2026-09", context);
		expect(result.rows.find((r) => r.memberId === "admin")).toMatchObject({
			state: "unissued",
			label: "부과 없음",
		});
		data.drafts = [
			{
				source_key: group.source_key,
				hold_reason: "검토",
				payload: {
					action: "issue",
					reason: "",
					lines: [{ member_id: "admin" }],
				},
			},
		];
		result = groupParticipation(data, group, "2026-09", context);
		expect(result.rows.find((r) => r.memberId === "admin")?.label).toBe(
			"발행 대기",
		);
		context.sessions[0].status = "active";
		expect(
			groupParticipation(data, group, "2026-09", context).rows.find(
				(r) => r.memberId === "admin",
			)?.label,
		).toBe("종료 후 부과");
	});
	it("shows terminal cancellations and waivers without counting a reissued predecessor as excluded", () => {
		const { data, group, charge } = fixture("manual");
		const old = charge("a");
		old.state = "cancelled";
		const replacement = charge("a", 6000);
		replacement.previous_id = old.id;
		const waived = charge("b");
		waived.state = "waived";
		waived.basis = { reason: "이전 재발행 사유" };
		const cancelled = charge("admin");
		cancelled.state = "cancelled";
		const result = groupParticipation(data, group, "2026-09");
		expect(result).toMatchObject({
			totalCount: 3,
			chargedCount: 1,
			excludedCount: 2,
			progress: { paidCount: 1 },
		});
		expect(result.rows.find((r) => r.memberId === "b")).toMatchObject({
			label: "미납 면제",
			reason: "",
		});
	});
	it("explains free sessions while preserving historical issued charges even when current attendance or roles differ", () => {
		const { data, group, context, charge } = fixture();
		context.sessions[0].courtFee = 0;
		charge("admin", 6000);
		const result = groupParticipation(data, group, "2026-09", context);
		expect(result.progress.paidCount).toBe(1);
		expect(result.rows.find((r) => r.memberId === "admin")).toMatchObject({
			state: "charged",
			label: "완납",
		});
		expect(result.rows.find((r) => r.memberId === "a")?.reason).toBe(
			"안 걷는 회차 · 미부과",
		);
	});
	it("does not invent attendance or exemptions when context is missing", () => {
		const { data, group, charge } = fixture();
		charge("a");
		expect(groupParticipation(data, group, "2026-09")).toMatchObject({
			complete: false,
			totalCount: 1,
			chargedCount: 1,
			excludedCount: 0,
			unissuedCount: 0,
		});
	});
});
