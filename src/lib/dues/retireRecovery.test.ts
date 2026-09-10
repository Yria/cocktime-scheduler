import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import legacy from "../../../supabase/tests/fixtures/dues-v2-legacy.sql?raw";
import seed from "../../../supabase/tests/fixtures/dues-v2-seed.sql?raw";
import initial from "../../../supabase/migrations/20260907030000_dues_v2.sql?raw";
import refunds from "../../../supabase/migrations/20260907050000_dues_v2_payer_refunds.sql?raw";
import quick from "../../../supabase/migrations/20260907060000_dues_v2_quick_settlement.sql?raw";
import payer from "../../../supabase/migrations/20260907070000_dues_v2_payer_choice.sql?raw";
import retirement from "../../../supabase/migrations/20260908010000_retire_dues_recovery.sql?raw";

let db: PGlite;
const B = "00000000-0000-4000-8000-000000000002";
async function scalar<T = unknown>(
	sql: string,
	args: unknown[] = [],
): Promise<T> {
	return Object.values(
		(await db.query<Record<string, T>>(sql, args)).rows[0],
	)[0];
}
const revision = () =>
	scalar<number>("select revision from dues_v2_control where id=1");
const manage = async (action: string) =>
	scalar("select dues_v2_manage($1,$2,'fixture',$3)", [
		action,
		await revision(),
		crypto.randomUUID(),
	]);
const command = async (
	p: Record<string, unknown>,
	id = crypto.randomUUID(),
	rev?: number,
) =>
	scalar("select dues_v2_command($1,$2,$3)", [
		{ reason: "fixture", ...p },
		id,
		rev ?? (await revision()),
	]);
async function facts() {
	const tables = [
		"bank_transactions",
		"dues_charges",
		"dues_allocations",
		"dues_batches",
		"dues_charge_drafts",
		"dues_settings",
		"member_honorary",
		...[
			"groups",
			"charges",
			"due",
			"positions",
			"allocations",
			"reversals",
			"refunds",
			"expenses",
			"drafts",
		].map((t) => `dues_v2_${t}`),
	];
	const result: Record<string, unknown> = {};
	for (const table of tables)
		result[table] = await scalar(
			`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t`,
		);
	return result;
}
async function fail(run: () => Promise<unknown>, message: RegExp) {
	await db.exec("savepoint failure");
	await expect(run()).rejects.toThrow(message);
	await db.exec("rollback to savepoint failure");
}
beforeAll(async () => {
	db = new PGlite();
	for (const sql of [legacy, initial, refunds, quick, payer])
		await db.exec(sql);
}, 30_000);
beforeEach(async () => {
	await db.exec("begin");
	await db.exec(seed);
});
afterEach(async () => {
	await db.exec("rollback");
});
afterAll(async () => {
	await db.close();
});

it("removes only recovery data and endpoints, preserving every financial row and committed retry", async () => {
	await manage("activate");
	const oldRevision = await revision(),
		request = crypto.randomUUID();
	const result = await command({ action: "apply" }, request, oldRevision);
	const before = await facts();
	const epoch = await scalar("select epoch from dues_v2_control");
	const journal = await scalar(
		"select jsonb_agg(to_jsonb(o)-'before_state'-'after_state' order by id) from dues_v2_operations o where action='apply'",
	);
	await db.exec(retirement);
	expect(await facts()).toEqual(before);
	expect(await scalar("select epoch from dues_v2_control")).toEqual(epoch);
	expect(await revision()).toBe(oldRevision + 2);
	expect(
		await scalar(
			"select jsonb_agg(to_jsonb(o) order by id) from dues_v2_operations o",
		),
	).toEqual(journal);
	expect(await command({ action: "apply" }, request, oldRevision)).toEqual(
		result,
	);
	expect(
		await scalar(
			"select count(*)::int from information_schema.columns where table_schema='public' and (table_name='dues_v2_control' and column_name='baseline' or table_name='dues_v2_operations' and column_name in ('before_state','after_state'))",
		),
	).toBe(0);
	for (const signature of [
		"dues_v2_manage(text,bigint,text,uuid)",
		"dues_v2_export()",
		"dues_v2_import()",
		"dues_v2_restore(jsonb)",
		"dues_v2_restore_delta(jsonb,jsonb)",
		"dues_v2_delta(jsonb,jsonb)",
		"dues_v2_snapshot()",
	]) {
		expect(
			await scalar("select to_regprocedure($1)::text", [signature]),
		).toBeNull();
	}
	expect(await scalar("select dues_v2_read() ? 'active_operations'")).toBe(
		false,
	);
	await db.exec("select dues_v2_assert()");
});

