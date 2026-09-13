import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("guest registration errors keep selections and show a recoverable explanation", async ({
	page,
}) => {
	let fail = true;
	const writes: string[] = [];
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === "127.0.0.1" || url.hostname === "localhost")
			return route.continue();
		if (url.pathname.includes("/rest/v1/")) {
			const method = route.request().method();
			if (method !== "GET") writes.push(url.pathname);
			if (method === "POST" && fail)
				return route.fulfill({
					status: 409,
					contentType: "application/json",
					body: JSON.stringify({
						code: "23505",
						message:
							'duplicate key violates unique constraint "uq_session_member"',
					}),
				});
			return route.fulfill({ contentType: "application/json", body: "[]" });
		}
		return route.abort();
	});
	await page.goto("/e2e/session-setup.html");
	await page.getByRole("button", { name: "전체선택", exact: true }).click();
	await page.getByRole("button", { name: "+ 게스트", exact: true }).click();
	await page.getByPlaceholder("게스트 이름 입력").fill("테스트 게스트");
	await page.getByRole("button", { name: "추가", exact: true }).click();
	await page.getByRole("button", { name: "세션 시작 (4명)" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"이미 등록된 참가자입니다",
	);
	await expect(
		page.getByRole("button", { name: "세션 시작 (4명)" }),
	).toBeEnabled();
	expect(writes).toEqual(["/rest/v1/session_players"]);
	for (const theme of ["light", "dark"]) {
		await page.evaluate(
			(theme) =>
				document.documentElement.classList.toggle("dark", theme === "dark"),
			theme,
		);
		for (const width of [390, 1280]) {
			await page.setViewportSize({ width, height: 900 });
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: `test-results/design-guest-error-${width}-${theme}.png`,
				fullPage: true,
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
				doc.querySelectorAll("script,style,link").forEach((e) => e.remove());
				const style = document.createElement("style");
				style.textContent = css;
				doc.querySelector("head")!.append(style);
				return "<!doctype html>" + doc.outerHTML;
			});
			writeFileSync(
				`test-results/design-guest-error-${width}-${theme}.html`,
				html,
			);
		}
	}
	fail = false;
	await page.getByRole("button", { name: "세션 시작 (4명)" }).click();
	await expect(page.getByText("저장 완료", { exact: true })).toBeVisible();
});
