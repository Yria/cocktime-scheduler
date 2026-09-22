import { expect, test, type Page } from "@playwright/test";
import type { ProposalTestApi } from "./match-proposals";
import type { BoardDraftsPayload } from "../src/types/board";

declare global { interface Window { proposalTest: ProposalTestApi } }

for (const width of [390, 1280]) test(`server restores dragged courts and players after reload at ${width}px`, async ({ page, browser }, testInfo) => {
	let drafts: BoardDraftsPayload = { teams: [], reservations: [] };
	let version = 0, writes = 0, reads = 0;
	const errors: string[] = [];
	async function rendered(target: Page) {
		await expect(target.locator("canvas")).toBeVisible();
		await expect(target.getByText("보드 준비 중...")).toHaveCount(0);
		await target.evaluate(() => new Promise<void>(resolve => {
			let frames = 0; const tick = () => { if (++frames >= 20) resolve(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick);
		}));
	}
	async function connect(target: Page, role: string) {
		target.on("pageerror", error => errors.push(error.message));
		await target.setViewportSize({ width, height: 900 });
		await target.routeWebSocket("wss://**", socket => socket.close());
		await target.route("https://**/*", async route => {
			const url = route.request().url();
			if (url.includes("/rpc/load_session_state")) {
				reads++;
				return route.fulfill({ json: { board_drafts: drafts, board_drafts_version: version, court_count: 2 } });
			}
			if (url.includes("/rpc/board_save_drafts")) {
				const body = route.request().postDataJSON();
				expect(body.p_base_version).toBe(version);
				drafts = body.p_payload; writes++;
				return route.fulfill({ json: ++version });
			}
			if (url.includes("/match_proposals?") || url.includes("/members?")) return route.fulfill({ json: [] });
			return route.abort();
		});
		await target.goto(`/e2e/match-proposals.html?role=${role}&restore=true`);
		await expect(target.locator("canvas")).toHaveCount(1);
		await expect.poll(() => target.evaluate(() => window.proposalTest.board.getState().drafts.size)).toBe(2);
		await rendered(target);
	}
	await connect(page, "admin");
	await page.evaluate(async () => {
		const board = window.proposalTest.board.getState();
		board.commitBoardView({ scale: 0.4, cssWidth: innerWidth - 32, cssHeight: 800, userChanged: true });
		board.setTeamAnchor("court-1", 210, 240);
		board.setTeamAnchor("court-2", 600, 250);
		await window.proposalTest.flushDrafts();
	});
	// Real pointer drag: only the release commits the new position to the shared save path.
	const canvas = (await page.locator("canvas").boundingBox())!;
	await page.mouse.move(canvas.x + 210 * 0.4, canvas.y + 160 * 0.4);
	await page.mouse.down();
	await page.mouse.move(canvas.x + 280 * 0.4, canvas.y + 280 * 0.4, { steps: 12 });
	await page.mouse.up();
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.get("court-1")!.anchor.y)).toBeCloseTo(360, 0);
	await page.evaluate(async () => {
		window.proposalTest.board.getState().handleDrop("00000000-0000-0000-0000-000000000010", { x: 520, y: 820 });
		await window.proposalTest.flushDrafts();
	});
	expect(drafts.layout?.teams["court-1"]).toMatchObject({ x: 280, y: 360 });
	expect(drafts.layout?.magnets["00000000-0000-0000-0000-000000000010"]).toEqual({ x: 520, y: 820 });
	const saved = structuredClone(drafts.layout);
	const writesBeforeReload = writes;
	await page.reload();
	await rendered(page);
	const positions = (target: Page) => target.evaluate(() => {
		const state = window.proposalTest.board.getState();
		return { teams: Object.fromEntries([...state.drafts].map(([id, team]) => [id, team.anchor])),
			courts: Object.fromEntries(state.courtAnchors),
			magnets: Object.fromEntries([...state.magnets].map(([id, player]) => [id, { x: player.x, y: player.y }])) };
	});
	await expect.poll(() => positions(page)).toEqual({ teams: saved!.teams, courts: saved!.courts, magnets: saved!.magnets });
	await page.evaluate(() => window.proposalTest.flushDrafts());
	expect(writes).toBe(writesBeforeReload); // Initial pool/auto-fit/reset must not overwrite the server layout.
	await page.screenshot({ path: testInfo.outputPath(`restored-board-${width}.png`) });
	const otherContext = await browser.newContext({ baseURL: "http://127.0.0.1:4174" });
	try {
		const viewer = await otherContext.newPage();
		await connect(viewer, "member");
		await expect.poll(() => positions(viewer)).toEqual({ teams: saved!.teams, courts: saved!.courts, magnets: saved!.magnets });
		expect(await viewer.evaluate(() => window.proposalTest.board.getState().manualLayout)).toBe(true);
		await expect.poll(() => viewer.evaluate(() => {
			const state = window.proposalTest.board.getState();
			const canvas = document.querySelector("canvas")!.getBoundingClientRect();
			return [...state.drafts.values()].every(team => (team.anchor.x + 79) * state.scale <= canvas.width
				&& (team.anchor.y + 124) * state.scale <= canvas.height);
		})).toBe(true);
		expect(writes).toBe(writesBeforeReload);
	} finally { await otherContext.close(); }
	expect(reads).toBe(3);
	expect(errors).toEqual([]);
});