it("keeps preview atomic, allows payment and reversal, and rejects stale or repeated spending", async () => {
	await manage("activate");
	await db.exec(retirement);
	await db.exec(
		"insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',6000,'2026-09-06')",
	);
	const position = await scalar(
		"select id from dues_v2_positions where bank_tx_id=90",
	);
	const due = await scalar(
		"select d.id from dues_v2_due d join dues_v2_charges c on c.id=d.charge_id where c.legacy_id=106",
	);
	const payload = {
		action: "pay",
		reason: "fixture",
		owner_id: B,
		confirm_owner: true,
		lines: [{ position_id: position, due_id: due, amount: 5000 }],
	};
	const before = await facts(),
		rev = await revision(),
		id = crypto.randomUUID();
	const preview = await scalar<Record<string, number>>(
		"select dues_v2_preview($1,$2,$3)",
		[payload, id, rev],
	);
	expect(await facts()).toEqual(before);
	expect(await revision()).toBe(rev);
	expect(preview.outstanding_before - preview.outstanding_after).toBe(5000);
	await command(payload, id, rev);
	await command(payload, id, rev);
	expect(
		await scalar(
			"select count(*)::int from dues_v2_allocations where bank_tx_id=90",
		),
	).toBe(1);
	expect(
		await scalar(
			"select sum(amount)::int from dues_v2_positions where bank_tx_id=90",
		),
	).toBe(1000);
	await fail(
		() => command({ action: "apply" }, crypto.randomUUID(), rev),
		/다른 처리가/,
	);
	await fail(() => command(payload), /납기 잔액|잔액|금액/);
	const allocation = await scalar(
		"select id from dues_v2_allocations where bank_tx_id=90",
	);
	await command({
		action: "reverse_payment",
		allocation_id: allocation,
		amount: 5000,
	});
	expect(
		await scalar("select remaining from dues_v2_due where id=$1", [due]),
	).toBe(5000);
	await db.exec("select dues_v2_assert()");
	expect(
		await scalar(
			"select has_function_privilege('authenticated','dues_v2_execute(jsonb,uuid,bigint)','execute')",
		),
	).toBe(false);
	await db.exec("set test.admin='false'; set role authenticated");
	await fail(
		() => command({ action: "apply" }, crypto.randomUUID(), 0),
		/forbidden/,
	);
	await db.exec("reset role");
});

it("retains reverted financial request IDs so deleted recovery history cannot revive them", async () => {
	await manage("activate");
	const id = crypto.randomUUID();
	await command({ action: "apply" }, id);
	await manage("undo");
	await db.exec(retirement);
	await fail(() => command({ action: "apply" }, id), /되돌린 요청/);
	expect(
		await scalar(
			"select count(*)::int from dues_v2_operations where reverted_at is not null",
		),
	).toBe(1);
});

it("supports a fresh migration chain without leaving a disabled accounting installation", async () => {
	await db.exec(retirement);
	expect(await scalar("select enabled from dues_v2_control")).toBe(true);
	expect(await scalar("select count(*)::int from dues_v2_charges")).toBe(7);
	await command({ action: "apply" });
	await db.exec("select dues_v2_assert()");
});

it("refuses to remove recovery while paused or reverted to the legacy ledger", async () => {
	await manage("activate");
	await manage("pause");
	await fail(() => db.exec(retirement), /중지된 상태/);
	await manage("resume");
	await manage("rollback");
	await fail(() => db.exec(retirement), /복귀한 상태/);
	expect(
		await scalar(
			"select to_regprocedure('dues_v2_manage(text,bigint,text,uuid)') is not null",
		),
	).toBe(true);
});
