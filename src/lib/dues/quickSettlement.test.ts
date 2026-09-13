import { describe, expect, it } from "vitest";
import {
	payableTargets,
	previouslyPaidReceiptTargets,
	suggestedReceiptDue,
	suggestedReceiptPayer,
} from "./quickSettlement";
import type { AccountingData } from "./types";

const fixture = () =>
	({
		bank: [
			{
				id: 1,
				direction: "in",
				name: "박민준0906",
				amount: 6500,
				occurred_at: "2026-09-07T00:00:00Z",
			},
		],
		members: [{ id: "a", name: "박민준" }],
		groups: [{ id: "g", occurred_on: "2026-09-06" }],
		charges: [{ id: "c", group_id: "g", member_id: "a", state: "live" }],
		due: [{ id: "d", charge_id: "c", due_ym: "2026-09", remaining: 6500 }],
	}) as AccountingData;

describe("receipt suggestions before explicit confirmation", () => {
	it("includes upcoming attendance across months while requiring a unique dated match for a suggestion", () => {
		const data = fixture();
		data.due = [];
		data.prepayments = [
			{
				session_id: 10,
				member_id: "a",
				amount: 6500,
				due_ym: "2026-09",
				label: "오전 대관",
				occurred_on: "2026-09-06",
			},
		];
		expect(suggestedReceiptDue(data, 1, "a")).toEqual({
			"prepay:10:a": "6500",
		});
		data.prepayments.push({
			...data.prepayments[0],
			session_id: 11,
			label: "오후 대관",
		});
		expect(suggestedReceiptDue(data, 1, "a")).toEqual({});
		data.prepayments[1].due_ym = "2026-10";
		expect(payableTargets(data, "a", "2026-09")).toHaveLength(2);
		expect(payableTargets(data, "b", "2026-09")).toEqual([]);
	});
	it("never offers an issued, cancelled or waived court charge as a new prepayment", () => {
		const data = fixture();
		data.groups[0].session_id = 10;
		data.prepayments = [
			{
				session_id: 10,
				member_id: "a",
				amount: 6500,
				due_ym: "2026-09",
				label: "대관",
				occurred_on: "2026-09-06",
			},
		];
		for (const state of ["live", "cancelled", "waived"] as const) {
			data.charges[0].state = state;
			expect(
				payableTargets(data, "a", "2026-09").some((d) => d.prepayment),
			).toBe(false);
		}
	});
	it("uses a single cleaned bank-name match and refuses namesakes or an empty description", () => {
		const data = fixture();
		expect(suggestedReceiptPayer(data, 1)).toBe("a");
		data.members.push({ ...data.members[0], id: "b", active: false });
		expect(suggestedReceiptPayer(data, 1)).toBe("");
		data.bank[0].name = null;
		expect(suggestedReceiptPayer(data, 1)).toBe("");
	});
	it("suggests only the same month, amount, owner and explicit event date, without mutation", () => {
		const data = fixture();
		const before = JSON.stringify(data);
		expect(suggestedReceiptDue(data, 1, "a")).toEqual({ d: "6500" });
		expect(suggestedReceiptDue(data, 1, "b")).toEqual({});
		expect(JSON.stringify(data)).toBe(before);
		data.bank[0].name = "박민준0905";
		expect(suggestedReceiptDue(data, 1, "a")).toEqual({});
		data.bank[0].name = "박민준0906";
		data.due[0].due_ym = "2026-08";
		expect(suggestedReceiptDue(data, 1, "a")).toEqual({});
		data.due[0].due_ym = "2026-09";
		data.due[0].remaining = 6000;
		expect(suggestedReceiptDue(data, 1, "a")).toEqual({});
	});
	it("leaves equal candidate fees unselected unless the written date distinguishes them", () => {
		const data = fixture();
		data.groups.push({
			...data.groups[0],
			id: "g2",
			occurred_on: "2026-09-05",
		});
		data.charges.push({ ...data.charges[0], id: "c2", group_id: "g2" });
		data.due.push({ ...data.due[0], id: "d2", charge_id: "c2" });
		expect(suggestedReceiptDue(data, 1, "a")).toEqual({ d: "6500" });
		data.bank[0].name = "박민준";
		expect(suggestedReceiptDue(data, 1, "a")).toEqual({});
		data.charges[1].state = "cancelled";
		expect(suggestedReceiptDue(data, 1, "a")).toEqual({ d: "6500" });
	});
});

describe("already paid dated receipts", () => {
	const paidFixture = () => {
		const data = fixture();
		data.charges[0].amount = 6500;
		data.groups[0].kind = "court";
		data.groups[0].label = "9월 6일 대관";
		data.due[0].remaining = 0;
		data.bank.push({
			...data.bank[0],
			id: 2,
			occurred_at: "2026-09-03T00:00:00Z",
		});
		data.allocations = [
			{
				id: "a1",
				bank_tx_id: 2,
				charge_id: "c",
				due_id: "d",
				owner_id: "a",
				amount: 6500,
				reversed: 0,
				created_at: "2026-09-03T00:00:00Z",
			},
		];
		return data;
	};
	it("explains a completed charge using a different original deposit without offering another charge", () => {
		const data = paidFixture();
		expect(previouslyPaidReceiptTargets(data, 1, "a")).toMatchObject([
			{
				group: { label: "9월 6일 대관" },
				payments: [{ receipt: { id: 2 }, amount: 6500 }],
			},
		]);
		expect(payableTargets(data, "a", "2026-09")).toEqual([]);
		expect(previouslyPaidReceiptTargets(data, 1, "b")).toEqual([]);
		expect(previouslyPaidReceiptTargets(data, 2, "a")).toEqual([]);
	});
	it("does not call reversed, partially paid, waived or unrelated charges fully paid", () => {
		const data = paidFixture();
		data.allocations[0].reversed = 500;
		expect(previouslyPaidReceiptTargets(data, 1, "a")).toEqual([]);
		data.allocations[0].reversed = 0;
		data.due[0].remaining = 500;
		expect(previouslyPaidReceiptTargets(data, 1, "a")).toEqual([]);
		data.due[0].remaining = 0;
		data.charges[0].state = "waived";
		expect(previouslyPaidReceiptTargets(data, 1, "a")).toEqual([]);
		data.charges[0].state = "live";
		data.bank[0].name = "박민준0905";
		expect(previouslyPaidReceiptTargets(data, 1, "a")).toEqual([]);
		data.bank[0].name = "박민준";
		expect(previouslyPaidReceiptTargets(data, 1, "a")).toEqual([]);
	});
});
