import { expect, test, type Page } from "@playwright/test";
import type { BoardTestApi } from "./board";
import type { DraftTeam } from "../src/types/board";

declare global { interface Window { boardTest: BoardTestApi } }

test.beforeEach(async ({ page }) => {
	// Block backend/font traffic, but allow every Vite module on the local origin.
	await page.route("https://**/*", (route) => route.abort());
	await page.goto("/e2e/board.html");
	await expect(page.locator('canvas[data-board-renderer="pixi"]')).toHaveCount(1);
	await expect.poll(() => page.evaluate(() => window.boardTest.renders)).toBeGreaterThan(0);
});

async function frame(page: Page) {
	await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function touchInput(page: Page) {
	const session = await page.context().newCDPSession(page);
	return async (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", points: { id: number; x: number; y: number }[] = []) => {
		// Genuine browser touches exercise native pointer capture too; untrusted
		// dispatchEvent(pointerdown) does not create capturable active pointers.
		await session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
	};
}

async function setScale(page: Page, scale: number) {
	await page.evaluate((next) => window.boardTest.board.setState({ scale: next, userScale: null, stageW: 800 / next, stageH: 600 / next }), scale);
	await frame(page);
}

async function groupedFixture(page: Page) {
	await page.evaluate(() => {
		const { board, session } = window.boardTest;
		session.setState({ courts: [{ id: 1, match: { id: "m1", courtId: 1, gameType: "남복", teamA: ["p4", "p5"], teamB: ["p6", "p7"], startedAt: "2026-09-06T00:00:00Z" } }] });
		const magnets = new Map(board.getState().magnets);
		for (const [id, teamId] of [["p0", "T1"], ["p1", "T2"], ["p2", "T2"]]) {
			magnets.set(id, { ...magnets.get(id)!, teamId });
		}
		board.setState({
			magnets,
			drafts: new Map<string, DraftTeam>([
				["T1", { id: "T1", anchorMemberIds: ["p0"], anchor: { x: 180, y: 300 }, createdAt: 1, slots: { p0: 0, p4: 1 } }],
				["T2", { id: "T2", anchorMemberIds: ["p1", "p2"], anchor: { x: 430, y: 300 }, createdAt: 2, slots: { p1: 0, p2: 1 } }],
			]),
			reservations: new Map([["r1", { id: "r1", playerId: "p4", teamId: "T1", createdAt: 3 }]]),
			courtAnchors: new Map([[1, { x: 650, y: 300 }]]),
		});
	});
	await frame(page);
}

test("real two-finger pinch round trip commits manual zoom intent only at gesture end", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await setScale(page, 0.8);
	const touch = await touchInput(page);
	const frames = await page.evaluate(() => window.boardTest.renders);
	await touch("touchStart", [{ id: 1, x: 300, y: 400 }, { id: 2, x: 400, y: 400 }]);
	await touch("touchMove", [{ id: 1, x: 300, y: 400 }, { id: 2, x: 412.5, y: 400 }]);
	await frame(page);
	await expect.poll(() => page.evaluate(() => window.boardTest.renders)).toBeGreaterThan(frames);
	expect(await page.evaluate(() => ({ scale: window.boardTest.board.getState().scale, userScale: window.boardTest.board.getState().userScale }))).toEqual({ scale: 0.8, userScale: null });
	await touch("touchMove", [{ id: 1, x: 300, y: 400 }, { id: 2, x: 400, y: 400 }]);
	await touch("touchEnd");
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().userScale)).toBe(0.8);
	expect(await page.evaluate(() => window.boardTest.board.getState().scale)).toBe(0.8);
	expect(await page.evaluate(() => window.boardTest.clicks)).toEqual([]);
	expect(errors).toEqual([]);
});

test("second finger cancels a drag and touchcancel restores uncommitted zoom", async ({ page }) => {
	await setScale(page, 0.8);
	const touch = await touchInput(page);
	await touch("touchStart", [{ id: 1, x: 72, y: 80 }]);
	await touch("touchMove", [{ id: 1, x: 72, y: 160 }]);
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().dragInfo?.playerId)).toBe("p0");
	await touch("touchStart", [{ id: 1, x: 72, y: 160 }, { id: 2, x: 272, y: 160 }]);
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().dragInfo)).toBeNull();
	await touch("touchMove", [{ id: 1, x: 72, y: 160 }, { id: 2, x: 297, y: 160 }]);
	await frame(page);
	await touch("touchCancel");
	expect(await page.evaluate(() => {
		const state = window.boardTest.board.getState();
		return { point: state.magnets.get("p0"), scale: state.scale, userScale: state.userScale, hover: state.hoverTarget, drag: state.dragInfo };
	})).toEqual({ point: { playerId: "p0", teamId: null, x: 90, y: 100 }, scale: 0.8, userScale: null, hover: null, drag: null });
	// The next drag probes the restored *runtime* scale, not just store.scale.
	await page.mouse.move(72, 80);
	await page.mouse.down();
	await page.mouse.move(72, 280, { steps: 5 });
	await page.mouse.up();
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().magnets.get("p0")?.y)).toBe(350);
});

