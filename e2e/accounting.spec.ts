import { readFileSync, writeFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { test, expect, type Page } from "@playwright/test";

test.use({ locale: "ko-KR" });

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
let loseCommitResponse = false;
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
		"select dues_command($1,$2,(select revision from dues_control where id=1))",
		[{ reason: "fixture", ...payload }, crypto.randomUUID()],
	);
}
async function navigate(page: Page, path = "/dues/2026-08", member?: string) {
	await page.goto(
		`/e2e/accounting.html?${new URLSearchParams({ path, ...(member ? { member } : {}) })}`,
	);
	await expect(page.getByText("Loading", { exact: true })).toHaveCount(0);
}

// Self-contained copies of the rendered synthetic fixture for the design
// skill's independent screenshot/visual-lint runtime. No production data.
async function designEvidence(page: Page, name: string) {
	await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
	await page.screenshot({
		path: `test-results/design-${name}.png`,
		fullPage: true,
		animations: "disabled",
	});
	const html = await page.evaluate(() => {
		const css = [...document.styleSheets]
			.flatMap((sheet) => {
				try {
					return [...sheet.cssRules].map((rule) => rule.cssText);
				} catch {
					return [];
				}
			})
			.join("\n");
		const doc = document.documentElement.cloneNode(true) as HTMLElement;
		doc.querySelectorAll("script,style,link").forEach((node) => node.remove());
		const style = document.createElement("style");
		style.textContent = css;
		doc.querySelector("head")!.append(style);
		return "<!doctype html>" + doc.outerHTML;
	});
	writeFileSync(`test-results/design-${name}.html`, html);
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

test.beforeEach(async ({ page, context }, testInfo) => {
	db = new PGlite();
	calls = [];
	loseCommitResponse = false;
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
	await db.exec(
		readFileSync(
			new URL(
				"../supabase/migrations/20260907060000_dues_v2_quick_settlement.sql",
				import.meta.url,
			),
			"utf8",
		),
	);
	await db.exec(fixture("dues-v2-seed.sql"));
	await db.exec(
		readFileSync(
			new URL(
				"../supabase/migrations/20260907070000_dues_v2_payer_choice.sql",
				import.meta.url,
			),
			"utf8",
		),
	);
	await db.exec(
		"alter table bank_transactions add column balance_after bigint; alter table attendances add column confirmed_at timestamptz, add column cancelled_at timestamptz",
	);
	if (testInfo.title.startsWith("accounting layouts")) {
		await db.exec(`
		update members set birth_year=1993, gender='남' where id='${A}';
		update members set birth_year=1988, gender='남' where id='${B}';
		update bank_transactions set counterparty_name='김지훈' where id=9;
		update bank_transactions set counterparty_name='김지훈 회식비' where id=1;
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values
		(90,'in',5000,'2026-09-06T12:00:00+09','김지훈 9월 회비'),
		(91,'out',48000,'2026-09-04T12:00:00+09','올림픽체육관'),
		(92,'in',6000,'2026-09-02T12:00:00+09','이민수 대관비');
	`);
	}
	if (testInfo.title.startsWith("payer choice")) {
		await db.exec(`
			update members set birth_year=1996 where id='${A}';
			update members set birth_year=2002 where id='${B}';
			update dues_charges set member_id='${A}' where id=104;
			update dues_allocations set member_id='${A}' where id=5;
			insert into dues_charges(id,kind,member_id,amount_due,amount_paid,status,batch_id,period_ym)
			values(107,'monthly_fee','${B}',5000,0,'unpaid',21,'2026-09');
			insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name,paid_by)
			values(90,'in',5000,'2026-09-06T22:46:33+09','김지훈9월 회비','${A}');
		`);
	}

	if (testInfo.title.startsWith("ledger has no migration recovery")) {
		await db.exec(
			"update bank_transactions set balance_after=646592 where id=9",
		);
	}

	await scalar("select dues_v2_manage('activate',0,'fixture',$1)", [
		crypto.randomUUID(),
	]);
	await db.exec(
		readFileSync(
			new URL(
				"../supabase/migrations/20260908010000_retire_dues_recovery.sql",
				import.meta.url,
			),
			"utf8",
		),
	);
	await db.exec(
		readFileSync(
			new URL(
				"../supabase/migrations/20260908020000_reference_meal_roster.sql",
				import.meta.url,
			),
			"utf8",
		),
	);
	await db.exec(
		readFileSync(
			new URL("../supabase/migrations/20260910010000_court_prepayment.sql", import.meta.url),
			"utf8",
		),
	);
	await db.exec("alter table sessions add column is_active boolean default true, add column is_overridden boolean default false");
    await db.exec(readFileSync(new URL("../supabase/migrations/20260911010000_promote_dues.sql", import.meta.url), "utf8"));
	await context.routeWebSocket(
		/^(?!ws:\/\/(127\.0\.0\.1|localhost))/,
		(socket) => socket.close(),
	);
	await context.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (["127.0.0.1", "localhost"].includes(url.hostname))
			return route.continue();
		const name = url.pathname.split("/").at(-1)!;
		if (name === "bank_transactions" && route.request().method() === "GET") {
			const range = url.searchParams.getAll("occurred_at");
			const start = range.find((v) => v.startsWith("gte."))?.slice(4);
			const end = range.find((v) => v.startsWith("lt."))?.slice(3);
			const result = await db.query(
				"select * from bank_transactions where occurred_at >= $1 and occurred_at < $2 order by occurred_at desc",
				[start, end],
			);
			return route.fulfill({ json: result.rows });
		}
		if (name === "sessions" && route.request().method() === "GET") {
			const range = url.searchParams.getAll("scheduled_at");
			if (range.length) {
				const start = range.find((v) => v.startsWith("gte."))?.slice(4);
				const end = range.find((v) => v.startsWith("lt."))?.slice(3);
				calls.push({
					name: "reference_sessions",
					args: { start: start ?? null, end },
				});
				const result = await db.query(
					`select s.id,s.title,s.scheduled_at,s.ends_at,s.is_regular,s.meal_enabled,
					(select jsonb_build_object('name',p.name) from places p where p.id=s.place_id) as places
					from sessions s where ($1::timestamptz is null or s.scheduled_at >= $1) and s.scheduled_at < $2
					and s.status in ('open','active','closed') order by s.scheduled_at desc,s.id ${start ? "" : "limit 1"}`,
					[start ?? null, end],
				);
				return route.fulfill({ json: result.rows });
			}
			const ids = (url.searchParams.get("id") ?? "")
				.replace(/^in\.\(|\)$/g, "")
				.split(",")
				.map(Number)
				.filter(Number.isFinite);
			const result = await db.query(
				`select s.id,s.title,s.status,s.scheduled_at,s.court_fee,
				(select to_jsonb(r) from recurring_schedules r where r.id=s.recurring_schedule_id) as recurring_schedules,
				(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from attendances a where a.session_id=s.id) as attendances,
				(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from session_players p where p.session_id=s.id) as session_players
				from sessions s where s.id=any($1::bigint[])`,
				[ids],
			);
			return route.fulfill({ json: result.rows });
		}
		if (name === "user_roles" && route.request().method() === "GET")
			return route.fulfill({
				json: [{ member_id: "00000000-0000-4000-8000-000000000004" }],
			});
		if (name === "dues_settings" && route.request().method() === "GET")
			return route.fulfill({
				json: (
					await db.query(
						"select court_fee_default from dues_settings where id=1",
					)
				).rows[0],
			});
		const keys: Record<string, string[]> = {
			dues_mode: [],
			dues_read: [],
			dues_sessions: [],
			dues_reference_members: ["p_session_id", "p_meal"],
			dues_preview: ["p_payload", "p_request_id", "p_revision"],
			dues_command: ["p_payload", "p_request_id", "p_revision"],
			dues_ledger: ["p_ym"],
			dues_candidates: ["p_kind", "p_ym", "p_session_id"],
		};
		if (!url.pathname.includes("/rest/v1/rpc/") || !keys[name]) {
			// The member account display is unrelated to these financial commands,
			// but the member screen renders it as a card — serve a real payload.
			if (name === "dues_club_account")
				return route.fulfill({
					json: {
						bank_name: "토스뱅크",
						account: "1000-1234-5678",
						account_holder: "김총무",
						monthly_fee: 5000,
					},
				});
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
			if (name === "dues_command" && loseCommitResponse) {
				loseCommitResponse = false;
				return route.abort();
			}
			await route.fulfill({ json: result });
		} catch (error) {
			await route.fulfill({
				status: 400,
				json: {
					message: (error as Error).message,
					code: (error as { code?: string }).code ?? "P0001",
				},
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

for (const partiallyPaid of [false, true]) {
	test(`receipt proxy settles two members while preserving the sender (${partiallyPaid ? "remaining balance" : "one confirmation"})`, async ({
		page,
	}) => {
		await db.exec(`
			update members set name='박민준' where id='${A}';
			update members set name='이서연',is_guest=true where id='${B}';
			insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name)
			values(90,'in',12000,'2026-09-13T17:59:00+09','박민준/이서연_0913');
			select dues_sync_bank();
		`);
		await command({
			action: "issue",
			kind: "manual",
			label: "9월 13일 대관",
			date: "2026-09-13",
			lines: [A, B].map((member_id) => ({
				member_id,
				amount: 6000,
				due_ym: "2026-09",
			})),
		});
		const position = await scalar<string>(
			"select id from dues_positions where bank_tx_id=90 and amount>0",
		);
		const ownDue = await scalar<string>(
			"select d.id from dues_due d join dues_charges c on c.id=d.charge_id join dues_groups g on g.id=c.group_id where c.member_id=$1 and g.label='9월 13일 대관'",
			[A],
		);
		if (partiallyPaid)
			await command({
				action: "pay",
				owner_id: A,
				confirm_owner: true,
				lines: [{ position_id: position, due_id: ownDue, amount: 6000 }],
			});
		await navigate(page, "/dues/2026-09/inbox");
		const card = page.getByRole("region", { name: "거래 90", exact: true });
		if (!partiallyPaid) {
			await card
				.getByRole("group", { name: "납부자 검색 결과" })
				.getByRole("button", { name: "박민준", exact: true })
				.click();
			await card.getByRole("button", { name: /^9월 13일 대관 ·/ }).click();
		} else {
			await expect(
				card.getByRole("button", { name: "납부자 변경", exact: true }),
			).toHaveCount(0);
		}
		await card
			.getByRole("button", { name: "다른 회원 대납", exact: true })
			.click();
		await card.getByLabel("대납할 회원 이름·초성 검색").fill("이서연");
		await card
			.getByRole("group", { name: "대납할 회원 검색 결과" })
			.getByRole("button", { name: /이서연/ })
			.click();
		await card
			.getByRole("button", { name: /이서연.*대납 · 9월 13일 대관/ })
			.click();
		await expect(card).toContainText("남는 돈 없음");
		await expect(card).toContainText("이서연 · 게스트 대납 6,000원");
		await card.getByRole("button", { name: "정산 옵션" }).click();
		await card.getByRole("button", { name: "이월", exact: true }).click();
		await card.getByRole("button", { name: "이월 닫기", exact: true }).click();
		await expect(card).toContainText("남는 돈 없음");
		if (partiallyPaid) {
			for (const width of [390, 1280]) {
				await page.setViewportSize({ width, height: 900 });
				for (const theme of ["light", "dark"]) {
					await page.evaluate(
						(dark) => document.documentElement.classList.toggle("dark", dark),
						theme === "dark",
					);
					await designEvidence(page, `receipt-proxy-${width}-${theme}`);
					expect(
						await page.evaluate(
							() => document.documentElement.scrollWidth <= innerWidth,
						),
					).toBe(true);
				}
			}
		}
		await card.getByRole("button", { name: "납부 확인", exact: true }).click();
		await expect(
			card.getByRole("region", { name: "납부 정산", exact: true }),
		).toHaveCount(0);
		expect(
			await scalar(
				"select sum(amount)::int from dues_positions where bank_tx_id=90",
			),
		).toBe(0);
		expect(
			await scalar(
				"select count(distinct c.member_id)::int from dues_allocations a join dues_charges c on c.id=a.charge_id where a.bank_tx_id=90 and a.owner_id=$1 and a.amount-a.reversed=6000",
				[A],
			),
		).toBe(2);
		expect(
			await scalar(
				"select count(*)::int from dues_positions where bank_tx_id=90 and owner_id is distinct from $1",
				[A],
			),
		).toBe(0);
		expect(
			calls.filter((c) => c.name === "dues_command").at(-1)?.args.p_payload,
		).toMatchObject({ owner_id: A, proxy: true });
		await db.query("select dues_assert()");
	});
}

test("dated repeat receipt explains its earlier full payment without duplicating the charge", async ({
	page,
}) => {
	await db.exec(`update members set name='박민준' where id='${A}';
		insert into sessions(id,title,status,scheduled_at) values(10,'대관','closed','2026-09-13T15:00:00+09');
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values
		(90,'in',6000,'2026-09-10T12:35:00+09','박민준0913'),
		(91,'in',6000,'2026-09-13T14:12:00+09','박민준0913');
		select dues_sync_bank();`);
	await command({
		action: "issue",
		kind: "court",
		session_id: 10,
		label: "9월 13일 대관",
		date: "2026-09-13",
		lines: [{ member_id: A, amount: 6000, due_ym: "2026-09" }],
	});
	await command({
		action: "pay",
		owner_id: A,
		confirm_owner: true,
		lines: [
			{
				position_id: await scalar(
					"select id from dues_positions where bank_tx_id=90 and amount>0",
				),
				due_id: await scalar(
					"select d.id from dues_due d join dues_charges c on c.id=d.charge_id join dues_groups g on g.id=c.group_id where g.session_id=10",
				),
				amount: 6000,
			},
		],
	});
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 91", exact: true });
	const note = card.getByRole("note", { name: "기존 납부 내역" });
	await expect(note).toContainText("2026-09-13 · 대관 · 이미 완납");
	await expect(note).toContainText("9. 10. 입금 · 박민준0913 · 6,000원 납부");
	await expect(note).toContainText("이번 입금 6,000원은 별도 잔액");
	await expect(
		card.getByRole("button", { name: "납부 확인", exact: true }),
	).toBeDisabled();
	for (const width of [390, 1280]) {
		await page.setViewportSize({ width, height: 900 });
		await designEvidence(page, `receipt-already-paid-${width}`);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
	}
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(0);
	expect(
		await scalar(
			"select sum(amount)::int from dues_positions where bank_tx_id=91",
		),
	).toBe(6000);
	await db.query("select dues_assert()");
});

test("payer choice distinguishes a paid namesake from an unpaid namesake and rematches only on confirmation", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 90", exact: true });
	const results = card.getByRole("group", { name: "납부자 검색 결과" });
	await expect(
		card.getByText("동명이인이 있습니다. 실제 입금자를 선택해 주세요."),
	).toBeVisible();
	await expect(results.getByRole("button", { name: /1996년생/ })).toContainText(
		"9월 회비 완납",
	);
	await expect(results.getByRole("button", { name: /2002년생/ })).toContainText(
		"9월 회비 5,000원 미납",
	);
	for (const theme of ["light", "dark"]) {
		await page.evaluate(
			(dark) => document.documentElement.classList.toggle("dark", dark),
			theme === "dark",
		);
		await page.screenshot({
			path: `test-results/accounting-payer-choice-${theme}.png`,
			fullPage: true,
			animations: "disabled",
		});
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	}
	// Year search is local and keeps namesakes distinct by member ID.
	const payerSearch = card.getByLabel("납부자 이름·초성 검색");
	await payerSearch.fill("김지훈 02");
	await expect(results.getByRole("button", { name: /2002년생/ })).toHaveCount(
		1,
	);
	await expect(results.getByRole("button", { name: /1996년생/ })).toHaveCount(
		0,
	);
	await payerSearch.fill("김지훈");
	await results.getByRole("button", { name: /1996년생/ }).click();
	await expect(card.getByRole("button", { name: /^9월 회비/ })).toHaveCount(0);
	await card.getByRole("button", { name: "납부자 변경" }).click();
	await results.getByRole("button", { name: /2002년생/ }).focus();
	await page.keyboard.press("Enter");
	await card.getByRole("button", { name: /^9월 회비/ }).click();
	const confirm = card.getByRole("button", { name: "납부 확인", exact: true });
	await expect(confirm).toBeEnabled();
	await expect(card.locator(".ac-receipt-hint")).toContainText("2002년생");
	await expect(card.locator(".ac-receipt-hint")).toContainText(
		"납부자 변경 예정",
	);
	// Changing candidates discards previously selected charges and their preview.
	await card.getByRole("button", { name: "납부자 변경" }).click();
	await results.getByRole("button", { name: /1996년생/ }).click();
	await expect(confirm).toBeDisabled();
	await card.getByRole("button", { name: "납부자 변경" }).click();
	await results.getByRole("button", { name: /2002년생/ }).click();
	await expect(card.getByRole("button", { name: /^9월 회비/ })).toHaveAttribute(
		"aria-pressed",
		"false",
	);
	await card.getByRole("button", { name: /^9월 회비/ }).click();
	await expect(confirm).toBeEnabled();
	await expect(page.locator(".accounting-sheet")).toHaveCount(0);
	for (const [width, height] of [
		[375, 812],
		[430, 932],
		[768, 1024],
		[1024, 768],
		[1440, 900],
	]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(dark) => document.documentElement.classList.toggle("dark", dark),
				theme === "dark",
			);
			await designEvidence(page, `settlement-${width}-${theme}`);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
			const sizes = await card.getByRole("button").evaluateAll((buttons) =>
				buttons
					.map((b) => ({
						width: b.getBoundingClientRect().width,
						height: b.getBoundingClientRect().height,
					}))
					.filter((b) => b.width > 0 && b.height > 0),
			);
			// The supplied design uses 26px changes and 36px choice chips.
			expect(sizes.every((s) => s.width >= 24 && s.height >= 24)).toBe(true);
		}
	}
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(0);
	expect(
		await scalar("select owner_id from dues_positions where bank_tx_id=90"),
	).toBe(A);
	await confirm.click();
	await expect(card).toHaveCount(0);
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(1);
	expect(
		await scalar(
			"select a.owner_id from dues_allocations a join dues_charges c on c.id=a.charge_id where a.bank_tx_id=90 and c.legacy_id=107",
		),
	).toBe(B);
	expect(
		await scalar(
			"select sum(a.amount-a.reversed)::int from dues_allocations a join dues_charges c on c.id=a.charge_id where c.legacy_id=104",
		),
	).toBe(5000);
	expect(
		await scalar("select paid_by from bank_transactions where id=90"),
	).toBe(A);
	await page.getByRole("button", { name: "회계", exact: true }).click();
	await page.getByText("회계 변경 이력", { exact: true }).click();
	await expect(
		page.locator(".ac-history").getByText(/납부자 변경:.*1996.*→.*2002/),
	).toBeVisible();
	await page.getByRole("button", { name: "거래 90 상세", exact: true }).click();
	await expect(card.locator(".ac-settled-heading")).toBeVisible();
	await expect(card.getByText("납부 완료", { exact: true })).toBeVisible();
	for (const [width, height] of [
		[390, 844],
		[1280, 900],
	]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(dark) => document.documentElement.classList.toggle("dark", dark),
				theme === "dark",
			);
			await designEvidence(page, `settled-payment-${width}-${theme}`);
		}
	}
	await card.getByRole("button", { name: "연결 해제", exact: true }).click();
	await card
		.getByRole("button", { name: "납부 연결 해제 확인", exact: true })
		.click();
	await expect
		.poll(() =>
			scalar(
				"select sum(amount-reversed)::int from dues_allocations where bank_tx_id=90",
			),
		)
		.toBe(0);
});

test("cancel and reissue previews without writing and commits once after recovery retirement", async ({
	page,
}) => {
	await navigate(page, "/dues/2026-08/charge");
	await page
		.getByRole("button", { name: "발행 내역·회비·대관 부과", exact: true })
		.click();
	await page.getByRole("button", { name: /^회식 / }).click();
	await page.getByRole("checkbox", { name: /000002/ }).uncheck();
	await page.getByRole("button", { name: "선택한 1건 취소 후 발행" }).click();
	await page.getByLabel(/000001 부과액/).fill("24000");
	await page.getByLabel("처리 사유").fill("회식비 변경");
	await page.getByRole("button", { name: "변경 결과 확인" }).click();
	await expect(
		page.getByText("기존 납부금 재사용", { exact: true }),
	).toBeVisible();
	expect(
		await scalar("select state from dues_charges where legacy_id=100"),
	).toBe("live");
	await page.getByRole("button", { name: "확정", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "확정", exact: true }),
	).toHaveCount(0);
	const preview = calls.find((c) => c.name === "dues_preview")!,
		commit = calls.find((c) => c.name === "dues_command")!;
	expect(commit.args).toEqual(preview.args);
	expect(
		await scalar(
			"select sum(amount)::int from dues_positions where purpose='member_pending' and bank_tx_id=1",
		),
	).toBe(6000);
	await page.getByRole("button", { name: "회계", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "부과 운영·복구" }),
	).toHaveCount(0);
	expect(
		await scalar("select state from dues_charges where legacy_id=100"),
	).toBe("cancelled");
});

