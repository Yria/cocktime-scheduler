import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";

const read = (p: string) =>
	readFileSync(new URL(`../../../supabase/${p}`, import.meta.url), "utf8");
const migration = read("migrations/20260911010000_promote_dues.sql");
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
let oldResult: unknown;
let oldRevision: number;
let oldEpoch: string;
let before: unknown;
const request = crypto.randomUUID();
const financial = [
	"groups",
	"charges",
	"due",
	"positions",
	"allocations",
	"reversals",
	"refunds",
	"expenses",
	"operations",
	"drafts",
];
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
async function facts(prefix = "dues_") {
	const result: Record<string, unknown> = {};
	for (const suffix of financial)
		result[suffix] = await scalar(
			`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${prefix + suffix} t`,
		);
	result.bank = await scalar(
		"select jsonb_agg(to_jsonb(t) order by id) from bank_transactions t",
	);
	return result;
}
const command = async (
	p: Record<string, unknown>,
	id = crypto.randomUUID(),
	rev?: number,
	rpc = "dues_command",
) =>
	scalar(`select ${rpc}($1,$2,$3)`, [
		{ reason: "promotion test", ...p },
		id,
		rev ?? (await revision()),
	]);
async function rejects(sql: string, pattern: RegExp) {
	await db.exec("savepoint failure");
	try {
		await expect(db.exec(sql)).rejects.toThrow(pattern);
	} finally {
		await db.exec("rollback to savepoint failure");
	}
}
async function extract(file: string, name: string) {
	const sql = read(`migrations/${file}`),
		start = sql.indexOf(`create or replace function public.${name}(`);
	if (start < 0) throw new Error(name);
	await db.exec(sql.slice(start, sql.indexOf("$function$;", start) + 12));
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
	await db.exec(`alter table sessions add column is_active boolean default true, add column is_overridden boolean default false;
  alter table members add column created_at timestamptz default '2026-01-01', add column rejoined_at timestamptz, add column membership_started_at date;
  alter table dues_settings add column offset_days int default 3, add column join_cutoff_day int default 21;
  alter table attendances add column invited_by uuid, add column confirmed_at timestamptz, add column cancelled_at timestamptz;
  alter table bank_transactions add constraint bank_batch_fkey foreign key(batch_id) references dues_batches(id) on delete set null;
  create function is_operator(uuid) returns boolean language sql as $$ select $1='00000000-0000-4000-8000-000000000004'::uuid $$;
  create function dues_confirm_match() returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
  grant execute on function dues_confirm_match() to authenticated;`);
	await extract(
		"20260810000000_day_cancel_grace_1h.sql",
		"dues_is_day_cancel_chargeable",
	);
	await extract(
		"20260818000000_court_targets_include_board_added.sql",
		"dues_court_targets",
	);
	await extract(
		"20260823030000_monthly_issued_facts.sql",
		"dues_monthly_targets",
	);
	await extract(
		"20260831000000_prepaid_court_close_auto_issue.sql",
		"trg_session_court_on_close",
	);
	await db.exec(
		"create trigger trg_session_court_on_close after update of status on sessions for each row when(new.status='closed' and old.status is distinct from 'closed') execute function trg_session_court_on_close()",
	);
	for (const file of [
		"20260908010000_retire_dues_recovery.sql",
		"20260908020000_reference_meal_roster.sql",
		"20260910010000_court_prepayment.sql",
	])
		await db.exec(read(`migrations/${file}`));
	await db.exec(
		"update dues_v2_control set activated_at='2026-09-07T12:00:00+09' where id=1",
	);
	oldRevision = await scalar("select revision from dues_v2_control where id=1");
	oldEpoch = await scalar("select epoch from dues_v2_control where id=1");
	oldResult = await scalar("select dues_v2_command($1,$2,$3)", [
		{ action: "apply", reason: "promotion test" },
		request,
		oldRevision,
	]);
	before = await facts("dues_v2_");
	// pg_cron is unavailable in PGlite. Model its catalog/API to verify migration
	// wiring and preserve job ID, custom cadence and disabled state; no clock claim.
	await db.exec(`create schema cron;
  create table cron.job(jobid bigint primary key,jobname text,schedule text,command text,active boolean);
  insert into cron.job values(41,'dues-v2-month-and-carry','*/7 * * * *','select public.dues_v2_run_scheduled()',false);
  create function cron.alter_job(job_id bigint,command text) returns void language sql as $$ update cron.job set command=$2 where jobid=$1 $$;`);
	await db.exec(migration);
}, 30000);
beforeEach(async () => {
	await db.exec("begin");
});
afterEach(async () => {
	await db.exec("rollback");
});
afterAll(async () => {
	await db.close();
});

