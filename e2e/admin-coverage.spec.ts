import { expect, test } from "@playwright/test";
import type { CoverageTestApi } from "./admin-coverage";
declare global { interface Window { coverageTest: CoverageTestApi } }

test.beforeEach(async ({ page }) => { await page.route("https://**/*", route => route.abort()); });
for (const width of [390, 1440]) test(`administrator relay is mandatory at ${width}px`, async ({ page }) => {
	await page.setViewportSize({ width, height: 900 });
	await page.goto("/e2e/admin-coverage.html");
	await page.getByRole("button", { name: "교대 확인" }).click();
	await expect(page.getByText("먼저 출전 가능:", { exact: false })).toBeVisible();
	await expect(page.getByRole("button", { name: "이번 경기 시작" })).toHaveCount(0);
	expect(await page.evaluate(() => window.coverageTest.starts())).toBe(0);
	await page.screenshot({ path: `test-results/admin-coverage-alternative-${width}.png` });
	await page.getByRole("button", { name: "대기 유지" }).click();
	await page.evaluate(() => window.coverageTest.session.setState(s => ({ courts: s.courts.map(c => ({ ...c, match: null })) })));
	await expect(page.getByText("다음 경기 · 4/4", { exact: true })).toBeVisible();
	expect(await page.evaluate(() => { const t = window.coverageTest.scene().entities.find(e => e.key === "team:first"); return t?.kind === "card" && t.appearance.blink; })).toBe(true);
	await page.goto("/e2e/admin-coverage.html?sole=1");
	await page.getByRole("button", { name: "교대 확인" }).click();
	await expect(page.getByRole("button", { name: "교대까지 대기" })).toBeVisible();
	await page.screenshot({ path: `test-results/admin-coverage-required-${width}.png` });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.getByRole("button", { name: "교대까지 대기" }).click();
	expect(await page.evaluate(() => window.coverageTest.starts())).toBe(0);
	await page.getByRole("button", { name: "교대 확인" }).click();
	await expect(page.getByRole("button", { name: "이번 경기 시작" })).toHaveCount(0);
	await expect(page.getByText("운영진이 최소 한 명은 경기 밖에 남아 있어야 해요.", { exact: false })).toBeVisible();
	expect(await page.evaluate(() => window.coverageTest.starts())).toBe(0);
});
