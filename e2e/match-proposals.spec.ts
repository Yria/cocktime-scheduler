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
		if (url.includes("/rpc/board_save_drafts")) return route.fulfill({ json: (request.postDataJSON().p_base_version ?? 0) + 1 });
		if (url.includes("/rest/v1/match_proposals")) return route.fulfill({ json: server.proposals });
		if (url.includes("/rpc/create_match_proposal")) {
			if (options.failSend) return route.fulfill({ status: 503, json: { message: "offline" } });
			const body = request.postDataJSON();
			const proposal: MatchProposal = { id: body.p_id, session_id: 1, created_by: uid(2), creator_name: "민수", player_ids: body.p_player_ids,
				player_names: body.p_player_ids.map((id: string) => ["운영진", "민수", "지수", "현우", "수빈"][Number(id.slice(-2)) - 1]), status: "pending", created_at: "2026-09-18T00:00:00Z", updated_at: "2026-09-18T00:00:00Z" };
			server.proposals = [proposal, ...server.proposals];
			return route.fulfill({ json: proposal });
		}
		if (url.includes("/rpc/edit_match_proposals")) {
			const body = request.postDataJSON();
			const rows = body.p_updates.map((update: { id: string; player_ids: string[] }) => {
				const previous = server.proposals.find((item) => item.id === update.id)!;
				return { ...previous, player_ids: update.player_ids.length ? update.player_ids : previous.player_ids,
					player_names: update.player_ids.map((id) => `회원${Number(id.slice(-2))}`),
					status: update.player_ids.length ? "pending" : "rejected", updated_at: new Date().toISOString() };
			});
			server.proposals = [...rows, ...server.proposals.filter((item) => !rows.some((row: MatchProposal) => row.id === item.id))];
			return route.fulfill({ json: rows });
		}
		if (url.includes("/rpc/start_match_proposal")) {
			const body = request.postDataJSON();
			const row = { ...server.proposals.find((item) => item.id === body.p_id)!, status: "started" as const, match_id: body.p_match_id };
			server.proposals = server.proposals.map((item) => item.id === row.id ? row : item);
			return route.fulfill({ json: row });
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
	const controls = cardControls(card.appearance.showUnconfirm);
	const rect = reject ? controls.unconfirm! : controls.main;
	const canvas = (await page.locator("canvas").boundingBox())!;
	const scale = await page.evaluate(() => window.proposalTest.board.getState().scale);
	await page.mouse.click(canvas.x + (card.point.x + rect.x + rect.width / 2) * scale,
		canvas.y + (card.point.y + rect.y + rect.height / 2) * scale);
}

const proposal: MatchProposal = { id: uid(200), session_id: 1, created_by: uid(2), creator_name: "민수", player_ids: [uid(2), uid(3)],
	player_names: ["민수", "지수"], status: "pending", created_at: "2026-09-18T00:00:00Z", updated_at: "2026-09-18T00:00:00Z" };

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

