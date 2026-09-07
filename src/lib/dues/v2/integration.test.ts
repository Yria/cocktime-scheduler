import seed from "../../../../supabase/tests/fixtures/dues-v2-seed.sql?raw";
import legacySchema from "../../../../supabase/tests/fixtures/dues-v2-legacy.sql?raw";
import { PGlite } from "@electric-sql/pglite";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";
import sql from "../../../../supabase/migrations/20260907030000_dues_v2.sql?raw";

import activateSql from "../../../../scripts/accounting-v2-activate.sql?raw";
import quickSql from "../../../../supabase/migrations/20260907060000_dues_v2_quick_settlement.sql?raw";
import refundSql from "../../../../supabase/migrations/20260907050000_dues_v2_payer_refunds.sql?raw";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
let db: PGlite;

async function scalar<T = unknown>(
	query: string,
	params: unknown[] = [],
): Promise<T> {
	const r = await db.query<Record<string, T>>(query, params);
	return Object.values(r.rows[0])[0];
}
async function mode() {
	return scalar<{ revision: number; enabled: boolean }>(
		"select public.dues_v2_mode()",
	);
}
async function manage(action: string) {
	return scalar("select public.dues_v2_manage($1,$2,'test',$3)", [
		action,
		(await mode()).revision,
		crypto.randomUUID(),
	]);
}
async function command(
	payload: Record<string, unknown>,
	request = crypto.randomUUID(),
	revision?: number,
) {
	return scalar<Record<string, unknown>>(
		"select public.dues_v2_command($1,$2,$3)",
		[
			{ reason: "test", ...payload },
			request,
			revision ?? (await mode()).revision,
		],
	);
}
async function charge(legacy: number) {
	return scalar<string>(
		"select id from public.dues_v2_charges where legacy_id=$1",
		[legacy],
	);
}
async function due(legacy: number) {
	return scalar<string>(
		"select d.id from public.dues_v2_due d join public.dues_v2_charges c on c.id=d.charge_id where c.legacy_id=$1",
		[legacy],
	);
}
async function position(bank: number) {
	return scalar<string>(
		"select id from public.dues_v2_positions where bank_tx_id=$1 and amount>0 order by id limit 1",
		[bank],
	);
}
async function state() {
	return scalar("select public.dues_v2_snapshot()");
}
async function expectFailure(
	run: () => Promise<unknown>,
	message?: string | RegExp,
) {
	await db.exec("savepoint expected_failure");
	await expect(run()).rejects.toThrow(message);
	await db.exec("rollback to savepoint expected_failure");
}
async function legacy() {
	return scalar(
		"select jsonb_build_object('charges',(select jsonb_agg(c order by id) from dues_charges c),'allocations',(select jsonb_agg(a order by id) from dues_allocations a),'bank',(select jsonb_agg(t order by id) from bank_transactions t))",
	);
}

