import { describe, expect, it } from "vitest";
import {
	groupAddAmount,
	groupAddCommand,
	groupAddDueYm,
	groupAddState,
} from "./groupAdd";
import type { AccountingData, BillingGroup, Charge } from "./types";

const group: BillingGroup = {
	id: "g1",
	source_key: "manual:x",
	kind: "manual",
	label: "11월 정모 회식비",
	occurred_on: "2026-11-07",
	session_id: null,
	basis: {},
};
const charge = (id: string, member: string, amount: number, extra: Partial<Charge> = {}): Charge => ({
	id,
	legacy_id: null,
	group_id: "g1",
	member_id: member,
	amount,
	state: "live",
	previous_id: null,
	payer_hint: null,
	issued_at: "2026-11-07T00:00:00Z",
	...extra,
});
const data = (charges: Charge[], due: AccountingData["due"] = []) =>
	({ charges, due }) as unknown as AccountingData;

describe("groupAddAmount", () => {
	it("uses the amount everyone else was charged", () => {
		expect(groupAddAmount(data([charge("a", "m1", 10000), charge("b", "m2", 10000)]), "g1")).toBe(10000);
	});
	it("picks the most common live amount, ignoring cancelled rows", () => {
		const d = data([
			charge("a", "m1", 10000),
			charge("b", "m2", 10000),
			charge("c", "m3", 5000),
			charge("d", "m4", 99000, { state: "cancelled" }),
		]);
		expect(groupAddAmount(d, "g1")).toBe(10000);
	});
	it("breaks ties toward the smaller amount", () => {
		expect(groupAddAmount(data([charge("a", "m1", 8000), charge("b", "m2", 6000)]), "g1")).toBe(6000);
	});
	it("is null with no live charges", () => {
		expect(groupAddAmount(data([]), "g1")).toBeNull();
	});
});

describe("groupAddState", () => {
	it("marks live members as charged and others as candidates", () => {
		const d = data([charge("a", "m1", 10000)]);
		expect(groupAddState(d, "g1", "m1")).toBe("charged");
		expect(groupAddState(d, "g1", "m2")).toBe("candidate");
	});
	it("lets a member whose charge was cancelled be added again", () => {
		const d = data([charge("a", "m1", 10000, { state: "cancelled" })]);
		expect(groupAddState(d, "g1", "m1")).toBe("readd");
	});
	it("still blocks a waived member (server refuses)", () => {
		const d = data([charge("a", "m1", 10000, { state: "waived" })]);
		expect(groupAddState(d, "g1", "m1")).toBe("blocked");
	});
	it("treats a replaced-then-live member as charged", () => {
		const d = data([
			charge("a", "m1", 10000, { state: "cancelled" }),
			charge("b", "m1", 8000, { previous_id: "a" }),
		]);
		expect(groupAddState(d, "g1", "m1")).toBe("charged");
	});
});

describe("groupAddDueYm / command", () => {
	it("follows the existing first due month", () => {
		const d = data(
			[charge("a", "m1", 10000), charge("b", "m2", 10000)],
			[
				{ id: "d1", charge_id: "a", due_ym: "2026-11", remaining: 0 },
				{ id: "d2", charge_id: "b", due_ym: "2026-11", remaining: 10000 },
			] as AccountingData["due"],
		);
		expect(groupAddDueYm(d, group)).toBe("2026-11");
	});
	it("falls back to the occurrence month", () => {
		expect(groupAddDueYm(data([]), group)).toBe("2026-11");
	});
	it("issues one line into the existing group", () => {
		const cmd = groupAddCommand(group, "m9", "홍길동", 10000, "2026-11");
		expect(cmd).toMatchObject({
			action: "issue",
			group_id: "g1",
			lines: [{ member_id: "m9", amount: 10000, due_ym: "2026-11" }],
		});
		expect(cmd.rule).toBeUndefined();
		expect(cmd.reissue_cancelled).toBe(true);
		expect(cmd.reason).toContain("홍길동");
	});
});
