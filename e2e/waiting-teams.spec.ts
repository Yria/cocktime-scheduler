import { expect, test } from "@playwright/test";
import type { BoardTestApi } from "./board";
import { cardControls } from "../src/lib/board/pixi/cardControls";

declare global { interface Window { boardTest: BoardTestApi } }

for (const width of [390, 1280]) test(`waiting places fill on completion and keep empty courts usable at ${width}px`, async ({ page }, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	await page.route("https://**/*", route => route.abort());
	await page.setViewportSize({ width, height: 900 });
	await page.goto("/e2e/board.html?responsive=1");
	await expect.poll(() => page.evaluate(() => window.boardTest.renders)).toBeGreaterThan(0);
	await page.evaluate(width => {
		const { board, session } = window.boardTest;
		const players = [...session.getState().sessionPlayers.values()].map((p, i) => ({ ...p, name: `선수 ${i + 1}`, gender: "M" as const, gameCount: 0, skills: { grade: 5 }, status: "waiting" as const }));
		session.setState({ sessionPlayers: new Map(players.map(p => [p.id, p])), restingIds: [], groupHistory: [], lastGameType: {},
			courts: [{ id: 1, match: { id: "live", courtId: 1, gameType: "남복", teamA: ["p0", "p1"], teamB: ["p2", "p3"], startedAt: new Date().toISOString() } }, { id: 2, match: null }],
			handleComplete: async courtId => {
				const ss = session.getState(), match = ss.courts.find(c => c.id === courtId)?.match;
				if (!match) return;
				const ids = [...match.teamA, ...match.teamB];
				session.setState({ courts: ss.courts.map(c => c.id === courtId ? { ...c, match: null } : c),
					groupHistory: [...ss.groupHistory, { matchId: match.id, members: ids, completedAt: new Date().toISOString() }],
					sessionPlayers: new Map([...ss.sessionPlayers].map(([id, p]) => [id, ids.includes(id) ? { ...p, gameCount: p.gameCount + 1, waitSince: new Date().toISOString() } : p])) });
			} });
		board.getState().reset();
		board.getState().setStageSize(width, 900);
		board.getState().initializeFromPool(players);
		board.getState().ensureCourtGroups();
		board.getState().commitTeammates({ newTeam: true }, ["p4", "p5", "p6", "p7"]);
		board.getState().autoFillTarget({ newTeam: true });
		board.getState().autoFillTarget({ newTeam: true });
		board.getState().setScale(width < 600 ? 0.72 : 1);
		board.getState().rearrangeAll(width / board.getState().scale, 900 / board.getState().scale);
	}, width);
	const waiting = () => page.evaluate(() => [...window.boardTest.board.getState().drafts.values()].filter(t => t.waitForCompletion));
	await expect.poll(async () => (await waiting()).length).toBe(2);
	const before = await page.evaluate(() => window.boardTest.scene().entities.filter(e => e.kind === "card").map(e => ({ key: e.key, waiting: e.waitingSlots, empty: e.emptySlots, cta: [e.appearance.ctaLabel, e.appearance.ctaEnabled] })));
	expect(before.find(e => e.key === "team:court-2")?.waiting).toBeUndefined();
	expect(before.filter(e => e.waiting?.length === 2).map(e => e.cta)).toEqual([["완료 후 채움", false], ["완료 후 채움", false]]);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.waitForTimeout(200);
	await page.screenshot({ path: testInfo.outputPath(`waiting-${width}.png`) });
	const court = await page.evaluate(() => {
		const card = window.boardTest.scene().entities.find(e => e.kind === "card" && e.source.kind === "court");
		if (!card || card.kind !== "card") throw new Error("Missing court");
		return { point: card.point, appearance: card.appearance, scale: window.boardTest.board.getState().scale };
	});
	const control = cardControls(court.appearance.showUnconfirm).main;
	await page.mouse.click((court.point.x + control.x + control.width / 2) * court.scale, (court.point.y + control.y + control.height / 2) * court.scale);
	await expect.poll(async () => (await waiting()).length).toBe(0);
	const filled = await page.evaluate(() => [...window.boardTest.board.getState().drafts.values()].filter(t => t.courtId == null));
	expect(filled.map(t => t.anchorMemberIds.length)).toEqual([4, 4, 4]);
	expect(filled.slice(1).map(t => t.anchorMemberIds.filter(id => ["p0", "p1", "p2", "p3"].includes(id)).length)).toEqual([2, 2]);
	expect(new Set(filled.flatMap(t => t.anchorMemberIds)).size).toBe(12);
	await page.waitForTimeout(200);
	await page.screenshot({ path: testInfo.outputPath(`filled-${width}.png`) });
	// Separate starvation case: four people in two waiting teams, no free players.
	await page.evaluate(() => {
		const { board, session } = window.boardTest;
		for (const team of [...board.getState().drafts.values()]) if (team.courtId == null) board.getState().dismissTeam(team.id);
		session.setState(s => ({ sessionPlayers: new Map([...s.sessionPlayers].map(([id, p]) => [id, { ...p, status: ["p0", "p1", "p2", "p3"].includes(id) ? "waiting" : "resting" }])) }));
		board.getState().commitTeammates({ newTeam: true }, ["p0", "p1"], { waitForCompletion: true });
		board.getState().commitTeammates({ newTeam: true }, ["p2", "p3"], { waitForCompletion: true });
		board.getState().autoFillTeam("court-2");
	});
	expect(await page.evaluate(() => window.boardTest.board.getState().drafts.get("court-2")?.anchorMemberIds.length)).toBe(4);
	expect(errors).toEqual([]);
});
