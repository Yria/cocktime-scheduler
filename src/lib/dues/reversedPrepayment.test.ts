import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";

const read = (p: string) =>
	readFileSync(new URL(`../../../supabase/${p}`, import.meta.url), "utf8");
const fix = read("migrations/20260914010000_restore_reversed_prepayment.sql");
const A = "00000000-0000-4000-8000-000000000001";
let db: PGlite;
async function scalar<T = unknown>(
	sql: string,
	args: unknown[] = [],
): Promise<T> {
	return Object.values(
		(await db.query<Record<string, T>>(sql, args)).rows[0],
	)[0];
}
const revision = () =>
	scalar<number>("select revision from dues_control where id=1");
const command = async (
	p: Record<string, unknown>,
	request = crypto.randomUUID(),
	rev?: number,
	rpc = "dues_command",
) =>
	scalar<Record<string, unknown>>(`select ${rpc}($1,$2,$3)`, [
		{ reason: "prepayment reversal test", ...p },
		request,
		rev ?? (await revision()),
	]);
const candidates = () =>
	scalar<{ member_id: string; session_id: number }[]>(
		"select dues_prepayment_candidates()",
	);
const available = async () =>
	(await candidates()).some((p) => p.member_id === A && p.session_id === 10);
async function pay(amount = 6000, expected = 6000) {
	const position = await scalar(
		"select id from dues_positions where bank_tx_id=90 and amount>=$1 order by amount desc limit 1",
		[amount],
	);
	await command({
		action: "pay",
		owner_id: A,
		confirm_owner: true,
		lines: [
			{
				position_id: position,
				session_id: 10,
				expected_amount: expected,
				amount,
			},
		],
	});
	return scalar<string>(
		"select a.id from dues_allocations a join dues_charges c on c.id=a.charge_id join dues_groups g on g.id=c.group_id where g.session_id=10 and a.amount>a.reversed and c.state='live' limit 1",
	);
}
const reverse = (allocation: string, amount = 6000) =>
	command({ action: "reverse_payment", allocation_id: allocation, amount });
async function charge(allocation: string) {
	return scalar<Record<string, unknown>>(
		"select to_jsonb(c) from dues_charges c join dues_allocations a on a.charge_id=c.id where a.id=$1",
		[allocation],
	);
}
const money = () =>
	scalar(
		"select jsonb_build_object('bank',(select jsonb_agg(to_jsonb(t) order by id) from bank_transactions t),'positions',(select jsonb_agg(to_jsonb(t) order by id) from dues_positions t),'allocations',(select jsonb_agg(to_jsonb(t) order by id) from dues_allocations t),'reversals',(select jsonb_agg(to_jsonb(t) order by id) from dues_reversals t))",
	);

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
	await db.exec(`alter table sessions add column is_active boolean default true, add column is_overridden boolean default false;
    alter table attendances add column invited_by uuid, add column confirmed_at timestamptz, add column cancelled_at timestamptz;
    create function is_operator(uuid) returns boolean language sql as $$ select false $$;`);
	for (const [file, name] of [
		["20260810000000_day_cancel_grace_1h.sql", "dues_is_day_cancel_chargeable"],
		[
			"20260818000000_court_targets_include_board_added.sql",
			"dues_court_targets",
		],
		[
			"20260831000000_prepaid_court_close_auto_issue.sql",
			"trg_session_court_on_close",
		],
	]) {
		const sql = read(`migrations/${file}`);
		const start = sql.indexOf(`create or replace function public.${name}(`);
		await db.exec(sql.slice(start, sql.indexOf("$function$;", start) + 12));
	}
	await db.exec(
		"create trigger trg_session_court_on_close after update of status on sessions for each row when(new.status='closed' and old.status is distinct from 'closed') execute function trg_session_court_on_close()",
	);
	for (const file of [
		"20260908010000_retire_dues_recovery.sql",
		"20260908020000_reference_meal_roster.sql",
		"20260910010000_court_prepayment.sql",
	])
		await db.exec(read(`migrations/${file}`));
	await db.exec(`create schema cron; create table cron.job(jobid bigint,jobname text,command text);
    create function cron.alter_job(job_id bigint,command text) returns void language sql as $$ update cron.job set command=$2 where jobid=$1 $$;`);
	await db.exec(read("migrations/20260911010000_promote_dues.sql"));
}, 30000);
beforeEach(async () => {
	await db.exec("begin");
	await db.exec(`insert into places values(10,'테스트 대관',true);
    insert into sessions(id,title,status,scheduled_at,ends_at,place_id) values(10,'예정 대관','open',now()+interval '7 days',now()+interval '7 days 3 hours',10);
    insert into attendances(session_id,member_id,status) values(10,'${A}','confirmed');
    insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',8000,now(),'테스트 선납');
    select dues_sync_bank();`);
});
afterEach(async () => {
	await db.exec("rollback");
});
afterAll(async () => {
	await db.close();
});