beforeAll(async () => {
	db = new PGlite();
	await db.exec(legacySchema);
	try {
		await db.exec(sql);
		await db.exec(refundSql);
		await db.exec(quickSql);
	} catch (error) {
		throw new Error(`Migration failed: ${String(error)}`);
	}
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

describe("real PostgreSQL accounting migration and commands", () => {
	it("preserves a partially paid multi-month schedule through replacement and undo", async () => {
		await manage("activate");
		const id = await charge(106);
		await command({
			action: "carry",
			member_id: B,
			target_ym: "2099-01",
			debts: [{ due_id: await due(106), amount: 3000 }],
		});
		const currentDue = await scalar<string>(
			"select id from dues_v2_due where charge_id=$1 and due_ym='2026-07'",
			[id],
		);
		await command({
			action: "pay",
			proxy: true,
			lines: [
				{ position_id: await position(2), due_id: currentDue, amount: 1000 },
			],
		});
		const before = await state();
		const result = await command({
			action: "replace",
			charge_ids: [id],
			lines: [
				{
					previous_id: id,
					member_id: B,
					amount: 4500,
					due_schedule: [
						{ due_ym: "2026-07", amount: 1500 },
						{ due_ym: "2099-01", amount: 3000 },
					],
				},
			],
		});
		expect(result.reused).toBe(1000);
		expect(
			(
				await db.query(
					"select due_ym,remaining from dues_v2_due d join dues_v2_charges c on c.id=d.charge_id where c.previous_id=$1 order by due_ym",
					[id],
				)
			).rows,
		).toEqual([
			{ due_ym: "2026-07", remaining: 500 },
			{ due_ym: "2099-01", remaining: 3000 },
		]);
		await manage("undo");
		expect(await state()).toEqual(before);
	});

	it("rejects invalid schedules atomically and supports splitting an initial manual issue", async () => {
		await manage("activate");
		const before = await state();
		const payload = {
			action: "issue",
			kind: "manual",
			label: "분납",
			date: "2026-09-01",
			lines: [
				{
					member_id: A,
					amount: 5000,
					due_schedule: [
						{ due_ym: "2026-09", amount: 2000 },
						{ due_ym: "2099-01", amount: 3000 },
					],
				},
			],
		};
		await expectFailure(
			() =>
				command({ ...payload, lines: [{ ...payload.lines[0], amount: 6000 }] }),
			/납기별/,
		);
		expect(await state()).toEqual(before);
		await command(payload);
		expect(
			await scalar(
				"select sum(remaining)::int from dues_v2_due where due_ym='2099-01'",
			),
		).toBe(3000);
	});

	it("rejects multiple payer identities on one receipt while allowing explicit proxy beneficiaries", async () => {
		await manage("activate");
		await db.exec(
			"insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',6000,now())",
		);
		const p = await position(90);
		await command({
			action: "position",
			position_id: p,
			owner_id: A,
			amount: 1000,
			purpose: "member_pending",
		});
		await expectFailure(
			() =>
				command({
					action: "position",
					position_id: p,
					owner_id: B,
					amount: 1000,
					purpose: "member_pending",
				}),
			/돈 소유자/,
		);
		expect(
			await scalar("select amount from dues_v2_positions where id=$1", [p]),
		).toBe(5000);
	});

	it("imports a legacy deferred debt without creating a payment or changing its amount", async () => {
		await db.exec("update dues_charges set deferred_to='2099-01' where id=106");
		await manage("activate");
		expect(
			await scalar("select remaining from dues_v2_due where due_ym='2099-01'"),
		).toBe(5000);
		expect(
			await scalar("select sum(amount)::int from dues_v2_allocations"),
		).toBe(75000);
	});

	it("can activate again after rollback without reviving discarded V2 decisions", async () => {
		await manage("activate");
		await command({
			action: "replace",
			charge_ids: [await charge(100)],
			lines: [],
		});
		await manage("rollback");
		await db.exec(
			"insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',1000,now())",
		);
		await manage("activate");
		expect(
			await scalar("select state from dues_v2_charges where legacy_id=100"),
		).toBe("live");
		expect(
			await scalar("select amount from dues_v2_positions where bank_tx_id=90"),
		).toBe(1000);
		expect(
			await scalar(
				"select count(*)::int from dues_v2_operations where action='replace' and reverted_at is not null",
			),
		).toBe(1);
		await db.query("select dues_v2_assert()");
	});
	it("keeps private helpers, backups and tables inaccessible to members and anonymous users", async () => {
		expect(
			await scalar(
				"select has_function_privilege('authenticated','dues_v2_execute(jsonb,uuid,bigint)','execute')",
			),
		).toBe(false);
		expect(
			await scalar(
				"select has_function_privilege('authenticated','dues_v2_restore(jsonb)','execute')",
			),
		).toBe(false);
		expect(
			await scalar(
				"select has_function_privilege('anon','dues_v2_command(jsonb,uuid,bigint)','execute')",
			),
		).toBe(false);
		expect(
			await scalar(
				"select has_table_privilege('authenticated','dues_v2_operations','select')",
			),
		).toBe(false);
		await manage("activate");
		await db.exec(
			`set test.admin='false'; set test.member='${B}'; set role authenticated;`,
		);
		await expectFailure(() => scalar("select dues_v2_export()"), "forbidden");
		await expectFailure(() => command({ action: "apply" }), "forbidden");
		expect(
			(await scalar<{ operations: unknown[] }>("select dues_v2_read()"))
				.operations,
		).toEqual([]);
		await db.exec("reset role");
	});

	it("rejects a stale competing confirmation and blocks money reuse after reservation", async () => {
		await manage("activate");
		const rev = (await mode()).revision;
		const p = await position(2);
		await command(
			{
				action: "position",
				position_id: p,
				amount: 1000,
				purpose: "refund_pending",
			},
			crypto.randomUUID(),
			rev,
		);
		await expectFailure(
			() =>
				command(
					{
						action: "carry",
						member_id: A,
						target_ym: "2099-01",
						money: [{ position_id: p, amount: 1000 }],
					},
					crypto.randomUUID(),
					rev,
				),
			/다른 처리/,
		);
		await expectFailure(() =>
			command({
				action: "pay",
				lines: [
					{
						position_id: p,
						due_id: "00000000-0000-4000-8000-000000000099",
						amount: 1000,
					},
				],
			}),
		);
		expect(
			await scalar(
				"select sum(amount)::int from dues_v2_positions where purpose='refund_pending'",
			),
		).toBe(1000);
		await db.query("select dues_v2_assert()");
	});

	it("preserves payer ownership during proxy payment and cancellation", async () => {
		await manage("activate");
		const payload = {
			action: "pay",
			lines: [
				{
					position_id: await position(2),
					due_id: await due(106),
					amount: 1000,
				},
			],
		};
		await expectFailure(() => command(payload), /소유자/);
		await command({ ...payload, proxy: true });
		await command({
			action: "replace",
			charge_ids: [await charge(106)],
			lines: [],
		});
		expect(
			await scalar(
				"select sum(amount)::int from dues_v2_positions where bank_tx_id=2 and owner_id=$1 and purpose='member_pending'",
				[A],
			),
		).toBe(1000);
		expect(
			await scalar(
				"select count(*)::int from dues_v2_positions where bank_tx_id=2 and owner_id=$1",
				[B],
			),
		).toBe(0);
	});

	it("never spends club funds as member carry or payment", async () => {
		await manage("activate");
		const p = await position(1);
		await expectFailure(
			() =>
				command({
					action: "carry",
					member_id: A,
					target_ym: "2099-01",
					money: [{ position_id: p, amount: 6000 }],
				}),
			/소유자/,
		);
		await expectFailure(
			async () =>
				command({
					action: "pay",
					proxy: true,
					lines: [{ position_id: p, due_id: await due(106), amount: 1000 }],
				}),
			/납부할/,
		);
		expect(
			await scalar("select amount from dues_v2_positions where id=$1", [p]),
		).toBe(24000);
	});

	it("protects past obligations from membership changes and old write APIs", async () => {
		await manage("activate");
		await db.query("update members set is_active=false where id=$1", [B]);
		await db.query("select dues_set_honorary($1,true,'test')", [B]);
		expect(
			await scalar("select amount_due from dues_charges where id=106"),
		).toBe(5000);
		expect(
			await scalar("select remaining from dues_v2_due where id=$1", [
				await due(106),
			]),
		).toBe(5000);
		await expectFailure(
			() => db.query("delete from dues_allocations where id=1"),
			/새 부과/,
		);
		await expectFailure(
			() => db.query("update bank_transactions set amount=1 where id=1"),
			/새 부과/,
		);
		await expectFailure(
			() => db.query("select dues_set_session_fee(1,10000)"),
			/취소 후 발행/,
		);
		await expectFailure(
			() => db.query("select dues_notify_selected(array[]::uuid[],'test')"),
			/이전 화면/,
		);
		await expectFailure(
			() => db.query("select dues_ensure_monthly('2099-01')"),
			/새 부과 화면/,
		);
		await expectFailure(
			() => db.query("select generate_dues_charges('2099-01')"),
			/새 부과 화면/,
		);
		expect(
			await scalar(
				"select has_function_privilege('authenticated','generate_dues_charges(text)','execute')",
			),
		).toBe(false);
	});

	it("pauses confirmations, keeps ingesting real bank entries and resumes safely", async () => {
		await manage("activate");
		await manage("pause");
		await expectFailure(() => command({ action: "apply" }), /일시 중지/);
		await db.query(
			"insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',1000,now())",
		);
		expect(
			await scalar("select amount from dues_v2_positions where bank_tx_id=90"),
		).toBe(1000);
		await manage("resume");
		await command({ action: "apply" });
		await db.query("select dues_v2_assert()");
	});

	it("generates a new monthly bill once and never revives a cancelled member on retry", async () => {
		await manage("activate");
		expect(await scalar("select dues_generate_monthly('2026-07')")).toBe(0);
		expect(await scalar("select dues_generate_monthly('2099-01')")).toBe(3);
		expect(await scalar("select dues_generate_monthly('2099-01')")).toBe(0);
		const c = await scalar<string>(
			"select c.id from dues_v2_charges c join dues_v2_groups g on g.id=c.group_id where g.source_key='monthly:2099-01' and c.member_id=$1",
			[A],
		);
		await command({ action: "replace", charge_ids: [c], lines: [] });
		expect(await scalar("select dues_generate_monthly('2099-01')")).toBe(0);
		expect(
			await scalar("select state from dues_v2_charges where id=$1", [c]),
		).toBe("cancelled");
	});

	it("holds an unusual court calculation and revalidates it before issuing", async () => {
		await manage("activate");
		await db.exec(
			"insert into places values(1,'test',true); insert into sessions(id,title,status,scheduled_at,place_id,court_fee) values(2,'future','closed','2099-01-01T12:00:00+09',1,3000); insert into matches values(1,2)",
		);
		expect(await scalar("select dues_generate_session_court(2,true)")).toBe(0);
		expect(
			await scalar(
				"select hold_reason from dues_v2_drafts where source_key='court:2'",
			),
		).toBe("amount_out_of_range");
		const count = await scalar("select count(*) from dues_v2_operations");
		expect(await scalar("select dues_generate_session_court(2,true)")).toBe(0);
		expect(await scalar("select count(*) from dues_v2_operations")).toEqual(
			count,
		);
		const candidate = await scalar<{ payload: Record<string, unknown> }>(
			"select dues_v2_candidates('court','2099-01',2)",
		);
		await db.query("update sessions set court_fee=18000 where id=2");
		await expectFailure(() => command(candidate.payload), /금액이 변경/);
		const fresh = await scalar<{ payload: Record<string, unknown> }>(
			"select dues_v2_candidates('court','2099-01',2)",
		);
		await command(fresh.payload);
		expect(await scalar("select count(*)::int from dues_v2_drafts")).toBe(0);
	});

	it("exports the original facts as well as reversible V2 operation history", async () => {
		const backup = await scalar<{
			legacy: { bank_transactions: unknown[]; dues_charges: unknown[] };
		}>("select dues_v2_export()");
		expect(backup.legacy.bank_transactions).toHaveLength(8);
		expect(backup.legacy.dues_charges).toHaveLength(7);
	});
	it("installs disabled; imports issued facts and cross-month payments without changing legacy records", async () => {
		expect(
			await scalar(
				"select to_regprocedure('public.dues_notify_unpaid(text)')::text",
			),
		).toBeNull();
		expect((await mode()).enabled).toBe(false);
		const original = await legacy();
		await manage("activate");
		expect(await legacy()).toEqual(original);
		expect(await scalar("select sum(remaining)::int from dues_v2_due")).toBe(
			5000,
		);
		expect(
			await scalar("select sum(amount)::int from dues_v2_allocations"),
		).toBe(75000);
		expect(
			await scalar("select amount from dues_v2_positions where bank_tx_id=6"),
		).toBe(52000);
		expect(
			await scalar("select amount from dues_v2_positions where bank_tx_id=3"),
		).toBe(0);
		expect(
			await scalar(
				"select count(*)::int from dues_v2_positions where purpose='carry'",
			),
		).toBe(0);
		await db.query("select dues_v2_assert()");
	});
	it("previews exact cancel/reissue atomically, preserving mixed club income and the original payer", async () => {
		await manage("activate");
		const id = await charge(100);
		const payload = {
			action: "replace",
			reason: "회식 금액 변경",
			charge_ids: [id],
			lines: [
				{ previous_id: id, member_id: A, amount: 24000, due_ym: "2026-08" },
			],
		};
		const original = await state();
		const revision = (await mode()).revision;
		const request = crypto.randomUUID();
		const preview = await scalar<Record<string, number>>(
			"select dues_v2_preview($1,$2,$3)",
			[payload, request, revision],
		);
		expect(preview.reused).toBe(24000);
		expect(await state()).toEqual(original);
		expect((await mode()).revision).toBe(revision);
		await command(payload, request, revision);
		expect(
			await scalar(
				"select sum(amount)::int from dues_v2_positions where bank_tx_id=1 and purpose='club'",
			),
		).toBe(24000);
		expect(
			await scalar(
				"select sum(amount)::int from dues_v2_positions where bank_tx_id=1 and purpose='member_pending'",
			),
		).toBe(6000);
		expect(
			await scalar("select state from dues_v2_charges where legacy_id=100"),
		).toBe("cancelled");
		await db.query("select dues_v2_assert()");
	});
	it("rolls back a failed reissue; a duplicate request cannot spend twice", async () => {
		await manage("activate");
		const id = await charge(100);
		const original = await state();
		// Catch inside a SQL subtransaction so the fixture transaction survives failure.
		await db.query("savepoint invalid");
		await expect(
			command({
				action: "replace",
				charge_ids: [id],
				lines: [
					{ previous_id: id, member_id: A, amount: -1, due_ym: "2026-08" },
				],
			}),
		).rejects.toThrow();
		await db.query("rollback to savepoint invalid");
		expect(await state()).toEqual(original);
		const request = crypto.randomUUID();
		const payload = { action: "replace", charge_ids: [id], lines: [] };
		const revision = (await mode()).revision;
		const first = await command(payload, request, revision);
		expect(await command(payload, request, revision)).toEqual(first);
	});
	it("partially carries a debt and cash together without inventing charges or money", async () => {
		await manage("activate");
		await command({
			action: "replace",
			charge_ids: [await charge(101)],
			lines: [],
		});
		const count = await scalar("select count(*) from dues_v2_charges");
		await command({
			action: "carry",
			member_id: B,
			target_ym: "2099-10",
			debts: [{ due_id: await due(106), amount: 2000 }],
			money: [{ position_id: await position(4), amount: 6000 }],
		});
		expect(await scalar("select count(*) from dues_v2_charges")).toEqual(count);
		expect(
			await scalar(
				"select sum(remaining)::int from dues_v2_due where due_ym='2099-10'",
			),
		).toBe(2000);
		expect(
			await scalar(
				"select sum(amount)::int from dues_v2_positions where purpose='carry'",
			),
		).toBe(6000);
		await command({ action: "apply" });
		expect(
			await scalar(
				"select sum(amount)::int from dues_v2_positions where purpose='carry'",
			),
		).toBe(6000);
		await db.query("select dues_v2_assert()");
	});
	it("uses due carry once and reserves refund money against reuse", async () => {
		await manage("activate");
		await command({
			action: "replace",
			charge_ids: [await charge(101)],
			lines: [],
		});
		await command({
			action: "carry",
			member_id: B,
			target_ym: "2026-08",
			money: [{ position_id: await position(4), amount: 6000 }],
		});
		expect(await scalar("select sum(remaining)::int from dues_v2_due")).toBe(0);
		expect(
			await scalar(
				"select sum(amount)::int from dues_v2_positions where purpose='carry'",
			),
		).toBe(1000);
		await command({ action: "apply" });
		expect(
			await scalar(
				"select sum(amount)::int from dues_v2_positions where purpose='carry'",
			),
		).toBe(1000);
	});
	it("links an August remainder to a September refund and preserves each cash month", async () => {
		await manage("activate");
		const id = await charge(100);
		await command({
			action: "replace",
			charge_ids: [id],
			lines: [
				{ previous_id: id, member_id: A, amount: 24000, due_ym: "2026-08" },
			],
		});
		const source = await scalar<string>(
			"select id from dues_v2_positions where bank_tx_id=1 and purpose='member_pending' and amount>0",
		);
		await command({
			action: "refund",
			owner_id: A,
			out_tx_id: 9,
			lines: [{ position_id: source, amount: 6000 }],
		});
		for (const ym of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
			const ledger = await scalar<{
				income: number;
				expense: number;
				lines: { income: number; expense: number }[];
			}>("select dues_v2_ledger($1)", [ym]);
			expect(ledger.lines.reduce((s, l) => s + l.income, 0)).toBe(
				ledger.income,
			);
			expect(ledger.lines.reduce((s, l) => s + l.expense, 0)).toBe(
				ledger.expense,
			);
		}
		await command({ action: "reverse_refund", out_tx_id: 9 });
		expect(
			await scalar(
				"select sum(amount)::int from dues_v2_positions where bank_tx_id=1 and purpose='refund_pending'",
			),
		).toBe(6000);
	});
	it("undoes the last operation and rolls back to legacy while preserving new real bank transactions", async () => {
		const old = await legacy();
		await manage("activate");
		const original = await state();
		await command({
			action: "replace",
			charge_ids: [await charge(100)],
			lines: [],
		});
		await manage("undo");
		expect(await state()).toEqual(original);
		await command({
			action: "replace",
			charge_ids: [await charge(100)],
			lines: [],
		});
		await db.query(
			"insert into bank_transactions(id,direction,amount,occurred_at) values(99,'in',7000,now())",
		);
		await manage("rollback");
		expect((await mode()).enabled).toBe(false);
		expect(
			await scalar("select amount from bank_transactions where id=99"),
		).toBe(7000);
		const after = (await legacy()) as { bank: { id: number }[] };
		expect({ ...after, bank: after.bank.filter((t) => t.id !== 99) }).toEqual(
			old,
		);
		expect(
			await scalar(
				"select count(*)::int from dues_v2_operations where action='rollback'",
			),
		).toBe(1);
	});
	it("does not expose another payer's balance or bank transaction to a member", async () => {
		await manage("activate");
		await db.exec(`set test.admin='false'; set test.member='${B}'`);
		const data = await scalar<{
			positions: { owner_id: string }[];
			bank: { id: number }[];
			operations: unknown[];
		}>("select dues_v2_read()");
		expect(data.positions.every((p) => p.owner_id === B)).toBe(true);
		expect(data.bank.some((t) => t.id === 1)).toBe(false);
		expect(data.operations).toEqual([]);
	});
});

describe("refund payer matching", () => {
	it("rejects a namesake's source without changing any facts", async () => {
		await manage("activate");
		await command({
			action: "replace",
			charge_ids: [await charge(100)],
			lines: [],
		});
		const before = await state();
		const source = await scalar<string>(
			"select id from dues_v2_positions where bank_tx_id=1 and purpose='member_pending' and amount>0",
		);
		await expectFailure(
			() =>
				command({
					action: "refund",
					out_tx_id: 9,
					owner_id: B,
					lines: [{ position_id: source, amount: 6000 }],
				}),
			/납부자/,
		);
		expect(await state()).toEqual(before);
	});
	it("previews and confirms unknown ownership with the refund, preserving the remainder and undoing both", async () => {
		await manage("activate");
		await db.exec(
			"insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',7000,'2026-08-01')",
		);
		const source = await position(90);
		const before = await state();
		const payload = {
			action: "refund",
			reason: "납부자 확인",
			out_tx_id: 9,
			owner_id: A,
			lines: [{ position_id: source, amount: 6000 }],
		};
		await expectFailure(() => command(payload), /실제 납부자/);
		const request = crypto.randomUUID(),
			revision = (await mode()).revision;
		await scalar("select dues_v2_preview($1,$2,$3)", [
			{ ...payload, confirm_owner: true },
			request,
			revision,
		]);
		expect(await state()).toEqual(before);
		await command({ ...payload, confirm_owner: true }, request, revision);
		expect(
			await scalar("select owner_id from dues_v2_refunds where out_tx_id=9"),
		).toBe(A);
		expect(
			await scalar(
				"select amount from dues_v2_positions where bank_tx_id=90 and owner_id=$1 and purpose='member_pending'",
				[A],
			),
		).toBe(1000);
		await command({ ...payload, confirm_owner: true }, request, revision);
		expect(
			await scalar(
				"select count(*)::int from dues_v2_refunds where out_tx_id=9",
			),
		).toBe(1);
		await manage("undo");
		expect(await state()).toEqual(before);
	});
	it("allows an explicitly confirmed unregistered sender but rejects using a member's money that way", async () => {
		await manage("activate");
		await db.exec(
			"insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',6000,'2026-08-01')",
		);
		const payload = {
			action: "refund",
			out_tx_id: 9,
			external_refund: true,
			lines: [{ position_id: await position(90), amount: 6000 }],
		};
		await expectFailure(() => command(payload), /실제 납부자/);
		await command({ ...payload, confirm_owner: true });
		expect(
			await scalar("select owner_id from dues_v2_refunds where out_tx_id=9"),
		).toBeNull();
		await manage("undo");
		await command({
			action: "position",
			position_id: await position(90),
			owner_id: B,
			purpose: "member_pending",
			amount: 6000,
		});
		const ownedPosition = await position(90);
		await expectFailure(
			() =>
				command({
					...payload,
					confirm_owner: true,
					lines: [{ position_id: ownedPosition, amount: 6000 }],
				}),
			/납부자/,
		);
	});
});

it("database-owner deployment activation preserves financial facts and records the deployment without impersonation", async () => {
	const before = await legacy();
	const script = activateSql
		.replace(/\nbegin;\n/, "\n")
		.replace(/\ncommit;\n$/, "\n");
	await db.exec(script);
	expect((await mode()).enabled).toBe(true);
	expect(await legacy()).toEqual(before);
	expect(
		await scalar(
			"select actor_id from dues_v2_operations where action='activate'",
		),
	).toBeNull();
	await expectFailure(() => db.exec(script), /already exists|이미/);
});

describe("atomic matching from the settlement list", () => {
	it("previews matching and partial payment together, commits once, and undoes both", async () => {
		await manage("activate");
		await db.exec(
			"insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',6000,'2026-09-06','김지훈')",
		);
		const before = await state(),
			old = await legacy(),
			rev = (await mode()).revision;
		const request = crypto.randomUUID();
		const payload = {
			action: "pay",
			reason: "목록에서 납부 확인",
			owner_id: B,
			confirm_owner: true,
			lines: [
				{
					position_id: await position(90),
					due_id: await due(106),
					amount: 4000,
				},
			],
		};
		await scalar("select dues_v2_preview($1,$2,$3)", [payload, request, rev]);
		expect(await state()).toEqual(before);
		const result = await command(payload, request, rev);
		expect(await command(payload, request, rev)).toEqual(result);
		expect(
			await scalar(
				"select owner_id from dues_v2_allocations where bank_tx_id=90",
			),
		).toBe(B);
		expect(
			await scalar(
				"select sum(amount)::int from dues_v2_positions where bank_tx_id=90 and owner_id=$1 and purpose='member_pending'",
				[B],
			),
		).toBe(2000);
		expect(await legacy()).toEqual(old);
		await manage("undo");
		expect(await state()).toEqual(before);
		expect(await legacy()).toEqual(old);
	});
	it("rolls back the ownership choice with an invalid payment and rejects unconfirmed/wrong-owner claims", async () => {
		await manage("activate");
		await db.exec(
			"insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',6000,'2026-09-06')",
		);
		const before = await state();
		const line = {
			position_id: await position(90),
			due_id: await due(106),
			amount: 6000,
		};
		await expectFailure(() =>
			command({
				action: "pay",
				owner_id: B,
				confirm_owner: true,
				lines: [line],
			}),
		);
		expect(await state()).toEqual(before);
		await expectFailure(
			() =>
				command({
					action: "pay",
					owner_id: B,
					lines: [{ ...line, amount: 5000 }],
				}),
			/납부자를 먼저 선택/,
		);
		await expectFailure(
			() =>
				command({
					action: "pay",
					owner_id: A,
					confirm_owner: true,
					lines: [{ ...line, amount: 5000 }],
				}),
			/소유자/,
		);
		expect(await state()).toEqual(before);
		await command({
			action: "position",
			position_id: await position(90),
			owner_id: B,
			amount: 6000,
			purpose: "member_pending",
		});
		const matched = await state();
		await expectFailure(
			async () =>
				command({
					action: "pay",
					owner_id: A,
					confirm_owner: true,
					proxy: true,
					lines: [{ ...line, position_id: await position(90), amount: 5000 }],
				}),
			/납부자를 바꿀 수 없습니다/,
		);
		expect(await state()).toEqual(matched);
		expect(
			await scalar(
				"select has_function_privilege('authenticated','public.dues_v2_match_position(uuid,uuid,boolean)','execute')",
			),
		).toBe(false);
	});
	it("matches unused money while carrying it together with a debt, preserving the remainder and undo", async () => {
		await manage("activate");
		await db.exec(
			"insert into bank_transactions(id,direction,amount,occurred_at) values(90,'in',6000,'2026-09-06')",
		);
		const before = await state();
		await command({
			action: "carry",
			member_id: B,
			confirm_owner: true,
			target_ym: "2099-01",
			money: [{ position_id: await position(90), amount: 4000 }],
			debts: [{ due_id: await due(106), amount: 3000 }],
		});
		expect(
			await scalar(
				"select sum(amount)::int from dues_v2_positions where bank_tx_id=90 and owner_id=$1 and purpose='carry'",
				[B],
			),
		).toBe(4000);
		expect(
			await scalar(
				"select sum(amount)::int from dues_v2_positions where bank_tx_id=90 and owner_id=$1 and purpose='member_pending'",
				[B],
			),
		).toBe(2000);
		expect(
			await scalar(
				"select sum(remaining)::int from dues_v2_due where due_ym='2099-01'",
			),
		).toBe(3000);
		await manage("undo");
		expect(await state()).toEqual(before);
	});
});
