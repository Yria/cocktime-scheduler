import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../../../supabase/${path}`, import.meta.url), "utf8");
const fix = read(
	"migrations/20260920010000_settle_owned_unassigned_receipts.sql",
);
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
let position: string;
let due: string;
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
	payload: Record<string, unknown>,
	request = crypto.randomUUID(),
	rev?: number,
) =>
	scalar("select dues_command($1,$2,$3)", [
		{ reason: "owned receipt regression", ...payload },
		request,
		rev ?? (await revision()),
	]);
const payment = (overrides: Record<string, unknown> = {}) => ({
	action: "pay",
	owner_id: A,
	confirm_owner: false,
	lines: [{ position_id: position, due_id: due, amount: 5000 }],
	...overrides,
});
async function facts() {
	const result: Record<string, unknown> = {};
	for (const table of [
		"bank_transactions",
		"dues_control",
		"dues_groups",
		"dues_charges",
		"dues_due",
		"dues_positions",
		"dues_allocations",
		"dues_reversals",
		"dues_refunds",
		"dues_expenses",
		"dues_operations",
		"dues_drafts",
	])
		result[table] = await scalar(
			`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t`,
		);
	return result;
}
async function rejects(run: () => Promise<unknown>, message: RegExp) {
	await db.exec("savepoint rejected");
	await expect(run()).rejects.toThrow(message);
	await db.exec("rollback to savepoint rejected");
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
	])
		await db.exec(read(`migrations/${file}`));
}, 30000);
beforeEach(async () => {
	await db.exec(
		"begin; insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',11000,'2026-09-20'); select dues_sync_bank()",
	);
	await command({
		action: "issue",
		kind: "manual",
		label: "합성 대관",
		date: "2026-09-20",
		lines: [{ member_id: A, amount: 6000, due_ym: "2026-09" }],
	});
	const courtDue = await scalar<string>(
		"select d.id from dues_due d join dues_charges c on c.id=d.charge_id join dues_groups g on g.id=c.group_id where g.label='합성 대관'",
	);
	position = await scalar<string>(
		"select id from dues_positions where bank_tx_id=90 and amount>0",
	);
	await command({
		action: "pay",
		owner_id: A,
		confirm_owner: true,
		lines: [{ position_id: position, due_id: courtDue, amount: 6000 }],
	});
	const group = await scalar<string>(
		"select id from dues_groups where source_key='monthly:2026-09'",
	);
	await command({
		action: "position",
		position_id: position,
		owner_id: A,
		purpose: "club",
		group_id: group,
		amount: 5000,
	});
	position = await scalar<string>(
		"select id from dues_positions where bank_tx_id=90 and amount>0",
	);
	await command({
		action: "position",
		position_id: position,
		owner_id: A,
		purpose: "unassigned",
		amount: 5000,
	});
	position = await scalar<string>(
		"select id from dues_positions where bank_tx_id=90 and amount>0",
	);
	await command({
		action: "issue",
		kind: "monthly",
		group_id: group,
		label: "9월 회비",
		date: "2026-09-01",
		ym: "2026-09",
		lines: [{ member_id: A, amount: 5000, due_ym: "2026-09" }],
	});
	due = await scalar<string>(
		"select d.id from dues_due d join dues_charges c on c.id=d.charge_id join dues_groups g on g.id=c.group_id where g.source_key='monthly:2026-09' and c.member_id=$1",
		[A],
	);
});
afterEach(async () => {
	await db.exec("rollback");
});
afterAll(async () => {
	await db.close();
});

it("reproduces the rejection, installs without ledger changes, then settles the remaining 5,000 exactly once", async () => {
	await rejects(() => command(payment()), /납부할 금액·소유자·납기·잔액/);
	const before = await facts();
	const court = await scalar(
		"select to_jsonb(a) from dues_allocations a where bank_tx_id=90",
	);
	await db.exec(fix);
	expect(await facts()).toEqual(before);
	const request = crypto.randomUUID();
	const rev = await revision();
	const result = await command(payment(), request, rev);
	expect(result).toMatchObject({ paid: 5000 });
	expect(await command(payment(), request, rev)).toEqual(result);
	expect(
		await scalar("select remaining from dues_due where id=$1", [due]),
	).toBe(0);
	expect(
		await scalar(
			"select sum(amount)::int from dues_positions where bank_tx_id=90",
		),
	).toBe(0);
	expect(
		await scalar(
			"select jsonb_agg(amount order by amount) from dues_allocations where bank_tx_id=90",
		),
	).toEqual([5000, 6000]);
	expect(
		await scalar(
			"select to_jsonb(a) from dues_allocations a where bank_tx_id=90 and amount=6000",
		),
	).toEqual(court);
	expect(await scalar("select amount from bank_transactions where id=90")).toBe(
		11000,
	);
	await db.exec("select dues_assert()");
});

it.each([
	"club",
	"refund_pending",
	"carry",
])("does not turn reserved %s money into a payable balance", async (purpose) => {
	await db.exec(fix);
	await db.query(
		"update dues_positions set purpose=$1,available_ym='2999-01',group_id=case when $1='club' then (select id from dues_groups where source_key='monthly:2026-09') end where id=$2",
		[purpose, position],
	);
	const before = await facts();
	await rejects(() => command(payment()), /납부할 금액·소유자·납기·잔액/);
	expect(await facts()).toEqual(before);
});

it("keeps confirmed ownership and rejects reassignment after a partial payment", async () => {
	await db.exec(fix);
	const before = await facts();
	await rejects(
		() => command(payment({ owner_id: B, confirm_owner: true })),
		/납부자를 바꿀 수 없습니다/,
	);
	await rejects(
		() =>
			command(
				payment({ owner_id: B, confirm_owner: true, reassign_owner: true }),
			),
		/납부·환불·이월 처리 전/,
	);
	expect(await facts()).toEqual(before);
});

it("still requires explicit confirmation for an unidentified balance", async () => {
	await db.exec(fix);
	await db.query("update dues_positions set owner_id=null where id=$1", [
		position,
	]);
	await rejects(() => command(payment()), /납부자를 먼저 선택/);
	expect(await command(payment({ confirm_owner: true }))).toMatchObject({
		paid: 5000,
	});
	await db.exec("select dues_assert()");
});

it("rolls back the purpose conversion when an excessive payment is rejected", async () => {
	await db.exec(fix);
	const before = await facts();
	await rejects(
		() =>
			command(
				payment({
					lines: [{ position_id: position, due_id: due, amount: 5001 }],
				}),
			),
		/납부할 금액·소유자·납기·잔액/,
	);
	expect(await facts()).toEqual(before);
});

it("keeps the matching helper private", async () => {
	await db.exec(fix);
	for (const role of ["anon", "authenticated"])
		expect(
			await scalar(
				"select has_function_privilege($1,'dues_match_position(uuid,uuid,boolean)','execute')",
				[role],
			),
		).toBe(false);
});
