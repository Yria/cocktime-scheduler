import { expect, test, type Page } from "@playwright/test";
import type { MatchEditTestApi } from "./match-edit";

declare global { interface Window { matchEditTest: MatchEditTestApi } }

for (const mobile of [true, false]) {
	test.describe(mobile ? "mobile match edit" : "desktop match edit", () => {
		test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 900, height: 700 },
			hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 3 : 1 });

		const tap = (page: Page, x: number, y: number) => mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);

		for (const scale of [1, 0.5]) {
			test(`opening touch stays open at ${scale}x; a new backdrop tap and cancel still dismiss`, async ({ page }, testInfo) => {
				const errors: string[] = [];
				page.on("pageerror", (error) => errors.push(error.message));
				await page.route("https://**/*", (route) => route.abort());
				await page.goto(`/e2e/match-edit.html?scale=${scale}`);
				await expect(page.locator('canvas[data-board-renderer="pixi"]')).toBeVisible();
				// Wait for the asynchronously initialized canvas scene to commit.
				await page.evaluate(() => document.fonts.ready);
				await expect(async () => {
					if (await page.evaluate(() => window.matchEditTest.opened) === 0) await tap(page, 255 * scale, 95 * scale);
					expect(await page.evaluate(() => window.matchEditTest.opened)).toBe(1);
				}).toPass();
				const heading = page.getByRole("heading", { name: "경기 수정 · 1번 코트" });
				// Native touch includes the trailing click that used to land on the new backdrop.
				await expect(heading).toBeVisible();
				expect(await page.evaluate(() => window.matchEditTest)).toEqual({ opened: 1, closed: 0 });
				await page.screenshot({ path: testInfo.outputPath("match-edit-open.png") });

				const title = await heading.boundingBox();
				await tap(page, title!.x + 10, title!.y + 10);
				await expect(heading).toBeVisible();
				await tap(page, 20, 20);
				await expect(heading).toHaveCount(0);
				expect(await page.evaluate(() => window.matchEditTest)).toEqual({ opened: 1, closed: 1 });

				await tap(page, 255 * scale, 95 * scale);
				await expect(heading).toBeVisible();
				const cancel = page.getByRole("button", { name: "취소", exact: true });
				if (mobile) await cancel.tap(); else await cancel.click();
				await expect(heading).toHaveCount(0);
				expect(await page.evaluate(() => window.matchEditTest)).toEqual({ opened: 2, closed: 2 });
				expect(errors).toEqual([]);
			});
		}
	});
}
