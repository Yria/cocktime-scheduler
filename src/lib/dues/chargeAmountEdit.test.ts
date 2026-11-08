import { describe, expect, it } from "vitest";
import {
	amountEditOutcome,
	chargeAmountCommand,
	chargePaid,
	simpleAmountEditable,
} from "./chargeAmountEdit";
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
const charge: Charge = {
	id: "c1",
	legacy_id: null,
	group_id: "g1",
	member_id: "m1",
	amount: 10000,
	state: "live",
	previous_id: null,
	payer_hint: null,
	issued_at: "2026-11-07T00:00:00Z",
};
const data = (extra: Partial<AccountingData>) =>
	({ charges: [charge], due: [], allocations: [], ...extra }) as unknown as AccountingData;

describe("chargePaid", () => {
	it("sums live allocations net of reversals for this charge only", () => {
		const d = data({
			allocations: [
				{ charge_id: "c1", amount: 10000, reversed: 0 },
				{ charge_id: "c1", amount: 3000, reversed: 3000 },
				{ charge_id: "c2", amount: 9000, reversed: 0 },
			] as AccountingData["allocations"],
		});
		expect(chargePaid(d, "c1")).toBe(10000);
	});
});

describe("simpleAmountEditable", () => {
	it("allows a single due month and refuses installments", () => {
		const one = data({ due: [{ id: "d1", charge_id: "c1", due_ym: "2026-11", remaining: 0 }] as AccountingData["due"] });
		const split = data({
			due: [
				{ id: "d1", charge_id: "c1", due_ym: "2026-11", remaining: 0 },
				{ id: "d2", charge_id: "c1", due_ym: "2026-12", remaining: 5000 },
			] as AccountingData["due"],
		});
		expect(simpleAmountEditable(one, "c1")).toBe(true);
		expect(simpleAmountEditable(split, "c1")).toBe(false);
	});
});

describe("amountEditOutcome", () => {
	it("keeps what was paid against the new amount", () => {
		expect(amountEditOutcome(10000, 5000)).toEqual({ remaining: 0, overflow: 5000 });
		expect(amountEditOutcome(10000, 43000)).toEqual({ remaining: 33000, overflow: 0 });
	});
});

describe("chargeAmountCommand", () => {
	it("replaces one charge with the same member, due month and payer", () => {
		const d = data({ due: [{ id: "d1", charge_id: "c1", due_ym: "2026-11", remaining: 0 }] as AccountingData["due"] });
		const cmd = chargeAmountCommand(d, group, charge, "김길환", 5000, "2026-10");
		expect(cmd).toMatchObject({
			action: "replace",
			charge_ids: ["c1"],
			lines: [{ member_id: "m1", amount: 5000, due_ym: "2026-11", previous_id: "c1", payer_hint: null }],
		});
		expect(cmd.reason).toBe("11월 정모 회식비 · 김길환 금액 변경 10,000원 → 5,000원");
	});
	it("falls back to the given month when the charge has no due rows", () => {
		const cmd = chargeAmountCommand(data({}), group, charge, "x", 5000, "2026-10");
		expect((cmd.lines as { due_ym: string }[])[0].due_ym).toBe("2026-10");
	});
});