it("restores a fully reversed future prepayment atomically, preserves retry/preview and allows repeated prepayment at current rates", async () => {
	await db.exec(fix);
	const a = await pay();
	const original = await charge(a);
	const p = { action: "reverse_payment", allocation_id: a, amount: 6000 };
	const rev = await revision(),
		request = crypto.randomUUID(),
		before = await money();
	expect(await available()).toBe(false);
	const preview = await command(p, request, rev, "dues_preview");
	expect(preview.restored_prepayment).toBe(original.id);
	expect(await money()).toEqual(before);
	expect((await charge(a)).state).toBe("live");
	const result = await command(p, request, rev);
	expect(await command(p, request, rev)).toEqual(result);
	expect(await revision()).toBe(rev + 1);
	expect(await charge(a)).toMatchObject({
		state: "cancelled",
		basis: { prepayment: true, prepayment_reversed: true },
	});
	expect(
		await scalar(
			"select sum(remaining)::int from dues_due where charge_id=$1",
			[original.id],
		),
	).toBe(0);
	expect(await available()).toBe(true);
	expect(
		await scalar(
			"select sum(amount)::int from dues_positions where bank_tx_id=90",
		),
	).toBe(8000);
	await db.exec("update dues_settings set court_fee_default=5000 where id=1");
	const b = await pay(5000, 5000);
	expect(await charge(b)).toMatchObject({
		previous_id: original.id,
		amount: 5000,
		state: "live",
	});
	await reverse(b, 5000);
	const c = await pay(5000, 5000);
	expect(await charge(c)).toMatchObject({
		previous_id: (await charge(b)).id,
		amount: 5000,
	});
	await db.exec("select dues_assert()");
});

it("keeps partial reversals unpaid until the final active allocation is released", async () => {
	await db.exec(fix);
	const a = await pay(3000);
	const due = await scalar("select due_id from dues_allocations where id=$1", [
		a,
	]);
	const position = await scalar(
		"select id from dues_positions where bank_tx_id=90 and amount=5000",
	);
	await command({
		action: "pay",
		owner_id: A,
		lines: [{ position_id: position, due_id: due, amount: 3000 }],
	});
	const b = await scalar<string>(
		"select id from dues_allocations where due_id=$1 and id<>$2",
		[due, a],
	);
	await reverse(a, 3000);
	expect((await charge(a)).state).toBe("live");
	expect(await available()).toBe(false);
	await reverse(b, 1000);
	expect((await charge(a)).state).toBe("live");
	await reverse(b, 2000);
	expect((await charge(a)).state).toBe("cancelled");
	expect(await available()).toBe(true);
});

it.each([
	"active",
	"closed",
	"elapsed",
	"matches",
	"ordinary",
])("retains the obligation for %s sessions or ordinary charges", async (kind) => {
	await db.exec(fix);
	const a = await pay();
	if (kind === "active" || kind === "closed")
		await db.query("update sessions set status=$1 where id=10", [kind]);
	if (kind === "elapsed")
		await db.exec(
			"update sessions set scheduled_at=now()-interval '1 minute' where id=10",
		);
	if (kind === "matches") await db.exec("insert into matches values(90,10)");
	if (kind === "ordinary")
		await db.query(
			"update dues_charges set basis=basis-'prepayment' where id=$1",
			[(await charge(a)).id],
		);
	await reverse(a);
	expect((await charge(a)).state).toBe("live");
	expect(
		await scalar(
			"select remaining from dues_due where id=(select due_id from dues_allocations where id=$1)",
			[a],
		),
	).toBe(6000);
	expect(await available()).toBe(false);
});

it("issues the restored obligation once through the real session-close trigger", async () => {
	await db.exec(fix);
	const a = await pay();
	await reverse(a);
	await db.exec(
		"insert into matches values(90,10); update sessions set status='closed' where id=10",
	);
	expect(
		await scalar(
			"select count(*)::int from dues_charges c join dues_groups g on g.id=c.group_id where g.session_id=10 and c.state='live'",
		),
	).toBe(1);
	expect(
		await scalar(
			"select previous_id from dues_charges where state='live' and previous_id=$1",
			[(await charge(a)).id],
		),
	).toBe((await charge(a)).id);
	await db.exec(
		"select dues_generate_session_court(10,true); select dues_assert()",
	);
	expect(
		await scalar(
			"select count(*)::int from dues_charges c join dues_groups g on g.id=c.group_id where g.session_id=10",
		),
	).toBe(2);
});

it("repairs an existing orphan without moving money or granting direct helper access", async () => {
	const a = await pay();
	await reverse(a);
	const before = await money();
	await db.exec(fix);
	expect(await money()).toEqual(before);
	const c = await charge(a);
	expect(
		await scalar("select dues_restore_reversed_prepayment($1)", [c.id]),
	).toBe(c.id);
	expect(
		await scalar("select dues_restore_reversed_prepayment($1)", [c.id]),
	).toBeNull();
	expect(await money()).toEqual(before);
	expect(await available()).toBe(true);
	for (const role of ["authenticated", "anon"])
		expect(
			await scalar(
				"select has_function_privilege($1,'dues_restore_reversed_prepayment(uuid)','execute')",
				[role],
			),
		).toBe(false);
	await db.exec("select dues_assert()");
});

it.each([
	"cancelled",
	"waived",
])("does not reopen an ordinary %s charge", async (state) => {
	await db.exec(fix);
	const a = await pay();
	await command({
		action: "replace",
		charge_ids: [(await charge(a)).id],
		lines: [],
	});
	await db.query("update dues_charges set state=$1 where id=$2", [
		state,
		(await charge(a)).id,
	]);
	expect(await available()).toBe(false);
	await db.exec("savepoint rejected");
	await expect(pay()).rejects.toThrow("선납 대상");
	await db.exec("rollback to savepoint rejected");
});
