import { expect, test, type Page } from "@playwright/test";
import type { ProposalTestApi } from "./match-proposals";

declare global { interface Window { proposalTest: ProposalTestApi } }
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function setup(page: Page, role = "member", options: { failSend?: boolean; proposals?: unknown[] } = {}) {
	const writes: string[] = [];
	let saved = options.proposals ?? [];
	await page.routeWebSocket("wss://**", (socket) => socket.close());
	await page.route("https://**/*", async (route) => {
		const request = route.request();
		const url = request.url();
		if (request.method() === "POST") writes.push(url);
		if (url.includes("/rest/v1/match_proposals")) return route.fulfill({ json: saved });
		if (url.includes("/rpc/create_match_proposal")) {
			if (options.failSend) return route.fulfill({ status: 503, json: { message: "offline" } });
			const body = request.postDataJSON();
			const proposal = { id: body.p_id, session_id: 1, created_by: uid(2), creator_name: "민수", player_ids: body.p_player_ids,
				player_names: body.p_player_ids.map((id: string) => ["운영진", "민수", "지수", "현우", "수빈"][Number(id.slice(-2)) - 1]), status: "pending", created_at: "2026-09-18T00:00:00Z" };
			saved = [proposal];
			return route.fulfill({ json: proposal });
		}
		if (url.includes("/rpc/resolve_match_proposal")) return route.fulfill({ status: 204, body: "" });
		return route.abort();
	});
	await page.goto(`/e2e/match-proposals.html?role=${role}`);
	await expect(page.locator("canvas")).toHaveCount(1);
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().magnets.size)).toBe(10);
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().scope)).not.toBeNull();
	return writes;
}

async function drag(page: Page, player: number, target?: { x: number; y: number }) {
	const canvas = (await page.locator("canvas").boundingBox())!;
	const state = await page.evaluate((id) => {
		const s = window.proposalTest.board.getState();
		return { point: s.magnets.get(id)!, scale: s.scale };
	}, uid(player));
	const destination = target ?? { x: 180, y: 350 };
	await page.mouse.move(canvas.x + state.point.x * state.scale, canvas.y + state.point.y * state.scale);
	await page.mouse.down();
	await page.mouse.move(canvas.x + destination.x * state.scale, canvas.y + destination.y * state.scale, { steps: 8 });
	await page.mouse.up();
	await page.evaluate(() => new Promise<void>((resolve) => {
		let frames = 0;
		const next = () => { if (++frames >= 8) resolve(); else requestAnimationFrame(next); };
		requestAnimationFrame(next);
	}));
}

test("member locally groups 1–4, cannot add a fifth, and only sends on the proposal button", async ({ page }) => {
	const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
	const writes = await setup(page);
	await expect(page.getByRole("button", { name: "보기 전용", exact: true })).toHaveCount(0);
	await drag(page, 2);
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().groups[0]?.playerIds.length)).toBe(1);
	for (const id of [3, 4, 5, 6]) {
		const target = await page.evaluate(() => window.proposalTest.proposals.getState().groups[0].anchor);
		await drag(page, id, target);
	}
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().groups[0]?.playerIds.length)).toBe(4);
	expect(writes).toEqual([]);
	expect(await page.evaluate(() => ({ drafts: window.proposalTest.board.getState().drafts.size, reservations: window.proposalTest.board.getState().reservations.size }))).toEqual({ drafts: 0, reservations: 0 });
	const canvas = (await page.locator("canvas").boundingBox())!;
	const { anchor, scale } = await page.evaluate(() => ({ anchor: window.proposalTest.proposals.getState().groups[0].anchor, scale: window.proposalTest.board.getState().scale }));
	await page.mouse.click(canvas.x + (anchor.x + 15) * scale, canvas.y + (anchor.y + 89) * scale);
	await expect.poll(() => writes.length).toBe(1);
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().groups.length)).toBe(0);
	await page.getByRole("button", { name: "내 매칭 제안" }).click();
	await expect(page.getByText("보낸 제안", { exact: true })).toBeVisible();
	await expect(page.getByText("작성자와 운영진에게만 보여요")).toBeVisible();
	expect(errors).toEqual([]);
});

test("a failed send preserves the local group for retry", async ({ page }) => {
	await setup(page, "member", { failSend: true });
	await drag(page, 2);
	await page.getByRole("button", { name: "내 매칭 제안" }).click();
	await page.getByRole("button", { name: "매칭 제안", exact: true }).click();
	await expect(page.getByText("제안을 보내지 못했어요. 묶음은 그대로 있으니 다시 눌러주세요.")).toBeVisible();
	expect(await page.evaluate(() => window.proposalTest.proposals.getState().groups[0].playerIds)).toEqual([uid(2)]);
});

const proposal = { id: uid(200), session_id: 1, created_by: uid(2), creator_name: "민수", player_ids: [uid(2), uid(3)],
	player_names: ["민수", "지수"], status: "pending", created_at: "2026-09-18T00:00:00Z" };

test("admin sees proposals and retains the existing read-only button", async ({ page }) => {
	await setup(page, "admin", { proposals: [proposal] });
	await expect(page.getByRole("button", { name: "보기 전용", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "매칭 제안 1건" }).click();
	await expect(page.getByText("민수님의 제안")).toBeVisible();
	await page.getByRole("button", { name: "확인했어요" }).click();
	await expect(page.getByText("운영진 확인", { exact: true })).toBeVisible();
});

test("another member never displays someone else's proposal, including after a stale response", async ({ page }) => {
	await setup(page, "other", { proposals: [proposal] });
	await page.getByRole("button", { name: "내 매칭 제안" }).click();
	await expect(page.getByText("보낸 제안", { exact: true })).toHaveCount(0);
	await expect(page.getByText("아직 보낸 제안이 없어요.", { exact: false })).toBeVisible();
});

test("mobile board and proposal sheet fit the viewport", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await setup(page);
	await drag(page, 2, { x: 180, y: 370 });
	await page.screenshot({ path: testInfo.outputPath("member-mobile-board.png") });
	await page.getByRole("button", { name: "내 매칭 제안" }).click();
	await expect(page.getByRole("button", { name: "매칭 제안", exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	const visualIssues = await page.evaluate(() => {
		const issues: string[] = [];
		for (const button of document.querySelectorAll<HTMLButtonElement>(".proposal-sheet button, .proposal-dock")) {
			const rect = button.getBoundingClientRect();
			if (rect.width < 44 || rect.height < 44) issues.push(`small target: ${button.textContent}`);
			if (rect.left < 0 || rect.right > innerWidth) issues.push(`overflow: ${button.textContent}`);
			if (!(button.textContent?.trim() || button.getAttribute("aria-label"))) issues.push("unnamed button");
		}
		for (const text of document.querySelectorAll<HTMLElement>(".proposal-panel p, .proposal-item-heading, .proposal-players")) {
			if (text.scrollWidth > text.clientWidth + 1) issues.push(`text overflow: ${text.textContent}`);
			if (parseFloat(getComputedStyle(text).fontSize) < 12) issues.push(`tiny text: ${text.textContent}`);
		}
		return issues;
	});
	expect(visualIssues).toEqual([]);
	await page.screenshot({ path: testInfo.outputPath("member-mobile-sheet.png") });
});

test("desktop proposal inbox", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await setup(page, "admin", { proposals: [proposal] });
	await page.getByRole("button", { name: "매칭 제안 1건" }).click();
	await expect(page.getByText("민수님의 제안")).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("admin-desktop-sheet.png") });
});
