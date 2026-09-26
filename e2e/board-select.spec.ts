import { expect, test } from "@playwright/test";

// The full board (e2e/match-proposals fixture) must not start text selection, the selection caret or
// the long-press/context menu while pressing and dragging; inputs in its dialogs stay editable.
test.beforeEach(async ({ page }) => {
	await page.routeWebSocket("wss://**", socket => socket.close());
	await page.route("https://**/*", route => route.abort());
	await page.goto("/e2e/match-proposals.html");
	await expect(page.getByRole("button", { name: "로그" })).toBeVisible();
});

test("pressing and dragging across the board selects nothing", async ({ page }) => {
	const text = (await page.getByText("1번", { exact: true }).first().boundingBox())!;
	const log = (await page.getByRole("button", { name: "로그" }).boundingBox())!;
	await page.mouse.move(text.x + 1, text.y + text.height / 2);
	await page.mouse.down();
	await page.mouse.move(log.x + log.width, log.y + log.height / 2, { steps: 10 });
	await page.mouse.move(600, 650, { steps: 10 });
	await page.mouse.up();
	await page.mouse.dblclick(text.x + text.width / 2, text.y + text.height / 2);
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
	const style = await page.evaluate(() => {
		const s = getComputedStyle(document.querySelector(".board-no-select")!);
		return { select: s.userSelect, callout: s.getPropertyValue("-webkit-touch-callout") || "unsupported" };
	});
	expect(style.select).toBe("none");
	const prevented = await page.evaluate(() => {
		const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
		document.querySelector(".board-no-select canvas, .board-no-select div")!.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(true);
});

test("the member search input on the board still accepts typing and selection", async ({ page }) => {
	await page.getByRole("button", { name: "회원 찾기" }).click();
	const input = page.locator("#board-player-query");
	await input.fill("김민지");
	await input.selectText();
	expect(await page.evaluate(() => { const el = document.querySelector<HTMLInputElement>("#board-player-query")!; return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0); })).toBe("김민지");
});
