import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";

const read = (p: string) =>
	readFileSync(new URL(`../../../supabase/${p}`, import.meta.url), "utf8");
const migration = read(
	"migrations/20260916010000_cancel_inactive_member_monthly_dues.sql",
);
const honoraryMigration = read(
	"migrations/20260916020000_waive_honorary_member_monthly_dues.sql",
);
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
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
) =>
	scalar("select dues_command($1,$2,$3)", [
		{ reason: "deactivation test", ...p },
		request,
		rev ?? (await revision()),
	]);
const deactivate = (member = B) =>
	db.query("update members set is_active=false where id=$1", [member]);
const charge = (id: string) =>
	scalar<{ state: string; amount: number; basis: Record<string, unknown> }>(
		"select to_jsonb(c) from dues_charges c where id=$1",
		[id],
	);
const legacyCharge = (id: number) =>
	scalar<string>("select id from dues_charges where legacy_id=$1", [id]);
async function facts(tables: string[]) {
	const result: Record<string, unknown> = {};
	for (const table of tables)
		result[table] = await scalar(
			`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t`,
		);
	return result;
}
const money = () =>
	facts([
		"bank_transactions",
		"dues_allocations",
		"dues_reversals",
		"dues_positions",
		"dues_refunds",
		"dues_expenses",
	]);
async function rejects(sql: string, args: unknown[], pattern: RegExp) {
	await db.exec("savepoint failure");
	try {
		await expect(db.query(sql, args)).rejects.toThrow(pattern);
	} finally {
		await db.exec("rollback to savepoint failure");
	}
}
async function addCharge(
	kind = "monthly",
	member = B,
	state = "live",
	schedule = [5000],
) {
	const group = await scalar<string>(
		"insert into dues_groups(source_key,kind,label,occurred_on) values($1,$2,'test','2026-06-01') returning id",
		[crypto.randomUUID(), kind],
	);
	const id = await scalar<string>(
		"insert into dues_charges(group_id,member_id,amount,state) values($1,$2,5000,$3) returning id",
		[group, member, state],
	);
	for (const [index, amount] of schedule.entries())
		await db.query(
			"insert into dues_due(charge_id,due_ym,remaining) values($1,$2,$3)",
			[
				id,
				`2026-${String(6 + index).padStart(2, "0")}`,
				state === "live" ? amount : 0,
			],
		);
	return id;
}
async function pay(id: string, amount: number) {
	const due = await scalar<string>(
		"select id from dues_due where charge_id=$1 and remaining>0 limit 1",
		[id],
	);
	const pos = await scalar<string>(
		"select id from dues_positions where bank_tx_id=90 and amount>=$1 order by amount desc limit 1",
		[amount],
	);
	await command({
		action: "pay",
		owner_id: B,
		confirm_owner: true,
		lines: [{ position_id: pos, due_id: due, amount }],
	});
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
	await db.exec(
		read("migrations/20260914010000_restore_reversed_prepayment.sql"),
	);
	await db.exec(read("migrations/20260821010000_guard_member_is_active.sql"));
}, 30000);
beforeEach(async () => {
	await db.exec("begin");
	await db.exec(
		"insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',8000,now()); select dues_sync_bank()",
	);
});
afterEach(async () => {
	await db.exec("rollback");
});
afterAll(async () => {
	await db.close();
});

it("backfills inactive members once, cancels all unpaid monthly due slices and preserves other charges and money", async () => {
	const unpaid = await legacyCharge(106);
	const carried = await addCharge("monthly", B, "live", [2000, 3000]);
	const partial = await addCharge();
	const paid = await addCharge();
	const court = await addCharge("court");
	const manual = await addCharge("manual");
	const active = await addCharge("monthly", A);
	const waived = await addCharge("monthly", B, "waived");
	const cancelled = await addCharge("monthly", B, "cancelled");
	await pay(partial, 2000);
	await pay(paid, 5000);
	const preserved = [
		partial,
		paid,
		court,
		manual,
		active,
		waived,
		cancelled,
		await legacyCharge(104),
	];
	const beforeCharges = await Promise.all(preserved.map(charge));
	const beforeMoney = await money();
	await deactivate();
	expect((await charge(unpaid)).state).toBe("live");
	const rev = await revision();
	await db.exec(migration);
	for (const id of [unpaid, carried]) {
		expect(await charge(id)).toMatchObject({
			state: "cancelled",
			amount: 5000,
			basis: { member_deactivated: true },
		});
		expect(
			await scalar(
				"select sum(remaining)::int from dues_due where charge_id=$1",
				[id],
			),
		).toBe(0);
	}
	expect(await Promise.all(preserved.map(charge))).toEqual(beforeCharges);
	expect(await money()).toEqual(beforeMoney);
	expect(await revision()).toBe(rev + 1);
	const audit = await scalar<{
		payload: { charge_ids: string[] };
		result: { count: number; items: unknown[] };
	}>(
		"select to_jsonb(o) from dues_operations o where payload->>'source'='member_deactivation'",
	);
	expect(audit.payload.charge_ids.sort()).toEqual([unpaid, carried].sort());
	expect(audit.result.count).toBe(2);
	expect(audit.result.items).toHaveLength(2);
	const after = await facts([
		"dues_charges",
		"dues_due",
		"dues_operations",
		"dues_control",
	]);
	await db.exec(migration);
	expect(
		await facts([
			"dues_charges",
			"dues_due",
			"dues_operations",
			"dues_control",
		]),
	).toEqual(after);
	await db.exec("select dues_assert()");
});

