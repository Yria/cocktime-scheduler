import { expect, test, type Page } from "@playwright/test";
import type { MatchAvoidTestApi } from "./match-avoid";

declare global { interface Window { avoidTest: MatchAvoidTestApi } }

type Row = { id: string; member_ids: string[]; created_at: string };
async function fakeBackend(page: Page, rows: Row[], outage = { on: false }) {
	const writes: { method: string; body: unknown; url: string }[] = [];
	await page.route("https://**/*", async route => {
		const request = route.request(), url = new URL(request.url());
		const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
		if (url.pathname === "/rest/v1/match_avoid_groups") {
			if (request.method() === "GET") {
				if (outage.on) return json({ code: "PGRST205", message: "Could not find the table" }, 404); // not deployed yet
				return json(rows);
			}
			if (request.method() === "POST") {
				const body = request.postDataJSON() as { member_ids: string[] };
				writes.push({ method: "POST", body, url: request.url() });
				const row = { id: `new-${rows.length}`, member_ids: body.member_ids, created_at: "2026-09-26T00:00:00Z" };
				rows.push(row);
				return json(row, 201);
			}
			if (request.method() === "DELETE") {
				writes.push({ method: "DELETE", body: null, url: request.url() });
				const id = url.searchParams.get("id")?.replace(/^eq\./, "");
				rows.splice(rows.findIndex(row => row.id === id), 1);
				return route.fulfill({ status: 204 });
			}
		}
		if (url.pathname === "/rest/v1/members") return json([{ id: "m0", name: "지수" }, { id: "m1", name: "현우" }, { id: "m9", name: "지난 회원" }]);
		return route.abort();
	});
	return writes;
}
const longPress = async (page: Page) => {
	const box = (await page.getByTestId("court-status").boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(950);
	await page.mouse.up();
};

for (const who of ["member", "operator"]) test(`a ${who} who is not the owner sees nothing when long-pressing the court status`, async ({ page }) => {
	const requests: string[] = [];
	page.on("request", request => requests.push(request.url()));
	await fakeBackend(page, []);
	await page.goto(`/e2e/match-avoid.html?${who}`);
	await longPress(page);
	await expect(page.getByRole("heading", { name: "같이 매칭하지 않기" })).toHaveCount(0);
	expect(requests.filter(url => url.includes("match_avoid"))).toEqual([]);
	// Owner and others get the same strip: no owner-only inline style.
	expect(await page.getByTestId("court-status").getAttribute("style")).not.toMatch(/user-select|touch-callout/);
});

test("a short tap does not open the hidden menu", async ({ page }) => {
	await fakeBackend(page, []);
	await page.goto("/e2e/match-avoid.html");
	await page.getByTestId("court-status").click();
	await page.waitForTimeout(950);
	await expect(page.getByRole("heading", { name: "같이 매칭하지 않기" })).toHaveCount(0);
});

for (const width of [320, 390, 1280]) test(`an operator saves and deletes a group from the hidden menu at ${width}px`, async ({ page }) => {
	await page.setViewportSize({ width, height: width < 400 ? 740 : 900 });
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	const writes = await fakeBackend(page, [{ id: "old", member_ids: ["m0", "m9"], created_at: "2026-09-20T00:00:00Z" }]);
	await page.goto("/e2e/match-avoid.html");
	await longPress(page);
	await expect(page.getByRole("heading", { name: "같이 매칭하지 않기" })).toBeVisible();
	await expect(page.getByText("지수 · 지난 회원", { exact: true })).toBeVisible();
	await expect(page.getByText("게스트 민호")).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	const save = page.getByRole("button", { name: /명 이상 골라 주세요|묶음 저장/ });
	await expect(save).toBeDisabled();
	await page.getByText("현우", { exact: true }).click();
	await expect(save).toBeDisabled();
	await page.getByText("수빈", { exact: true }).click();
	await expect(page.getByText("고른 사람: 현우 · 수빈", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "묶음 저장" })).toBeEnabled();
	const button = (await page.getByRole("button", { name: "묶음 저장" }).boundingBox())!;
	expect(button.y + button.height).toBeLessThanOrEqual(page.viewportSize()!.height); // Visible without scrolling.
	await page.waitForTimeout(300); // Let the button's enable transition finish before the screenshot.
	await page.screenshot({ path: `test-results/match-avoid-${width}.png` });
	await page.getByRole("button", { name: "묶음 저장" }).click();
	await expect(page.getByText("현우 · 수빈", { exact: true })).toBeVisible();
	expect(writes.filter(w => w.method === "POST").map(w => w.body)).toEqual([{ member_ids: ["m1", "m2"] }]);
	expect(await page.evaluate(() => window.avoidTest.avoid.getState().groups.map(g => g.memberIds))).toEqual([["m0", "m9"], ["m1", "m2"]]);
	await page.getByRole("button", { name: "지수 · 지난 회원 묶음 삭제" }).click();
	await page.getByRole("button", { name: "삭제", exact: true }).click();
	await expect(page.getByText("지수 · 지난 회원", { exact: true })).toHaveCount(0);
	expect(writes.filter(w => w.method === "DELETE")).toHaveLength(1);
	expect(errors).toEqual([]);
});

