import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

// Service workers must not bypass the mock-only network boundary below.
test.use({ serviceWorkers: "block" });

interface Credentials { email: string; password: string }

async function mockAuthBackend(page: Page, baseURL: string, options: { success?: boolean; hold?: boolean } = {}) {
	// Every credential/token belongs to this browser test only. No real account
	// address, password, project secret, or reusable login token is checked in.
	const credentials: Credentials = { email: `${randomUUID()}@example.invalid`, password: `  ${randomUUID()}  ` };
	const userId = randomUUID();
	const memberId = randomUUID();
	const user = {
		id: userId, aud: "authenticated", role: "authenticated", email: credentials.email,
		email_confirmed_at: "2020-01-01T00:00:00Z", created_at: "2020-01-01T00:00:00Z",
		app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { name: "브라우저 테스트" }, identities: [],
	};
	const expiresAt = Math.floor(Date.now() / 1000) + 3600;
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, email: credentials.email, aud: "authenticated", role: "authenticated", exp: expiresAt })}.${randomUUID()}`;
	const logins: Credentials[] = [];
	let release = () => {};
	const gate = options.hold ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
	const localOrigin = new URL(baseURL).origin;

	await page.routeWebSocket((url) => !["localhost", "127.0.0.1"].includes(url.hostname), (socket) => socket.close());
	await page.route("**/*", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const headers = {
			"access-control-allow-origin": "*",
			"access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile",
			"access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
		};
		const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
		if (request.method() === "OPTIONS" && url.origin !== localOrigin) return route.fulfill({ status: 204, headers });
		if (url.pathname === "/auth/v1/token") {
			expect(url.searchParams.get("grant_type")).toBe("password");
			const body = request.postDataJSON() as Credentials;
			logins.push({ email: body.email, password: body.password });
			await gate;
			return options.success
				? json({ access_token: accessToken, refresh_token: randomUUID(), token_type: "bearer", expires_in: 3600, expires_at: expiresAt, user })
				: json({ code: "invalid_credentials", error_code: "invalid_credentials", message: "Invalid login credentials" }, 400);
		}
		if (url.pathname === "/auth/v1/user") return json(user);
		if (url.pathname === "/rest/v1/members" && request.method() === "GET" && url.searchParams.has("auth_user_id")) {
			return json({ id: memberId, name: "브라우저 테스트", gender: "M", birth_year: 1990, residence: "테스트 동네", membership_started_at: "2020-01-01", created_at: "2020-01-01T00:00:00Z" });
		}
		if (url.pathname === "/rest/v1/rpc/is_admin") return json(false);
		if (url.pathname === "/rest/v1/rpc/wait_points_my_status") return json({ balance: 0, max: 7, cost: 7, session_cap: 2, has_ticket: false });
		// Empty schedules, members, notices and dues keep the real App shell small.
		// All POSTs (including profile upsert/schedule-sync RPC) are answered here:
		// none is forwarded to a real backend, even after successful sign-in.
		if (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/storage/v1/")) return json([]);
		if (url.origin === localOrigin) return route.continue();
		return route.abort();
	});
	return { credentials, userId, logins, release };
}

async function openLogin(page: Page) {
	await page.goto("/");
	await expect(page.getByRole("form", { name: "이메일 로그인", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "카카오로 로그인", exact: true })).toBeVisible();
}

async function fillCredentials(page: Page, credentials: Credentials) {
	await page.getByLabel("이메일", { exact: true }).fill(` ${credentials.email} `);
	await page.getByLabel("비밀번호", { exact: true }).fill(credentials.password);
}

test("email login coexists with Kakao, validates required inputs, and toggles password visibility without submitting", async ({ page, baseURL }) => {
	const backend = await mockAuthBackend(page, baseURL!);
	await page.setViewportSize({ width: 390, height: 844 });
	await openLogin(page);
	await page.screenshot({ path: "test-results/auth-login-mobile.png" });
	const email = page.getByLabel("이메일", { exact: true });
	const password = page.getByLabel("비밀번호", { exact: true });
	const submit = page.getByRole("button", { name: "이메일로 로그인", exact: true });
	await expect(email).toHaveAttribute("autocomplete", "email");
	await expect(password).toHaveAttribute("autocomplete", "current-password");
	await expect(password).toHaveAttribute("type", "password");
	await submit.click();
	await expect(page.getByRole("alert")).toHaveText("이메일을 입력해 주세요.");
	await email.fill("not-an-email");
	await submit.click();
	await expect(page.getByRole("alert")).toHaveText("올바른 이메일 주소를 입력해 주세요.");
	await email.fill(backend.credentials.email);
	await submit.click();
	await expect(page.getByRole("alert")).toHaveText("비밀번호를 입력해 주세요.");
	await password.fill(backend.credentials.password);
	await page.getByRole("button", { name: "비밀번호 보기", exact: true }).click();
	await expect(password).toHaveAttribute("type", "text");
	await expect(password).toHaveValue(backend.credentials.password);
	await page.getByRole("button", { name: "비밀번호 숨기기", exact: true }).click();
	await expect(password).toHaveAttribute("type", "password");
	expect(backend.logins).toEqual([]);
	await expect(page.getByRole("button", { name: "카카오로 로그인", exact: true })).toBeEnabled();
});

test("invalid credentials show a safe error and preserve the exact password for retry", async ({ page, baseURL }) => {
	const backend = await mockAuthBackend(page, baseURL!);
	await openLogin(page);
	await fillCredentials(page, backend.credentials);
	await page.getByRole("button", { name: "이메일로 로그인", exact: true }).click();
	await expect(page.getByRole("alert")).toHaveText("이메일 또는 비밀번호를 확인해 주세요.");
	expect(backend.logins).toEqual([backend.credentials]);
	await expect(page.getByLabel("비밀번호", { exact: true })).toHaveValue(backend.credentials.password);
	await expect(page.getByRole("button", { name: "이메일로 로그인", exact: true })).toBeEnabled();
	await expect(page.getByRole("button", { name: "카카오로 로그인", exact: true })).toBeEnabled();
	await page.getByLabel("비밀번호", { exact: true }).fill(randomUUID());
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("pending email login disables both login methods and rejects repeated form submissions", async ({ page, baseURL }) => {
	const backend = await mockAuthBackend(page, baseURL!, { hold: true });
	await openLogin(page);
	await fillCredentials(page, backend.credentials);
	await page.getByRole("button", { name: "이메일로 로그인", exact: true }).click();
	await expect.poll(() => backend.logins.length).toBe(1);
	const form = page.getByRole("form", { name: "이메일 로그인", exact: true });
	await expect(form).toHaveAttribute("aria-busy", "true");
	await expect(page.getByRole("button", { name: "로그인 중…", exact: true })).toBeDisabled();
	await expect(page.getByLabel("이메일", { exact: true })).toBeDisabled();
	await expect(page.getByLabel("비밀번호", { exact: true })).toBeDisabled();
	await expect(page.getByRole("button", { name: "비밀번호 보기", exact: true })).toBeDisabled();
	await expect(page.getByRole("button", { name: "카카오로 로그인", exact: true })).toBeDisabled();
	// Exercise the handler guard in addition to the browser's disabled button.
	await form.evaluate((element: HTMLFormElement) => { element.requestSubmit(); element.requestSubmit(); });
	expect(backend.logins).toHaveLength(1);
	backend.release();
	await expect(page.getByRole("alert")).toHaveText("이메일 또는 비밀번호를 확인해 주세요.");
	await expect(form).toHaveAttribute("aria-busy", "false");
	await expect(page.getByRole("button", { name: "이메일로 로그인", exact: true })).toBeEnabled();
	await expect(page.getByRole("button", { name: "카카오로 로그인", exact: true })).toBeEnabled();
	expect(backend.logins).toHaveLength(1);
});

test("successful mocked password login enters the normal app as a non-admin member", async ({ page, baseURL }) => {
	const backend = await mockAuthBackend(page, baseURL!, { success: true });
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await openLogin(page);
	await fillCredentials(page, backend.credentials);
	await page.getByRole("button", { name: "이메일로 로그인", exact: true }).click();
	await expect(page.getByRole("form", { name: "이메일 로그인", exact: true })).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "일정", exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(async () => {
		const path = "/src/store/authStore.ts";
		const auth: typeof import("../src/store/authStore") = await import(path);
		const state = auth.useAuthStore.getState();
		return { userId: state.user?.id, email: state.user?.email, ready: state.ready, memberLoaded: state.memberLoaded, isAdmin: state.isAdmin };
	})).toEqual({ userId: backend.userId, email: backend.credentials.email, ready: true, memberLoaded: true, isAdmin: false });
	expect(backend.logins).toEqual([backend.credentials]);
	await expect(page.getByRole("button", { name: "일정 관리", exact: true })).toHaveCount(0);
	expect(errors).toEqual([]);
});
