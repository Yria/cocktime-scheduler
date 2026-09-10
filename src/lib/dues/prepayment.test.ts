import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import legacy from "../../../supabase/tests/fixtures/dues-v2-legacy.sql?raw";
import seed from "../../../supabase/tests/fixtures/dues-v2-seed.sql?raw";
import initial from "../../../supabase/migrations/20260907030000_dues_v2.sql?raw";
import refunds from "../../../supabase/migrations/20260907050000_dues_v2_payer_refunds.sql?raw";
import quick from "../../../supabase/migrations/20260907060000_dues_v2_quick_settlement.sql?raw";
import payer from "../../../supabase/migrations/20260907070000_dues_v2_payer_choice.sql?raw";
import retirement from "../../../supabase/migrations/20260908010000_retire_dues_recovery.sql?raw";
import migration from "../../../supabase/migrations/20260910010000_court_prepayment.sql?raw";
import targets from "../../../supabase/migrations/20260818000000_court_targets_include_board_added.sql?raw";
import grace from "../../../supabase/migrations/20260810000000_day_cancel_grace_1h.sql?raw";
import type { AccountingData } from "./types";

let db: PGlite;
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1),
	B = id(2);
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
async function command(
	p: Record<string, unknown>,
	request = crypto.randomUUID(),
	rev?: number,
) {
	return scalar("select dues_v2_command($1,$2,$3)", [
		{ reason: "fixture", ...p },
		request,
		rev ?? (await revision()),
	]);
}
const position = () =>
	scalar<string>(
		"select id from dues_v2_positions where bank_tx_id=90 and amount>0",
	);
const candidates = () =>
	scalar<NonNullable<AccountingData["prepayments"]>>(
		"select dues_v2_read()->'prepayments'",
	);
async function facts() {
	const out: Record<string, unknown> = {};
	for (const table of [
		"bank_transactions",
		"dues_charges",
		"dues_allocations",
		"dues_batches",
		...[
			"groups",
			"charges",
			"due",
			"positions",
			"allocations",
			"refunds",
			"expenses",
			"drafts",
			"operations",
		].map((t) => `dues_v2_${t}`),
	])
		out[table] = await scalar(
			`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t`,
		);
	return out;
}
async function pay(amount = 6000, owner = A, session = 10, expected = 6000) {
	return {
		action: "pay",
		owner_id: owner,
		confirm_owner: true,
		lines: [
			{
				position_id: await position(),
				session_id: session,
				expected_amount: expected,
				amount,
			},
		],
	};
}
async function rejects(p: Record<string, unknown>, message: RegExp) {
	const before = await facts();
	await db.exec("savepoint rejection");
	await expect(command(p)).rejects.toThrow(message);
	await db.exec("rollback to savepoint rejection");
	expect(await facts()).toEqual(before);
}
beforeAll(async () => {
	db = new PGlite();
	for (const sql of [legacy, initial, refunds, quick, payer])
		await db.exec(sql);
	await db.exec(`alter table attendances add column invited_by uuid, add column confirmed_at timestamptz, add column cancelled_at timestamptz;
    create function is_operator(uuid) returns boolean language sql as $$ select $1='${id(4)}'::uuid $$;`);
	for (const [sql, name] of [
		[grace, "dues_is_day_cancel_chargeable"],
		[targets, "dues_court_targets"],
	]) {
		const start = sql.indexOf(`create or replace function public.${name}(`);
		await db.exec(sql.slice(start, sql.indexOf("$function$;", start) + 12));
	}
}, 30000);
beforeEach(async ({ task }) => {
	await db.exec("begin");
	await db.exec(seed);
	await db.exec(retirement);
	await db.exec(`insert into places values(10,'에이트민턴',true),(11,'무료 체육관',false);
    insert into sessions(id,title,status,scheduled_at,ends_at,place_id) values
    (10,'오전','open','2026-09-13T09:00:00+09','2026-09-13T12:00:00+09',10),
    (11,'오후','open','2026-09-13T15:00:00+09','2026-09-13T18:00:00+09',10),
    (12,'다음달','open','2026-10-04T09:00:00+09','2026-10-04T12:00:00+09',10);
    insert into members(id,name,is_guest) values('${id(5)}','게스트',true),('${id(6)}','대기',false),('${id(7)}','취소',false),('${id(8)}','보드만',false);
    insert into attendances(session_id,member_id,status) values
    (10,'${A}','confirmed'),(10,'${B}','late_pool'),(10,'${id(4)}','confirmed'),(10,'${id(5)}','confirmed'),(10,'${id(6)}','waitlisted'),(10,'${id(7)}','cancelled'),
    (11,'${A}','confirmed'),(12,'${B}','confirmed');
    insert into session_players values(10,'${id(8)}');
    insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',${task.name.startsWith("combines") ? 15000 : 8000},'2026-09-10T12:00:00+09','김지훈0913');
    select dues_v2_sync_bank();`);
});
afterEach(async () => {
	await db.exec("rollback");
});
afterAll(async () => {
	await db.close();
});

