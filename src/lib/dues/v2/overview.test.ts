import { describe, expect, it } from "vitest";
import { billingProgress, overviewBalances } from "./overview";
import type { AccountingData } from "./types";

function fixture(): AccountingData {
	return {
		mode: {
			available: true,
			enabled: true,
			paused: false,
			revision: 1,
			epoch: "test",
		},
		groups: [
			{
				id: "sep",
				source_key: "monthly:2026-09",
				kind: "monthly",
				label: "9월 회비",
				occurred_on: "2026-09-01",
				session_id: null,
				basis: {},
			},
			{
				id: "jul",
				source_key: "monthly:2026-07",
				kind: "monthly",
				label: "7월 회비",
				occurred_on: "2026-07-01",
				session_id: null,
				basis: {},
			},
			{
				id: "oct",
				source_key: "monthly:2026-10",
				kind: "monthly",
				label: "10월 회비",
				occurred_on: "2026-10-01",
				session_id: null,
				basis: {},
			},
		],
		members: [
			{
				id: "a",
				name: "김지훈",
				birth_year: 1996,
				gender: "M",
				guest: false,
				active: true,
			},
			{
				id: "b",
				name: "김지훈",
				birth_year: 2002,
				gender: "M",
				guest: false,
				active: false,
			},
		],
		charges: [
			{
				id: "a9",
				legacy_id: 1,
				group_id: "sep",
				member_id: "a",
				amount: 5000,
				state: "live",
				previous_id: null,
				payer_hint: null,
				issued_at: "2026-09-01",
			},
			{
				id: "b9",
				legacy_id: 2,
				group_id: "sep",
				member_id: "b",
				amount: 5000,
				state: "live",
				previous_id: null,
				payer_hint: null,
				issued_at: "2026-09-01",
			},
			{
				id: "old",
				legacy_id: 3,
				group_id: "sep",
				member_id: "a",
				amount: 10000,
				state: "cancelled",
				previous_id: null,
				payer_hint: null,
				issued_at: "2026-09-01",
			},
			{
				id: "a7",
				legacy_id: 4,
				group_id: "jul",
				member_id: "a",
				amount: 3000,
				state: "live",
				previous_id: null,
				payer_hint: null,
				issued_at: "2026-07-01",
			},
			{
				id: "a10",
				legacy_id: 5,
				group_id: "oct",
				member_id: "a",
				amount: 5000,
				state: "live",
				previous_id: null,
				payer_hint: null,
				issued_at: "2026-09-01",
			},
		],
		due: [
			{ id: "d1", charge_id: "a9", due_ym: "2026-09", remaining: 0 },
			{ id: "d2", charge_id: "b9", due_ym: "2026-09", remaining: 3000 },
			{ id: "d3", charge_id: "b9", due_ym: "2026-10", remaining: 2000 },
			{ id: "d4", charge_id: "a7", due_ym: "2026-07", remaining: 1000 },
			{ id: "d5", charge_id: "a7", due_ym: "2026-10", remaining: 2000 },
			{ id: "d6", charge_id: "a10", due_ym: "2026-10", remaining: 5000 },
		],
		bank: [
			{
				id: 1,
				name: "김지훈",
				amount: 5000,
				direction: "in",
				occurred_at: "2026-07-28T06:00:00Z",
			},
			{
				id: 2,
				name: "김지훈",
				amount: 1000,
				direction: "in",
				occurred_at: "2026-08-30T12:00:00Z",
			},
			{
				id: 3,
				name: "김지훈",
				amount: 5000,
				direction: "in",
				occurred_at: "2026-09-30T16:00:00Z",
			},
		],
		allocations: [
			{
				id: "p1",
				bank_tx_id: 1,
				owner_id: "a",
				charge_id: "a9",
				due_id: "d1",
				amount: 5000,
				reversed: 0,
				created_at: "2026-09-01",
			},
		],
		positions: [
			{
				id: "cash",
				bank_tx_id: 2,
				owner_id: "b",
				amount: 1000,
				purpose: "carry",
				available_ym: "2026-10",
				group_id: null,
			},
			{
				id: "next",
				bank_tx_id: 3,
				owner_id: "a",
				amount: 5000,
				purpose: "carry",
				available_ym: "2026-11",
				group_id: null,
			},
		],
		refunds: [],
		expenses: [],
		operations: [],
		drafts: [],
	};
}

describe("overview accounting scopes", () => {
	it("uses actual charges and allocations, including past deposits and inactive namesakes, without treating deferred dues as paid", () => {
		const data = fixture();
		const progress = billingProgress(data, [data.groups[0]], "2026-09");
		expect(progress).toMatchObject({
			total: 10000,
			paid: 5000,
			remaining: 5000,
			later: 2000,
			paidCount: 1,
		});
		expect(progress.rows.map((r) => r.charge.member_id)).toEqual(["b", "a"]);
	});
	it("keeps carried debt and cash separate and excludes future-origin charges and receipts using KST", () => {
		const balances = overviewBalances(fixture(), "2026-09");
		expect(balances).toMatchObject({
			outstanding: 4000,
			futureDue: 4000,
			carryCash: 1000,
		});
		expect(balances.unpaid.map((m) => [m.id, m.amount])).toEqual([
			["b", 3000],
			["a", 1000],
		]);
		expect(balances.carry.map((p) => p.id)).toEqual(["cash"]);
	});
});