test("team frame drag preserves its grab offset and commits the parent anchor once released", async ({ page }) => {
	await groupedFixture(page);
	await page.mouse.move(135, 215);
	await page.mouse.down();
	await page.mouse.move(235, 305, { steps: 5 });
	expect(await page.evaluate(() => window.boardTest.board.getState().drafts.get("T1")?.anchor)).toEqual({ x: 180, y: 300 });
	await page.mouse.up();
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().drafts.get("T1")?.anchor)).toEqual({ x: 280, y: 390 });
	expect(await page.evaluate(() => window.boardTest.board.getState().drafts.get("T1")?.slots)).toEqual({ p0: 0, p4: 1 });
	expect(await page.evaluate(() => window.boardTest.board.getState().reservations.get("r1")?.teamId)).toBe("T1");
});

test("court frame drag commits only local placement, without altering the active match", async ({ page }) => {
	await groupedFixture(page);
	await page.mouse.move(605, 215);
	await page.mouse.down();
	await page.mouse.move(555, 315, { steps: 5 });
	expect(await page.evaluate(() => window.boardTest.board.getState().courtAnchors.get(1))).toEqual({ x: 650, y: 300 });
	await page.mouse.up();
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().courtAnchors.get(1))).toEqual({ x: 600, y: 400 });
	expect(await page.evaluate(() => window.boardTest.session.getState().courts[0].match)).toMatchObject({ id: "m1", teamA: ["p4", "p5"], teamB: ["p6", "p7"] });
});

test("playing drop needs an empty slot, while ghost transfer accepts the target card center", async ({ page }) => {
	await groupedFixture(page);
	// p5 is playing at court slot 1. Card center is inside T2 but outside all slots.
	await page.mouse.move(685, 265);
	await page.mouse.down();
	await page.mouse.move(430, 300, { steps: 6 });
	await page.mouse.up();
	expect(await page.evaluate(() => [...window.boardTest.board.getState().reservations.values()].map((r) => r.playerId))).toEqual(["p4"]);
	// Its original court position must remain hittable after the no-op snapback.
	await page.mouse.move(685, 265);
	await page.mouse.down();
	await page.mouse.move(395, 335, { steps: 6 });
	await page.mouse.up();
	await expect.poll(() => page.evaluate(() => [...window.boardTest.board.getState().reservations.values()].some((r) => r.playerId === "p5" && r.teamId === "T2"))).toBe(true);
	// Ghost p4 has a different source identity and retains the broader bounds rule.
	await page.mouse.move(215, 265);
	await page.mouse.down();
	await page.mouse.move(430, 300, { steps: 6 });
	await page.mouse.up();
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().reservations.get("r1")?.teamId)).toBe("T2");
	expect(await page.evaluate(() => window.boardTest.board.getState().drafts.has("T1"))).toBe(false);
	expect(await page.evaluate(() => window.boardTest.board.getState().magnets.get("p0")?.teamId)).toBeNull();
	expect(await page.evaluate(() => window.boardTest.session.getState().courts[0].match?.teamA)).toEqual(["p4", "p5"]);
});

test("viewer can visually drag a playing magnet but cannot create a reservation", async ({ page }) => {
	await groupedFixture(page);
	await page.evaluate(() => window.boardTest.session.setState({ isEditor: false }));
	await frame(page);
	await page.mouse.move(685, 265);
	await page.mouse.down();
	await page.mouse.move(395, 335, { steps: 6 });
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().dragInfo?.playerId)).toBe("p5");
	await page.mouse.up();
	expect(await page.evaluate(() => [...window.boardTest.board.getState().reservations.keys()])).toEqual(["r1"]);
	expect(await page.evaluate(() => window.boardTest.board.getState().dragInfo)).toBeNull();
	// A second grab at the original slot confirms the no-op restored its hit position.
	await page.mouse.move(685, 265);
	await page.mouse.down();
	await page.mouse.move(685, 315, { steps: 3 });
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().dragInfo?.playerId)).toBe("p5");
	await page.mouse.up();
});

test("remote source deletion during native drag clears preview and never resurrects the magnet", async ({ page }) => {
	await page.mouse.move(90, 100);
	await page.mouse.down();
	await page.mouse.move(90, 350, { steps: 5 });
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().dragInfo?.playerId)).toBe("p0");
	await page.evaluate(() => {
		const magnets = new Map(window.boardTest.board.getState().magnets);
		magnets.delete("p0");
		window.boardTest.board.setState({ magnets });
	});
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().dragInfo)).toBeNull();
	await page.mouse.move(200, 100, { steps: 3 });
	await page.mouse.up();
	expect(await page.evaluate(() => window.boardTest.board.getState().magnets.has("p0"))).toBe(false);
	expect(await page.evaluate(() => window.boardTest.board.getState().drafts.size)).toBe(0);
	expect(await page.evaluate(() => window.boardTest.board.getState().hoverTarget)).toBeNull();
});

test("losing editor permission cancels the current drop instead of reinterpreting it as a viewer move", async ({ page }) => {
	await page.mouse.move(90, 100);
	await page.mouse.down();
	await page.mouse.move(200, 100, { steps: 5 });
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().dragInfo?.playerId)).toBe("p0");
	await page.evaluate(() => window.boardTest.session.setState({ isEditor: false }));
	await expect.poll(() => page.evaluate(() => window.boardTest.board.getState().dragInfo)).toBeNull();
	await page.mouse.up();
	expect(await page.evaluate(() => window.boardTest.board.getState().magnets.get("p0"))).toEqual({ playerId: "p0", teamId: null, x: 90, y: 100 });
	expect(await page.evaluate(() => window.boardTest.board.getState().drafts.size)).toBe(0);
	expect(await page.evaluate(() => window.boardTest.board.getState().hoverTarget)).toBeNull();
});
