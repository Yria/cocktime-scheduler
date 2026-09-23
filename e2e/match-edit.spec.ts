import { expect, test, type Page } from "@playwright/test";
import type { ProposalTestApi } from "./match-proposals";
import { cardControls } from "../src/lib/board/pixi/cardControls";

declare global { interface Window { proposalTest: ProposalTestApi } }
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const names = ["운영진", "민수", "지수", "현우", "수빈", "지훈", "서연", "민재", "하늘", "예진"];

async function setup(page: Page) {
	const requests: Record<string, unknown>[] = [];
	const errors: string[] = [];
	const response = { fail: false };
	page.on("pageerror", error => errors.push(error.message));
	await page.routeWebSocket("wss://**", socket => socket.close());
	await page.route("https://**/*", async route => {
		const url = route.request().url();
		if (url.includes("/rpc/set_match_roster")) {
			const body = route.request().postDataJSON(); requests.push(body);
			await new Promise(resolve => setTimeout(resolve, 300));
			if (response.fail) return route.fulfill({ status: 503, json: { message: "offline" } });
			return route.fulfill({ json: [...body.p_removed_ids, ...body.p_added_ids].map((id: string) => {
				const i = Number(id.slice(-12)) - 1;
				return { id, player_id: id, member_id: id, name: names[i], gender: i % 2 ? "F" : "M", skills: { grade: 5 },
					status: body.p_added_ids.includes(id) ? "playing" : "waiting", game_count: i % 3, mixed_count: 0,
					wait_since: null, joined_at_match: 0, cock_checked: true, allow_mixed_single: false };
			}) });
		}
		if (url.includes("/rpc/board_save_drafts")) return route.fulfill({ json: route.request().postDataJSON().p_base_version + 1 });
		if (url.includes("/members?") || url.includes("/match_proposals?")) return route.fulfill({ json: [] });
		return route.abort();
	});
	await page.goto("/e2e/match-proposals.html?role=admin");
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().magnets.size)).toBe(10);
	await page.evaluate(ids => {
		const api = window.proposalTest;
		api.session.setState(s => ({ sessionPlayers: new Map([...s.sessionPlayers].map(([id, p]) => [id, { ...p, status: ids.includes(id) ? "playing" : "waiting" }])),
			courts: [{ id: 1, match: { id: "live-match", courtId: 1, gameType: "혼복", teamA: [ids[0], ids[1]], teamB: [ids[2], ids[3]], startedAt: "2026-09-23T00:00:00Z" } }, { id: 2, match: null }] }));
	}, [1, 2, 3, 4].map(uid));
	await page.getByRole("button", { name: "정렬", exact: true }).click();
	await page.waitForTimeout(300);
	return { requests, errors, response };
}

const court = (page: Page) => page.evaluate(() => {
	const view = window.proposalTest.scene().entities.find(v => v.kind === "card" && v.source.kind === "court" && v.source.courtId === 1);
	if (!view || view.kind !== "card") throw new Error("Missing court");
	return view;
});
const roster = (page: Page) => page.evaluate(() => {
	const match = window.proposalTest.session.getState().courts[0].match!;
	return [...match.teamA, ...match.teamB];
});
async function control(page: Page, cancel = false, touch = false) {
	const view = await court(page);
	const controls = cardControls(view.appearance.showUnconfirm);
	const rect = cancel ? controls.unconfirm! : controls.main;
	const box = (await page.locator("canvas").boundingBox())!;
	const scale = await page.evaluate(() => window.proposalTest.board.getState().scale);
	const x = box.x + (view.point.x + rect.x + rect.width / 2) * scale;
	const y = box.y + (view.point.y + rect.y + rect.height / 2) * scale;
	if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
}
async function replace(page: Page, id: number, slot: number, touch = false) {
	await page.waitForTimeout(260); // Finish the rendered position tween before picking a magnet.
	const points = await page.evaluate(({ id, slot }) => {
		const scene = window.proposalTest.scene(); const board = window.proposalTest.board.getState();
		const box = document.querySelector("canvas")!.getBoundingClientRect();
		const target = scene.entities.find(v => v.kind === "card" && v.source.kind === "court" && v.source.courtId === 1)!;
		let source;
		for (const view of scene.entities) {
			if (view.kind === "magnet" && view.player.id === id) source = view.point;
			if (view.kind === "card") {
				const member = view.members.find(m => m.player.id === id);
				if (member) source = { x: view.point.x + member.point.x, y: view.point.y + member.point.y };
			}
		}
		if (!source) throw new Error("Missing player");
		return [source, { x: target.point.x + (slot % 2 ? 35 : -35), y: target.point.y + (slot < 2 ? -35 : 35) }]
			.map(p => ({ x: box.x + p.x * board.scale, y: box.y + p.y * board.scale }));
	}, { id: uid(id), slot });
	if (touch) {
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, ...points[0] }] });
		for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1,
			x: points[0].x + (points[1].x - points[0].x) * i / 10, y: points[0].y + (points[1].y - points[0].y) * i / 10 }] });
		await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
		await cdp.detach();
	} else {
		await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
		await page.mouse.move(points[1].x, points[1].y, { steps: 10 }); await page.mouse.up();
	}
}