test("admin rejects with X; author loses the same group after refresh", async ({ page, context }) => {
	const server = { proposals: [proposal] };
	const author = await context.newPage();
	await setup(author, "member", { server });
	await expect.poll(async () => (await cards(author)).length).toBe(1);
	await setup(page, "admin-viewer", { server });
	await expect(page.getByRole("button", { name: "보기 전용", exact: true })).toBeVisible();
	await expect.poll(async () => (await cards(page))[0]?.appearance.showUnconfirm).toBe(true);
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

test("admin adds and removes private members; author receives roster changes", async ({ page, context }) => {
	const sharedPayloads: unknown[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/rpc/board_save_drafts")) sharedPayloads.push(request.postDataJSON().p_payload);
	});
	const server = { proposals: [proposal] };
	const writes = await setup(page, "admin", { server });
	const author = await context.newPage();
	await setup(author, "member", { server });
	await page.bringToFront();
	const original = (await cards(page))[0];
	expect(original.members.every((member) => member.draggable)).toBe(true);
	await drag(page, 4, { x: original.point.x - 35, y: original.point.y + 35 });
	await expect.poll(() => server.proposals[0].player_ids.length).toBe(3);
	await expect.poll(async () => (await cards(page))[0].members.length).toBe(3);
	const group = (await cards(page))[0];
	const canvas = (await page.locator("canvas").boundingBox())!;
	const scale = await page.evaluate(() => window.proposalTest.board.getState().scale);
	const member = group.members[0];
	await page.mouse.move(canvas.x + (group.point.x + member.point.x) * scale, canvas.y + (group.point.y + member.point.y) * scale);
	await page.mouse.down();
	await page.mouse.move(canvas.x + 650 * scale, canvas.y + 430 * scale, { steps: 10 });
	await page.mouse.up();
	await expect.poll(() => server.proposals[0].player_ids).toEqual([uid(3), uid(4)]);
	await author.bringToFront();
	await author.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect.poll(async () => (await cards(author))[0]?.members.map((item) => item.player.id)).toEqual([uid(3), uid(4)]);
	expect((await cards(author))[0].members.every((item) => !item.draggable)).toBe(true);
	expect(writes.filter((url) => url.includes("edit_match_proposals"))).toHaveLength(2);
	for (const payload of sharedPayloads) expect(payload).toMatchObject({ teams: [], reservations: [] });
	expect(await page.evaluate(() => window.proposalTest.board.getState().drafts.size)).toBe(0);
	await author.close();
});

test("admin automatically fills four and starts directly; member keeps cancellation only", async ({ page, context }) => {
	const server = { proposals: [proposal] };
	const writes = await setup(page, "admin", { server });
	expect((await cards(page))[0].appearance.ctaLabel).toBe("자동매칭");
	await pressFooter(page);
	await expect.poll(async () => (await cards(page))[0]?.members.length).toBe(4);
	await expect.poll(async () => (await cards(page))[0]?.appearance.ctaLabel).toBe("경기시작");
	const author = await context.newPage();
	await setup(author, "member", { server });
	expect((await cards(author))[0].appearance.ctaLabel).toBe("제안 취소");
	await author.close();
	await page.bringToFront();
	await pressFooter(page);
	await expect.poll(async () => (await cards(page)).length).toBe(0);
	expect(writes.filter((url) => url.includes("start_match_proposal"))).toHaveLength(1);
	expect(server.proposals[0].status).toBe("started");
	expect(await page.evaluate(() => window.proposalTest.board.getState().drafts.size)).toBe(0);
});

test("admin without editor permission can reject but cannot edit or start", async ({ page }) => {
	const writes = await setup(page, "admin-viewer", { server: { proposals: [proposal] } });
	const group = (await cards(page))[0];
	expect(group.appearance).toMatchObject({ ctaEnabled: false, showUnconfirm: true });
	expect(group.members.every((item) => !item.draggable)).toBe(true);
	await pressFooter(page);
	expect(writes).toEqual([]);
	await pressFooter(page, 0, true);
	await expect.poll(async () => (await cards(page)).length).toBe(0);
});


test("playing court has footer editing left of completion on mobile", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await setup(page, "admin");
	await page.evaluate((ids) => {
		window.proposalTest.session.setState({ courts: [{ id: 1, match: { id: "test-match", courtId: 1, gameType: "혼복", teamA: [ids[0], ids[1]], teamB: [ids[2], ids[3]], startedAt: new Date().toISOString() } }, { id: 2, match: null }] });
	}, [1,2,3,4].map(uid));
	await page.getByRole("button", { name: "정렬", exact: true }).click();
	await page.evaluate(() => new Promise<void>((resolve) => {
		let frames = 0; const tick = () => { if (++frames >= 20) resolve(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick);
	}));
	const group = await page.evaluate(() => window.proposalTest.scene().entities.find((view) => view.kind === "card" && view.source.kind === "court"));
	if (!group || group.kind !== "card") throw new Error("Missing court");
	expect(group.appearance).toMatchObject({ showEdit: true, ctaLabel: "경기완료" });
	await page.screenshot({ path: testInfo.outputPath("court-footer-mobile.png") });
	const canvas = (await page.locator("canvas").boundingBox())!;
	const scale = await page.evaluate(() => window.proposalTest.board.getState().scale);
	const rect = cardControls(true).unconfirm!;
	await page.mouse.click(canvas.x + (group.point.x + rect.x + rect.width / 2) * scale, canvas.y + (group.point.y + rect.y + rect.height / 2) * scale);
	await expect(page.getByText("경기 수정 · 1번 코트", { exact: true })).toBeVisible();
});