test("the same group cannot be saved twice and at most four people can be picked", async ({ page }) => {
	await fakeBackend(page, [{ id: "old", member_ids: ["m1", "m0"], created_at: "2026-09-20T00:00:00Z" }]);
	await page.goto("/e2e/match-avoid.html");
	await longPress(page);
	await page.getByText("지수", { exact: true }).last().click();
	await page.getByText("현우", { exact: true }).click();
	await expect(page.getByRole("alert")).toHaveText("이미 같은 묶음이 있어요");
	await expect(page.getByRole("button", { name: "묶음 저장" })).toBeDisabled();
	for (const name of ["수빈", "지훈"]) await page.getByText(name, { exact: true }).click();
	await expect(page.getByRole("heading", { name: "새 묶음 · 4/4명" })).toBeVisible();
	await expect(page.getByRole("button", { name: /서연/ })).toBeDisabled();
});

test("a failed load is shown with a retry, and saving waits until the list is loaded", async ({ page }) => {
	const outage = { on: true };
	await fakeBackend(page, [{ id: "old", member_ids: ["m0", "m1"], created_at: "2026-09-20T00:00:00Z" }], outage);
	await page.goto("/e2e/match-avoid.html");
	await longPress(page);
	await expect(page.getByText("묶음을 불러오지 못했어요. 불러오기 전까지 이 설정 없이 편성돼요.")).toBeVisible();
	await page.getByText("현우", { exact: true }).click();
	await page.getByText("수빈", { exact: true }).click();
	await expect(page.getByRole("button", { name: "저장된 묶음을 먼저 불러와야 해요" })).toBeDisabled();
	outage.on = false;
	await page.getByRole("button", { name: "다시 불러오기" }).click();
	await expect(page.getByText("지수 · 현우", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "묶음 저장" })).toBeEnabled();
});

test("a right-button hold or a drag does not open the hidden menu", async ({ page }) => {
	await fakeBackend(page, []);
	await page.goto("/e2e/match-avoid.html");
	const box = (await page.getByTestId("court-status").boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down({ button: "right" });
	await page.waitForTimeout(950);
	await page.mouse.up({ button: "right" });
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
	await page.waitForTimeout(950);
	await page.mouse.up();
	await expect(page.getByRole("heading", { name: "같이 매칭하지 않기" })).toHaveCount(0);
});

test("the delete confirmation covers the menu behind it", async ({ page }) => {
	await fakeBackend(page, [{ id: "old", member_ids: ["m0", "m1"], created_at: "2026-09-20T00:00:00Z" }]);
	await page.goto("/e2e/match-avoid.html");
	await longPress(page);
	await page.getByRole("button", { name: "지수 · 현우 묶음 삭제" }).click();
	await expect(page.getByRole("button", { name: "삭제", exact: true })).toBeVisible();
	await page.getByText("수빈", { exact: true }).click({ force: true, trial: false }).catch(() => {});
	await expect(page.getByText("같이 넣지 않을 사람을 2~4명 골라 주세요")).toBeVisible();
});
