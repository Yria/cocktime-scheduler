import { expect, test, type Page } from "@playwright/test";
import type { ProposalTestApi } from "./match-proposals";
import type { MatchProposal } from "../src/lib/supabase/matchProposals";
import { cardControls } from "../src/lib/board/pixi/cardControls";

declare global { interface Window { proposalTest: ProposalTestApi } }
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function setup(page: Page, role = "member", options: { failSend?: boolean; failResolve?: boolean; adminIds?: string[]; server?: { proposals: MatchProposal[] } } = {}) {
	const writes: string[] = [];
	const server = options.server ?? { proposals: [] };
	await page.routeWebSocket("wss://**", (socket) => socket.close());
	await page.route("https://**/*", async (route) => {
		const request = route.request();
		const url = request.url();
		if (request.method() === "POST") writes.push(url);
		if (url.includes("/rest/v1/members?") && url.includes("user_roles")) return route.fulfill({ json: (options.adminIds ?? [uid(1), uid(9)]).map(id => ({ id, user_roles: [{ role: "admin" }] })) });
		if (url.includes("/rpc/board_save_drafts")) return route.fulfill({ json: (request.postDataJSON().p_base_version ?? 0) + 1 });
		if (url.includes("/rest/v1/match_proposals")) return route.fulfill({ json: server.proposals });
		if (url.includes("/rpc/create_match_proposal")) {
			if (options.failSend) return route.fulfill({ status: 503, json: { message: "offline" } });
			const body = request.postDataJSON();
			const authorId = role.startsWith("admin") ? uid(1) : role === "other" ? uid(3) : uid(2);
			const proposal: MatchProposal = { id: body.p_id, session_id: 1, created_by: authorId, creator_name: role.startsWith("admin") ? "운영진" : "민수", player_ids: body.p_player_ids,
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
		const scene = window.proposalTest.scene();
		for (const view of scene.entities) {
			if (view.kind === "magnet" && view.player.id === id) return { point: view.point, scale: s.scale };
			if (view.kind === "card") {
				const member = view.members.find((item) => item.player.id === id);
				if (member) return { point: { x: view.point.x + member.point.x, y: view.point.y + member.point.y }, scale: s.scale };
			}
		}
		throw new Error(`Missing rendered magnet ${id}`);
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

async function pair(page: Page, player: number, partner: number) {
	await drag(page, player, await page.evaluate((id) => window.proposalTest.board.getState().magnets.get(id)!, uid(partner)));
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

test("member starts with a pair, grows to four and sees the sent dashed group at the same location", async ({ page }) => {
	const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
	const writes = await setup(page);
	await expect(page.getByRole("button", { name: "보기 전용", exact: true })).toHaveCount(0);
	await expect(page.locator(".proposal-dock, .proposal-sheet")).toHaveCount(0);
	await pair(page, 2, 3);
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().groups[0]?.playerIds.length)).toBe(2);
	for (const id of [4, 5, 6]) {
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

for (const width of [390, 1280]) {
	test(`read-only administrator submits and withdraws a private proposal at ${width}px`, async ({ page, context }, testInfo) => {
		await page.setViewportSize({ width, height: 844 });
		const server = { proposals: [] as MatchProposal[] };
		const writes = await setup(page, "admin-viewer", { server });
		await expect(page.getByRole("button", { name: "보기 전용", exact: true })).toBeVisible();
		await pair(page, 2, 3);
		for (const id of [4, 5, 6]) await drag(page, id, (await cards(page))[0].point);
		expect((await cards(page))[0].members).toHaveLength(4);
		expect((await cards(page))[0].appearance).toMatchObject({ ctaLabel: "매칭 제안", ctaEnabled: true });
		expect(writes).toEqual([]);
		await pressFooter(page);
		await expect.poll(async () => (await cards(page))[0]?.appearance.dashed).toBe(true);
		expect(server.proposals[0].created_by).toBe(uid(1));
		expect((await cards(page))[0].appearance).toMatchObject({ ctaLabel: "제안 취소", ctaEnabled: true, showUnconfirm: false });
		expect(await page.evaluate(() => ({ editor: window.proposalTest.session.getState().isEditor,
			drafts: window.proposalTest.board.getState().drafts.size, reservations: window.proposalTest.board.getState().reservations.size })))
			.toEqual({ editor: false, drafts: 0, reservations: 0 });
		await page.screenshot({ path: testInfo.outputPath(`admin-viewer-${width}-proposal.png`) });

		const viewer = await context.newPage();
		await setup(viewer, "member", { server });
		expect(await cards(viewer)).toHaveLength(0);
		await viewer.close();
		const editor = await context.newPage();
		await setup(editor, "admin", { server });
		expect((await cards(editor))[0].appearance).toMatchObject({ ctaLabel: "경기시작", ctaEnabled: true });
		await editor.close();
		await page.bringToFront();
		await pressFooter(page);
		await expect.poll(async () => (await cards(page)).length).toBe(0);
		expect(server.proposals[0].status).toBe("withdrawn");
		expect(writes.map(url => url.split("/rpc/")[1])).toEqual(["create_match_proposal", "resolve_match_proposal"]);
	});
}

test("administrator switches between private proposals and shared editing without losing submitted proposals", async ({ page }) => {
	const server = { proposals: [] as MatchProposal[] };
	const writes = await setup(page, "admin-viewer", { server });
	await pair(page, 2, 3);
	await pressFooter(page);
	await expect.poll(async () => (await cards(page))[0]?.appearance.dashed).toBe(true);
	await pair(page, 4, 5);
	await expect.poll(async () => (await cards(page)).length).toBe(2);
	await page.evaluate(() => window.proposalTest.session.setState({ isEditor: true }));
	await expect.poll(async () => (await cards(page)).length).toBe(1);
	expect((await cards(page))[0].appearance).toMatchObject({ ctaLabel: "자동매칭", ctaEnabled: true });
	await pair(page, 4, 5);
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.size)).toBe(1);
	await page.evaluate(() => window.proposalTest.session.setState({ isEditor: false }));
	await expect.poll(async () => (await cards(page))[0]?.appearance.ctaLabel).toBe("제안 취소");
	await pair(page, 6, 7);
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().groups.length)).toBe(1);
	expect(server.proposals).toHaveLength(1);
	expect(writes.filter(url => url.includes("create_match_proposal"))).toHaveLength(1);
});

test("overlapping proposals render independent magnets and a started match disables the other proposal", async ({ page }, testInfo) => {
	const first = { ...proposal, player_ids: [2, 3, 4, 5].map(uid), player_names: ["민수", "지수", "현우", "수빈"] };
	const second = { ...proposal, id: uid(201), created_by: uid(1), creator_name: "운영진",
		player_ids: [2, 6, 7, 8].map(uid), player_names: ["민수", "지훈", "서연", "민재"] };
	const server = { proposals: [first, second] };
	const writes = await setup(page, "admin", { server });
	await page.getByRole("button", { name: "정렬", exact: true }).click();
	const groups = await cards(page);
	const magnets = groups.flatMap(group => group.members).filter(member => member.player.id === uid(2));
	expect(magnets).toHaveLength(2);
	expect(new Set(magnets.map(member => member.key)).size).toBe(2);
	expect(await page.evaluate(id => window.proposalTest.scene().entities.some(view => view.kind === "magnet" && view.player.id === id), uid(2))).toBe(false);
	await page.screenshot({ path: testInfo.outputPath("overlapping-proposals.png") });
	const firstIndex = groups.findIndex(group => group.source.kind === "proposal" && group.source.groupId === first.id);
	await pressFooter(page, firstIndex);
	await expect.poll(async () => (await cards(page)).length).toBe(1);
	await page.evaluate(ids => window.proposalTest.session.setState({ courts: [
		{ id: 1, match: { id: "started-proposal", courtId: 1, gameType: "혼합", teamA: [ids[0], ids[1]], teamB: [ids[2], ids[3]], startedAt: new Date().toISOString() } },
		{ id: 2, match: null },
	] }), first.player_ids);
	await expect.poll(async () => (await cards(page))[0]?.appearance.ctaEnabled).toBe(false);
	expect((await cards(page))[0].members.some(member => member.player.id === uid(2))).toBe(true);
	await pressFooter(page);
	expect(writes.filter(url => url.includes("start_match_proposal"))).toHaveLength(1);
	expect(server.proposals.find(item => item.id === second.id)?.status).toBe("pending");
});

test("failed sends and rejections retain the group for retry", async ({ page }) => {
	await setup(page, "member", { failSend: true });
	await pair(page, 2, 3);
	await pressFooter(page);
	await expect(page.getByText("제안을 보내지 못했어요. 묶음은 그대로 있으니 다시 눌러주세요.")).toBeVisible();
	expect(await page.evaluate(() => window.proposalTest.proposals.getState().groups[0].playerIds)).toEqual([uid(3), uid(2)]);
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
	await pair(page, 4, 5);
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

test("admin cannot copy a shared team member into a submitted proposal", async ({ page }) => {
	const server = { proposals: [proposal] };
	const writes = await setup(page, "admin", { server });
	await page.evaluate((ids) => {
		window.proposalTest.session.setState({ boardDrafts: { teams: [{ id: "shared", memberIds: ids, createdMs: 1 }], reservations: [] } });
	}, [uid(4), uid(5)]);
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.size)).toBe(1);
	await page.getByRole("button", { name: "정렬", exact: true }).click();
	const target = (await cards(page))[0];
	await drag(page, 4, { x: target.point.x - 35, y: target.point.y + 35 });
	expect(server.proposals[0].player_ids).toEqual([uid(2), uid(3)]);
	expect((await cards(page))[0].members.map((member) => member.player.id)).toEqual([uid(2), uid(3)]);
	expect(await page.evaluate(() => window.proposalTest.board.getState().drafts.get("shared")?.anchorMemberIds)).toEqual([uid(4), uid(5)]);
	expect(writes.filter((url) => url.includes("edit_match_proposals"))).toEqual([]);
});

for (const [state, player] of [["resting", 2], ["cock-pending", 3]] as const) {
	test(`member pairing excludes ${state} ${player === 2 ? "source" : "partner"}`, async ({ page }) => {
		const writes = await setup(page);
		await page.evaluate(({ state, id }) => {
			const session = window.proposalTest.session;
			if (state === "resting") session.setState({ restingIds: [id] });
			else session.setState({ cockCheckEnabled: true, sessionPlayers: new Map(session.getState().sessionPlayers)
				.set(id, { ...session.getState().sessionPlayers.get(id)!, cockChecked: false }) });
		}, { state, id: uid(player) });
		await pair(page, 2, 3);
		expect(await cards(page)).toHaveLength(0);
		expect(writes).toEqual([]);
	});
}

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

test("a proposal containing the last administrator requires an explicit start exception", async ({ page }) => {
	const server = { proposals: [{ ...proposal, player_ids: [1, 2, 3, 4].map(uid), player_names: ["운영진", "민수", "지수", "현우"] }] };
	const writes = await setup(page, "admin", { server, adminIds: [uid(1)] });
	await expect.poll(async () => (await cards(page))[0]?.appearance.ctaLabel).toBe("교대 확인");
	await pressFooter(page);
	await expect(page.getByRole("button", { name: "교대까지 대기" })).toBeVisible();
	expect(writes.some(url => url.includes("start_match_proposal"))).toBe(false);
	await page.getByRole("button", { name: "교대까지 대기" }).click();
	await pressFooter(page);
	const request = page.waitForRequest(r => r.url().includes("start_match_proposal_with_admin_coverage"));
	await page.getByRole("button", { name: "이번 경기 시작" }).click();
	expect((await request).postDataJSON().p_allow_admin_absence).toBe(true);
	await expect.poll(async () => (await cards(page)).length).toBe(0);
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


for (const role of ["member", "admin", "other"]) {
	test(`${role} hides floor duplicates only for visible proposals and restores them on dismissal`, async ({ page }) => {
		const server = { proposals: [proposal] };
		await setup(page, role, { server });
		const floor = () => page.evaluate(() => window.proposalTest.scene().entities.filter((view) => view.kind === "magnet").map((view) => view.player.id));
		await expect.poll(floor).toHaveLength(role === "other" ? 10 : 8);
		if (role === "other") { expect(await floor()).toContain(uid(2)); return; }
		expect(await floor()).not.toContain(uid(2));
		await pressFooter(page, 0, role === "admin");
		await expect.poll(floor).toHaveLength(10);
		expect(await page.evaluate(() => window.proposalTest.board.getState().magnets.get("00000000-0000-0000-0000-000000000002")?.teamId)).toBeNull();
	});
}

for (const [role, width, height] of [["member", 390, 844], ["admin", 1280, 800]] as const) {
	test(`${role} locates a proposal member by initial consonants at ${width}px`, async ({ page }, testInfo) => {
		const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
		await page.setViewportSize({ width, height });
		const writes = await setup(page, role, { server: { proposals: [proposal] } });
		await page.getByRole("button", { name: "정렬", exact: true }).click();
		const canvas = (await page.locator("canvas").boundingBox())!;
		await page.mouse.dblclick(canvas.x + canvas.width / 2, canvas.y + canvas.height - 160, { delay: 90 });
		const dialog = page.getByRole("dialog", { name: "회원 찾기" });
		await expect(dialog).toBeVisible();
		const input = page.getByRole("searchbox", { name: "이름 또는 초성" });
		await expect(input).toBeFocused();
		await input.fill("없는회원"); await expect(dialog.getByText("일치하는 회원이 없어요.")).toBeVisible();
		await input.fill("ㅁㅅ");
		await expect(dialog.getByRole("button", { name: "민수 매칭 제안" })).toHaveCount(1);
		await page.screenshot({ path: testInfo.outputPath(`search-${width}.png`) });
		await dialog.getByRole("button", { name: "민수 매칭 제안" }).click();
		await expect(dialog).toHaveCount(0);
		await expect(page.getByRole("status").filter({ hasText: "민수 위치를 보드에 표시" })).toBeVisible();
		await page.evaluate(() => new Promise<void>((resolve) => {
			let frames = 0; const tick = () => { if (++frames >= 20) resolve(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick);
		}));
		await page.screenshot({ path: testInfo.outputPath(`located-${width}.png`) });
		const screenshot = await page.locator("canvas").screenshot();
		const yellowPixels = await page.evaluate(async (data) => {
			const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
			const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
			const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
			const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
			let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 220 && pixels[i + 1] > 190 && pixels[i + 2] < 130) count++;
			return count;
		}, screenshot.toString("base64"));
		expect(yellowPixels).toBeGreaterThan(50);
		await expect(page.getByRole("status").filter({ hasText: "민수 위치를 보드에 표시" })).toHaveCount(0, { timeout: 6000 });
		await page.getByRole("button", { name: "회원 찾기", exact: true }).click();
		await page.getByRole("searchbox").fill("수빈");
		await expect(page.getByRole("button", { name: "수빈 대기 중" })).toBeVisible();
		await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
		expect(writes.filter((url) => !url.includes("board_save_drafts"))).toEqual([]);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		expect(errors).toEqual([]);
	});
}

test("touch opens search; playing and waiting members remain findable with reduced motion", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
	await setup(page, "member");
	await page.evaluate((ids) => {
		document.documentElement.classList.add("dark");
		window.proposalTest.session.setState({ courts: [{ id: 1, match: { id: "search-match", courtId: 1, gameType: "혼복", teamA: [ids[0], ids[1]], teamB: [ids[2], ids[3]], startedAt: new Date().toISOString() } }] });
	}, [1,2,3,4].map(uid));
	const canvas = (await page.locator("canvas").boundingBox())!;
	const cdp = await page.context().newCDPSession(page);
	const points = [{ id: 1, x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height - 160 }];
	await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points });
	await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points });
	await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await expect(page.getByRole("dialog", { name: "회원 찾기" })).toBeVisible();
	await page.getByRole("searchbox").fill("ㅇㅇㅈ");
	await expect(page.getByRole("button", { name: "운영진 1번 코트 · 경기 중" })).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("search-dark-mobile.png") });
	await page.getByRole("searchbox").press("Enter");
	await expect(page.getByRole("status").filter({ hasText: "운영진 위치를 보드에 표시" })).toBeVisible();
	await page.getByRole("button", { name: "회원 찾기", exact: true }).click();
	await page.getByRole("searchbox").fill("수빈");
	await page.getByRole("searchbox").press("Enter");
	await expect(page.getByRole("status").filter({ hasText: "수빈 위치를 보드에 표시" })).toBeVisible();
	await page.evaluate(() => new Promise<void>((resolve) => {
		let frames = 0; const tick = () => { if (++frames >= 20) resolve(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick);
	}));
	await page.screenshot({ path: testInfo.outputPath("located-free-dark-mobile.png") });
	await cdp.detach();
});

