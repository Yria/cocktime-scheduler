import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

// 발행 뒤 회차 총액 변경 = 취소 후 재발행(20261019000000). 세션 395 사고 재현.
const read = (path: string) =>
	readFileSync(new URL(`../../../supabase/${path}`, import.meta.url), "utf8");
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const OP = "00000000-0000-4000-8000-000000000004"; // 운영진 — 정액이면 제외, 엔빵이면 포함
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
const setFee = (amount: number | null) =>
	scalar<Record<string, number | boolean | null>>(
		"select dues_set_session_fee(10,$1)",
		[amount],
	);
const charges = () =>
	scalar<
		{
			id: string;
			member_id: string;
			amount: number;
			state: string;
			previous_id: string | null;
			basis: Record<string, unknown>;
			paid: number;
			remaining: number;
		}[]
	>(`select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'member_id',c.member_id,'amount',c.amount,'state',c.state,
      'previous_id',c.previous_id,'basis',c.basis,
      'paid',(select coalesce(sum(a.amount-a.reversed),0) from dues_allocations a where a.charge_id=c.id),
      'remaining',(select coalesce(sum(d.remaining),0) from dues_due d where d.charge_id=c.id))
      order by c.issued_at,c.member_id),'[]')
    from dues_charges c join dues_groups g on g.id=c.group_id where g.source_key='court:10'`);
const live = async () =>
	Object.fromEntries(
		(await charges())
			.filter((c) => c.state === "live")
			.map((c) => [c.member_id, c]),
	);
const balance = (member: string) =>
	scalar<number>(
		"select coalesce(sum(amount),0)::int from dues_positions where owner_id=$1 and purpose in ('member_pending','carry')",
		[member],
	);
async function pay(member: string, amount: number) {
	const due = (await live())[member];
	await scalar("select dues_command($1,$2,$3)", [
		{
			reason: "fee reissue test",
			action: "pay",
			owner_id: member,
			confirm_owner: true,
			lines: [
				{
					position_id: await scalar(
						"select id from dues_positions where bank_tx_id=90 and amount>0",
					),
					due_id: await scalar(
						"select id from dues_due where charge_id=$1",
						[due.id],
					),
					amount,
				},
			],
		},
		crypto.randomUUID(),
		await revision(),
	]);
}
async function rejects(sql: string, pattern: RegExp) {
	await db.exec("savepoint failure");
	try {
		await expect(db.exec(sql)).rejects.toThrow(pattern);
	} finally {
		await db.exec("rollback to savepoint failure");
	}
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
	await db.exec(`alter table sessions add column is_active boolean default true, add column is_overridden boolean default false;
    alter table attendances add column invited_by uuid, add column confirmed_at timestamptz, add column cancelled_at timestamptz;
    create function is_operator(uuid) returns boolean language sql as $$ select $1='${OP}'::uuid $$;`);
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
		"20260911010000_promote_dues.sql",
		"20260914010000_restore_reversed_prepayment.sql",
		"20260920010000_settle_owned_unassigned_receipts.sql",
		"20260921010000_dues_command_patch.sql",
		"20261019000000_session_fee_reissue.sql",
	])
		await db.exec(read(`migrations/${file}`));
	await db.exec(
		"update dues_control set activated_at='2026-09-07T12:00:00+09' where id=1",
	);
}, 30000);
beforeEach(async () => {
	// 일회성 대관 회차: A·B 참석 + 운영진. 총액 미입력으로 종료 → 정액 6,000원 × 2명(운영진 제외) 자동 발행.
	await db.exec(`begin;
    insert into places values(10,'테스트 대관',true);
    insert into sessions(id,title,status,scheduled_at,ends_at,place_id) values(10,'대관','active','2026-10-18T19:00:00+09','2026-10-18T21:00:00+09',10);
    insert into attendances(session_id,member_id,status) values(10,'${A}','confirmed'),(10,'${B}','confirmed'),(10,'${OP}','confirmed');
    insert into matches values(1000,10);
    update sessions set status='closed' where id=10;
    insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',8000,'2026-10-19T12:00:00+09');
    select dues_sync_bank();`);
});
afterEach(async () => {
	await db.exec("rollback");
});
afterAll(async () => {
	await db.close();
});

it("총액 미입력 종료 → 정액 2건 발행 (사고 상황 재현)", async () => {
	const rows = await live();
	expect(Object.keys(rows).sort()).toEqual([A, B]);
	expect(rows[A].amount).toBe(6000);
});

it("늦게 넣은 총액으로 전부 취소 후 재발행하고, 낸 돈은 같은 회원 새 부과에 다시 연결한다", async () => {
	await pay(A, 6000);
	const before = await charges();
	const result = await setFee(30000); // 엔빵 → 운영진 포함 3명, 인당 10,000원
	expect(result).toMatchObject({
		court_fee: 30000,
		per_head: 10000,
		head: 3,
		cancelled: 2,
		paid_cancelled: 1,
		released_amount: 6000,
		reused_amount: 6000,
		left_as_balance: 0,
		reissued: 2,
		issued_new: 1,
		held: 0,
	});
	const all = await charges();
	for (const old of before) {
		const now = all.find((c) => c.id === old.id)!;
		expect(now).toMatchObject({ state: "cancelled", paid: 0, remaining: 0 });
		expect(now.basis.reissuable).toBe(true);
	}
	const rows = await live();
	expect(Object.keys(rows).sort()).toEqual([A, B, OP]);
	expect(rows[A]).toMatchObject({ amount: 10000, paid: 6000, remaining: 4000 });
	expect(rows[A].previous_id).toBe(before.find((c) => c.member_id === A)!.id);
	expect(rows[B]).toMatchObject({ amount: 10000, paid: 0, remaining: 10000 });
	expect(rows[A].basis).toMatchObject({
		rule: "court",
		total: 30000,
		per_head: 10000,
		fee_reset: true,
		line: { member_id: A, is_day_cancel: false },
	});
	expect(rows[OP].previous_id).toBeNull();
	expect(
		await scalar("select court_fee from sessions where id=10"),
	).toBe(30000);
	await db.exec("select dues_assert()");
});