test("one carry form moves partial debt and actual money; member sees both future balances", async ({
	page,
}) => {
	await db.query(
		"insert into bank_transactions(id,direction,amount,occurred_at) values(91,'in',6000,'2026-08-30T12:00:00+09')",
	);
	const pos = await scalar<string>(
		"select id from dues_positions where bank_tx_id=91",
	);
	await command({
		action: "position",
		position_id: pos,
		owner_id: B,
		amount: 6000,
		purpose: "member_pending",
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-08/charge");
	await page
		.getByRole("button", { name: "발행 내역·회비·대관 부과", exact: true })
		.click();
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
			"select sum(remaining)::int from dues_due where due_ym='2099-01'",
		),
	).toBe(3000);
	expect(await scalar("select count(*)::int from dues_charges")).toBe(7);
	await db.exec(`set test.admin='false'; set test.member='${B}'`);
	await navigate(page, "/my-dues", B);
	// 달 카드는 이름이 달에 묶이지 않는 region 이다(테스트 시계는 실제 시각이다).
	await expect(
		page.getByRole("region", { name: "회비 납부 현황" }),
	).toBeVisible();
	// 진입 달(=이번 달)에 부과가 없는 회원이 보는 첫 화면. 카드는 사라지지 않는다.
	await designEvidence(page, "my-dues-entry-light");
	await expect(
		page.getByText("앞으로 낼 돈 3,000원 · 이미 낸 돈 6,000원"),
	).toBeVisible();
	await expect(page.getByRole("region", { name: "입금 계좌" })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "계좌번호 복사" }),
	).toBeVisible();
	// 달 이동은 같은 조회 스냅샷에서 계산한다 — 새 dues_read 를 만들지 않는다.
	const reads = calls.filter((c) => c.name === "dues_read").length;
	const month = page.locator(".ac-month strong");
	const shown = await month.innerText();
	await page.getByRole("button", { name: "이전 달", exact: true }).click();
	await expect(month).not.toHaveText(shown);
	expect(calls.filter((c) => c.name === "dues_read")).toHaveLength(reads);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: "test-results/accounting-member-mobile.png",
		fullPage: true,
	});
	for (const theme of ["light", "dark"]) {
		await page.evaluate(
			(dark) => document.documentElement.classList.toggle("dark", dark),
			theme === "dark",
		);
		await designEvidence(page, `my-dues-${theme}`);
	}
	await page.evaluate(() =>
		document.documentElement.classList.remove("dark"),
	);
	await page.getByRole("button", { name: "클럽 회계", exact: true }).click();
	await expect(page.getByText("항목별 수지")).toBeVisible();
	await expect(
		page.getByText("회원 화면에서는 항목별 합계까지만 보입니다.", {
			exact: false,
		}),
	).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await designEvidence(page, "my-dues-ledger-light");
});

test("September refund finds and spends the remainder of an August deposit", async ({
	page,
}) => {
	const old = await scalar<string>(
		"select id from dues_charges where legacy_id=100",
	);
	await command({
		action: "replace",
		charge_ids: [old],
		lines: [
			{ previous_id: old, member_id: A, amount: 24000, due_ym: "2026-08" },
		],
	});
	await navigate(page, "/dues/2026-09/inbox");
	await page
		.getByRole("region", { name: "거래 9", exact: true })
		.getByRole("button", { name: "정산 옵션" })
		.click();
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
	await page.getByRole("button", { name: "납부자 변경" }).click();
	await page
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000002/ })
		.click();
	await expect(page.getByRole("radio", { name: /입금 #1 / })).toHaveCount(0);
	await page.getByRole("button", { name: "납부자 변경" }).click();
	await page
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000001/ })
		.click();
	await expect(page.getByRole("radio", { name: /입금 #1 / })).not.toBeChecked();
	await page.getByRole("radio", { name: /입금 #1 / }).check();
	await page.getByRole("button", { name: "환불 확인", exact: true }).click();
	await expect(page.locator(".accounting-sheet")).toHaveCount(0);
	await expect(
		page.getByRole("region", { name: "거래 9", exact: true }),
	).toHaveCount(0);
	expect(
		await scalar("select amount from dues_refunds where out_tx_id=9"),
	).toBe(6000);
});

test("ledger has no migration recovery controls and keeps the financial history", async ({
	page,
}) => {
	await command({ action: "apply" });
	await navigate(page, "/dues/2026-09/ledger");
	const summary = page.getByRole("region", { name: "이달의 수지" });
	await expect(summary).toContainText("통장잔액");
	await expect(summary).toContainText("646,592");
	await expect(
		page.getByRole("button", {
			name: /부과 운영·복구|직전 처리 되돌리기|기존 부과로 복귀|처리 일시 중지|백업/,
		}),
	).toHaveCount(0);
	await page.getByText("회계 변경 이력", { exact: true }).click();
	await expect(page.getByText("이월금 적용", { exact: true })).toBeVisible();
	expect(
		calls.some((c) => ["dues_export", "dues_manage"].includes(c.name)),
	).toBe(false);
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 900 },
	]) {
		await page.setViewportSize(viewport);
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(dark) => document.documentElement.classList.toggle("dark", dark),
				theme === "dark",
			);
			await designEvidence(
				page,
				`recovery-removed-ledger-${viewport.width}-${theme}`,
			);
		}
	}
});

test("replacement retains partial carry months and requires the changed amounts to add up", async ({
	page,
}) => {
	const d = await scalar<string>(
		"select d.id from dues_due d join dues_charges c on c.id=d.charge_id where c.legacy_id=106",
	);
	await command({
		action: "carry",
		member_id: B,
		target_ym: "2099-01",
		debts: [{ due_id: d, amount: 3000 }],
	});
	await navigate(page, "/dues/2026-07/charge");
	await page
		.getByRole("button", { name: "발행 내역·회비·대관 부과", exact: true })
		.click();
	await page.getByRole("button", { name: /^7월 회비 / }).click();
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
			"select sum(remaining)::int from dues_due where due_ym='2099-01'",
		),
	).toBe(3000);
});

