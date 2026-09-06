import { expect, test } from "@playwright/test";
import type { BoardTestApi } from "./board";

declare global { interface Window { boardTest: BoardTestApi } }

test.beforeEach(async ({ page }) => {
	await page.route("https://**/*", (route) => route.abort());
});

test("WebGL initial commit, idle frames, native drag, and teardown", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/e2e/board.html");
	const canvas = page.locator('canvas[data-board-renderer="pixi"]');
	await expect(canvas).toHaveCount(1);
	await expect.poll(() => page.evaluate(() => window.boardTest.renders)).toBeGreaterThan(0);
	await page.waitForTimeout(350);
	const frames = await page.evaluate(() => window.boardTest.renders);
	await page.waitForTimeout(150);
	expect(await page.evaluate(() => window.boardTest.renders)).toBe(frames);
	await page.mouse.move(90, 100); await page.mouse.down();
	await page.mouse.move(90, 350, { steps: 5 });
	expect(await page.evaluate(() => window.boardTest.board.getState().magnets.get("p0")?.y)).toBe(100);
	await page.mouse.up();
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().magnets.get("p0")?.y)).toBe(350);
	await page.evaluate(() => window.boardTest.board.getState().setScale(0.7));
	await expect.poll(() => page.evaluate(() => window.boardTest.renders)).toBeGreaterThan(frames);
	await page.screenshot({ path: "test-results/pixi-board.png" });
	await page.evaluate(() => window.boardTest.unmount());
	await expect(canvas).toHaveCount(0);
	await page.evaluate(() => window.boardTest.mount());
	await expect(canvas).toHaveCount(1);
	await page.waitForTimeout(150);
	expect(errors).toEqual([]);
});

test("native pair drop and delayed tap keep their existing commands", async ({ page }) => {
	await page.goto("/e2e/board.html");
	await expect.poll(() => page.evaluate(() => window.boardTest.renders)).toBeGreaterThan(0);
	await page.mouse.move(90, 100); await page.mouse.down(); await page.mouse.move(200, 100, { steps: 5 }); await page.mouse.up();
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().drafts.size)).toBe(1);
	await page.mouse.click(640, 100);
	await expect.poll(() => page.evaluate(() => window.boardTest.clicks)).toContain("p5");
});

test("WebGL failure falls back without leaving a broken canvas", async ({ page }) => {
	await page.addInitScript(() => {
		const getContext = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
			if (type.includes("webgl")) return null;
			return Reflect.apply(getContext, this, [type, ...args]);
		} as typeof getContext;
	});
	await page.goto("/e2e/board.html");
	await expect(page.locator(".konvajs-content")).toBeVisible();
	await expect(page.locator('canvas[data-board-renderer="pixi"]')).toHaveCount(0);
});
