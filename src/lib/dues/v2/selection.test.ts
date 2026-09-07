import { describe, expect, it } from "vitest";
import {
	matchingMembers,
	receiptHistory,
	sessionChoiceLabels,
} from "./selection";
import type { AccountingData } from "./types";

describe("accounting person and session selection", () => {
	it("keeps every namesake including inactive members and old guest records", () => {
		const members = Array.from({ length: 12 }, (_, i) => ({
			id: String(i),
			name: "김지훈",
			guest: i > 1,
			active: i !== 1,
			birth_year: null,
			gender: null,
		}));
		const data = { members } as AccountingData;
		for (const query of ["ㄱㅈㅎ", "김지훈9월 회비", "김 지훈", ""])
			expect(matchingMembers(data, query).map((m) => m.id)).toEqual(
				members.map((m) => m.id),
			);
	});
	it("uses sender IDs even when a deposit description matches someone else or a proxy beneficiary", () => {
		const data = {
			bank: [
				{
					id: 1,
					direction: "in",
					amount: 10000,
					occurred_at: "2026-08-01T00:00:00Z",
					name: "B",
				},
			],
			positions: [
				{
					bank_tx_id: 1,
					amount: 3000,
					purpose: "member_pending",
					owner_id: "A",
				},
				{ bank_tx_id: 1, amount: 2000, purpose: "club", owner_id: "A" },
			],
			allocations: [
				{
					bank_tx_id: 1,
					amount: 8000,
					reversed: 5000,
					owner_id: "A",
					charge_id: "B-duty",
				},
			],
			refunds: [{ in_tx_id: 1, amount: 2000, owner_id: "A" }],
		} as unknown as AccountingData;
		expect(receiptHistory(data)[0]).toMatchObject({
			owners: ["A"],
			used: 3000,
			refunded: 2000,
			club: 2000,
			available: 3000,
		});
	});
	it("shows times only for the same KST day and place, and IDs only for otherwise identical sessions", () => {
		const base = {
			title: "정모",
			place: "체육관",
			scheduled_at: "2026-08-22T14:00:00+09:00",
			ends_at: "2026-08-22T16:00:00+09:00",
		};
		const sessions = [
			{ ...base, id: 1 },
			{
				...base,
				id: 2,
				scheduled_at: "2026-08-22T18:00:00+09:00",
				ends_at: "2026-08-22T20:00:00+09:00",
			},
			{ ...base, id: 3, place: "다른 장소" },
			{
				...base,
				id: 4,
				scheduled_at: "2026-08-23T14:00:00+09:00",
				ends_at: null,
			},
			{ ...base, id: 5 },
		];
		const labels = sessionChoiceLabels(sessions);
		expect(labels.get(1)).toContain("14:00–16:00 · 정모 · #1");
		expect(labels.get(5)).toContain("#5");
		expect(labels.get(2)).toBe("2026-08-22 · 체육관 · 18:00–20:00");
		expect(labels.get(3)).toBe("2026-08-22 · 다른 장소");
		expect(labels.get(4)).toBe("2026-08-23 · 체육관");
	});
});
