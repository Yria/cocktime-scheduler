// Offline only: run against a locally exported, name-redacted legacy snapshot.
// node scripts/accounting-v2-dry-run.mjs /path/to/snapshot.json
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

const path = process.argv[2];
if (!path) throw new Error("Provide the local snapshot JSON path; this script never connects to a server.");
const raw = JSON.parse(await readFile(path, "utf8"));
const source = raw.rows?.[0]?.snapshot ?? raw;
const db = new PGlite();
const query = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
try {
	await db.exec(await readFile(new URL("../supabase/tests/fixtures/dues-v2-legacy.sql", import.meta.url), "utf8"));
	const tables = ["members", "sessions", "dues_settings", "txn_categories", "dues_batches", "bank_transactions", "dues_charges", "dues_allocations", "dues_charge_drafts"];
	for (const table of tables) {
		await db.query(`insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},$1)`, [source.tables[table] ?? []]);
	}
	const legacyHash = async () => createHash("sha256").update(JSON.stringify(await query(`select jsonb_build_object(
    'charges',(select jsonb_agg(t order by id) from dues_charges t),
    'allocations',(select jsonb_agg(t order by id) from dues_allocations t),
    'bank',(select jsonb_agg(t order by id) from bank_transactions t),
    'batches',(select jsonb_agg(t order by id) from dues_batches t))`))).digest("hex");
	const originalHash = await legacyHash();
	await db.exec(await readFile(new URL("../supabase/migrations/20260907030000_dues_v2.sql", import.meta.url), "utf8"));
	await db.exec(await readFile(new URL("../supabase/migrations/20260907050000_dues_v2_payer_refunds.sql", import.meta.url), "utf8"));
	await db.query("select set_config('test.member',$1,false)", [source.tables.members[0].id]);
	await db.query("select set_config('test.admin','true',false)");
	const mode = () => query("select dues_v2_mode()");
	const command = async payload => query("select dues_v2_command($1,$2,$3)", [{ reason: "offline dry run", ...payload }, randomUUID(), (await mode()).revision]);
	for (const name of ["20260907060000_dues_v2_quick_settlement.sql", "20260907070000_dues_v2_payer_choice.sql", "20260908010000_retire_dues_recovery.sql"]) {
		await db.exec(await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"));
	}
	assert.equal(await legacyHash(), originalHash, "Activation edited a legacy fact");
	const amounts = await query(`select jsonb_build_object('charges',(select count(*) from dues_v2_charges),
    'allocations',(select count(*) from dues_v2_allocations),
    'paid',(select sum(amount-reversed) from dues_v2_allocations),
    'outstanding',(select sum(remaining) from dues_v2_due),
    'member_pending',(select sum(amount) from dues_v2_positions where purpose='member_pending'),
    'club',(select sum(amount) from dues_v2_positions where purpose='club'))`);
	assert.equal(amounts.charges, source.tables.dues_charges.length);
	assert.equal(amounts.allocations, source.tables.dues_allocations.length);
	assert.equal(amounts.paid, source.tables.dues_allocations.reduce((s, a) => s + a.amount, 0));
	await db.query("select dues_v2_assert()");
	const c = await query(`select to_jsonb(c) from dues_v2_charges c join dues_v2_groups g on g.id=c.group_id
    where g.kind='manual' and c.state='live' and c.amount=30000
      and not exists(select 1 from dues_v2_allocations a where a.charge_id=c.id and a.owner_id<>c.member_id)
      and (select sum(amount-reversed) from dues_v2_allocations where charge_id=c.id)=30000 limit 1`);
	const result = await command({ action: "replace", charge_ids: [c.id], lines: [{ previous_id: c.id, member_id: c.member_id, amount: 24000, due_ym: "2026-08" }] });
	assert.equal(result.reused, 24000);
	assert.equal(result.member_balance_after - result.member_balance_before, 6000);
	await db.query("select dues_v2_assert()");
	for (const ym of ["2026-07", "2026-08", "2026-09"]) {
		const ledger = await query("select dues_v2_ledger($1)", [ym]);
		assert.equal(ledger.lines.reduce((sum, row) => sum + row.income, 0), ledger.income);
		assert.equal(ledger.lines.reduce((sum, row) => sum + row.expense, 0), ledger.expense);
	}
	assert.equal((await mode()).enabled, true);
	assert.equal(await legacyHash(), originalHash, "Current commands edited a legacy fact");
	console.log(JSON.stringify({ observed_at: source.observed_at, ...amounts, legacy_hash_unchanged: true, replace: "passed", july_august_september_cash_totals: "passed", recovery_removed: await query("select to_regprocedure('dues_v2_manage(text,bigint,text,uuid)') is null") }, null, 2));
} finally {
	await db.close();
}