test("unsettled August deposit appears directly and requires payer confirmation before refund", async ({
	page,
}) => {
	await db.exec(`
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values
		(90,'in',7000,'2026-08-01','김지훈0801'),
		(91,'in',8000,'2026-08-02','다른입금명'),
		(92,'in',9000,'2026-08-03','김지훈'),
		(99,'in',1000,'2026-08-04','소액입금');
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name)
		select id, 'in', 6000, '2026-07-01'::date + (id - 93), '김지훈 ' || (id - 92) || '회비'
		from generate_series(93, 98) as id;
		select dues_sync_bank();
	`);
	await command({
		action: "position",
		position_id: await scalar<string>("select id from dues_positions where bank_tx_id=92"),
		amount: 9000,
		purpose: "member_pending",
		owner_id: B,
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-09/inbox");
	await page
		.getByRole("region", { name: "거래 9", exact: true })
		.getByRole("button", { name: "정산 옵션" })
		.click();
	await page.getByRole("button", { name: "환불 연결", exact: true }).click();
	await page.getByLabel("납부자 이름·초성 검색").fill("ㄱㅈㅎ");
	await page
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000001/ })
		.click();
	const card = page.getByRole("region", { name: "거래 9", exact: true });
	const main = card.locator('[aria-label="환불 원입금 후보"]');
	await expect(main.getByRole("radio", { name: /입금 #90 .*환불 가능 7,000원/ })).toBeVisible();
	await expect(card.getByText("이 납부자의 환불 가능한 입금이 없습니다.")).toHaveCount(0);
	await expect(card.getByRole("radio", { name: /입금 #91 / })).toHaveCount(0);
	await expect(card.getByRole("radio", { name: /입금 #92 / })).toHaveCount(0);
	await expect(card.getByRole("button", { name: /잔액이 없거나 환불액보다 적은 입금/ })).toHaveCount(0);
	await expect(card.getByRole("radio", { name: /입금 #[12] / })).toHaveCount(0);
	await card.getByRole("button", { name: /다른 미정산 입금 찾기/ }).click();
	await expect(card.getByRole("radio", { name: /입금 #91 / })).toBeEnabled();
	await expect(card.getByRole("radio", { name: /입금 #99 / })).toHaveCount(0);
	await expect(card.getByRole("radio", { name: /입금 #90 / })).toHaveCount(1);
	await expect(card.getByRole("radio", { name: /입금 #92 / })).toHaveCount(0);
	await card.getByRole("button", { name: /다른 미정산 입금 찾기/ }).click();
	await card.getByRole("button", { name: "입금 검색 필터" }).click();
	await card.getByLabel("입금월 (비우면 전체)").fill("2026-09");
	await expect(card.getByRole("radio", { name: /입금 #90 / })).toHaveCount(0);
	await card.getByLabel("입금월 (비우면 전체)").fill("");
	await card.getByRole("button", { name: "입금 검색 필터" }).click();
	await page.getByRole("radio", { name: /입금 #90 / }).check();
	await expect(
		page.getByRole("button", { name: "환불 확인", exact: true }),
	).toBeDisabled();
	await expect(
		page.getByText("미매칭 원입금의 실제 납부자를 확인해 주세요"),
	).toBeVisible();
	for (const [width, height] of [[390, 844], [1440, 1000]]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
			await designEvidence(page, `receipt-refund-unsettled-${width}-${theme}`);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		}
	}
	await page
		.getByRole("checkbox", { name: /이 원입금이 .*000001.*돈임을 확인/ })
		.check();
	await page.getByRole("button", { name: "환불 확인", exact: true }).click();
	await expect(
		page.getByRole("region", { name: "거래 9", exact: true }),
	).toHaveCount(0);
	expect(
		await scalar("select owner_id from dues_refunds where out_tx_id=9"),
	).toBe(A);
	expect(
		await scalar(
			"select sum(amount)::int from dues_positions where bank_tx_id=90 and purpose='member_pending'",
		),
	).toBe(1000);
	expect(calls.filter((c) => c.name === "dues_command").map((c) => (c.args.p_payload as { action: string }).action)).toEqual(["refund"]);
});

test("same-name payer B can receive a missing monthly charge and pay it independently of A", async ({
	page,
}) => {
	await db.query(
		"insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',5000,'2026-08-30','김지훈8월회비')",
	);
	await navigate(page, "/dues/2026-08/inbox");
	let receipt = page.getByRole("region", { name: "거래 90", exact: true });
	await receipt.getByRole("button", { name: "정산 옵션" }).click();
	await receipt.getByRole("button", { name: "용도 지정", exact: true }).click();
	await expect(page.getByText("선택한 납부자:")).toHaveCount(0);
	await page
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000002/ })
		.click();
	await receipt
		.getByRole("button", { name: "용도 지정 확인", exact: true })
		.click();
	await expect(receipt.getByText("선택한 내역을 반영했습니다.")).toBeVisible();
	await page.getByRole("button", { name: "부과", exact: true }).click();
	await page
		.getByRole("button", { name: "발행 내역·회비·대관 부과", exact: true })
		.click();
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
	receipt = page.getByRole("region", { name: "거래 90", exact: true });
	// Pending receipts open directly in payment mode.
	await receipt
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000002/ })
		.click();
	await expect(receipt.locator(".ac-receipt-hint")).toContainText("000002");
	await receipt.getByRole("button", { name: /^8월 회비/ }).click();
	await receipt.getByRole("button", { name: "납부 확인", exact: true }).click();
	await expect(receipt).toHaveCount(0);
	expect(
		await scalar("select amount_paid from dues_legacy.dues_charges where id=102"),
	).toBe(5000);
	expect(
		await scalar(
			"select sum(a.amount-a.reversed)::int from dues_allocations a join dues_charges c on c.id=a.charge_id join dues_groups g on g.id=c.group_id where c.member_id=$1 and g.source_key='monthly:2026-08'",
			[B],
		),
	).toBe(5000);
	expect(
		await scalar(
			"select owner_id from dues_allocations where bank_tx_id=90",
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
	await page
		.getByRole("button", { name: "발행 내역·회비·대관 부과", exact: true })
		.click();
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
	await page
		.getByRole("list", { name: "참고 회차", exact: true })
		.getByRole("button", {
			name: "2026-08-22 · 체육관 · 18:00–20:00",
			exact: true,
		})
		.click();
	const roster = page.getByRole("group", { name: "부과 대상 명단" });
	await expect(roster.getByRole("button", { name: /000002/ })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(roster.getByRole("button", { name: /000001/ })).toHaveAttribute(
		"aria-pressed",
		"false",
	);
	await page.getByLabel("부과 이름", { exact: true }).fill("저녁 회식");
	await page.getByLabel("총액으로 나누기", { exact: true }).fill("5000");
	await page.getByRole("button", { name: "1명에게 발행", exact: true }).click();
	await expect(page.getByRole("status")).toContainText("부과를 발행했습니다");
	expect(
		await scalar(
			"select basis->>'reference_session_id' from dues_charges where legacy_id is null",
		),
	).toBe("2");
});

test("accounting layouts keep settlement in the list in both themes", async ({
	page,
}) => {
	const old = await scalar<string>(
		"select id from dues_charges where legacy_id=100",
	);
	await command({
		action: "replace",
		charge_ids: [old],
		lines: [
			{ previous_id: old, member_id: A, amount: 24000, due_ym: "2026-08" },
		],
	});
	await page.setViewportSize({ width: 390, height: 844 });
	for (const theme of ["light", "dark"]) {
		await navigate(page, "/dues/2026-09/inbox");
		await page.evaluate(
			(dark) => document.documentElement.classList.toggle("dark", dark),
			theme === "dark",
		);
		const card = page.getByRole("region", { name: "거래 9", exact: true });
		await card.getByRole("button", { name: "정산 옵션" }).click();
		await card.getByRole("button", { name: "환불 연결", exact: true }).click();
		await card
			.getByRole("group", { name: "납부자 검색 결과" })
			.getByRole("button", { name: /1993/ })
			.click();
		await card.getByRole("radio", { name: /입금 #1 / }).check();
		await expect(
			card.getByRole("button", { name: "환불 확인", exact: true }),
		).toBeEnabled();
		await expect(page.locator(".accounting-sheet")).toHaveCount(0);
		await card.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: `test-results/accounting-inline-refund-${theme}.png`,
			fullPage: true,
			animations: "disabled",
		});
		await designEvidence(page, `refund-${theme}`);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	}
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.screenshot({
		path: "test-results/accounting-inline-desktop.png",
		fullPage: true,
		animations: "disabled",
	});
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(0);
});

test("inline matching and payment need one confirmation and recover a lost response without double spending", async ({
	page,
}) => {
	await db.exec(
		"insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',6000,'2026-09-06','김지훈 회비')",
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 90", exact: true });
	await card
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000002/ })
		.click();
	await card.getByRole("button", { name: /^7월 회비/ }).click();
	const confirm = card.getByRole("button", { name: "납부 확인", exact: true });
	await expect(confirm).toBeEnabled();
	await expect(card.getByText(/입금 잔액 1,000원/)).toBeVisible();
	expect(
		await scalar("select owner_id from dues_positions where bank_tx_id=90"),
	).toBeNull();
	await expect(page.locator(".accounting-sheet")).toHaveCount(0);
	await card.screenshot({
		path: "test-results/accounting-inline-payment.png",
		animations: "disabled",
	});
	loseCommitResponse = true;
	await confirm.click();
	const retry = card.getByRole("button", {
		name: "결과 다시 확인",
		exact: true,
	});
	await expect(retry).toBeEnabled();
	await expect(
		card.getByRole("button", { name: "납부자 변경" }),
	).toBeDisabled();
	await expect(card.getByRole("button", { name: "정산 옵션" })).toBeDisabled();
	await retry.click();
	await expect(card.getByText("선택한 내역을 반영했습니다.")).toBeVisible();
	const commits = calls.filter((c) => c.name === "dues_command");
	expect(commits).toHaveLength(2);
	expect(commits[0].args).toEqual(commits[1].args);
	expect(calls.filter((c) => c.name === "dues_preview")).toHaveLength(0);
	expect(
		await scalar(
			"select count(*)::int from dues_allocations where bank_tx_id=90",
		),
	).toBe(1);
	expect(
		await scalar(
			"select sum(amount)::int from dues_positions where bank_tx_id=90 and owner_id=$1",
			[B],
		),
	).toBe(1000);
});

test("inline stale confirmation requires another explicit confirmation after refreshing", async ({
	page,
}) => {
	await db.exec(
		"insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',5000,'2026-09-06','김지훈')",
	);
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 90", exact: true });
	await card
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000002/ })
		.click();
	await card.getByRole("button", { name: /^7월 회비/ }).click();
	const confirm = card.getByRole("button", { name: "납부 확인", exact: true });
	await expect(confirm).toBeEnabled();
	await command({ action: "apply" });
	await confirm.click();
	await expect(confirm).toBeEnabled();
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(1);
	expect(
		await scalar("select owner_id from dues_positions where bank_tx_id=90"),
	).toBeNull();
	await confirm.click();
	await expect(card).toHaveCount(0);
	expect(
		await scalar(
			"select count(*)::int from dues_allocations where bank_tx_id=90",
		),
	).toBe(1);
});

test("inline expense confirmation advances the pending list and inline carry moves debt and cash together", async ({
	page,
}) => {
	await db.exec(
		"insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',6000,'2026-09-06','김지훈'),(91,'out',8000,'2026-09-05','체육관')",
	);
	await navigate(page, "/dues/2026-09/inbox");
	await expect(
		page
			.locator(".ac-ledger-filters")
			.getByRole("button", { name: "전체", exact: true }),
	).toHaveCount(0);
	const expense = page.getByRole("region", { name: "거래 91", exact: true });
	await expense
		.getByRole("group", { name: "회계 항목 선택" })
		.getByRole("button", { name: "회식", exact: true })
		.click();
	await expense.getByRole("button", { name: "지출 확인", exact: true }).click();
	await expect(expense).toHaveCount(0);
	const receipt = page.getByRole("region", { name: "거래 90", exact: true });
	await expect(receipt).toBeVisible();
	await receipt.getByRole("button", { name: "정산 옵션" }).click();
	await receipt.getByRole("button", { name: "이월", exact: true }).click();
	await receipt
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000002/ })
		.click();
	await receipt.getByLabel("이월할 월").fill("2099-01");
	await receipt.getByRole("button", { name: /^7월 회비/ }).click();
	await receipt
		.getByRole("button", { name: "이 입금 · 6,000원", exact: true })
		.click();
	await receipt.getByLabel("7월 회비 선택 금액").fill("3000");
	await receipt.getByRole("button", { name: "이월 확인", exact: true }).click();
	await expect(receipt).toHaveCount(0);
	await expect(page.locator(".accounting-sheet")).toHaveCount(0);
	expect(
		await scalar(
			"select sum(remaining)::int from dues_due where due_ym='2099-01'",
		),
	).toBe(3000);
	expect(
		await scalar(
			"select sum(amount)::int from dues_positions where bank_tx_id=90 and owner_id=$1 and purpose='carry'",
			[B],
		),
	).toBe(6000);
});

test("ledger restores the compact monthly list and edits saved expenses without confirming them twice", async ({
	page,
}) => {
	const balanceReads: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.pathname.endsWith("/bank_transactions"))
			balanceReads.push(url.searchParams.get("select") ?? "");
	});
	const meal = await scalar<string>(
		"select id from dues_groups where source_key='manual:meal:1'",
	);
	await command({ action: "expense", out_tx_id: 9, group_id: meal });
	await db.exec(`
		insert into dues_groups(source_key,kind,label,occurred_on)
		select 'manual:recent:'||n,'manual','최근 항목 '||n,'2026-09-06' from generate_series(1,7) n;
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name,balance_after) values
		(90,'in',6000,'2026-09-06T12:00:00+09','김지훈 9월 회비',718592),
		(91,'out',117000,'2026-09-06T10:00:00+09','최광준',712592),
		(92,'in',3000,'2026-09-05T12:00:00+09','이월 입금',829592);
	`);
	const money = await scalar<string>(
		"select id from dues_positions where bank_tx_id=92",
	);
	await command({
		action: "carry",
		member_id: B,
		target_ym: "2099-01",
		confirm_owner: true,
		debts: [],
		money: [{ position_id: money, amount: 3000 }],
	});
	await navigate(page, "/dues/2026-09/inbox");
	await expect(
		page.getByRole("heading", { name: "처리할 내역 2" }),
	).toBeVisible();
	await expect(
		page.getByRole("region", { name: "거래 9", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("region", { name: "거래 92", exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "회계", exact: true }).click();
	const ledger = page.getByRole("region", { name: "전체 거래 내역" });
	await expect(
		ledger.getByRole("button", { name: /^거래 \d+ 상세$/ }),
	).toHaveCount(4);
	// 접힌 줄은 날짜 + 금액 + (미정산) 만 말한다. 어디에 쓰였는지는 펼친 상세가
	// 책임진다(아래 '지출 처리됨 · 회식' 검사). 판단이 남은 건은 목록에서 바로 보여야 한다.
	const row9 = ledger.getByRole("group", { name: "거래 9 요약" });
	await expect(row9).toContainText("9/2");
	await expect(row9).not.toContainText("회식");
	const row92 = ledger.getByRole("group", { name: "거래 92 요약" });
	await expect(row92).toContainText("+3,000");
	await expect(row92).not.toContainText("2099-01");
	await expect(
		ledger.getByRole("group", { name: "거래 90 요약" }),
	).toContainText("미정산");
	// 펼치면 이월 내역이 그대로 드러난다 — 접힌 줄에서 뺀 설명의 행선지.
	await ledger.getByRole("button", { name: "거래 92 상세" }).click();
	await expect(page.locator("#ledger-detail-92")).toContainText("2099-01");
	await ledger.getByRole("button", { name: "거래 92 상세" }).click();
	const summary = page.getByRole("region", { name: "이달의 수지" });
	await expect(summary).toContainText("통장잔액");
	await expect(summary).toContainText("9/6 기준");
	await expect(summary).toContainText("718,592");
	await expect(ledger.locator(".ac-transaction")).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	for (const theme of ["light", "dark"]) {
		await page.evaluate(
			(dark) => document.documentElement.classList.toggle("dark", dark),
			theme === "dark",
		);
		await ledger.screenshot({
			path: `test-results/accounting-compact-ledger-${theme}.png`,
			animations: "disabled",
		});
		await designEvidence(page, `ledger-${theme}`);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	}
	const filters = ledger.getByRole("group", { name: "거래 내역 필터" });
	await filters.getByRole("button", { name: "미정산", exact: true }).click();
	await expect(
		ledger.getByRole("button", { name: /^거래 \d+ 상세$/ }),
	).toHaveCount(2);
	await filters.getByRole("button", { name: "전체", exact: true }).click();
	// 항목별 수지는 거래 내역 안의 필터 줄이다 — 누르면 그 항목의 거래만 남고 다시
	// 누르면 풀린다. 좁힐 대상이 없는 합성 항목(미분류·이월 …)은 버튼이 아니지만
	// 금액은 읽을 수 있어야 한다.
	const buckets = ledger.getByRole("group", { name: "항목별 수지" });
	// 순서는 종류 묶음 + 날짜순 — 묶음이 있는 항목(회식)이 먼저, 묶음 없는 합성
	// 항목(미분류·이월 입금)이 라벨순으로 뒤에 선다.
	await expect(buckets.locator(".ac-bucket-name")).toHaveText([
		"회식",
		"미분류",
		"이월 입금",
	]);
	await expect(buckets.getByText("미분류", { exact: true })).toBeVisible();
	await expect(buckets.getByRole("button", { name: /^미분류/ })).toHaveCount(0);
	await buckets.getByRole("button", { name: /^회식 .* 거래 보기$/ }).click();
	await expect(
		ledger.getByRole("button", { name: /^거래 \d+ 상세$/ }),
	).toHaveCount(1);
	await expect(ledger.getByRole("group", { name: "거래 9 요약" })).toBeVisible();
	await buckets.getByRole("button", { name: /^회식 .* 필터 해제$/ }).click();
	await expect(
		ledger.getByRole("button", { name: /^거래 \d+ 상세$/ }),
	).toHaveCount(4);
	await ledger.getByLabel("전체 거래 검색").fill("2026-09-05");
	await expect(
		ledger.getByRole("button", { name: /^거래 \d+ 상세$/ }),
	).toHaveCount(1);
	await expect(
		ledger.getByRole("group", { name: "거래 92 요약" }),
	).toBeVisible();
	await ledger.getByLabel("전체 거래 검색").fill("");
	await ledger.getByLabel("거래 정렬").selectOption("amount");
	await expect(
		ledger.locator(".ac-ledger-transaction-row").first(),
	).toHaveAttribute("aria-label", "거래 91 요약");
	expect(balanceReads).toEqual(["id,occurred_at,balance_after"]);
	await ledger.getByLabel("전체 거래 검색").fill("회식");
	await expect(
		ledger.getByRole("button", { name: /^거래 \d+ 상세$/ }),
	).toHaveCount(1);
	await ledger.getByRole("button", { name: "거래 9 상세" }).click();
	const card = ledger.getByRole("region", { name: "거래 9", exact: true });
	await expect(card.getByText("지출 처리됨")).toBeVisible();
	await card.getByRole("button", { name: "지출 항목 변경" }).click();
	const choices = card.getByRole("group", { name: "회계 항목 선택" });
	const saved = choices.getByRole("button", { name: "회식", exact: true });
	await expect(saved).toHaveAttribute("aria-pressed", "true");
	await saved.click();
	await expect(card.getByRole("button", { name: "변경 저장" })).toHaveCount(0);
	expect(
		calls.filter((c) =>
			["dues_preview", "dues_command"].includes(c.name),
		),
	).toHaveLength(0);
	await choices
		.getByRole("button", { name: "최근 항목 1", exact: true })
		.click();
	await expect(card.getByRole("button", { name: "변경 저장" })).toBeEnabled();
	await choices
		.getByRole("button", { name: "최근 항목 1", exact: true })
		.click();
	// Searching must keep the selected group visible, even outside the first six choices.
	await card.getByRole("button", { name: "정산 옵션" }).click();
	await expect(
		card.getByRole("button", { name: "환불 연결", exact: true }),
	).toHaveCount(0);
	await card.getByLabel("회계 항목 검색").fill("회식");
	await choices.getByRole("button", { name: "회식", exact: true }).click();
	await expect(card.getByRole("button", { name: "변경 저장" })).toHaveCount(0);
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(0);
	await choices.getByRole("button", { name: "미분류로 변경" }).click();
	await card.getByRole("button", { name: "변경 저장" }).click();
	await expect(ledger.getByRole("button", { name: "거래 9 상세" })).toHaveCount(
		0,
	); // no longer matches '회식'
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(1);
	expect(
		await scalar("select group_id from dues_expenses where bank_tx_id=9"),
	).toBeNull();
	await page.getByRole("button", { name: "정산함", exact: true }).click();
	await expect(
		page.getByRole("region", { name: "거래 9", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "회계", exact: true }).click();
	await page.getByRole("button", { name: "이전 달", exact: true }).click();
	await expect(
		page
			.getByRole("region", { name: "전체 거래 내역" })
			.getByRole("button", { name: /^거래 \d+ 상세$/ }),
	).toHaveCount(5);
	await expect(page.getByRole("button", { name: "거래 9 상세" })).toHaveCount(
		0,
	);
});

test("overview presents read-only payment progress in both themes, with operations in their own tabs", async ({
	page,
}) => {
	const C = "00000000-0000-4000-8000-000000000003";
	const D = "00000000-0000-4000-8000-000000000005";
	const G = "00000000-0000-4000-8000-000000000006";
	await db.exec(`
		update members set birth_year=1996 where id='${A}';
		update members set birth_year=2002 where id='${B}';
		insert into members(id,name,is_active) values('${C}','박서연',true),('${D}','이민수',false),('${G}','김민서',true);
		update sessions set title='에이트민턴' where id=1;
		insert into attendances(session_id,member_id,status) values (1,'${A}','confirmed'),(1,'${C}','confirmed'),(1,'${D}','late_pool'),(1,'00000000-0000-4000-8000-000000000004','confirmed');
		insert into attendances(session_id,member_id,status,confirmed_at,cancelled_at) values (1,'${G}','cancelled','2026-08-22T10:00:00+09','2026-08-22T10:30:00+09');
	`);
	const monthly = await scalar<string>(
		"select id from dues_groups where source_key='monthly:2026-08'",
	);
	const court = await scalar<string>(
		"select id from dues_groups where source_key='court:1'",
	);
	await command({
		action: "issue",
		group_id: monthly,
		lines: [B, C, D].map((member_id) => ({
			member_id,
			amount: 5000,
			due_ym: "2026-08",
		})),
	});
	await command({
		action: "issue",
		group_id: court,
		lines: [A, C, D].map((member_id) => ({
			member_id,
			amount: 6000,
			due_ym: "2026-08",
		})),
	});
	const debt = await scalar<string>(
		"select d.id from dues_due d join dues_charges c on c.id=d.charge_id where c.legacy_id=106",
	);
	const cash = await scalar<string>(
		"select id from dues_positions where bank_tx_id=2 and amount>0",
	);
	await command({
		action: "carry",
		member_id: B,
		target_ym: "2099-01",
		debts: [{ due_id: debt, amount: 2000 }],
		money: [],
	});
	await command({
		action: "carry",
		member_id: A,
		target_ym: "2099-01",
		debts: [],
		money: [{ position_id: cash, amount: 1000 }],
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-08");
	const overview = page.getByRole("region", { name: "월별 납부 현황" });
	const fee = overview.getByRole("region", { name: "8월 회비 현황" });
	await expect(fee.getByRole("progressbar")).toHaveAttribute(
		"aria-valuenow",
		"25",
	);
	await expect(fee.getByText("1 / 4명")).toBeVisible();
	await expect(overview.getByRole("region", { name: "미납 현황" })).toHaveCount(
		0,
	);
	await expect(overview.getByText("남은 미납", { exact: true })).toHaveCount(0);
	const courtRegion = overview.getByRole("region", {
		name: /에이트민턴.*부과 현황/,
	});
	await expect(courtRegion).toContainText("전체 6명");
	await expect(courtRegion).toContainText("부과 3명");
	await expect(courtRegion).toContainText("제외 3명");
	await expect(courtRegion).not.toContainText("부과 제외 ·");
	await expect(page.locator(".ac-status-counts")).toHaveCount(0);
	await expect(courtRegion).toContainText("0/3명 납부");
	await expect(overview.getByRole("region", { name: "이월 현황" })).toHaveCount(
		0,
	);
	await expect(page.getByRole("checkbox")).toHaveCount(0);
	await expect(
		page.getByRole("button", {
			name: /취소 후 발행|이월금 적용|미납·입금 이월|부과 운영·복구/,
		}),
	).toHaveCount(0);
	await expect(page.getByText("회계 변경 이력", { exact: true })).toHaveCount(
		0,
	);
	for (const theme of ["light", "dark"]) {
		await page.evaluate(
			(dark) => document.documentElement.classList.toggle("dark", dark),
			theme === "dark",
		);
		await page.screenshot({
			path: `test-results/accounting-overview-${theme}.png`,
			fullPage: true,
			animations: "disabled",
		});
		await designEvidence(page, `overview-${theme}`);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	}
	const feeTrigger = fee.getByRole("button", { name: "납부 명단" });
	const originalCardHeight = (await fee.boundingBox())!.height;
	await feeTrigger.click();
	const feeDialog = page.getByRole("dialog", { name: "8월 회비 납부 명단" });
	await expect(feeDialog.getByText(/김지훈 · 1996년생/)).toBeVisible();
	await expect(feeDialog.getByText(/김지훈 · 2002년생/)).toBeVisible();
	await expect(feeDialog.getByText("이민수", { exact: true })).toBeVisible();
	await expect(feeDialog.getByText(/입금으로 납부/)).toBeVisible();
	expect((await fee.boundingBox())!.height).toBe(originalCardHeight);
	await expect(feeDialog.getByRole("button", { name: "닫기" })).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(
		feeDialog.getByRole("region", { name: "상세 명단" }),
	).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(feeDialog.getByRole("button", { name: "닫기" })).toBeFocused();
	await designEvidence(page, "fee-modal-mobile-dark");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(feeTrigger).toBeFocused();
	await courtRegion.getByRole("button").click();
	const courtDialog = page.getByRole("dialog", {
		name: /에이트민턴.*부과 명단/,
	});
	await expect(courtDialog).toContainText("부과 취소 1명");
	await expect(courtDialog).toContainText("운영진 1명");
	await expect(courtDialog).toContainText("1시간 내 철회 1명");
	await expect(
		courtDialog.getByText("운영진 · 대관비 면제", { exact: true }),
	).toBeVisible();
	await expect(
		courtDialog.getByText("확정 후 1시간 내 철회 · 미부과", { exact: true }),
	).toBeVisible();
	await expect(courtDialog.getByText("미납", { exact: true })).toHaveCount(3);
	for (const theme of ["light", "dark"]) {
		await page.evaluate(
			(dark) => document.documentElement.classList.toggle("dark", dark),
			theme === "dark",
		);
		await designEvidence(page, `participation-modal-${theme}`);
	}
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.evaluate(() => {
		(document.activeElement as HTMLElement | null)?.blur();
		window.scrollTo({ top: 0, behavior: "instant" });
	});
	await page.screenshot({
		path: "test-results/accounting-overview-desktop.png",
		fullPage: true,
		animations: "disabled",
	});
	await designEvidence(page, "participation-desktop");
	await courtDialog.getByRole("button", { name: "닫기" }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await designEvidence(page, "overview-desktop");
	expect(
		calls.filter((c) =>
			["dues_command", "dues_preview", "dues_manage"].includes(c.name),
		),
	).toHaveLength(0);
	await page
		.getByRole("navigation")
		.getByRole("button", { name: "정산함", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: /^처리할 내역/ }),
	).toBeVisible();
	await page.getByRole("button", { name: "부과", exact: true }).click();
	await page
		.getByRole("button", { name: "발행 내역·회비·대관 부과", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "미납·입금 이월", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "회계", exact: true }).click();
	await expect(page.getByText("회계 변경 이력", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "부과 운영·복구", exact: true }),
	).toHaveCount(0);
});

test("overview shows an unissued month as empty and resets the roster on month changes", async ({
	page,
}) => {
	await navigate(page, "/dues/2026-07");
	await page.getByRole("button", { name: "납부 명단" }).click();
	await page.getByRole("dialog").getByRole("button", { name: "닫기" }).click();
	await page.getByRole("button", { name: "이전 달", exact: true }).click();
	const fee = page.getByRole("region", { name: "6월 회비 현황" });
	await expect(fee.getByText("부과 없음", { exact: true })).toBeVisible();
	await expect(fee.getByRole("progressbar")).toHaveAttribute(
		"aria-valuenow",
		"0",
	);
	await expect(fee.getByText("모두 납부", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "미납 현황" })).toHaveCount(0);
	await page.getByRole("button", { name: "다음 달", exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "납부 명단" })).toHaveAttribute(
		"aria-haspopup",
		"dialog",
	);
});

test("overview retains issued facts when attendance fails and retries without writing", async ({
	page,
}) => {
	let unavailable = true;
	await page.route("**/rest/v1/sessions?**", async (route) => {
		if (unavailable)
			return route.fulfill({ status: 403, json: { message: "Unavailable" } });
		return route.fallback();
	});
	await navigate(page, "/dues/2026-08");
	const overview = page.getByRole("region", { name: "월별 납부 현황" });
	await expect(overview.getByRole("alert")).toBeVisible();
	const court = overview.getByRole("region", { name: /대관.*부과 현황/ });
	await expect(court).toContainText("발행 명단 1명");
	await expect(court).not.toContainText("전체");
	await court.getByRole("button").click();
	await expect(page.getByRole("dialog")).toContainText(
		"참석 기록을 확인할 수 없어 발행 명단만 표시합니다.",
	);
	await page.getByRole("dialog").getByRole("button", { name: "닫기" }).click();
	unavailable = false;
	await overview.getByRole("button", { name: "다시 불러오기" }).click();
	await expect(overview.getByRole("alert")).toHaveCount(0);
	await expect(court).toContainText("전체 1명");
	await court.getByRole("button").click();
	await expect(page.getByRole("dialog")).toContainText("부과 취소");
	expect(
		calls.filter((c) =>
			["dues_command", "dues_preview", "dues_manage"].includes(c.name),
		),
	).toHaveLength(0);
});

test("a unique dated receipt fits one card and confirms with no selection RPCs and one refresh", async ({
	page,
}) => {
	const member = "00000000-0000-4000-8000-000000000008";
	await db.exec(`insert into members(id,name,birth_year) values('${member}','박민준',1995);
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',6500,'2026-09-07T12:00:00+09','박민준0906');`);
	await command({
		action: "issue",
		kind: "manual",
		date: "2026-09-06",
		label: "9. 6. 에이트민턴 · 19:00–22:00",
		lines: [{ member_id: member, amount: 6500, due_ym: "2026-09" }],
	});
	// The UI must not wait for another read/preview after making a selection.
	await page.route("**/rest/v1/rpc/dues_read", async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 300));
		await route.fallback();
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 90", exact: true });
	await expect(card.locator(".ac-receipt-payer")).toContainText("박민준");
	await expect(
		card.getByRole("button", { name: "납부자 변경" }),
	).toHaveAttribute("aria-expanded", "false");
	await expect(card.getByRole("searchbox")).toHaveCount(0);
	await expect(card.locator("input")).toHaveCount(0);
	await expect(
		card.getByRole("button", { name: "납부 연결", exact: true }),
	).toHaveCount(0);
	const target = card.getByRole("button", { name: /^9\. 6\. 에이트민턴/ });
	await expect(target).toHaveAttribute("aria-pressed", "true");
	const confirm = card.getByRole("button", { name: "납부 확인", exact: true });
	await expect(confirm).toBeEnabled();
	await expect(card.locator("details")).toHaveCount(0);
	await expect(
		card.getByRole("button", { name: "접기", exact: true }),
	).toHaveCount(0);
	await expect(confirm).toHaveText("확인");
	await card.getByRole("button", { name: "정산 옵션" }).click();
	await card.getByLabel("처리 사유").fill("대관비");
	await card.getByLabel("처리 사유").fill("9월 6일 대관비");
	const amount = card.getByRole("spinbutton", { name: /선택 금액/ });
	await amount.fill("6501");
	await expect(confirm).toBeDisabled();
	await amount.fill("6500");
	await expect(confirm).toBeEnabled();
	await card.getByRole("button", { name: "정산 옵션" }).click();
	await expect(card.locator("input")).toHaveCount(0);
	for (const [width, height] of [
		[375, 812],
		[390, 844],
		[768, 1024],
		[1440, 900],
	]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(dark) => document.documentElement.classList.toggle("dark", dark),
				theme === "dark",
			);
			await page.evaluate(() =>
				(document.activeElement as HTMLElement | null)?.blur(),
			);
			await designEvidence(page, `direct-${width}-${theme}`);
			const box = (await confirm.boundingBox())!;
			expect((await card.boundingBox())!.height).toBeLessThan(340);
			// The confirm rail fills the card even when the only due has a short label.
			expect(
				Math.abs((await card.boundingBox())!.width - box.width - 28),
			).toBeLessThan(2);
			expect(box.y + box.height).toBeLessThan(height);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
		}
	}
	expect(calls.filter((c) => c.name === "dues_read")).toHaveLength(1);
	expect(calls.filter((c) => c.name === "dues_sessions")).toHaveLength(0);
	expect(calls.filter((c) => c.name === "dues_preview")).toHaveLength(0);
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(0);
	await confirm.click();
	await expect(card).toHaveCount(0);
	// A new revision should not trigger another full read after the explicit refresh.
	expect(calls.filter((c) => c.name === "dues_read")).toHaveLength(2);
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(1);
	expect(calls.filter((c) => c.name === "dues_preview")).toHaveLength(0);
	expect(
		await scalar(
			"select sum(amount)::int from dues_allocations where bank_tx_id=90",
		),
	).toBe(6500);
	writeFileSync(
		"test-results/direct-rpc-counts.json",
		JSON.stringify({
			initialReads: 1,
			selectionPreviews: 0,
			sessionReads: 0,
			commits: 1,
			postCommitReads: 1,
			readDelayMs: 300,
		}),
	);
});

test("a database rejection unlocks the form, and a corrected retry commits once", async ({
	page,
}) => {
	await db.exec(
		"insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',5000,'2026-09-06','김지훈')",
	);
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 90", exact: true });
	await card
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000002/ })
		.click();
	await card.getByRole("button", { name: /^7월 회비/ }).click();
	await db.exec(
		"update dues_control set paused=true,revision=revision+1 where id=1",
	);
	await card.getByRole("button", { name: "납부 확인", exact: true }).click();
	await expect(card.getByRole("alert")).toContainText("일시 중지");
	await card.getByRole("button", { name: "정산 옵션" }).click();
	await expect(card.getByLabel("처리 사유")).toBeEnabled();
	expect(
		await scalar(
			"select count(*)::int from dues_allocations where bank_tx_id=90",
		),
	).toBe(0);
	await db.exec(
		"update dues_control set paused=false,revision=revision+1 where id=1",
	);
	await card.getByRole("button", { name: "내역 새로고침" }).click();
	await card.getByLabel("처리 사유").fill("재개 후 납부 확인");
	await card.getByRole("button", { name: "납부 확인", exact: true }).click();
	await expect(card).toHaveCount(0);
	expect(
		await scalar(
			"select count(*)::int from dues_allocations where bank_tx_id=90",
		),
	).toBe(1);
});

test("role revocation refreshes mode and removes admin data without reloading the admin ledger", async ({
	page,
}) => {
	await navigate(page, "/dues/2026-09/inbox");
	await expect(
		page.getByRole("region", { name: "거래 9", exact: true }),
	).toBeVisible();
	await page.evaluate(async () => {
		const moduleUrl = "/src/store/authStore.ts";
		const { useAuthStore } = await import(moduleUrl);
		useAuthStore.setState({ isAdmin: false });
	});
	await expect
		.poll(() => calls.filter((c) => c.name === "dues_mode").length)
		.toBe(2);
    await expect(page.getByRole("region", { name: "거래 9", exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => {
        const moduleUrl = "/src/store/duesStore.ts";
        const { useDuesStore } = await import(moduleUrl);
        return useDuesStore.getState().data;
    })).toBeNull();
    expect(calls.filter((c) => c.name === "dues_read")).toHaveLength(1);
});

test("manual voucher splits and rounds the total for selected member IDs without writing before confirmation", async ({
	page,
}) => {
	await db.exec(
		`update members set birth_year=1996 where id='${A}'; update members set birth_year=2002 where id='${B}';`,
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-08/charge");
	const voucher = page.getByRole("region", { name: "부과 발행", exact: true });
	await expect(
		voucher.getByRole("button", { name: "+ 새 묶음", exact: true }),
	).toHaveCount(0);
	await expect(voucher.getByLabel("처리 사유")).toHaveCount(0);
	await expect(voucher.getByLabel("참고 회차")).toBeVisible();
	await expect(
		page.getByText("이 달 발행된 묶음", { exact: true }),
	).toHaveCount(0);
	await expect(
		voucher.getByRole("button", { name: "0명에게 발행", exact: true }),
	).toBeDisabled();
	await voucher.getByLabel("부과 이름", { exact: true }).fill("9월 회식 분할");
	await voucher.getByLabel("발생일", { exact: true }).fill("2026-09-12");
	const roster = voucher.getByRole("group", { name: "부과 대상 명단" });
	const first = roster.getByRole("button", { name: /1996/ });
	const second = roster.getByRole("button", { name: /2002/ });
	await first.click();
	await second.click();
	await voucher.getByRole("button", { name: "총액 분할", exact: true }).click();
	await voucher.getByLabel("총액으로 나누기", { exact: true }).fill("10001");
	await voucher
		.getByRole("button", { name: "100원 올림", exact: true })
		.click();
	await expect(voucher.getByText("10,200원", { exact: true })).toBeVisible();
	await first.click();
	await expect(
		voucher.getByText("10,100원", { exact: true }).last(),
	).toBeVisible();
	await first.click();
	await expect(voucher.getByText("10,200원", { exact: true })).toBeVisible();
	await voucher.getByLabel("대상 회원 검색").fill("2002");
	await expect(first).toHaveCount(0);
	await expect(second).toHaveAttribute("aria-pressed", "true");
	await voucher.getByLabel("대상 회원 검색").fill("");
	for (const [width, height] of [
		[390, 844],
		[1440, 1000],
	]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(dark) => document.documentElement.classList.toggle("dark", dark),
				theme === "dark",
			);
			await designEvidence(page, `manual-layout-${width}-${theme}`);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
		}
	}
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(0);
	await voucher
		.getByRole("button", { name: "2명에게 발행", exact: true })
		.click();
	await expect(page.getByRole("status")).toContainText("부과를 발행했습니다");
	expect(calls.filter((c) => c.name === "dues_preview")).toHaveLength(0);
	const issued = await db.query<{
		member_id: string;
		amount: number;
		due_ym: string;
	}>(
		"select c.member_id,c.amount,d.due_ym from dues_charges c join dues_groups g on g.id=c.group_id join dues_due d on d.charge_id=c.id where g.label='9월 회식 분할' order by c.member_id",
	);
	expect(issued.rows).toEqual([
		{ member_id: A, amount: 5100, due_ym: "2026-09" },
		{ member_id: B, amount: 5100, due_ym: "2026-09" },
	]);
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(1);
});

test("receipt options retain access to another balance split from the same deposit", async ({
	page,
}) => {
	await db.exec(
		"insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',6000,'2026-09-06','김지훈')",
	);
	const position = await scalar<string>(
		"select id from dues_positions where bank_tx_id=90",
	);
	const group = await scalar<string>(
		"select id from dues_groups where source_key='manual:meal:1'",
	);
	await command({
		action: "position",
		position_id: position,
		amount: 1000,
		purpose: "club",
		group_id: group,
	});
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 90", exact: true });
	await expect(
		card.getByText("정산할 잔액 5,000원", { exact: true }),
	).toBeVisible();
	await card
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /000002/ })
		.click();
	await card.getByRole("button", { name: "납부자 변경" }).click();
	await expect(
		card.getByRole("group", { name: "납부자 검색 결과" }),
	).toBeVisible();
	await card.getByRole("button", { name: "정산 옵션" }).click();
	await card
		.getByRole("group", { name: "이 입금의 다른 잔액" })
		.getByRole("button", { name: /1,000원/ })
		.click();
	await expect(
		card.getByRole("button", { name: "직접 수입", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(card.getByLabel("변경할 금액")).toHaveValue("1000");
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(0);
	await card.getByRole("button", { name: "용도 지정 닫기", exact: true }).click();
	await expect(card.getByRole("button", { name: "정산 옵션" })).toBeVisible();
});

test("manual issue keeps its draft across views and retries a lost response without duplicate charges", async ({
	page,
}) => {
	await navigate(page, "/dues/2026-09/charge");
	const voucher = page.getByRole("region", { name: "부과 발행", exact: true });
	await voucher
		.getByLabel("부과 이름", { exact: true })
		.fill("응답 유실 검증 부과");
	await voucher
		.getByRole("group", { name: "부과 대상 명단" })
		.getByRole("button", { name: /000002/ })
		.click();
	await voucher.getByRole("button", { name: "인당 직접", exact: true }).click();
	await voucher.getByLabel("인당 금액", { exact: true }).fill("3500");
	await page.getByRole("button", { name: "현황", exact: true }).click();
	await page.getByRole("button", { name: "부과", exact: true }).click();
	await expect(voucher.getByLabel("부과 이름", { exact: true })).toHaveValue(
		"응답 유실 검증 부과",
	);
	await expect(voucher.getByLabel("인당 금액", { exact: true })).toHaveValue(
		"3500",
	);
	await page
		.getByRole("button", { name: "발행 내역·회비·대관 부과", exact: true })
		.click();
	await page.getByRole("button", { name: "새 수동 부과", exact: true }).click();
	await expect(voucher.getByLabel("인당 금액", { exact: true })).toHaveValue(
		"3500",
	);
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(0);
	loseCommitResponse = true;
	await voucher
		.getByRole("button", { name: "1명에게 발행", exact: true })
		.click();
	await expect(
		voucher.getByRole("button", { name: "결과 다시 확인", exact: true }),
	).toBeEnabled();
	await expect(voucher.getByLabel("인당 금액", { exact: true })).toBeDisabled();
	const referenceActions = page
		.getByLabel("참고 회차", { exact: true })
		.getByRole("button");
	await expect(referenceActions.first()).toBeDisabled();
	for (const action of await referenceActions.all())
		await expect(action).toBeDisabled();
	await expect(
		page.getByRole("button", { name: "정산함", exact: true }),
	).toBeDisabled();
	await voucher
		.getByRole("button", { name: "결과 다시 확인", exact: true })
		.click();
	await expect(page.getByRole("status")).toContainText("부과를 발행했습니다");
	const commits = calls.filter((c) => c.name === "dues_command");
	expect(commits).toHaveLength(2);
	expect(commits[0].args).toEqual(commits[1].args);
	expect(calls.filter((c) => c.name === "dues_preview")).toHaveLength(0);
	expect(
		await scalar(
			"select count(*)::int from dues_charges c join dues_groups g on g.id=c.group_id where g.label='응답 유실 검증 부과' and c.member_id=$1 and c.amount=3500",
			[B],
		),
	).toBe(1);
});

test("the charge design keeps a full roster and its totals together on mobile and desktop", async ({
	page,
}) => {
	const names = [
		"김도현",
		"박서연",
		"이준호",
		"최민아",
		"정하늘",
		"윤재호",
		"서지민",
		"한도윤",
		"배수아",
		"신유진",
		"손예찬",
		"오지훈",
		"임세라",
		"고우석",
		"류지아",
	];
	for (const [i, name] of names.entries()) {
		await db.query(
			"insert into members(id,name,birth_year,gender) values($1,$2,$3,$4)",
			[
				`10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
				name,
				1988 + i,
				i % 2 ? "F" : "M",
			],
		);
	}
	await navigate(page, "/dues/2026-09/charge");
	const voucher = page.getByRole("region", { name: "부과 발행", exact: true });
	await voucher
		.getByLabel("부과 이름", { exact: true })
		.fill("9월 회식 (삼거리곱창)");
	await voucher.getByLabel("발생일", { exact: true }).fill("2026-09-12");
	const people = voucher
		.getByRole("group", { name: "부과 대상 명단" })
		.getByRole("button");
	const count = await people.count();
	expect(count).toBe(18);
	for (let i = 0; i < count; i++) await people.nth(i).click();
	await people.nth(count - 1).click();
	await people.nth(count - 2).click();
	await voucher.getByLabel("총액으로 나누기", { exact: true }).fill("224000");
	await expect(
		voucher.getByText("16명 부과 합계", { exact: true }),
	).toBeVisible();
	await expect(voucher.getByText("14,000원", { exact: true })).toBeVisible();
	await expect(
		voucher.getByRole("button", { name: "16명에게 발행", exact: true }),
	).toBeEnabled();
	for (const [width, height] of [
		[375, 812],
		[390, 844],
		[768, 1024],
		[1440, 1000],
	]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.evaluate((dark) => {
				document.documentElement.classList.toggle("dark", dark);
				(document.activeElement as HTMLElement | null)?.blur();
			}, theme === "dark");
			await designEvidence(page, `charge-roster-${width}-${theme}`);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			const cardBox = (await voucher.boundingBox())!;
			const confirmBox = (await voucher
				.getByRole("button", { name: "16명에게 발행", exact: true })
				.boundingBox())!;
			expect(Math.abs(cardBox.width - confirmBox.width - 26)).toBeLessThan(2);
			await expect(voucher.getByRole("dialog")).toHaveCount(0);
		}
	}
	expect(
		calls.filter((c) =>
			["dues_command", "dues_preview"].includes(c.name),
		),
	).toHaveLength(0);
});

test("custom manual issue creates its own group and leaves existing same-name groups unchanged", async ({
	page,
}) => {
	await db.exec(`
		update members set birth_year=1996 where id='${A}';
		update members set birth_year=2002 where id='${B}';
		update dues_groups set label='정모 회식비' where source_key='manual:meal:1';
	`);
	const groupsBefore = await db.query("select * from dues_groups order by id");
	const chargesBefore = await db.query("select * from dues_charges order by id");
	const allocationsBefore = await db.query("select * from dues_allocations order by id");
	await navigate(page, "/dues/2026-09/charge");
	const voucher = page.getByRole("region", { name: "부과 발행", exact: true });
	await expect(voucher.getByRole("group", { name: "회계 묶음", exact: true })).toHaveCount(0);
	await expect(voucher.getByLabel("부과할 묶음 검색")).toHaveCount(0);
	await expect(voucher.getByRole("button", { name: "+ 새 묶음", exact: true })).toHaveCount(0);
	await voucher.getByLabel("부과 이름", { exact: true }).fill("정모 회식비");
	await voucher.getByLabel("발생일", { exact: true }).fill("2026-09-08");
	await voucher.getByRole("button", { name: "인당 직접", exact: true }).click();
	await voucher.getByLabel("인당 금액", { exact: true }).fill("3500");
	await voucher.getByRole("group", { name: "부과 대상 명단" }).getByRole("button", { name: /2002/ }).click();
	for (const [width, height] of [[390, 844], [1440, 1000]]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
			await designEvidence(page, `custom-charge-${width}-${theme}`);
		}
	}
	expect(calls.filter((c) => c.name === "dues_read")).toHaveLength(1);
	expect(calls.filter((c) => ["dues_command", "dues_preview"].includes(c.name))).toHaveLength(0);
	await voucher.getByRole("button", { name: "1명에게 발행" }).click();
	await expect(page.getByRole("status")).toContainText("부과를 발행했습니다");
	const commits = calls.filter((c) => c.name === "dues_command");
	expect(commits).toHaveLength(1);
	expect(commits[0].args.p_payload).not.toHaveProperty("group_id");
	expect(commits[0].args.p_payload).toMatchObject({
		label: "정모 회식비", date: "2026-09-08",
		lines: [{ member_id: B, amount: 3500, due_ym: "2026-09" }],
	});
	const afterGroups = (await db.query("select * from dues_groups order by id")).rows;
	expect(afterGroups).toHaveLength(groupsBefore.rows.length + 1);
	expect(afterGroups.filter((g) => groupsBefore.rows.some((old) => old.id === g.id))).toEqual(groupsBefore.rows);
	expect((await db.query("select * from dues_allocations order by id")).rows).toEqual(allocationsBefore.rows);
	const after = (await db.query("select * from dues_charges order by id")).rows;
	expect(after).toHaveLength(chargesBefore.rows.length + 1);
	expect(after.filter((c) => chargesBefore.rows.some((old) => old.id === c.id))).toEqual(chargesBefore.rows);
});

test("charge roster presets replace the draft automatically and load older months on demand", async ({
	page,
}) => {
	await db.exec(`
		update sessions set status='closed';
		insert into places values(8,'에이트민턴',false);
		insert into sessions(id,title,status,scheduled_at,ends_at,place_id) values
		(20,'정기 모임','closed','2026-09-06T19:00:00+09','2026-09-06T22:00:00+09',8),
		(21,'월초 모임','closed','2026-09-01T00:00:00+09',null,8),
		(22,'명단 없는 모임','closed','2026-09-07T19:00:00+09',null,8),
		(30,'월말 모임','closed','2026-08-31T23:59:59+09',null,8),
		(40,'6월 정모','closed','2026-06-20T19:00:00+09',null,8),
		(50,'취소된 모임','cancelled','2026-05-20T19:00:00+09',null,8);
		update sessions set is_regular=true,meal_enabled=true where id in (20,21,22,30,40);
	`);
	await db.query(
		"insert into attendances(session_id,member_id,status,meal_joining) values(20,$1,'confirmed',false),(20,$2,'confirmed',true),(21,$1,'confirmed',true),(30,$1,'confirmed',true),(40,$2,'confirmed',true)",
		[A, B],
	);
	await navigate(page, "/dues/2026-09/charge");
	const voucher = page.getByRole("region", { name: "부과 발행", exact: true });
	const preset = voucher.getByRole("group", { name: "지난 명단 프리셋" });
	const source = preset.getByRole("list", { name: "참고 회차", exact: true });
	await expect(source).toBeVisible();
	await expect(preset.getByRole("combobox")).toHaveCount(0);
	await expect(source.locator("button[value='21']")).toHaveCount(1);
	await expect(source.locator("button[value='30']")).toHaveCount(0);
	expect(calls.filter((c) => c.name === "dues_sessions")).toHaveLength(0);
	expect(calls.filter((c) => c.name === "reference_sessions")).toHaveLength(2);
	const range = calls.find(
		(c) => c.name === "reference_sessions" && c.args.start,
	)!.args;
	expect(new Date(String(range.start)).toISOString()).toBe(
		"2026-08-31T15:00:00.000Z",
	);
	expect(new Date(String(range.end)).toISOString()).toBe(
		"2026-09-30T15:00:00.000Z",
	);
	await voucher.getByLabel("부과 이름", { exact: true }).fill("9월 회식");
	await voucher.getByLabel("발생일", { exact: true }).fill("2026-09-12");
	await voucher.getByLabel("총액으로 나누기", { exact: true }).fill("10001");
	await source.locator("button[value='20']").focus();
	await page.keyboard.press("Enter");
	await expect(
		voucher.getByText("2명 부과 합계", { exact: true }),
	).toBeVisible();
	await expect(voucher.getByText("12,000원", { exact: true })).toBeVisible();
	await preset.getByLabel("회식 참여자만", { exact: true }).check();
	const roster = voucher.getByRole("group", { name: "부과 대상 명단" });
	await expect(roster.getByRole("button", { name: /000001/ })).toHaveAttribute(
		"aria-pressed",
		"false",
	);
	await expect(roster.getByRole("button", { name: /000002/ })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(
		voucher.getByText("11,000원", { exact: true }).last(),
	).toBeVisible();
	await expect(voucher.getByLabel("부과 이름", { exact: true })).toHaveValue(
		"9월 회식",
	);
	await expect(voucher.getByLabel("발생일", { exact: true })).toHaveValue(
		"2026-09-12",
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await designEvidence(page, "charge-preset-more-mobile-light");
	await source
		.getByRole("button", { name: "더 보기 · 2026년 8월", exact: true })
		.click();
	await expect(source.locator("button[value='30']")).toHaveCount(1);
	await expect(source.locator("button[value='20']")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(source.locator("button[value='40']")).toHaveCount(0);
	await expect(
		preset.getByRole("button", { name: "더 보기 · 2026년 6월", exact: true }),
	).toBeVisible();
	await source.locator("button[value='30']").click();
	await expect(roster.getByRole("button", { name: /000001/ })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(roster.getByRole("button", { name: /000002/ })).toHaveAttribute(
		"aria-pressed",
		"false",
	);
	await source.locator("button[value='20']").click();
	await expect(source.locator("button[value='20']")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	expect(
		calls.filter(
			(c) =>
				c.name === "dues_reference_members" &&
				c.args.p_session_id === 20 &&
				c.args.p_meal === true,
		),
	).toHaveLength(1);
	await source
		.getByRole("button", { name: "더 보기 · 2026년 6월", exact: true })
		.click();
	await expect(source.locator("button[value='40']")).toHaveCount(1);
	await expect(preset.getByRole("button", { name: /더 보기/ })).toHaveCount(0);
	// The month list scrolls within its boundary and stays usable from the keyboard.
	await source.focus();
	await page.keyboard.press("End");
	await expect.poll(() => source.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
	await expect(source.locator("button[value='40']")).toBeInViewport();
	await source.locator("button[value='40']").focus();
	await page.keyboard.press("Enter");
	await expect(source.locator("button[value='40']")).toHaveAttribute("aria-pressed", "true");

	for (const [width, height] of [
		[390, 844],
		[1440, 1000],
	]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(dark) => document.documentElement.classList.toggle("dark", dark),
				theme === "dark",
			);
			await designEvidence(page, `charge-preset-${width}-${theme}`);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
		}
	}
	await source.locator("button[value='22']").click();
	await expect(preset.getByRole("status")).toContainText("대상");
	await expect(
		voucher.getByRole("button", { name: "0명에게 발행", exact: true }),
	).toBeDisabled();
	await source.locator("button[value='40']").click();
	await expect(source.locator("button[value='40']")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(0);
	await voucher
		.getByRole("button", { name: "1명에게 발행", exact: true })
		.click();
	await expect(page.getByRole("status")).toContainText("부과를 발행했습니다");
	expect(
		await scalar(
			"select basis->>'reference_session_id' from dues_charges where legacy_id is null",
		),
	).toBe("40");
	expect(
		await scalar(
			"select count(*)::int from dues_charges where legacy_id is null and member_id=$1 and amount=11000",
			[B],
		),
	).toBe(1);
});

test("charge preset fetch failures preserve the draft and allow retry without premature issue", async ({
	page,
}) => {
	await db.exec(
		"insert into sessions(id,title,status,scheduled_at) values(20,'9월 모임','closed','2026-09-06T19:00:00+09')",
	);
	await db.query(
		"insert into attendances(session_id,member_id,status,meal_joining) values(20,$1,'confirmed',true)",
		[B],
	);
	await navigate(page, "/dues/2026-09/charge");
	const voucher = page.getByRole("region", { name: "부과 발행", exact: true });
	const preset = voucher.getByRole("group", { name: "지난 명단 프리셋" });
	const source = preset.getByRole("list", { name: "참고 회차", exact: true });
	await expect(source).toBeVisible();
	await expect(preset.getByRole("combobox")).toHaveCount(0);
	await voucher.getByLabel("부과 이름", { exact: true }).fill("입력 보존");
	await voucher.getByLabel("총액으로 나누기", { exact: true }).fill("5000");
	const a = voucher
		.getByRole("group", { name: "부과 대상 명단" })
		.getByRole("button", { name: /000001/ });
	await a.click();
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(
		"**/rpc/dues_reference_members",
		async (route) => {
			await wait;
			await route.fulfill({ status: 503, json: { message: "연결 실패" } });
		},
		{ times: 1 },
	);
	await source.locator("button[value='20']").click();
	await expect(
		voucher.getByRole("button", { name: "1명에게 발행", exact: true }),
	).toBeDisabled();
	await expect(preset.getByRole("status")).toContainText("불러오는 중");
	release();
	await expect(preset.getByRole("alert")).toContainText(
		"명단을 불러오지 못했습니다",
	);
	await expect(source.locator("button[aria-pressed='true']")).toHaveCount(0);
	await expect(a).toHaveAttribute("aria-pressed", "true");
	await source.locator("button[value='20']").click();
	await expect(source.locator("button[value='20']")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(a).toHaveAttribute("aria-pressed", "false");
	await expect(
		preset.getByLabel("회식 참여자만", { exact: true }),
	).toBeDisabled();
	await expect(
		preset.getByText("이 회차는 회식 참석을 기록하지 않았습니다."),
	).toBeVisible();

	await preset
		.getByRole("button", { name: "회원 직접 선택", exact: true })
		.click();
	await expect(
		voucher
			.getByRole("group", { name: "부과 대상 명단" })
			.getByRole("button", { name: /000002/ }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(
		voucher.getByLabel("총액으로 나누기", { exact: true }),
	).toHaveValue("5000");
	let failMonth = true;
	await page.route("**/rest/v1/sessions?**", async (route) => {
		const range = new URL(route.request().url()).searchParams.getAll(
			"scheduled_at",
		);
		if (failMonth && range.some((value) => value.startsWith("gte."))) {
			failMonth = false;
			return route.fulfill({
				status: 403,
				json: { message: "월 조회 실패" },
			});
		}
		return route.fallback();
	});
	await source
		.getByRole("button", { name: "더 보기 · 2026년 8월", exact: true })
		.click();
	await expect(preset.getByRole("alert")).toContainText(
		"회차를 불러오지 못했습니다",
	);
	await expect(source.locator("button[value='20']")).toHaveCount(1);
	await source
		.getByRole("button", { name: "더 보기 · 2026년 8월", exact: true })
		.click();
	await expect(source.locator("button[value='1']")).toHaveCount(1);
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(0);
});

test("overview detail keeps its close button visible while a long roster scrolls", async ({
	page,
}) => {
	const members = Array.from(
		{ length: 45 },
		(_, index) =>
			`20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
	);
	for (const [index, id] of members.entries())
		await db.query("insert into members(id,name,birth_year) values($1,$2,$3)", [
			id,
			`검증회원 ${index + 1}`,
			1990 + (index % 10),
		]);
	await command({
		action: "issue",
		kind: "manual",
		label: "전체 모임",
		date: "2026-09-01",
		ym: "2026-09",
		lines: members.map((member_id) => ({
			member_id,
			amount: 5000,
			due_ym: "2026-09",
		})),
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-09/home");
	const trigger = page.getByRole("button", {
		name: "전체 모임 부과 현황 자세히 보기",
		exact: true,
	});
	await trigger.click();
	const modal = page.getByRole("dialog", { name: "전체 모임 부과 명단" });
	await expect(modal).toContainText("부과 45명");
	expect(
		await modal
			.locator(".ac-detail-body")
			.evaluate((body) => body.scrollHeight > body.clientHeight),
	).toBe(true);
	await modal.locator(".ac-detail-body").evaluate((body) => {
		body.scrollTop = body.scrollHeight;
	});
	await expect(modal.getByRole("button", { name: "닫기" })).toBeInViewport();
	await expect(
		modal.locator(".ac-overview-roster .ac-row").last(),
	).toBeInViewport();
	await page.keyboard.press("Shift+Tab");
	await expect(modal.getByRole("region", { name: "상세 명단" })).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await expect(modal.getByRole("button", { name: "닫기" })).toBeFocused();
	for (const [width, height] of [[390, 844], [1280, 900]]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
			await modal.locator(".ac-detail-body").evaluate((body) => { body.scrollTop = 0; });
			await designEvidence(page, `detail-scroll-${width}-${theme}`);
			const fits = await modal.locator(".ac-detail-body").evaluate((body) => {
				const rect = body.getBoundingClientRect();
				return [...body.querySelectorAll(".ac-row")].every((row) =>
					row.getBoundingClientRect().right <= rect.left + body.clientWidth - 8);
			});
			expect(fits).toBe(true);
		}
	}
	await page.mouse.click(4, 4);
	await expect(modal).toHaveCount(0);
	await expect(trigger).toBeFocused();
});

test("ledger detail uses the inbox receipt and retains partial-payment reversal under options", async ({
	page,
}) => {
	const member = "00000000-0000-4000-8000-000000000008";
	await db.exec(`insert into members(id,name,birth_year) values('${member}','박민준',1995);
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name,balance_after) values(90,'in',6500,'2026-09-07T12:00:00+09','박민준0906',6500);`);
	await command({
		action: "issue",
		kind: "manual",
		label: "9. 6. 에이트민턴 · 15:00–18:00",
		date: "2026-09-06",
		lines: [{ member_id: member, amount: 6000, due_ym: "2026-09" }],
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 90", exact: true });
	await expect(card.locator(".ac-receipt-form")).toBeVisible();
	const styles = async () =>
		card.evaluate((el) =>
			[
				".ac-receipt-payer strong",
				".ac-receipt-change",
				".ac-receipt-amount",
				".ac-receipt-dues .ac-chip",
				".ac-inline-confirm",
			].map((selector) => {
				const item = el.querySelector(selector)!;
				const style = getComputedStyle(item);
				return {
					selector,
					font: style.fontSize,
					gap: style.gap,
					padding: style.padding,
					minHeight: style.minHeight,
				};
			}),
		);
	const inboxStyles = await styles();
	await page.getByRole("button", { name: "회계", exact: true }).click();
	await page.getByRole("button", { name: "거래 90 상세", exact: true }).click();
	await expect(card.locator(".ac-receipt-form")).toBeVisible();
	expect(await styles()).toEqual(inboxStyles);
	await expect(card.locator(".ac-transaction-heading")).toHaveCount(0);
	await expect(card.getByRole("spinbutton")).toHaveCount(0);
	await expect(
		card.getByRole("button", { name: "납부 연결", exact: true }),
	).toHaveCount(0);
	await expect(
		card.getByRole("button", { name: "취소", exact: true }),
	).toHaveCount(0);
	await card.getByRole("button", { name: /^9\. 6\. 에이트민턴/ }).click();
	await expect(
		card.getByRole("button", { name: "납부 확인", exact: true }),
	).toHaveText("확인");
	for (const [width, height] of [
		[390, 844],
		[1440, 1000],
	]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(dark) => document.documentElement.classList.toggle("dark", dark),
				theme === "dark",
			);
			await designEvidence(page, `shared-ledger-receipt-${width}-${theme}`);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
		}
	}
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(0);
	await card.getByRole("button", { name: "납부 확인", exact: true }).click();
	await expect(
		card.getByText("정산할 잔액 500원", { exact: true }),
	).toBeVisible();
	const commit = calls.find((c) => c.name === "dues_command")!;
	expect(commit.args.p_payload).toMatchObject({
		reason: "회계 · 박민준0906 · 납부 확인",
	});
	await card.getByRole("button", { name: "정산 옵션" }).click();
	const history = card.getByRole("group", { name: "이 입금의 처리 내역" });
	await expect(history).toContainText("6,000원");
	await expect(
		card.getByText("다른 사람의 부과에 대납", { exact: true }),
	).toHaveCount(0);
	await history.getByRole("button", { name: "연결 해제", exact: true }).click();
	await card
		.getByRole("button", { name: "납부 연결 해제 확인", exact: true })
		.click();
	await expect
		.poll(() =>
			scalar(
				"select sum(amount)::int from dues_positions where bank_tx_id=90",
			),
		)
		.toBe(6500);
	expect(
		await scalar(
			"select sum(amount-reversed)::int from dues_allocations where bank_tx_id=90",
		),
	).toBe(0);
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(2);
	expect(calls.filter((c) => c.name === "dues_preview")).toHaveLength(0);
});

test("partial settlement keeps its remainder in inbox but another member needs a separate charge target", async ({
	page,
}) => {
	await db.exec(`update members set name='박민준' where id='${A}'; update members set name='이서연' where id='${B}';
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',12000,'2026-09-07T12:00:00+09','박민준0906');`);
	const issued = (await command({
		action: "issue",
		kind: "manual",
		label: "9월 모임",
		date: "2026-09-06",
		lines: [A, B].map((member_id) => ({
			member_id,
			amount: 6000,
			due_ym: "2026-09",
		})),
	})) as { group_id: string };
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 90", exact: true });
	await card.getByRole("button", { name: "정산 옵션" }).click();
	await expect(
		card.getByText("다른 사람의 부과에 대납", { exact: true }),
	).toHaveCount(0);
	await expect(
		card.getByRole("group", { name: "낼 사람 검색 결과" }),
	).toHaveCount(0);
	await card.getByRole("button", { name: "정산 옵션" }).click();
	await card.getByRole("button", { name: /^9월 모임 ·/ }).click();
	await card.getByRole("button", { name: "납부 확인", exact: true }).click();
	await expect(
		card.getByText("정산할 잔액 6,000원", { exact: true }),
	).toBeVisible();
	await expect(card.getByRole("button", { name: "납부자 변경" })).toHaveCount(
		0,
	);
	await expect(card.getByRole("button", { name: /^9월 모임 ·/ })).toHaveCount(
		0,
	);
	const position = await scalar<string>(
		"select id from dues_positions where bank_tx_id=90 and amount>0",
	);
	const due = await scalar<string>(
		"select d.id from dues_due d join dues_charges c on c.id=d.charge_id where c.group_id=$1 and c.member_id=$2",
		[issued.group_id, B],
	);
	const lines = [{ position_id: position, due_id: due, amount: 6000 }];
	await expect(
		command({
			action: "pay",
			owner_id: B,
			confirm_owner: true,
			reassign_owner: true,
			lines,
		}),
	).rejects.toThrow("납부·환불·이월 처리 전의 입금만");
	await expect(command({ action: "pay", owner_id: A, lines })).rejects.toThrow(
		"소유자",
	);
	expect(
		await scalar(
			"select sum(amount)::int from dues_positions where bank_tx_id=90",
		),
	).toBe(6000);
	// Feasibility check on the synthetic DB only: preserve A as sender while paying B's charge.
	await command({ action: "pay", owner_id: A, proxy: true, lines });
	expect(
		await scalar(
			"select sum(amount)::int from dues_positions where bank_tx_id=90",
		),
	).toBe(0);
	expect(
		await scalar(
			"select count(*)::int from dues_allocations where bank_tx_id=90 and owner_id=$1",
			[A],
		),
	).toBe(2);
	expect(
		await scalar("select remaining from dues_due where id=$1", [due]),
	).toBe(0);
	// The removed UI never submits the proxy command used by this feasibility probe.
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(1);
});

test("upcoming court prepayment shares the receipt, keeps namesakes and same-day sessions distinct, and retries without duplicates", async ({
	page,
}) => {
	await db.exec(`
		update members set birth_year=1996 where id='${A}'; update members set birth_year=2002 where id='${B}';
		insert into places values(10,'에이트민턴',true);
		insert into sessions(id,title,status,scheduled_at,ends_at,place_id) values
		(10,'오전','open','2026-09-13T09:00:00+09','2026-09-13T12:00:00+09',10),
		(11,'오후','open','2026-09-13T15:00:00+09','2026-09-13T18:00:00+09',10);
		insert into attendances(session_id,member_id,status) values(10,'${A}','confirmed'),(11,'${A}','confirmed'),(10,'${B}','waitlisted');
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',8000,'2026-09-10T12:00:00+09','김지훈0913');
		select dues_sync_bank();
	`);
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 90", exact: true });
	await card
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /2002년생/ })
		.click();
	await expect(card.getByRole("button", { name: /선납/ })).toHaveCount(0);
	await card.getByRole("button", { name: "납부자 변경", exact: true }).click();
	await card
		.getByRole("group", { name: "납부자 검색 결과" })
		.getByRole("button", { name: /1996년생/ })
		.click();
	const targets = card.getByRole("group", { name: "납부할 항목 선택" });
	const morning = targets.getByRole("button", { name: /09:00–12:00.*선납/ });
	await expect(morning).toBeVisible();
	await expect(
		targets.getByRole("button", { name: /15:00–18:00.*선납/ }),
	).toBeVisible();
	await morning.click();
	await expect(card).toContainText("입금 잔액 2,000원 보관");
	for (const [width, height] of [
		[390, 844],
		[1280, 900],
	]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(dark) => document.documentElement.classList.toggle("dark", dark),
				theme === "dark",
			);
			await designEvidence(page, `court-prepayment-${width}-${theme}`);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
		}
	}
	expect(calls.filter((c) => c.name === "dues_read")).toHaveLength(1);
	expect(
		calls.filter((c) =>
			[
				"dues_command",
				"dues_preview",
				"dues_candidates",
				"dues_sessions",
			].includes(c.name),
		),
	).toHaveLength(0);
	loseCommitResponse = true;
	await card.getByRole("button", { name: /^납부 확인/ }).click();
	await expect(
		card.getByRole("button", { name: "결과 다시 확인", exact: true }),
	).toBeEnabled();
	await card
		.getByRole("button", { name: "결과 다시 확인", exact: true })
		.click();
	expect(
		await scalar(
			"select count(*)::int from dues_charges c join dues_groups g on g.id=c.group_id where g.session_id=10 and c.member_id=$1",
			[A],
		),
	).toBe(1);
	expect(
		await scalar(
			"select sum(amount)::int from dues_positions where bank_tx_id=90",
		),
	).toBe(2000);
	const commits = calls.filter((c) => c.name === "dues_command");
	expect(commits).toHaveLength(2);
	expect(commits[0].args).toEqual(commits[1].args);
	await expect(card).toBeVisible();
	await expect(
		card.getByRole("button", { name: /09:00–12:00.*선납/ }),
	).toHaveCount(0);
	await expect(
		card.getByRole("button", { name: /15:00–18:00.*선납/ }),
	).toBeVisible();
});

test("a stale upcoming court fee refreshes before an explicit new confirmation", async ({
	page,
}) => {
	await db.exec(`update members set name='이민수' where id='${A}';
		insert into places values(10,'에이트민턴',true);
		insert into sessions(id,title,status,scheduled_at,ends_at,place_id) values(10,'예정','open','2026-10-04T09:00:00+09','2026-10-04T12:00:00+09',10);
		insert into attendances(session_id,member_id,status) values(10,'${A}','confirmed');
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',8000,'2026-09-10T12:00:00+09','이민수'); select dues_sync_bank();`);
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 90", exact: true });
	await card.getByRole("button", { name: /2026-10-04.*선납/ }).click();
	await db.exec("update dues_settings set court_fee_default=7000");
	await card.getByRole("button", { name: /^납부 확인/ }).click();
	await expect(card.getByText(/바뀐 내역을 확인한 뒤 다시 확인/)).toBeVisible();
	expect(
		await scalar(
			"select count(*)::int from dues_groups where session_id=10",
		),
	).toBe(0);
	// The receipt retains the chosen partial amount, but shows the updated full fee.
	await card.getByRole("button", { name: /2026-10-04.*선납/ }).click();
	await card.getByRole("button", { name: /2026-10-04.*선납.*7,000/ }).click();
	await card.getByRole("button", { name: /^납부 확인/ }).click();
	expect(
		await scalar(
			"select sum(amount)::int from dues_allocations where bank_tx_id=90",
		),
	).toBe(7000);
	expect(
		await scalar(
			"select to_char(occurred_at at time zone 'Asia/Seoul','YYYY-MM') from bank_transactions where id=90",
		),
	).toBe("2026-09");
});

test("receipt editors keep the compact card and preserve payment choices when closed", async ({
	page,
}) => {
	await db.exec(`update members set name='박현아' where id='${A}';
		update members set name='이서연' where id='${B}';
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',5000,'2026-09-09T11:24:00+09','9월회비박현아');`);
	await command({
		action: "issue",
		kind: "manual",
		label: "9월 모임",
		date: "2026-09-13",
		lines: [{ member_id: A, amount: 6000, due_ym: "2026-09" }],
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 90", exact: true });
	const options = card.getByRole("button", { name: "정산 옵션", exact: true });
	const payer = card.locator(".ac-receipt-payer");
	const payment = card
		.getByRole("group", { name: "납부할 항목 선택", exact: true })
		.getByRole("button", { name: /^9월 모임/ });
	await payment.click();
	const cardStyles = () =>
		card.evaluate((el) =>
			[
				".ac-receipt-heading",
				".ac-receipt-payer strong",
				".ac-receipt-amount",
				".ac-inline-confirm",
			].map((selector) => {
				const style = getComputedStyle(el.querySelector(selector)!);
				return {
					font: style.fontSize,
					padding: style.padding,
					minHeight: style.minHeight,
				};
			}),
		);
	const initialStyles = await cardStyles();
	await options.click();
	await card.getByLabel("9월 모임 선택 금액").fill("3000");
	await expect(payment).toHaveAttribute("aria-pressed", "true");
	expect(await cardStyles()).toEqual(initialStyles);
	await designEvidence(page, "receipt-options-390-dark");

	for (const [action, label] of [
		["carry", "이월"],
		["position", "용도 지정"],
	]) {
		await card.getByRole("button", { name: label, exact: true }).click();
		const editor = card.getByRole("group", {
			name: `${label} 설정`,
			exact: true,
		});
		await expect(editor).toBeVisible();
		await expect(card.locator(".ac-receipt-editor-heading")).toBeFocused();
		await expect(
			card.locator(".ac-segment, .ac-transaction-heading"),
		).toHaveCount(0);
		await expect(
			card.getByRole("button", { name: "납부 연결", exact: true }),
		).toHaveCount(0);
		await expect(
			card.getByRole("group", { name: "납부자 검색 결과" }),
		).toHaveCount(0);
		await expect(payer).toContainText("박현아");
		expect(await cardStyles()).toEqual(initialStyles);
		if (action === "carry") {
			await expect(
				editor.getByRole("button", { name: /^9월 모임/ }),
			).toHaveAttribute("aria-pressed", "false");
			await editor.getByLabel("이월할 월").fill("2099-01");
			await editor
				.getByRole("button", { name: "이 입금 · 5,000원", exact: true })
				.click();
			await editor.getByLabel("입금 90 이월 금액").fill("2000");
		} else {
			await editor
				.getByRole("button", { name: "환불 대기", exact: true })
				.click();
			await editor.getByLabel("변경할 금액").fill("1500");
		}
		await expect(
			card.getByRole("button", { name: `${label} 확인`, exact: true }),
		).toBeEnabled();
		for (const [width, height] of [
			[390, 844],
			[1440, 1000],
		]) {
			await page.setViewportSize({ width, height });
			for (const theme of ["light", "dark"]) {
				await page.evaluate(
					(dark) => document.documentElement.classList.toggle("dark", dark),
					theme === "dark",
				);
				await designEvidence(page, `receipt-${action}-${width}-${theme}`);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				).toBe(true);
				const box = (await card.boundingBox())!;
				const confirmBox = (await card
					.getByRole("button", { name: `${label} 확인`, exact: true })
					.boundingBox())!;
				expect(Math.abs(box.width - confirmBox.width - 28)).toBeLessThan(2);
			}
		}
		await editor
			.getByRole("button", { name: `${label} 닫기`, exact: true })
			.click();
		await expect(editor).toHaveCount(0);
		await expect(options).toBeFocused();
		await expect(payment).toHaveAttribute("aria-pressed", "true");
		await expect(payer).toContainText("박현아");
		await expect(card).toContainText("입금 잔액 2,000원 보관");
		await options.click();
		await expect(card.getByLabel("9월 모임 선택 금액")).toHaveValue("3000");
	}
	expect(calls.filter((call) => call.name === "dues_command")).toHaveLength(
		0,
	);
	await options.click();
	await card.getByRole("button", { name: "납부 확인", exact: true }).click();
	await expect
		.poll(() =>
			scalar(
				"select sum(amount-reversed)::int from dues_allocations where bank_tx_id=90",
			),
		)
		.toBe(3000);
	expect(calls.filter((call) => call.name === "dues_command")).toHaveLength(
		1,
	);
});

test("cash-only receipt carry shows one grouped amount without debt controls", async ({ page }) => {
	const member = "00000000-0000-4000-8000-000000000008";
	await db.exec(`insert into members(id,name,birth_year) values('${member}','박현아',1995);
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values(90,'in',5000,'2026-09-09T11:24:00+09','9월회비박현아');`);
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 90", exact: true });
	await card.getByRole("button", { name: "정산 옵션", exact: true }).click();
	await card.getByRole("button", { name: "이월", exact: true }).click();
	const editor = card.getByRole("group", { name: "이월 설정", exact: true });
	await expect(editor.getByRole("group", { name: "이월할 미납 선택" })).toHaveCount(0);
	await expect(editor.getByRole("checkbox")).toHaveCount(0);
	await expect(card.getByRole("button", { name: "이월 확인", exact: true })).toBeDisabled();
	await editor.getByRole("button", { name: "이 입금 · 5,000원", exact: true }).click();
	await expect(editor.getByLabel("입금 90 이월 금액")).toHaveValue("5000");
	await expect(editor.getByLabel("이월할 월")).toHaveValue("2026-10");
	await expect(card.getByRole("button", { name: "이월 확인", exact: true })).toBeEnabled();
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await designEvidence(page, "receipt-cash-only-390-dark");
	await card.getByRole("button", { name: "이월 확인", exact: true }).click();
	await expect(card).toHaveCount(0);
	expect(await scalar("select sum(amount)::int from dues_positions where bank_tx_id=90 and purpose='carry' and available_ym='2026-10'")).toBe(5000);
});

test("refund shares the receipt shell and restores the expense draft on close", async ({ page }) => {
	const member = "00000000-0000-4000-8000-000000000008";
	await db.exec(`insert into members(id,name,birth_year) values('${member}','성재경',1995);
		insert into bank_transactions(id,direction,amount,occurred_at,counterparty_name) values
		(90,'in',7000,'2026-09-09T11:24:00+09','성재경'),
		(91,'out',5000,'2026-09-10T12:00:00+09','성재경'); select dues_sync_bank();`);
	const position = await scalar<string>("select id from dues_positions where bank_tx_id=90");
	await command({ action: "position", position_id: position, amount: 7000, purpose: "member_pending", owner_id: member });
	await page.setViewportSize({ width: 390, height: 844 });
	await navigate(page, "/dues/2026-09/inbox");
	const card = page.getByRole("region", { name: "거래 91", exact: true });
	const options = card.getByRole("button", { name: "정산 옵션", exact: true });
	const style = () => card.evaluate((el) => [".ac-receipt-heading", ".ac-receipt-payer strong", ".ac-inline-confirm"].map((selector) => {
		const s = getComputedStyle(el.querySelector(selector)!); return { font: s.fontSize, padding: s.padding, height: s.minHeight };
	}));
	const expenseStyle = await style();
	await card.getByRole("group", { name: "회계 항목 선택" }).getByRole("button", { name: "회식", exact: true }).click();
	await options.click();
	await card.getByRole("button", { name: "환불 연결", exact: true }).click();
	const editor = card.getByRole("group", { name: "환불 연결 설정", exact: true });
	await expect(editor).toBeVisible();
	await expect(card.locator(".ac-receipt-heading")).toHaveCount(1);
	await expect(card.locator(".ac-refund-outgoing, .ac-transaction-heading, .ac-segment")).toHaveCount(0);
	await expect(card.getByRole("group", { name: "납부자 필터" })).toHaveCount(0);
	expect(await style()).toEqual(expenseStyle);
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await designEvidence(page, "receipt-refund-search-390-dark");
	await editor.getByRole("group", { name: "납부자 검색 결과" }).getByRole("button", { name: /성재경/ }).click();
	await editor.getByRole("radio", { name: /입금 #90 / }).check();
	await expect(card.getByRole("button", { name: "환불 확인", exact: true })).toBeEnabled();
	for (const [width, height] of [[390, 844], [1440, 1000]]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
			await designEvidence(page, `receipt-refund-${width}-${theme}`);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		}
	}
	await editor.getByRole("button", { name: "환불 연결 닫기", exact: true }).click();
	await expect(options).toBeFocused();
	await expect(card.getByRole("group", { name: "회계 항목 선택" }).getByRole("button", { name: "회식", exact: true })).toHaveAttribute("aria-pressed", "true");
	expect(calls.filter((c) => c.name === "dues_command")).toHaveLength(0);
	await options.click();
	await card.getByRole("button", { name: "환불 연결", exact: true }).click();
	await expect(editor.getByRole("radio", { name: /입금 #90 / })).toBeChecked();
	await card.getByRole("button", { name: "환불 확인", exact: true }).click();
	await expect(card).toHaveCount(0);
	expect(await scalar("select amount from dues_refunds where out_tx_id=91")).toBe(5000);
	expect(await scalar("select group_id from dues_expenses where bank_tx_id=91")).toBeNull();
	expect(calls.filter((c) => c.name === "dues_command").map((c) => (c.args.p_payload as { action: string }).action)).toEqual(["refund"]);
});
