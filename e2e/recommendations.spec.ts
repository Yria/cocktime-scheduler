import { expect, test } from "@playwright/test";
import type { RecommendationTestApi } from "./recommendations";

declare global { interface Window { recommendationTest: RecommendationTestApi } }

test.beforeEach(async ({ page }) => { await page.route("https://**/*", route => route.abort()); });

for (const width of [390, 1440]) test(`waiting-first recommendations and automatic fill at ${width}px`, async ({ page }) => {
	await page.setViewportSize({ width, height: 900 });
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	await page.goto("/e2e/recommendations.html");
	await expect(page.getByRole("heading", { name: "추천 팀원" })).toBeVisible();
	await expect(page.getByText("경기중선수5", { exact: true })).toHaveCount(0);
	await expect(page.getByText("대기선수1", { exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: `test-results/recommendations-${width}.png` });
	await page.getByRole("button", { name: "추천 우선순위 확인" }).click();
	await expect(page.getByRole("columnheader", { name: "출전 초과" })).toBeVisible();
	await page.screenshot({ path: `test-results/recommendations-priorities-${width}.png` });
	await page.getByRole("button", { name: "자동편성", exact: true }).click();
	await expect(page.getByText("편성 완료", { exact: true })).toBeVisible();
	const result = await page.evaluate(() => {
		const s = window.recommendationTest.board.getState();
		return { members: [...s.drafts.values()].flatMap(t => t.anchorMemberIds).sort(), reservations: s.reservations.size };
	});
	expect(result).toEqual({ members: ["p0", "p1", "p2", "p3"], reservations: 0 });
	expect(errors).toEqual([]);
});

test("fixed seed and a manual pick stay selected during automatic completion", async ({ page }) => {
	await page.goto("/e2e/recommendations.html?seed=1");
	await page.getByText("대기선수2", { exact: true }).click();
	await expect(page.getByRole("button", { name: "확인 (1)" })).toBeEnabled();
	await page.getByRole("button", { name: "자동편성", exact: true }).click();
	expect(await page.evaluate(() => [...window.recommendationTest.board.getState().drafts.values()][0].anchorMemberIds)).toEqual(["p0", "p1", "p2", "p3"]);
});

for (const width of [320, 390, 1440]) test(`explicit completion waiting leaves two labelled places at ${width}px`, async ({ page }, testInfo) => {
	const height = width === 320 ? 700 : 900;
	await page.setViewportSize({ width, height });
	await page.goto("/e2e/recommendations.html");
	await page.getByRole("checkbox", { name: "경기 완료 후 빈자리 채우기" }).check();
	await expect(page.getByText("합류 대기", { exact: true })).toHaveCount(2);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	const button = await page.getByRole("button", { name: "자동편성", exact: true }).boundingBox();
	expect(button!.y + button!.height).toBeLessThanOrEqual(height);
	await page.screenshot({ path: testInfo.outputPath(`waiting-picker-${width}.png`) });
	await page.getByRole("button", { name: "자동편성", exact: true }).click();
	const result = await page.evaluate(() => {
		const s = window.recommendationTest.board.getState();
		return { teams: [...s.drafts.values()].map(t => ({ size: t.anchorMemberIds.length, waiting: t.waitForCompletion })), reservations: s.reservations.size };
	});
	expect(result).toEqual({ teams: [{ size: 2, waiting: true }], reservations: 0 });
});

test("a player the seed must not be matched with looks and selects like anyone else, and only auto fill leaves them out", async ({ page }) => {
	await page.goto("/e2e/recommendations.html?seed&avoid");
	await expect(page.getByRole("heading", { name: "추천 팀원" })).toBeVisible();
	const avoided = page.getByRole("button", { name: /대기선수2/ });
	await expect(avoided).toBeEnabled();
	await expect(page.getByText("같이 안 함")).toHaveCount(0);
	await avoided.scrollIntoViewIfNeeded();
	await page.screenshot({ path: "test-results/recommendations-avoid.png" });
	await page.getByRole("button", { name: "자동편성", exact: true }).click();
	const auto = await page.evaluate(() => {
		const s = window.recommendationTest.board.getState();
		return [...s.drafts.values()].flatMap(t => [...t.anchorMemberIds, ...[...s.reservations.values()].filter(r => r.teamId === t.id).map(r => r.playerId)]);
	});
	expect(auto).toContain("p0");
	expect(auto).not.toContain("p1");
});

test("an operator can still pick the avoided partner by hand in the recommendation dialog", async ({ page }) => {
	await page.goto("/e2e/recommendations.html?seed&avoid");
	await page.getByRole("button", { name: /대기선수2/ }).click();
	await page.getByRole("button", { name: /^확인/ }).click();
	const members = await page.evaluate(() => [...window.recommendationTest.board.getState().drafts.values()].flatMap(t => t.anchorMemberIds).sort());
	expect(members).toEqual(["p0", "p1"]);
});
