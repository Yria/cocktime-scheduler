import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function mockBackend(page: Page, options: { active?: boolean; failEnd?: boolean } = {}) {
	let active = options.active ?? true;
	const writes: string[] = [];
	await page.routeWebSocket((url) => !["localhost", "127.0.0.1"].includes(url.hostname), (socket) => socket.close());
	await page.route("**/*", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
		if (url.pathname === "/rest/v1/sessions") {
			if (request.method() === "PATCH") {
				writes.push(url.pathname);
				expect(request.postDataJSON()).toMatchObject({ is_active: false, status: "closed" });
				if (options.failEnd) return json({ message: "permission denied", code: "42501" }, 403);
				active = false;
				return json({ id: 7 });
			}
			if (url.searchParams.get("is_active") === "eq.true") return json(active ? { id: 7, is_active: true, status: "active" } : null);
			return json([]);
		}
		if (url.pathname === "/rest/v1/rpc/wait_points_my_status") return json({ balance: 0, max: 7, cost: 7, has_ticket: false });
		if (url.pathname.startsWith("/rest/v1/")) return json([]);
		if (["localhost", "127.0.0.1"].includes(url.hostname)) return route.continue();
		return route.abort();
	});
	return { writes };
}

test("일반 회원에게 즉석 세션 생성 버튼과 설정 화면을 노출하지 않는다", async ({ page }) => {
	const backend = await mockBackend(page);
	await page.goto("/e2e/session-lifecycle.html?role=member");
	await expect(page.getByRole("heading", { name: "일정", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "즉석 세션 시작", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "진행 중 세션 입장", exact: true })).toBeVisible();
	await page.goto("/e2e/session-lifecycle.html?role=member&path=/setup");
	await expect(page.getByRole("heading", { name: "일정", exact: true })).toBeVisible();
	await expect(page.getByText("세션 설정", { exact: true })).toHaveCount(0);
	expect(backend.writes).toEqual([]);
});

test("권한 조회 중에는 설정 화면을 숨기고 운영진 확인 후 보여준다", async ({ page }) => {
	await mockBackend(page);
	await page.goto("/e2e/session-lifecycle.html?pending=true&path=/setup");
	await expect(page.getByText("세션 설정", { exact: true })).toHaveCount(0);
	await page.evaluate(() => {
		(window as unknown as { sessionLifecycleTest: { auth: { setState: (state: { memberLoaded: boolean }) => void } } }).sessionLifecycleTest.auth.setState({ memberLoaded: true });
	});
	await expect(page.getByText("세션 설정", { exact: true })).toBeVisible();
});

for (const width of [390, 1280]) {
	test(`세션 종료 후 로비에서 입장 버튼이 사라진다 (${width}px)`, async ({ page }) => {
		const backend = await mockBackend(page);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.setViewportSize({ width, height: 844 });
		await page.goto("/e2e/session-lifecycle.html?path=/session");
		await page.getByRole("button", { name: "세션 종료", exact: true }).click();
		await page.getByRole("button", { name: "종료", exact: true }).click();
		await expect(page.getByRole("heading", { name: "일정", exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "진행 중 세션 입장", exact: true })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "즉석 세션 시작", exact: true })).toBeVisible();
		expect(backend.writes).toEqual(["/rest/v1/sessions"]);
		// Rendered visual checks: no clipped viewport, broken images, or unnamed controls.
		const visualIssues = await page.evaluate(async () => {
			await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
			const issues: string[] = [];
			if (document.documentElement.scrollWidth > innerWidth) issues.push("horizontal overflow");
			for (const img of document.images) {
				if (!img.naturalWidth) issues.push(`broken image: ${img.getAttribute("src")}`);
				if (!img.hasAttribute("alt")) issues.push("missing image alt");
			}
			for (const button of document.querySelectorAll("button")) {
				if (!button.getAttribute("aria-label") && !button.textContent?.trim()) issues.push("unnamed button");
			}
			return issues;
		});
		expect(visualIssues).toEqual([]);
		await page.screenshot({ path: `test-results/session-ended-lobby-${width}.png`, fullPage: true });
		expect(errors).toEqual([]);
	});
}

test("종료 실패 시 보드에 남고 다시 시도할 수 있다", async ({ page }) => {
	await mockBackend(page, { failEnd: true });
	await page.goto("/e2e/session-lifecycle.html?path=/session");
	await page.getByRole("button", { name: "세션 종료", exact: true }).click();
	await page.getByRole("button", { name: "종료", exact: true }).click();
	await expect(page.getByText("세션을 종료하지 못했습니다. 다시 시도해 주세요.")).toBeVisible();
	await expect(page.getByRole("button", { name: "세션 종료", exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "일정", exact: true })).toHaveCount(0);
});

test("종료된 세션 정보가 남아 있어도 로비 진입 시 재조회해 제거한다", async ({ page }) => {
	await mockBackend(page, { active: false });
	await page.goto("/e2e/session-lifecycle.html");
	await expect(page.getByRole("heading", { name: "일정", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "진행 중 세션 입장", exact: true })).toHaveCount(0);
});
