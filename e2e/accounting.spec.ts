import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { test, expect, type Page } from "@playwright/test";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const fixture = (name: string) =>
	readFileSync(
		new URL(`../supabase/tests/fixtures/${name}`, import.meta.url),
		"utf8",
	);
const migration = readFileSync(
	new URL("../supabase/migrations/20260907030000_dues_v2.sql", import.meta.url),
	"utf8",
);
let db: PGlite;
let calls: { name: string; args: Record<string, unknown> }[];
async function scalar<T = unknown>(
	sql: string,
	params: unknown[] = [],
): Promise<T> {
	return Object.values(
		(await db.query<Record<string, T>>(sql, params)).rows[0],
	)[0];
}
async function command(payload: Record<string, unknown>) {
	return scalar(
		"select dues_v2_command($1,$2,(select revision from dues_v2_control where id=1))",
		[{ reason: "fixture", ...payload }, crypto.randomUUID()],
	);
}
async function navigate(page: Page, path = "/dues/2026-08", member?: string) {
	await page.goto(
		`/e2e/accounting.html?${new URLSearchParams({ path, ...(member ? { member } : {}) })}`,
	);
	await expect(page.getByText("Loading", { exact: true })).toHaveCount(0);
}
async function previewAndConfirm(page: Page, reason: string) {
	await page.getByLabel("처리 사유").fill(reason);
	await page
		.getByRole("button", { name: "변경 결과 확인", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "확정", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "확정", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "확정", exact: true }),
	).toHaveCount(0);
}

test.beforeEach(async ({ page, context }) => {
	db = new PGlite();
	calls = [];
	await db.exec(fixture("dues-v2-legacy.sql"));
	await db.exec(migration);
	await db.exec(
		readFileSync(
			new URL(
				"../supabase/migrations/20260907050000_dues_v2_payer_refunds.sql",
				import.meta.url,
			),
			"utf8",
		),
	);
	await db.exec(fixture("dues-v2-seed.sql"));
	await scalar("select dues_v2_manage('activate',0,'fixture',$1)", [
		crypto.randomUUID(),
	]);
	await context.routeWebSocket(
		/^(?!ws:\/\/(127\.0\.0\.1|localhost))/,
		(socket) => socket.close(),
	);
	await context.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (["127.0.0.1", "localhost"].includes(url.hostname))
			return route.continue();
		const name = url.pathname.split("/").at(-1)!;
		const keys: Record<string, string[]> = {
			dues_v2_mode: [],
			dues_v2_read: [],
			dues_v2_sessions: [],
			dues_v2_reference_members: ["p_session_id", "p_meal"],
			dues_v2_export: [],
			dues_v2_preview: ["p_payload", "p_request_id", "p_revision"],
			dues_v2_command: ["p_payload", "p_request_id", "p_revision"],
			dues_v2_manage: ["p_action", "p_revision", "p_reason", "p_request_id"],
			dues_v2_ledger: ["p_ym"],
			dues_v2_candidates: ["p_kind", "p_ym", "p_session_id"],
		};
		if (!url.pathname.includes("/rest/v1/rpc/") || !keys[name]) {
			// The member account display is unrelated to these financial commands.
			if (name === "dues_club_account") return route.fulfill({ json: null });
			return route.abort();
		}
		const args = route.request().postDataJSON() ?? {};
		calls.push({ name, args });
		try {
			const values = keys[name].map((key) => args[key]);
			const result = await db.transaction(
				async (tx) =>
					Object.values(
						(
							await tx.query<Record<string, unknown>>(
								`select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")})`,
								values,
							)
						).rows[0],
					)[0],
			);
			await route.fulfill({ json: result });
		} catch (error) {
			await route.fulfill({
				status: 400,
				json: { message: (error as Error).message, code: "P0001" },
			});
		}
	});
	page.on("pageerror", (error) => {
		throw error;
	});
});
test.afterEach(async () => {
	await db.close();
});

