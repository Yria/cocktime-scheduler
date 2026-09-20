import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { applyAccountingPatch } from "./accountingPatch";
import type {
	AccountingCommand,
	AccountingData,
	OperationResult,
} from "./types";

const read = (path: string) =>
	readFileSync(new URL(`../../../supabase/${path}`, import.meta.url), "utf8");
const member = "00000000-0000-4000-8000-000000000001";
let db: PGlite;
let data: AccountingData;
async function scalar<T>(sql: string, args: unknown[] = []): Promise<T> {
	return Object.values(
		(await db.query<Record<string, T>>(sql, args)).rows[0],
	)[0];
}
const snapshot = () => scalar<AccountingData>("select dues_read()");
const normalized = (value: AccountingData) =>
	Object.fromEntries(
		Object.entries(value).map(([key, rows]) => [
			key,
			Array.isArray(rows)
				? [...rows].sort((a, b) =>
						JSON.stringify(a).localeCompare(JSON.stringify(b)),
					)
				: rows,
		]),
	);
async function commit(payload: Omit<AccountingCommand, "reason">) {
	const result = await scalar<OperationResult>(
		"select dues_command($1,$2,$3)",
		[
			{ reason: "cache regression", ...payload },
			crypto.randomUUID(),
			data.mode.revision,
		],
	);
	const merged = applyAccountingPatch(data, result);
	expect(merged).not.toBeNull();
	data = merged!;
	expect(normalized(data)).toEqual(normalized(await snapshot()));
	return result;
}
async function issue(amount = 5000) {
	await commit({
		action: "issue",
		kind: "manual",
		label: "캐시 부과",
		date: "2026-09-21",
		lines: [{ member_id: member, amount, due_ym: "2026-09" }],
	});
	const group = data.groups.find((g) => g.label === "캐시 부과")!;
	const charge = data.charges.find((c) => c.group_id === group.id)!;
	return data.due.find((d) => d.charge_id === charge.id)!;
}
beforeAll(async () => {
	db = new PGlite();
	await db.exec(read("tests/fixtures/dues-v2-legacy.sql"));
	for (const file of [
		"20260907030000_dues_v2.sql",
		"20260907050000_dues_v2_payer_refunds.sql",
		"20260907060000_dues_v2_quick_settlement.sql",
		"20260907070000_dues_v2_payer_choice.sql",
	])
		await db.exec(read(`migrations/${file}`));
	await db.exec(read("tests/fixtures/dues-v2-seed.sql"));
	await scalar("select dues_v2_manage('activate',0,'fixture',$1)", [
		crypto.randomUUID(),
	]);
	await db.exec(
		"alter table sessions add column is_active boolean default true, add column is_overridden boolean default false; alter table attendances add column confirmed_at timestamptz, add column cancelled_at timestamptz",
	);
	for (const file of [
		"20260908010000_retire_dues_recovery.sql",
		"20260908020000_reference_meal_roster.sql",
		"20260910010000_court_prepayment.sql",
		"20260911010000_promote_dues.sql",
		"20260914010000_restore_reversed_prepayment.sql",
		"20260920010000_settle_owned_unassigned_receipts.sql",
		"20260921010000_dues_command_patch.sql",
	])
		await db.exec(read(`migrations/${file}`));
}, 30000);
beforeEach(async () => {
	await db.exec(
		"begin; insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',6000,'2026-09-21'),(91,'out',1000,'2026-09-21'); select dues_sync_bank()",
	);
	data = await snapshot();
});
afterEach(async () => {
	await db.exec("rollback");
});
afterAll(async () => {
	await db.close();
});

