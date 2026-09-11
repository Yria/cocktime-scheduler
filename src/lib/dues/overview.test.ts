import { describe, expect, it } from "vitest";
import {
	billingProgress,
	overviewBalances,
	sortLedgerBuckets,
} from "./overview";
import type { AccountingData, BillingGroup } from "./types";

function g(
	id: string,
	kind: BillingGroup["kind"],
	occurred_on: string,
	label: string,
): BillingGroup {
	return {
		id,
		source_key: `${kind}:${id}`,
		kind,
		label,
		occurred_on,
		session_id: null,
		basis: {},
	};
}

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

describe("sortLedgerBuckets — 항목 칩 순서", () => {
	const groups: BillingGroup[] = [
		g("c-830", "court", "2026-08-30", "2026-08-30 · 에이트민턴 · 19:00"),
		g("c-89", "court", "2026-08-09", "2026-08-09 · 에이트민턴 · 19:00"),
		g("c-816", "court", "2026-08-16", "2026-08-16 · 에이트민턴 · 19:00"),
		g("m-9", "monthly", "2026-09-01", "9월 회비"),
		g("m-8", "monthly", "2026-08-01", "8월 회비"),
		g("x-cock", "manual", "2026-08-25", "콕공구"),
		g("x-meal", "manual", "2026-08-22", "8. 22. 정모"),
	];
	const line = (group_id: string | null, label: string, income = 0, expense = 0) => ({
		group_id,
		label,
		income,
		expense,
	});

	it("대관비(날짜) → 회비(월) → 수동 묶음(발생일) → 묶음 없는 항목 순이다", () => {
		// 서버는 라벨 문자열순으로만 주므로 뒤섞인 입력을 흉내 낸다.
		const lines = [
			line(null, "환불", 0, 49000),
			line("m-9", "9월 회비", 10000),
			line("x-cock", "콕공구", 540000, 600000),
			line("c-830", "2026-08-30 · 에이트민턴 · 19:00", 156000, 169000),
			line(null, "이월 입금", 5000),
			line("c-89", "2026-08-09 · 에이트민턴 · 19:00", 156000, 195000),
			line("x-meal", "8. 22. 정모", 510000, 701000),
			line("m-8", "8월 회비", 375000),
			line("c-816", "2026-08-16 · 에이트민턴 · 19:00", 48000, 78000),
			line(null, "환불 원입금", 50000),
		];
		expect(sortLedgerBuckets(lines, groups).map((l) => l.label)).toEqual([
			"2026-08-09 · 에이트민턴 · 19:00",
			"2026-08-16 · 에이트민턴 · 19:00",
			"2026-08-30 · 에이트민턴 · 19:00",
			"8월 회비",
			"9월 회비",
			"8. 22. 정모",
			"콕공구",
			"이월 입금",
			"환불",
			"환불 원입금",
		]);
	});

	it("금액은 순서를 바꾸지 않는다 — 큰 지출이 날짜를 앞지르지 못한다", () => {
		const lines = [
			line("c-830", "2026-08-30 · 에이트민턴 · 19:00", 1000),
			line("c-89", "2026-08-09 · 에이트민턴 · 19:00", 0, 9_000_000),
		];
		expect(sortLedgerBuckets(lines, groups)[0].group_id).toBe("c-89");
	});

	it("모르는 묶음 ID 는 합성 항목과 같이 맨 뒤로 간다(라벨순)", () => {
		const lines = [
			line("ghost", "사라진 묶음", 1000),
			line("m-8", "8월 회비", 2000),
			line(null, "미분류", 3000),
		];
		expect(sortLedgerBuckets(lines, groups).map((l) => l.label)).toEqual([
			"8월 회비",
			"미분류",
			"사라진 묶음",
		]);
	});

	it("원본 배열을 바꾸지 않는다", () => {
		const lines = [line("m-9", "9월 회비"), line("c-89", "8/9")];
		const copy = [...lines];
		sortLedgerBuckets(lines, groups);
		expect(lines).toEqual(copy);
	});
});