test("cancel and reissue previews without writing, commits once, and undoes from the UI", async ({
	page,
}) => {
	await navigate(page);
	await page.getByRole("button", { name: /^회식 납부/ }).click();
	await page.getByRole("checkbox", { name: /000002/ }).uncheck();
	await page.getByRole("button", { name: "선택한 1건 취소 후 발행" }).click();
	await page.getByLabel(/000001 부과액/).fill("24000");
	await page.getByLabel("처리 사유").fill("회식비 변경");
	await page.getByRole("button", { name: "변경 결과 확인" }).click();
	await expect(
		page.getByText("기존 납부금 재사용", { exact: true }),
	).toBeVisible();
	expect(
		await scalar("select state from dues_v2_charges where legacy_id=100"),
	).toBe("live");
	await page.getByRole("button", { name: "확정", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "확정", exact: true }),
	).toHaveCount(0);
	const preview = calls.find((c) => c.name === "dues_v2_preview")!,
		commit = calls.find((c) => c.name === "dues_v2_command")!;
	expect(commit.args).toEqual(preview.args);
	expect(
		await scalar(
			"select sum(amount)::int from dues_v2_positions where purpose='member_pending' and bank_tx_id=1",
		),
	).toBe(6000);
	await page.getByRole("button", { name: "부과 운영·복구" }).click();
	await page
		.getByRole("button", { name: "직전 처리 되돌리기", exact: true })
		.click();
	await page.getByLabel("처리 사유").fill("화면 되돌리기 검증");
	await page
		.getByRole("button", { name: "직전 처리 되돌리기", exact: true })
		.last()
		.click();
	await expect(page.getByLabel("처리 사유")).toHaveCount(0);
	expect(
		await scalar("select state from dues_v2_charges where legacy_id=100"),
	).toBe("live");
});

test("one carry form moves partial debt and actual money; member sees both future balances", async ({
	page,
}) => {
	await db.query(
		"insert into bank_transactions(id,direction,amount,occurred_at) values(91,'in',6000,'2026-08-30T12:00:00+09')",
	);
	const pos = await scalar<string>(
		"select id from dues_v2_positions where bank_tx_id=91",
	);
	await command({
		action: "position",
		position_id: pos,
		owner_id: B,
		amount: 6000,
		purpose: "member_pending",
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page);
	await page
		.getByRole("button", { name: "미납·입금 이월", exact: true })
		.click();
	await page
		.getByRole("group", { name: "회원 검색 결과" })
		.getByRole("button", { name: /000002/ })
		.click();
	await page.getByLabel("이월할 월").fill("2099-01");
	await page.getByLabel("7월 회비 선택 금액").fill("3000");
	await page.getByLabel("입금 91 이월 금액").fill("6000");
	await previewAndConfirm(page, "미납과 잔액 함께 이월");
	expect(
		await scalar(
			"select sum(remaining)::int from dues_v2_due where due_ym='2099-01'",
		),
	).toBe(3000);
	expect(await scalar("select count(*)::int from dues_v2_charges")).toBe(7);
	await db.exec(`set test.admin='false'; set test.member='${B}'`);
	await navigate(page, "/my-dues", B);
	await expect(
		page.getByText("앞으로 낼 돈 3,000원 · 이미 낸 돈 6,000원"),
	).toBeVisible();
	await expect(page.getByText("이번에 낼 돈", { exact: true })).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: "test-results/accounting-member-mobile.png",
		fullPage: true,
	});
});