it("preserves all financial rows, epoch, IDs and committed retry results across both RPC names", async () => {
	expect(await facts()).toEqual(before);
	expect(await scalar("select epoch from dues_control where id=1")).toBe(
		oldEpoch,
	);
	expect(await command({ action: "apply" }, request, oldRevision)).toEqual(
		oldResult,
	);
	expect(
		await command({ action: "apply" }, request, oldRevision, "dues_v2_command"),
	).toEqual(oldResult);
	expect(await facts()).toEqual(before);
	expect(await scalar("select dues_read()=dues_v2_read()")).toBe(true);
	expect(
		await scalar("select dues_ledger('2026-08')=dues_v2_ledger('2026-08')"),
	).toBe(true);
	await db.exec("select dues_assert()");
});
it("retires old endpoints and archives tables without exposing rows or private helpers", async () => {
	expect(
		await scalar(
			"select to_regprocedure('public.dues_confirm_match()') is null",
		),
	).toBe(true);
	expect(await scalar("select count(*) from dues_legacy.dues_charges")).toBe(7);
	for (const fn of [
		"dues_execute(jsonb,uuid,bigint)",
		"dues_allocate(uuid,uuid,integer,boolean)",
		"dues_run_scheduled()",
	])
		expect(
			await scalar(
				"select has_function_privilege('authenticated',$1,'execute')",
				[fn],
			),
		).toBe(false);
	expect(
		await scalar(
			"select has_function_privilege('anon','dues_command(jsonb,uuid,bigint)','execute')",
		),
	).toBe(false);
	expect(
		await scalar(
			"select has_table_privilege('authenticated','dues_operations','select')",
		),
	).toBe(false);
	await rejects(
		"update dues_legacy.dues_charges set amount_due=1 where id=100",
		/보관 자료/,
	);
	await db.exec("set role authenticated");
	await rejects("select * from dues_legacy.dues_charges", /permission denied/);
	await rejects("select dues_legacy.dues_confirm_match()", /permission denied/);
	expect(await scalar("select dues_read()=dues_v2_read()")).toBe(true);
});
it("updates the scheduled command and name while preserving cadence, ID and active flag", async () => {
	expect((await db.query("select * from cron.job")).rows).toEqual([
		{
			jobid: 41,
			jobname: "dues-v2-month-and-carry",
			schedule: "*/7 * * * *",
			command: "select public.dues_run_scheduled()",
			active: false,
		},
	]);
	await db.exec(
		"select dues_run_scheduled(); select dues_run_scheduled(); select dues_assert()",
	);
	const counts = await scalar("select count(*) from dues_charges");
	await db.exec("select dues_run_scheduled()");
	expect(await scalar("select count(*) from dues_charges")).toBe(counts);
});
async function upcoming() {
	await db.exec(`insert into places values(10,'합성 대관',true);
  insert into sessions(id,title,status,scheduled_at,ends_at,place_id) values(10,'예정','open','2026-09-13T09:00:00+09','2026-09-13T12:00:00+09',10);
  insert into attendances(session_id,member_id,status) values(10,'${A}','confirmed'),(10,'${B}','confirmed');
  insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',6000,'2026-09-11T12:00:00+09');`);
	return scalar<string>("select id from dues_positions where bank_tx_id=90");
}
it("rechecks a newly prepaid one-off at deletion, preserves money, and removes it from candidates", async () => {
	const position = await upcoming();
	expect(await scalar("select dues_session_deletion(10)->'preserve'")).toBe(
		false,
	);
	await command({
		action: "pay",
		owner_id: A,
		confirm_owner: true,
		lines: [
			{
				position_id: position,
				session_id: 10,
				expected_amount: 6000,
				amount: 6000,
			},
		],
	});
	expect(await scalar("select dues_session_deletion(10)")).toEqual({
		preserve: true,
		paid_count: 1,
	});
	const paidFacts = await facts();
	expect(await scalar("select dues_delete_session(10)->'preserve'")).toBe(true);
	expect(await scalar("select status from sessions where id=10")).toBe(
		"cancelled",
	);
	expect(await facts()).toEqual(paidFacts);
	expect(
		await scalar("select jsonb_array_length(dues_read()->'prepayments')"),
	).toBe(0);
	await db.exec("select dues_assert()");
});
it("closes a prepaid session via the actual old-named trigger and issues only remaining attendees", async () => {
	const position = await upcoming();
	await command({
		action: "pay",
		owner_id: A,
		confirm_owner: true,
		lines: [
			{
				position_id: position,
				session_id: 10,
				expected_amount: 6000,
				amount: 6000,
			},
		],
	});
	await db.exec(
		"insert into matches values(10,10); update sessions set status='closed' where id=10",
	);
	expect(
		await scalar(
			"select count(*) from dues_charges c join dues_groups g on g.id=c.group_id where g.session_id=10",
		),
	).toBe(2);
	expect(
		await scalar(
			"select sum(amount-reversed) from dues_allocations where bank_tx_id=90",
		),
	).toBe(6000);
	await db.exec(
		"select dues_generate_session_court(10,true); select dues_assert()",
	);
	expect(
		await scalar(
			"select count(*) from dues_charges c join dues_groups g on g.id=c.group_id where g.session_id=10",
		),
	).toBe(2);
});
it("deletes an unbilled one-off, preserves recurring/issued/bank-linked sessions, and rejects unavailable sessions", async () => {
	await upcoming();
	await db.exec("select dues_delete_session(10)");
	expect(await scalar("select count(*) from sessions where id=10")).toBe(0);
	await db.exec(
		"insert into sessions(id,status,recurring_schedule_id) values(20,'open',1),(21,'open',null); insert into bank_transactions(id,direction,amount,session_id) values(91,'out',100,21)",
	);
	expect(await scalar("select dues_delete_session(20)->'preserve'")).toBe(true);
	expect(await scalar("select dues_delete_session(21)->'preserve'")).toBe(true);
	expect(await scalar("select dues_delete_session(1)->'preserve'")).toBe(true);
	await rejects("select dues_delete_session(999)", /회차가 없습니다/);
});
it("keeps bank inserts connected and forbids every raw update/delete after promotion", async () => {
	await db.exec(
		"insert into bank_transactions(id,direction,amount) values(90,'in',7000),(91,'out',3000)",
	);
	expect(
		await scalar("select amount from dues_positions where bank_tx_id=90"),
	).toBe(7000);
	expect(
		await scalar("select count(*) from dues_expenses where bank_tx_id=91"),
	).toBe(1);
	await rejects(
		"update bank_transactions set amount=1 where id=90",
		/통장 원본/,
	);
	await rejects("delete from bank_transactions where id=90", /통장 원본/);
	await db.exec("select dues_assert()");
});
it("preserves issued debts when deactivating or granting honorary membership", async () => {
	const original = await facts();
	await db.exec(
		`select dues_set_honorary('${A}',true,'명예회원'); update members set is_active=false where id='${B}'`,
	);
	expect(await facts()).toEqual(original);
	expect(
		await scalar("select count(*) from dues_monthly_targets('2026-10')"),
	).toBe(0);
});
it("checks admin privileges for settings/deletion, member ownership for reads, and old-name RPCs", async () => {
	await db.exec(
		`set test.admin='false'; set test.member='${A}'; set role authenticated`,
	);
	const data = await scalar<{ charges: { member_id: string }[] }>(
		"select dues_v2_read()",
	);
	expect(data.charges.every((c) => c.member_id === A)).toBe(true);
	await rejects("select dues_session_deletion(1)", /forbidden/);
	await rejects("select dues_delete_session(1)", /forbidden/);
	await rejects("select dues_set_session_fee(1,7000)", /forbidden/);
	await rejects(`select dues_set_honorary('${A}',true,'test')`, /forbidden/);
	await rejects(
		`select dues_v2_command('{"action":"apply"}',gen_random_uuid(),0)`,
		/forbidden/,
	);
});