for (const width of [390, 1280]) {
	test(`member drop into a shared empty slot never creates a singleton proposal at ${width}px`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width, height: 844 });
		const writes = await setup(page, "member");
		await page.evaluate((ids) => {
			window.proposalTest.session.setState({ boardDrafts: { teams: [{ id: "shared", memberIds: ids, createdMs: 1 }], reservations: [] } });
		}, [uid(2), uid(3)]);
		await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.size)).toBe(1);
		await page.getByRole("button", { name: "정렬", exact: true }).click();
		const target = await page.evaluate(() => {
			const view = window.proposalTest.scene().entities.find((entity) => entity.kind === "card" && entity.source.kind === "team");
			if (!view || view.kind !== "card") throw new Error("Missing shared team");
			return { x: view.point.x - 35, y: view.point.y + 35 };
		});
		const before = await page.evaluate((id) => window.proposalTest.board.getState().magnets.get(id), uid(4));
		await drag(page, 4, target);
		expect(await cards(page)).toHaveLength(0);
		expect(await page.evaluate((id) => window.proposalTest.board.getState().magnets.get(id), uid(4))).toEqual(before);
		expect(await page.evaluate(() => window.proposalTest.board.getState().drafts.get("shared")?.anchorMemberIds)).toEqual([uid(2), uid(3)]);
		expect(writes).toEqual([]);
		// Open space only moves the magnet. A new group requires another free magnet.
		const open = { x: width > 400 ? 450 : 250, y: 550 };
		await drag(page, 4, open);
		expect(await cards(page)).toHaveLength(0);
		expect(await page.evaluate((id) => window.proposalTest.board.getState().magnets.get(id), uid(4))).not.toEqual(before);
		await pair(page, 4, 5);
		await expect.poll(async () => (await cards(page))[0]?.appearance.label).toBe("매칭 제안 · 2/4");
		const local = (await cards(page))[0];
		await drag(page, 6, { x: local.point.x - 35, y: local.point.y + 35 });
		await expect.poll(async () => (await cards(page))[0]?.members.length).toBe(3);
		expect((await cards(page))[0].appearance.label).toBe("매칭 제안 · 3/4");
		// Shared team members cannot be copied into the private group.
		await drag(page, 2, { x: local.point.x + 35, y: local.point.y + 35 });
		expect((await cards(page))[0].members.map((member) => member.player.id)).toEqual([uid(5), uid(4), uid(6)]);
		expect(await page.evaluate(() => window.proposalTest.board.getState().drafts.get("shared")?.anchorMemberIds)).toEqual([uid(2), uid(3)]);
		expect(writes).toEqual([]);
		await page.screenshot({ path: testInfo.outputPath(`proposal-slot-guard-${width}.png`) });
	});
}