it("merges issuance, consecutive partial payments, exhausted balances and reversals exactly", async () => {
	const due = await issue();
	const position = data.positions.find((p) => p.bank_tx_id === 90)!;
	for (const amount of [2000, 3000]) {
		const result = await commit({
			action: "pay",
			owner_id: member,
			confirm_owner: true,
			lines: [{ position_id: position.id, due_id: due.id, amount }],
		});
		expect(Object.keys(result.patch!.tables).sort()).toEqual([
			"allocations",
			"due",
			"positions",
		]);
	}
	await commit({
		action: "reverse_payment",
		allocation_id: data.allocations.find((a) => a.bank_tx_id === 90)!.id,
		amount: 1000,
	});
	await commit({
		action: "refund",
		owner_id: member,
		out_tx_id: 91,
		lines: [{ position_id: position.id, amount: 1000 }],
	});
	expect(data.positions.some((p) => p.id === position.id)).toBe(false);
	await commit({ action: "reverse_refund", out_tx_id: 91 });
	expect(data.refunds.some((r) => r.out_tx_id === 91)).toBe(false);
	await commit({
		action: "expense",
		out_tx_id: 91,
		group_id: data.groups[0].id,
	});
});

it("merges replacement, waiver and auto-applied credit without predicting server IDs", async () => {
	const due = await issue();
	const position = data.positions.find((p) => p.bank_tx_id === 90)!;
	await commit({
		action: "pay",
		owner_id: member,
		confirm_owner: true,
		lines: [{ position_id: position.id, due_id: due.id, amount: 5000 }],
	});
	await commit({
		action: "replace",
		charge_ids: [due.charge_id],
		lines: [
			{
				previous_id: due.charge_id,
				member_id: member,
				amount: 4000,
				due_ym: "2026-09",
			},
		],
	});
	expect(data.charges.find((c) => c.id === due.charge_id)?.state).toBe(
		"cancelled",
	);
	const unpaid = data.charges.find((c) => c.legacy_id === 106)!;
	await commit({ action: "waive", charge_id: unpaid.id });
	expect(data.charges.find((c) => c.id === unpaid.id)?.state).toBe("waived");
});

it("retries return the original patch, never reapply it, and omit patches from history", async () => {
	const due = await issue();
	const request = crypto.randomUUID();
	const revision = data.mode.revision;
	const payload = {
		action: "pay",
		reason: "retry",
		owner_id: member,
		confirm_owner: true,
		lines: [
			{
				position_id: data.positions.find((p) => p.bank_tx_id === 90)!.id,
				due_id: due.id,
				amount: 5000,
			},
		],
	};
	const args = [payload, request, revision];
	const result = await scalar<OperationResult>(
		"select dues_command($1,$2,$3)",
		args,
	);
	data = applyAccountingPatch(data, result)!;
	await commit({
		action: "expense",
		out_tx_id: 91,
		group_id: data.groups[0].id,
	});
	expect(await scalar("select dues_command($1,$2,$3)", args)).toEqual(result);
	expect(applyAccountingPatch(data, result)).toBe(data);
	expect(data.operations.every((op) => !op.result.patch)).toBe(true);
	expect(Object.keys(result.patch!.tables)).not.toContain("charges");
});

it("previews and rejected commands leave the cache and ledger untouched", async () => {
	const due = await issue();
	const payload = {
		action: "waive",
		reason: "preview",
		charge_id: due.charge_id,
	};
	const args = [payload, crypto.randomUUID(), data.mode.revision];
	const preview = await scalar<OperationResult>(
		"select dues_preview($1,$2,$3)",
		args,
	);
	expect(preview.patch).toBeUndefined();
	expect(normalized(await snapshot())).toEqual(normalized(data));
	await db.exec("savepoint rejected");
	await expect(
		scalar("select dues_command($1,$2,$3)", [payload, args[1], -1]),
	).rejects.toThrow(/다른 처리/);
	await db.exec("rollback to savepoint rejected");
	expect(normalized(await snapshot())).toEqual(normalized(data));
	const result = await commit(payload);
	expect(
		applyAccountingPatch(
			{ ...data, mode: { ...data.mode, epoch: "other" } },
			result,
		),
	).toBeNull();
	expect(
		applyAccountingPatch(
			{ ...data, mode: { ...data.mode, revision: result.revision - 2 } },
			result,
		),
	).toBeNull();
});