it("installs and reads upcoming attendance without changing July/August or any financial facts, and hides candidates from members", async () => {
	const before = await facts();
	await db.exec(migration);
	const rows = await candidates();
	expect(
		rows
			.filter((p) => p.session_id === 10)
			.map((p) => p.member_id)
			.sort(),
	).toEqual([A, B, id(5)]);
	expect(rows.find((p) => p.session_id === 12)).toMatchObject({
		member_id: B,
		due_ym: "2026-10",
		amount: 6000,
	});
	expect(rows.find((p) => p.session_id === 10)?.label).toContain("09:00–12:00");
	expect(rows.find((p) => p.session_id === 11)?.label).toContain("15:00–18:00");
	expect(await facts()).toEqual(before);
	const deniedPayload = await pay(),
		deniedRevision = await revision();
	await db.exec(
		`set test.admin='false';set test.member='${A}';set role authenticated;`,
	);
	expect(await candidates()).toEqual([]);
	expect(
		await scalar(
			"select has_function_privilege('authenticated','dues_v2_prepay_due(bigint,uuid,integer)','execute')",
		),
	).toBe(false);
	await expect(
		scalar("select dues_v2_command($1,$2,$3)", [
			{ reason: "fixture", ...deniedPayload },
			crypto.randomUUID(),
			deniedRevision,
		]),
	).rejects.toThrow("forbidden");
});
it("previews without writing, pays only the selected member once, preserves the remainder and avoids reissuing after closure", async () => {
	await db.exec(migration);
	const p = await pay(),
		request = crypto.randomUUID(),
		rev = await revision(),
		before = await facts();
	await scalar("select dues_v2_preview($1,$2,$3)", [
		{ reason: "fixture", ...p },
		request,
		rev,
	]);
	expect(await facts()).toEqual(before);
	const result = await command(p, request, rev);
	expect(result).toMatchObject({ paid: 6000 });
	expect(await command(p, request, rev)).toEqual(result);
	expect(
		await scalar(
			"select sum(amount)::int from dues_v2_positions where bank_tx_id=90",
		),
	).toBe(2000);
	expect(
		await scalar(
			"select count(*)::int from dues_v2_charges c join dues_v2_groups g on g.id=c.group_id where g.session_id=10",
		),
	).toBe(1);
	const issued = await scalar(
		"select to_jsonb(c) from dues_v2_charges c join dues_v2_groups g on g.id=c.group_id where g.session_id=10",
	);
	expect(await candidates()).not.toContainEqual(
		expect.objectContaining({ session_id: 10, member_id: A }),
	);
	await db.exec(
		"update sessions set status='closed' where id=10; select dues_v2_auto_issue('court','2026-09',10,true);",
	);
	expect(
		await scalar(
			"select to_jsonb(c) from dues_v2_charges c join dues_v2_groups g on g.id=c.group_id where g.session_id=10 and c.member_id=$1",
			[A],
		),
	).toEqual(issued);
	expect(
		await scalar(
			"select count(*)::int from dues_v2_charges c join dues_v2_groups g on g.id=c.group_id where g.session_id=10 and c.member_id=$1",
			[A],
		),
	).toBe(1);
});
it("partial prepayment leaves one ordinary outstanding charge and later payment reuses it", async () => {
	await db.exec(migration);
	await command(await pay(3000));
	const due = await scalar<string>(
		"select d.id from dues_v2_due d join dues_v2_charges c on c.id=d.charge_id join dues_v2_groups g on g.id=c.group_id where g.session_id=10",
	);
	expect(
		await scalar("select remaining from dues_v2_due where id=$1", [due]),
	).toBe(3000);
	await command({
		action: "pay",
		owner_id: A,
		lines: [{ position_id: await position(), due_id: due, amount: 3000 }],
	});
	expect(
		await scalar("select remaining from dues_v2_due where id=$1", [due]),
	).toBe(0);
	expect(
		await scalar(
			"select count(*)::int from dues_v2_charges c join dues_v2_groups g on g.id=c.group_id where g.session_id=10",
		),
	).toBe(1);
});
it("combines a previous obligation and next-month prepayment while keeping cash in the deposit month", async () => {
	await db.exec(migration);
	const due = await scalar<string>(
		"select d.id from dues_v2_due d join dues_v2_charges c on c.id=d.charge_id where c.member_id=$1 and d.remaining>0",
		[B],
	);
	const p = await pay(6000, B, 12);
	await command({
		...p,
		lines: [
			{ position_id: await position(), due_id: due, amount: 5000 },
			...p.lines,
		],
	});
	expect(
		await scalar(
			"select sum(amount)::int from dues_v2_positions where bank_tx_id=90",
		),
	).toBe(4000);
	expect(
		await scalar(
			"select to_char(occurred_at at time zone 'Asia/Seoul','YYYY-MM') from bank_transactions where id=90",
		),
	).toBe("2026-09");
	expect(
		await scalar(
			"select d.due_ym from dues_v2_due d join dues_v2_charges c on c.id=d.charge_id join dues_v2_groups g on g.id=c.group_id where g.session_id=12",
		),
	).toBe("2026-10");
});
it("rejects changed attendance, fees, session eligibility and already issued targets atomically", async () => {
	await db.exec(migration);
	const p = await pay();
	for (const sql of [
		`update attendances set status='cancelled' where session_id=10 and member_id='${A}'`,
		"update dues_settings set court_fee_default=7000",
		"update sessions set status='closed' where id=10",
		"update sessions set place_id=11 where id=10",
		"update sessions set court_fee=0 where id=10",
	]) {
		await db.exec("savepoint change");
		await db.exec(sql);
		await rejects(p, /변경됐습니다/);
		await db.exec("rollback to savepoint change");
	}
	await command(p);
	await rejects(await pay(1000), /변경됐습니다/);
});
it("rolls back payer matching and charge creation on overspending or invalid target amounts", async () => {
	await db.exec(migration);
	await rejects(await pay(6001), /금액|잔액/);
	await rejects(await pay(3000, A, 10, 1), /변경됐습니다/);
	await rejects(await pay(3000, id(4)), /변경됐습니다/);
	await rejects({ ...(await pay()), owner_id: null }, /변경됐습니다/);
	const p = await pay();
	await rejects(
		{ ...p, lines: [...p.lines, { ...p.lines[0], session_id: 11 }] },
		/금액|잔액/,
	);
	expect(
		await scalar("select owner_id from dues_v2_positions where bank_tx_id=90"),
	).toBe(null);
});
it("reverses prepayment through the existing allocation action without reviving its candidate or losing the original owner", async () => {
	await db.exec(migration);
	await command(await pay());
	const allocation = await scalar<string>(
		"select id from dues_v2_allocations where bank_tx_id=90",
	);
	await command({
		action: "reverse_payment",
		allocation_id: allocation,
		amount: 6000,
	});
	expect(
		await scalar(
			"select sum(amount)::int from dues_v2_positions where bank_tx_id=90",
		),
	).toBe(8000);
	expect(await candidates()).not.toContainEqual(
		expect.objectContaining({ session_id: 10, member_id: A }),
	);
	expect(
		await scalar(
			"select count(distinct owner_id)::int from dues_v2_positions where bank_tx_id=90",
		),
	).toBe(1);
	expect(
		await scalar("select owner_id from dues_v2_allocations where id=$1", [
			allocation,
		]),
	).toBe(A);
});
it("uses actual split pricing and recurring fees, with no suggestions for free or closed sessions", async () => {
	await db.exec(migration);
	// Split includes the operator and actual board target in its denominator: five participants.
	await db.exec(
		"insert into recurring_schedules values(1,31000);update sessions set recurring_schedule_id=1 where id=10;",
	);
	expect(
		(await candidates())
			.filter((p) => p.session_id === 10)
			.every((p) => p.amount === 6200),
	).toBe(true);
	expect(await candidates()).toContainEqual(
		expect.objectContaining({ member_id: id(4), session_id: 10, amount: 6200 }),
	);
	await db.exec("update sessions set court_fee=0 where id=10");
	expect((await candidates()).filter((p) => p.session_id === 10)).toEqual([]);
});