it("automatically cancels on deactivation and never revives charges on repeated updates, reactivation or generation", async () => {
	await db.exec(migration);
	const id = await legacyCharge(106);
	await deactivate();
	expect((await charge(id)).state).toBe("cancelled");
	expect(
		await scalar(
			"select count(*)::int from dues_monthly_targets('2030-01') where member_id=$1",
			[B],
		),
	).toBe(0);
	const rev = await revision();
	await deactivate();
	await db.query("update members set is_active=true where id=$1", [B]);
	await db.exec("select dues_generate_monthly('2026-07')");
	expect((await charge(id)).state).toBe("cancelled");
	expect(
		await scalar(
			"select count(*)::int from dues_charges where group_id=(select group_id from dues_charges where id=$1) and member_id=$2",
			[id, B],
		),
	).toBe(1);
	expect(await revision()).toBe(rev);
	await db.exec("select dues_assert()");
});

it("preserves fully reversed payment history while cancelling the newly unpaid monthly charge", async () => {
	await db.exec(migration);
	const id = await legacyCharge(104);
	const allocation = await scalar<string>(
		"select id from dues_allocations where charge_id=$1",
		[id],
	);
	await command({
		action: "reverse_payment",
		allocation_id: allocation,
		amount: 5000,
	});
	const before = await money();
	await deactivate();
	expect((await charge(id)).state).toBe("cancelled");
	expect(await money()).toEqual(before);
	await db.exec("select dues_assert()");
});

it("invalidates stale financial confirmations and preserves already committed request retries", async () => {
	await db.exec(migration);
	const request = crypto.randomUUID();
	const oldRevision = await revision();
	const payload = { action: "apply", reason: "deactivation test" };
	const result = await command(payload, request, oldRevision);
	const staleRevision = await revision();
	await deactivate();
	await rejects(
		"select dues_command($1,$2,$3)",
		[payload, crypto.randomUUID(), staleRevision],
		/새로고침/,
	);
	expect(await command(payload, request, oldRevision)).toEqual(result);
});

it("rolls back the member change if the financial cancellation cannot complete", async () => {
	await db.exec(migration);
	await db.exec("update dues_control set paused=true where id=1");
	const before = await facts([
		"members",
		"dues_charges",
		"dues_due",
		"dues_operations",
		"dues_control",
	]);
	await rejects(
		"update members set is_active=false where id=$1",
		[B],
		/일시 중지/,
	);
	expect(
		await facts([
			"members",
			"dues_charges",
			"dues_due",
			"dues_operations",
			"dues_control",
		]),
	).toEqual(before);
});

it("keeps private cancellation helpers and direct member deactivation unavailable to ordinary members", async () => {
	await db.exec(migration);
	for (const role of ["anon", "authenticated"]) {
		for (const fn of [
			"dues_cancel_inactive_monthly(uuid)",
			"members_uncharge_dues_on_deactivate()",
		]) {
			expect(
				await scalar("select has_function_privilege($1,$2,'execute')", [
					role,
					fn,
				]),
			).toBe(false);
		}
	}
	await db.exec(
		"grant select,update on members to authenticated; set test.admin='false'; set local role authenticated",
	);
	await rejects(
		"update members set is_active=false where id=$1",
		[B],
		/forbidden/,
	);
	await db.exec("reset role; set test.admin='true'");
	expect((await charge(await legacyCharge(106))).state).toBe("live");
});