it("같은 값을 다시 저장하면 아무것도 취소하지 않는다", async () => {
	await setFee(30000);
	const before = await charges();
	expect(await setFee(30000)).toMatchObject({ unchanged: true, cancelled: 0 });
	expect(await charges()).toEqual(before);
});

it("총액이 줄면 넘치는 납부는 낸 사람 잔액으로 남는다", async () => {
	await pay(A, 6000);
	const base = await balance(A);
	const result = await setFee(9000); // 3명 × 3,000원
	expect(result).toMatchObject({
		per_head: 3000,
		reused_amount: 3000,
		left_as_balance: 3000,
	});
	expect((await live())[A]).toMatchObject({ amount: 3000, remaining: 0 });
	expect((await balance(A)) - base).toBe(3000);
	await db.exec("select dues_assert()");
});

it("0원으로 전부 취소한 뒤 다시 금액을 넣으면 다시 발행된다(reissuable)", async () => {
	await pay(A, 6000);
	const base = await balance(A);
	expect(await setFee(0)).toMatchObject({
		cancelled: 2,
		reissued: 0,
		issued_new: 0,
		left_as_balance: 6000,
	});
	expect(await live()).toEqual({});
	expect((await balance(A)) - base).toBe(6000);
	const zeroed = await charges();
	expect(await setFee(30000)).toMatchObject({ cancelled: 0, issued_new: 3, per_head: 10000 });
	const rows = await live();
	expect(Object.keys(rows).sort()).toEqual([A, B, OP]);
	expect(rows[A].previous_id).toBe(zeroed.find((c) => c.member_id === A)!.id);
	await db.exec("select dues_assert()");
});

it("사람이 면제한 부과는 되살리지 않는다", async () => {
	await scalar("select dues_command($1,$2,$3)", [
		{
			reason: "면제",
			action: "waive",
			charge_id: (await live())[B].id,
		},
		crypto.randomUUID(),
		await revision(),
	]);
	await setFee(30000);
	const all = await charges();
	expect(all.filter((c) => c.member_id === B).map((c) => c.state)).toEqual([
		"waived",
	]);
	expect(Object.keys(await live()).sort()).toEqual([A, OP]);
});

it("인당 금액이 정상 범위를 벗어나면 아무것도 바꾸지 않고 거부한다", async () => {
	const before = await charges();
	await rejects("select dues_set_session_fee(10,60000)", /정상 범위를 벗어납니다/);
	expect(await charges()).toEqual(before);
	expect(await scalar("select court_fee from sessions where id=10")).toBeNull();
});

it("미리보기는 결과만 돌려주고 장부를 바꾸지 않는다", async () => {
	await pay(A, 6000);
	const before = await charges(),
		rev = await revision();
	expect(
		await scalar("select dues_session_fee_preview(10,30000)"),
	).toMatchObject({ preview: true, cancelled: 2, paid_cancelled: 1, issued_new: 1 });
	expect(await charges()).toEqual(before);
	expect(await revision()).toBe(rev);
	expect(await scalar("select court_fee from sessions where id=10")).toBeNull();
});

it("운영진이 아니면 거부한다", async () => {
	await db.exec("set local test.admin='false'");
	await rejects("select dues_set_session_fee(10,30000)", /forbidden/);
	await rejects("select dues_session_fee_preview(10,30000)", /forbidden/);
});

it("진행 전 회차의 선납 부과는 선납 표식을 유지한 채 재발행하고, 나머지는 종료 때 발행한다", async () => {
	await db.exec(`insert into sessions(id,title,status,scheduled_at,ends_at,place_id) values(11,'예정 대관','open',now()+interval '7 days',now()+interval '7 days 2 hours',10);
    insert into attendances(session_id,member_id,status) values(11,'${A}','confirmed'),(11,'${B}','confirmed');`);
	await scalar("select dues_command($1,$2,$3)", [
		{
			reason: "선납",
			action: "pay",
			owner_id: A,
			confirm_owner: true,
			lines: [
				{
					position_id: await scalar(
						"select id from dues_positions where bank_tx_id=90 and amount>0",
					),
					session_id: 11,
					expected_amount: 6000,
					amount: 6000,
				},
			],
		},
		crypto.randomUUID(),
		await revision(),
	]);
	const result = await scalar<Record<string, number>>(
		"select dues_set_session_fee(11,20000)",
	);
	expect(result).toMatchObject({
		per_head: 10000,
		cancelled: 1,
		reissued: 1,
		reused_amount: 6000,
		issued_new: 0,
	});
	const rows = await scalar<{ member_id: string; amount: number; basis: Record<string, unknown> }[]>(
		"select jsonb_agg(to_jsonb(c)) from dues_charges c join dues_groups g on g.id=c.group_id where g.source_key='court:11' and c.state='live'",
	);
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		member_id: A,
		amount: 10000,
		basis: { prepayment: true, fee_reset: true },
	});
	await db.exec("insert into matches values(1100,11); update sessions set status='closed' where id=11");
	expect(
		await scalar(
			"select count(*)::int from dues_charges c join dues_groups g on g.id=c.group_id where g.source_key='court:11' and c.state='live'",
		),
	).toBe(2);
	await db.exec("select dues_assert()");
});
