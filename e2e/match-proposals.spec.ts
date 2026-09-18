import { expect, test, type Page } from "@playwright/test";
import type { ProposalTestApi } from "./match-proposals";
import type { MatchProposal } from "../src/lib/supabase/matchProposals";
import { cardControls } from "../src/lib/board/pixi/cardControls";

declare global { interface Window { proposalTest: ProposalTestApi } }
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function setup(page: Page, role = "member", options: { failSend?: boolean; failResolve?: boolean; server?: { proposals: MatchProposal[] } } = {}) {
	const writes: string[] = [];
	const server = options.server ?? { proposals: [] };
	await page.routeWebSocket("wss://**", (socket) => socket.close());
	await page.route("https://**/*", async (route) => {
		const request = route.request();
		const url = request.url();
		if (request.method() === "POST") writes.push(url);
		if (url.includes("/rest/v1/match_proposals")) return route.fulfill({ json: server.proposals });
		if (url.includes("/rpc/create_match_proposal")) {
			if (options.failSend) return route.fulfill({ status: 503, json: { message: "offline" } });
			const body = request.postDataJSON();
			const proposal: MatchProposal = { id: body.p_id, session_id: 1, created_by: uid(2), creator_name: "민수", player_ids: body.p_player_ids,
				player_names: body.p_player_ids.map((id: string) => ["운영진", "민수", "지수", "현우", "수빈"][Number(id.slice(-2)) - 1]), status: "pending", created_at: "2026-09-18T00:00:00Z" };
			server.proposals = [proposal, ...server.proposals];
			return route.fulfill({ json: proposal });
		}
		if (url.includes("/rpc/resolve_match_proposal")) {
			if (options.failResolve) return route.fulfill({ status: 503, json: { message: "offline" } });
			const body = request.postDataJSON();
			server.proposals = server.proposals.map((proposal) => proposal.id === body.p_id ? { ...proposal, status: body.p_status } : proposal);
			return route.fulfill({ status: 204, body: "" });
		}
		return route.abort();
	});
	await page.goto(`/e2e/match-proposals.html?role=${role}`);
	await expect(page.locator("canvas")).toHaveCount(1);
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().magnets.size)).toBe(10);
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().scope)).not.toBeNull();
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().loading)).toBe(false);
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

async function cards(page: Page) {
	return page.evaluate(() => window.proposalTest.scene().entities.filter((view) => view.kind === "card" && view.source.kind === "proposal"));
}

async function pressFooter(page: Page, index = 0, reject = false) {
	await expect.poll(async () => (await cards(page)).length).toBeGreaterThan(index);
	const card = (await cards(page))[index];
	const controls = cardControls(card.appearance.showUnconfirm, card.appearance.dashed);
	const rect = reject ? controls.unconfirm! : controls.main;
	const canvas = (await page.locator("canvas").boundingBox())!;
	const scale = await page.evaluate(() => window.proposalTest.board.getState().scale);
	await page.mouse.click(canvas.x + (card.point.x + rect.x + rect.width / 2) * scale,
		canvas.y + (card.point.y + rect.y + rect.height / 2) * scale);
}

const proposal: MatchProposal = { id: uid(200), session_id: 1, created_by: uid(2), creator_name: "민수", player_ids: [uid(2), uid(3)],
	player_names: ["민수", "지수"], status: "pending", created_at: "2026-09-18T00:00:00Z" };

test("member groups 1–4 and sees the sent dashed group at the same location", async ({ page }) => {
	const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
	const writes = await setup(page);
	await expect(page.getByRole("button", { name: "보기 전용", exact: true })).toHaveCount(0);
	await expect(page.locator(".proposal-dock, .proposal-sheet")).toHaveCount(0);
	await drag(page, 2);
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().groups[0]?.playerIds.length)).toBe(1);
	for (const id of [3, 4, 5, 6]) {
		await drag(page, id, await page.evaluate(() => window.proposalTest.proposals.getState().groups[0].anchor));
	}
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().groups[0]?.playerIds.length)).toBe(4);
	expect(writes).toEqual([]);
	const before = (await cards(page))[0];
	expect(before.appearance).toMatchObject({ ctaLabel: "매칭 제안", showUnconfirm: false });
	await pressFooter(page);
	await expect.poll(() => writes.length).toBe(1);
	await expect.poll(async () => (await cards(page))[0]?.appearance.dashed).toBe(true);
	const after = (await cards(page))[0];
	expect(after.point).toEqual(before.point);
	expect(after.members).toHaveLength(4);
	expect(after.appearance.ctaLabel).toBe("제안 취소");
	expect(await page.evaluate(() => ({ drafts: window.proposalTest.board.getState().drafts.size, reservations: window.proposalTest.board.getState().reservations.size }))).toEqual({ drafts: 0, reservations: 0 });
	expect(errors).toEqual([]);
	await pressFooter(page);
	await expect.poll(async () => (await cards(page)).length).toBe(0);
});