it("backfills honorary unpaid monthly charges, including carried debt, without changing paid charges or money", async () => {
	await db.exec(migration);
	const unpaid = await legacyCharge(106);
	const carried = await addCharge("monthly", B, "live", [2000, 3000]);
	const partial = await addCharge();
	await pay(partial, 2000);
	const preserved = [
		partial,
		await legacyCharge(104),
		await addCharge("court"),
		await addCharge("manual"),
		await addCharge("monthly", A),
		await addCharge("monthly", B, "waived"),
		await addCharge("monthly", B, "cancelled"),
	];
	await scalar("select dues_set_honorary($1,true,'test')", [B]);
	expect((await charge(unpaid)).state).toBe("live");
	const beforeCharges = await Promise.all(preserved.map(charge));
	const beforeMoney = await money();
	await db.exec(honoraryMigration);
	for (const id of [unpaid, carried]) {
		expect((await charge(id)).state).toBe("waived");
		expect(
			await scalar(
				"select sum(remaining)::int from dues_due where charge_id=$1",
				[id],
			),
		).toBe(0);
	}
	expect(await Promise.all(preserved.map(charge))).toEqual(beforeCharges);
	expect(await money()).toEqual(beforeMoney);
	expect(
		await scalar(
			"select count(*)::int from dues_operations where action='waive' and payload->>'source'='honorary_membership'",
		),
	).toBe(2);
	const after = await facts([
		"dues_charges",
		"dues_due",
		"dues_operations",
		"dues_control",
	]);
	await db.exec(honoraryMigration);
	expect(
		await facts([
			"dues_charges",
			"dues_due",
			"dues_operations",
			"dues_control",
		]),
	).toEqual(after);
	await db.exec("select dues_assert()");
});

it("waives unpaid dues in the honorary RPC, returns the count, and never revives them after honorary removal", async () => {
	await db.exec(migration);
	await db.exec(honoraryMigration);
	const unpaid = await legacyCharge(106);
	const reversed = await legacyCharge(104);
	const allocation = await scalar<string>(
		"select id from dues_allocations where charge_id=$1",
		[reversed],
	);
	await command({
		action: "reverse_payment",
		allocation_id: allocation,
		amount: 5000,
	});
	const beforeMoney = await money();
	const rev = await revision();
	expect(
		await scalar("select dues_set_honorary($1,true,'test')", [B]),
	).toMatchObject({ ok: true, honorary: true, cleared_unpaid: 2 });
	expect(await revision()).toBe(rev + 2);
	for (const id of [unpaid, reversed])
		expect((await charge(id)).state).toBe("waived");
	expect(await money()).toEqual(beforeMoney);
	expect(
		await scalar(
			"select count(*)::int from dues_monthly_targets('2030-01') where member_id=$1",
			[B],
		),
	).toBe(0);
	const audit = await facts(["dues_operations"]);
	expect(
		await scalar("select dues_set_honorary($1,true,'updated reason')", [B]),
	).toMatchObject({ cleared_unpaid: 0 });
	expect(await facts(["dues_operations"])).toEqual(audit);
	expect(await scalar("select dues_set_honorary($1,false)", [B])).toMatchObject(
		{ honorary: false, cleared_unpaid: 0 },
	);
	await db.exec("select dues_generate_monthly('2026-07')");
	expect((await charge(unpaid)).state).toBe("waived");
	await deactivate();
	expect((await charge(unpaid)).state).toBe("waived");
	await db.exec("select dues_assert()");
});

it("rolls back honorary status and reason together when the waiver cannot complete", async () => {
	await db.exec(migration);
	await db.exec(honoraryMigration);
	await db.exec("update dues_control set paused=true where id=1");
	const tables = [
		"members",
		"member_honorary",
		"dues_charges",
		"dues_due",
		"dues_operations",
		"dues_control",
	];
	const before = await facts(tables);
	await rejects("select dues_set_honorary($1,true,'test')", [B], /일시 중지/);
	expect(await facts(tables)).toEqual(before);
});

it("keeps honorary waiver helpers private and requires admin permission for designation", async () => {
	await db.exec(migration);
	await db.exec(honoraryMigration);
	for (const role of ["anon", "authenticated"]) {
		expect(
			await scalar(
				"select has_function_privilege($1,'dues_waive_honorary_monthly(uuid)','execute')",
				[role],
			),
		).toBe(false);
	}
	await db.exec("set test.admin='false'; set local role authenticated");
	await rejects("select dues_set_honorary($1,true,'test')", [B], /forbidden/);
	await db.exec("set test.admin='true'");
	expect(
		await scalar("select dues_set_honorary($1,true,'test')", [B]),
	).toMatchObject({ cleared_unpaid: 1 });
	await db.exec("reset role");
	expect((await charge(await legacyCharge(106))).state).toBe("waived");
});