test("September refund finds and spends the remainder of an August deposit", async ({
	page,
}) => {
	const old = await scalar<string>(
		"select id from dues_v2_charges where legacy_id=100",
	);
	await command({
		action: "replace",
		charge_ids: [old],
		lines: [
			{ previous_id: old, member_id: A, amount: 24000, due_ym: "2026-08" },
		],
	});
	await navigate(page, "/dues/2026-09/inbox");
	await page.getByRole("button", { name: "환불 연결", exact: true }).click();
	await expect(page.getByRole("radio", { name: /입금 #1 / })).toHaveCount(0);
	await page.getByLabel("납부자 이름·초성 검색").fill("ㄱㅈㅎ");
	await page
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000001/ })
		.click();
	await expect(page.getByRole("radio", { name: /입금 #4 / })).toHaveCount(0);
	await page.getByRole("radio", { name: /입금 #1 / }).check();
	// Switching namesakes must discard the previous receipt selection.
	await page
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000002/ })
		.click();
	await expect(page.getByRole("radio", { name: /입금 #1 / })).toHaveCount(0);
	await page
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000001/ })
		.click();
	await expect(page.getByRole("radio", { name: /입금 #1 / })).not.toBeChecked();
	await page.getByRole("radio", { name: /입금 #1 / }).check();
	await previewAndConfirm(page, "8월 회식 잔액 9월 환불");
	await expect(
		page.getByText("환불 완료 · 원입금 #1", { exact: true }),
	).toBeVisible();
	expect(
		await scalar("select amount from dues_v2_refunds where out_tx_id=9"),
	).toBe(6000);
});

test("full rollback downloads a backup and returns to the preserved legacy facts", async ({
	page,
}) => {
	await command({ action: "apply" });
	await navigate(page);
	await page.getByRole("button", { name: "부과 운영·복구" }).click();
	await page
		.getByRole("button", { name: "기존 부과로 복귀", exact: true })
		.click();
	await page.getByLabel("처리 사유").fill("복귀 검증");
	const download = page.waitForEvent("download");
	await page
		.getByRole("button", { name: "기존 부과로 복귀", exact: true })
		.last()
		.click();
	expect((await download).suggestedFilename()).toMatch(
		/^accounting-backup-.*\.json$/,
	);
	await expect(
		page.getByText("기존 부과 사용 중", { exact: true }),
	).toBeVisible();
	expect(
		await scalar("select amount_paid from dues_charges where id=100"),
	).toBe(30000);
	expect(calls.findIndex((c) => c.name === "dues_v2_export")).toBeLessThan(
		calls.findIndex((c) => c.name === "dues_v2_manage"),
	);
});

test("replacement retains partial carry months and requires the changed amounts to add up", async ({
	page,
}) => {
	const d = await scalar<string>(
		"select d.id from dues_v2_due d join dues_v2_charges c on c.id=d.charge_id where c.legacy_id=106",
	);
	await command({
		action: "carry",
		member_id: B,
		target_ym: "2099-01",
		debts: [{ due_id: d, amount: 3000 }],
	});
	await navigate(page, "/dues/2026-07");
	await page.getByRole("button", { name: /^7월 회비 납부/ }).click();
	await page.getByRole("checkbox", { name: /000001/ }).uncheck();
	await page.getByRole("button", { name: "선택한 1건 취소 후 발행" }).click();
	await expect(page.getByLabel("납기 1 월")).toHaveValue("2026-07");
	await expect(page.getByLabel("납기 2 월")).toHaveValue("2099-01");
	await page.getByLabel(/000002 부과액/).fill("4500");
	await page.getByLabel("처리 사유").fill("분납 유지하며 부담 감소");
	await page.getByRole("button", { name: "변경 결과 확인" }).click();
	await expect(page.getByRole("alert")).toContainText("납기별 금액 합계");
	await page.getByLabel("납기 1 금액").fill("1500");
	await previewAndConfirm(page, "분납 유지하며 부담 감소");
	expect(
		await scalar(
			"select sum(remaining)::int from dues_v2_due where due_ym='2099-01'",
		),
	).toBe(3000);
});

test("unknown August deposit requires payer confirmation and leaves a visible member balance", async ({
	page,
}) => {
	await db.query(
		"insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',7000,'2026-08-01','김지훈0801')",
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-09/inbox");
	await page.getByRole("button", { name: "환불 연결", exact: true }).click();
	await page.getByLabel("납부자 이름·초성 검색").fill("ㄱㅈㅎ");
	await page
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000001/ })
		.click();
	await page
		.getByText("아직 납부자를 확인하지 않은 입금", { exact: true })
		.click();
	await page.getByRole("radio", { name: /입금 #90 / }).check();
	await page.getByLabel("처리 사유").fill("입금자 확인 후 부분 환불");
	await page.getByRole("button", { name: "변경 결과 확인" }).click();
	await expect(page.getByRole("alert")).toContainText("실제 납부자");
	await page
		.getByRole("checkbox", { name: /이 원입금이 .*000001.*돈임을 확인/ })
		.check();
	await page.screenshot({
		path: "test-results/accounting-refund-payer-mobile.png",
		fullPage: true,
	});
	await previewAndConfirm(page, "입금자 확인 후 부분 환불");
	expect(
		await scalar("select owner_id from dues_v2_refunds where out_tx_id=9"),
	).toBe(A);
	expect(
		await scalar(
			"select sum(amount)::int from dues_v2_positions where bank_tx_id=90 and purpose='member_pending'",
		),
	).toBe(1000);
});

test("same-name payer B can receive a missing monthly charge and pay it independently of A", async ({
	page,
}) => {
	await db.query(
		"insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',5000,'2026-08-30','김지훈8월회비')",
	);
	await navigate(page, "/dues/2026-08/inbox");
	let receipt = page.locator("section").filter({ hasText: "김지훈8월회비" });
	await receipt.getByRole("button", { name: "용도 지정", exact: true }).click();
	await expect(page.getByText("선택한 납부자:")).toHaveCount(0);
	await page
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000002/ })
		.click();
	await previewAndConfirm(page, "동명이인 B 입금 확인");
	await page.getByRole("button", { name: "부과", exact: true }).click();
	await page
		.getByRole("button", { name: "회비 대상 확인", exact: true })
		.click();
	// A's August charge is already paid and must not be offered or recreated.
	await expect(page.getByLabel(/000001 부과액/)).toHaveCount(0);
	await page
		.getByRole("checkbox", {
			name: "계산 규칙 대신 대상·금액을 직접 지정",
			exact: true,
		})
		.check();
	await page
		.getByRole("button", { name: "대상 제외", exact: true })
		.last()
		.click();
	await previewAndConfirm(page, "미발행 B 8월 회비 발행");
	await page.getByRole("button", { name: "정산함", exact: true }).click();
	receipt = page.locator("section").filter({ hasText: "김지훈8월회비" });
	await receipt.getByRole("button", { name: "납부 연결", exact: true }).click();
	await expect(page.getByText(/선택한 낼 사람:.*000002/)).toBeVisible();
	await page.getByLabel("8월 회비 선택 금액").fill("5000");
	await previewAndConfirm(page, "동명이인 B 8월 회비 납부");
	expect(
		await scalar("select amount_paid from dues_charges where id=102"),
	).toBe(5000);
	expect(
		await scalar(
			"select sum(a.amount-a.reversed)::int from dues_v2_allocations a join dues_v2_charges c on c.id=a.charge_id join dues_v2_groups g on g.id=c.group_id where c.member_id=$1 and g.source_key='monthly:2026-08'",
			[B],
		),
	).toBe(5000);
	expect(
		await scalar(
			"select owner_id from dues_v2_allocations where bank_tx_id=90",
		),
	).toBe(B);
});

test("manual charge reference sessions distinguish times and copy each roster by ID", async ({
	page,
}) => {
	await db.exec(
		"insert into places values(1,'체육관',true); update sessions set place_id=1,ends_at='2026-08-22T16:00:00+09' where id=1; insert into sessions(id,title,status,scheduled_at,ends_at,place_id) values(2,'대관','closed','2026-08-22T18:00:00+09','2026-08-22T20:00:00+09',1),(3,'대관','closed','2026-08-23T14:00:00+09',null,1)",
	);
	await db.query(
		"insert into attendances values(1,$1,'confirmed',true),(2,$2,'confirmed',true)",
		[A, B],
	);
	await navigate(page, "/dues/2026-08/charge");
	await expect(
		page.getByLabel("대관 회차").getByRole("option", {
			name: "2026-08-22 · 체육관 · 14:00–16:00",
			exact: true,
		}),
	).toHaveCount(1);
	await expect(
		page
			.getByLabel("대관 회차")
			.getByRole("option", { name: "2026-08-23 · 체육관", exact: true }),
	).toHaveCount(1);
	await page.getByRole("button", { name: "새 수동 부과", exact: true }).click();
	await page.getByLabel("참고 회차", { exact: true }).selectOption("2");
	await page
		.getByRole("button", { name: "참고 회차 명단 추가", exact: true })
		.click();
	await expect(page.getByLabel(/000002 부과액/)).toBeVisible();
	await expect(page.getByLabel(/000001 부과액/)).toHaveCount(0);
	await page.getByLabel("부과 이름", { exact: true }).fill("저녁 회식");
	await previewAndConfirm(page, "저녁 회차 참여자 부과");
	expect(
		await scalar(
			"select basis->>'reference_session_id' from dues_v2_charges where legacy_id is null",
		),
	).toBe("2");
});