for (const mobile of [true, false]) test.describe(mobile ? "mobile inline roster" : "desktop inline roster", () => {
	test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: mobile, isMobile: mobile });
	for (const scale of [0.5, mobile ? 0.67 : 1]) test(`replace, cancel, save and swap sides directly at ${scale}x`, async ({ page }, testInfo) => {
		const transport = await setup(page);
		await page.evaluate(scale => {
			const box = document.querySelector("canvas")!.getBoundingClientRect();
			window.proposalTest.board.getState().commitBoardView({ scale, cssWidth: box.width, cssHeight: box.height });
		}, scale);
		const original = await roster(page);
		expect((await court(page)).appearance).toMatchObject({ ctaLabel: "경기완료", showUnconfirm: false });
		await replace(page, 5, 0, mobile);
		await expect.poll(async () => (await court(page)).appearance.ctaLabel).toBe("선수변경");
		expect((await court(page)).members.map(m => m.player.id)).toEqual([5, 2, 3, 4].map(uid));
		expect(await roster(page)).toEqual(original);
		expect(transport.requests).toHaveLength(0);
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await page.screenshot({ path: testInfo.outputPath("inline-roster-preview.png") });
		await control(page, true, mobile);
		await expect.poll(async () => (await court(page)).appearance.ctaLabel).toBe("경기완료");
		expect((await court(page)).members.map(m => m.player.id)).toEqual(original);
		expect(transport.requests).toHaveLength(0);
		await replace(page, 5, 0, mobile); await replace(page, 6, 3, mobile);
		await control(page, false, mobile);
		await expect.poll(async () => (await court(page)).appearance.ctaLabel).toBe("변경 중…");
		await control(page, false, mobile); // Duplicate click while saving must not complete the match.
		await expect.poll(() => roster(page)).toEqual([5, 2, 3, 6].map(uid));
		expect(transport.requests).toHaveLength(1);
		expect(transport.requests[0]).toMatchObject({ p_match_id: "live-match", p_removed_ids: [1, 4].map(uid), p_added_ids: [5, 6].map(uid) });
		await expect.poll(async () => (await court(page)).appearance.ctaLabel).toBe("경기완료");
		expect(await page.evaluate(() => window.proposalTest.session.getState().courts[0].match?.id)).toBe("live-match");
		expect(await page.evaluate(() => [...window.proposalTest.session.getState().sessionPlayers.values()].map(p => p.gameCount))).toEqual(Array.from({ length: 10 }, (_, i) => i % 3));
		// Pure team-A/team-B rearrangement is a real roster edit even with no added/removed players.
		await replace(page, 2, 2, mobile); await control(page, false, mobile);
		await expect.poll(() => roster(page)).toEqual([5, 3, 2, 6].map(uid));
		expect(transport.requests[1]).toMatchObject({ p_removed_ids: [], p_added_ids: [] });
		expect(transport.errors).toEqual([]);
	});
});

test("failed save retains the preview; remote roster change and permission loss clear it", async ({ page }) => {
	const transport = await setup(page);
	transport.response.fail = true;
	await replace(page, 5, 0); await control(page);
	await expect(page.getByText("선수 변경을 저장하지 못했어요. 다시 눌러 주세요")).toBeVisible();
	expect((await court(page)).appearance.ctaLabel).toBe("선수변경");
	expect(await roster(page)).toEqual([1, 2, 3, 4].map(uid));
	transport.response.fail = false;
	await control(page);
	await expect.poll(() => roster(page)).toEqual([5, 2, 3, 4].map(uid));
	await replace(page, 6, 1);
	await page.evaluate(id => window.proposalTest.session.setState(s => ({ courts: s.courts.map(c => c.id === 1 ? { ...c, match: { ...c.match!, teamB: [id, c.match!.teamB[1]] } } : c) })), uid(7));
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().matchEdits.size)).toBe(0);
	await replace(page, 6, 1);
	await page.evaluate(() => window.proposalTest.session.setState({ isEditor: false }));
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().matchEdits.size)).toBe(0);
	expect((await court(page)).appearance.showUnconfirm).toBe(false);
	expect(transport.requests).toHaveLength(2);
	expect(transport.errors).toEqual([]);
});

test("a prepared team member can replace a playing member; cancel preserves the source team", async ({ page }) => {
	const transport = await setup(page);
	await page.evaluate(ids => window.proposalTest.board.getState().commitTeammates({ teamId: "court-2" }, ids), [5, 6, 7, 8].map(uid));
	await replace(page, 5, 0);
	const sourceTeam = () => page.evaluate(() => {
		const view = window.proposalTest.scene().entities.find(v => v.kind === "card" && v.key === "team:court-2");
		if (!view || view.kind !== "card") throw new Error("Missing source team");
		return view;
	});
	expect((await sourceTeam()).members).toHaveLength(3);
	expect((await sourceTeam()).appearance).toMatchObject({ ctaLabel: "선수 변경 중", ctaEnabled: false });
	await control(page, true);
	expect((await sourceTeam()).members.map(m => m.player.id)).toEqual([5, 6, 7, 8].map(uid));
	expect(transport.requests).toHaveLength(0);
	await replace(page, 5, 0); await control(page);
	await expect.poll(() => roster(page)).toEqual([5, 2, 3, 4].map(uid));
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.get("court-2")!.anchorMemberIds)).toEqual([6, 7, 8].map(uid));
	expect(await page.evaluate(id => window.proposalTest.scene().entities.some(view => view.kind === "magnet" && view.player.id === id), uid(1))).toBe(true);
	expect(transport.errors).toEqual([]);
});