test("failed sends and rejections retain the group for retry", async ({ page }) => {
	await setup(page, "member", { failSend: true });
	await drag(page, 2);
	await pressFooter(page);
	await expect(page.getByText("제안을 보내지 못했어요. 묶음은 그대로 있으니 다시 눌러주세요.")).toBeVisible();
	expect(await page.evaluate(() => window.proposalTest.proposals.getState().groups[0].playerIds)).toEqual([uid(2)]);
	await page.unrouteAll();
	await setup(page, "admin", { failResolve: true, server: { proposals: [proposal] } });
	await pressFooter(page, 0, true);
	await expect(page.getByText("처리하지 못했어요. 다시 눌러주세요.")).toBeVisible();
	expect((await cards(page))[0].appearance.dashed).toBe(true);
});

test("admin reviews then rejects with X; author loses the same group after refresh", async ({ page, context }) => {
	const server = { proposals: [proposal] };
	const author = await context.newPage();
	await setup(author, "member", { server });
	await expect.poll(async () => (await cards(author)).length).toBe(1);
	await setup(page, "admin", { server });
	await expect(page.getByRole("button", { name: "보기 전용", exact: true })).toBeVisible();
	await expect.poll(async () => (await cards(page))[0]?.appearance.showUnconfirm).toBe(true);
	await pressFooter(page);
	await expect.poll(async () => (await cards(page))[0]?.appearance.ctaLabel).toBe("운영진 확인");
	await pressFooter(page, 0, true);
	await expect.poll(async () => (await cards(page)).length).toBe(0);
	expect(server.proposals[0].status).toBe("rejected");
	await author.bringToFront();
	await author.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect.poll(async () => (await cards(author)).length).toBe(0);
	await author.close();
});

test("other members never see proposal groups even from stale data", async ({ page }) => {
	await setup(page, "other", { server: { proposals: [proposal] } });
	expect(await cards(page)).toEqual([]);
	await page.evaluate((item) => window.proposalTest.proposals.setState({ proposals: [item], anchors: new Map([[item.id, { x: 200, y: 250 }]]) }), proposal);
	expect(await cards(page)).toEqual([]);
});

test("arrange repositions both draft and sent proposals locally", async ({ page }) => {
	const writes = await setup(page, "member", { server: { proposals: [proposal] } });
	await expect.poll(async () => (await cards(page)).length).toBe(1);
	const canvas = (await page.locator("canvas").boundingBox())!;
	const original = (await cards(page))[0];
	const scale = await page.evaluate(() => window.proposalTest.board.getState().scale);
	await page.mouse.move(canvas.x + original.point.x * scale, canvas.y + original.point.y * scale);
	await page.mouse.down();
	await page.mouse.move(canvas.x + 460 * scale, canvas.y + 330 * scale, { steps: 8 });
	await page.mouse.up();
	await expect.poll(async () => (await cards(page))[0].point.x).toBe(460);
	await drag(page, 4, { x: 650, y: 400 });
	const before = (await cards(page)).map((card) => card.point);
	expect(before).toHaveLength(2);
	await page.getByRole("button", { name: "정렬", exact: true }).click();
	await expect.poll(async () => (await cards(page)).map((card) => card.point)).not.toEqual(before);
	const after = await cards(page);
	expect(after[0].point.y).toBe(after[1].point.y);
	expect(Math.abs(after[0].point.x - after[1].point.x)).toBeGreaterThan(158);
	expect(writes).toEqual([]);
	expect(await page.evaluate(() => window.proposalTest.board.getState().drafts.size)).toBe(0);
});

for (const [role, width, height] of [["member", 390, 844], ["admin", 390, 844], ["admin", 1280, 800]] as const) {
	test(`${role} proposal groups at ${width}px`, async ({ page }, testInfo) => {
		const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
		await page.setViewportSize({ width, height });
		await setup(page, role, { server: { proposals: [proposal] } });
		await expect.poll(async () => (await cards(page))[0]?.appearance.dashed).toBe(true);
		await page.getByRole("button", { name: "정렬", exact: true }).click();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await expect.poll(() => page.evaluate(() => {
			const scene = window.proposalTest.scene();
			const group = scene.entities.find((view) => view.kind === "card" && view.source.kind === "proposal")!;
			return scene.entities.filter((view) => view.kind === "magnet").every((view) => view.point.y > group.point.y + 149);
		})).toBe(true);
		await page.evaluate(() => new Promise<void>((resolve) => {
			let frames = 0;
			const tick = () => { if (++frames >= 20) resolve(); else requestAnimationFrame(tick); };
			requestAnimationFrame(tick);
		}));
		await page.screenshot({ path: testInfo.outputPath(`${role}-${width}-groups.png`) });
		await page.evaluate(() => document.documentElement.classList.add("dark"));
		await page.screenshot({ path: testInfo.outputPath(`${role}-${width}-groups-dark.png`) });
		expect(errors).toEqual([]);
	});
}