it("rolls back every rename when the financial invariant check fails", async () => {
	const isolated = new PGlite();
	try {
		await isolated.exec(read("tests/fixtures/dues-v2-legacy.sql"));
		for (const file of [
			"20260907030000_dues_v2.sql",
			"20260907050000_dues_v2_payer_refunds.sql",
			"20260907060000_dues_v2_quick_settlement.sql",
			"20260907070000_dues_v2_payer_choice.sql",
		])
			await isolated.exec(read(`migrations/${file}`));
		await isolated.exec(read("tests/fixtures/dues-v2-seed.sql"));
		for (const file of [
			"20260908010000_retire_dues_recovery.sql",
			"20260908020000_reference_meal_roster.sql",
			"20260910010000_court_prepayment.sql",
		])
			await isolated.exec(read(`migrations/${file}`));
		await isolated.exec(
			"update dues_v2_positions set amount=amount+1 where bank_tx_id=2 and amount>0",
		);
		await expect(isolated.exec(migration)).rejects.toThrow(
			/보존|invariant|balance|잔액|금액/i,
		);
		await isolated.exec("rollback");
		const result = await isolated.query(
			"select to_regclass('public.dues_v2_control') is not null as original, to_regclass('public.dues_control') is null as unpromoted, not exists(select 1 from pg_namespace where nspname='dues_legacy') as unarchived",
		);
		expect(result.rows).toEqual([
			{ original: true, unpromoted: true, unarchived: true },
		]);
		expect(
			(await isolated.query("select count(*)::int as n from dues_charges"))
				.rows,
		).toEqual([{ n: 7 }]);
	} finally {
		await isolated.close();
	}
});
