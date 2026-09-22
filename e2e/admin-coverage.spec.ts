import { expect, test } from "@playwright/test";
import type { CoverageTestApi } from "./admin-coverage";
declare global { interface Window { coverageTest: CoverageTestApi } }

test.beforeEach(async ({ page }) => { await page.route("https://**/*", route => route.abort()); });
for (const width of [390, 1440]) test(`administrator absence can be cancelled or confirmed for one match at ${width}px`, async ({ page }) => {
	await page.setViewportSize({ width, height: 900 });
	await page.goto("/e2e/admin-coverage.html");
	await page.getByRole("button", { name: "교대 확인" }).click();
	await expect(page.getByText("먼저 출전 가능:", { exact: false })).toBeVisible();
	await expect(page.getByRole("button", { name: "이번 경기 시작" })).toBeVisible();
	expect(await page.evaluate(() => window.coverageTest.starts())).toBe(0);
	await page.screenshot({ path: `test-results/admin-coverage-confirm-${width}.png` });
	await page.getByRole("button", { name: "취소", exact: true }).click();
	expect(await page.evaluate(() => window.coverageTest.starts())).toBe(0);
	expect(await page.evaluate(() => window.coverageTest.board.getState().drafts.get("first")?.anchorMemberIds)).toHaveLength(4);
	await page.getByRole("button", { name: "교대 확인" }).click();
	await page.getByRole("button", { name: "이번 경기 시작" }).click();
	await expect.poll(() => page.evaluate(() => window.coverageTest.starts())).toBe(1);
	await expect(page.getByRole("heading", { name: "운영진 전원 출전" })).toHaveCount(0);
	// A single participating administrator receives the same choice.
	await page.goto("/e2e/admin-coverage.html?sole=1");
	await page.getByRole("button", { name: "교대 확인" }).click();
	await expect(page.getByRole("button", { name: "이번 경기 시작" })).toBeVisible();
	await page.screenshot({ path: `test-results/admin-coverage-sole-${width}.png` });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.keyboard.press("Escape");
	expect(await page.evaluate(() => window.coverageTest.starts())).toBe(0);
	await page.getByRole("button", { name: "교대 확인" }).click();
	await page.getByRole("button", { name: "이번 경기 시작" }).click();
	await expect.poll(() => page.evaluate(() => window.coverageTest.starts())).toBe(1);
});

test("losing edit permission dismisses an outstanding confirmation", async ({ page }) => {
	await page.goto("/e2e/admin-coverage.html");
	await page.getByRole("button", { name: "교대 확인" }).click();
	await page.evaluate(() => window.coverageTest.session.setState({ isEditor: false }));
	await expect(page.getByRole("button", { name: "이번 경기 시작" })).toHaveCount(0);
	expect(await page.evaluate(() => window.coverageTest.starts())).toBe(0);
});
