import { test, expect, type Page } from "@playwright/test";
import type { ProposalTestApi } from "./match-proposals";
import type { MatchProposal } from "../src/lib/supabase/matchProposals";
import type { BoardDraftsPayload } from "../src/types/board";
import { groupGridAnchor } from "../src/lib/board/groupGrid";
import { cardControls } from "../src/lib/board/pixi/cardControls";
import { TEAM_READY_BG, TEAM_READY_STROKE } from "../src/lib/board/constants";

declare global { interface Window { proposalTest: ProposalTestApi } }
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function setup(page: Page) {
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	let drafts: BoardDraftsPayload = { teams: [], reservations: [] };
	let version = 0;
	let applications = 0;
	let proposals: MatchProposal[] = [];
	await page.routeWebSocket("wss://**", socket => socket.close());
	await page.route("https://**/*", async route => {
		const url = route.request().url();
		if (url.includes("/members?") && url.includes("user_roles")) return route.fulfill({ json: [] });
		if (url.includes("/match_proposals?")) return route.fulfill({ json: proposals });
		if (url.includes("/rpc/board_save_drafts")) {
			const body = route.request().postDataJSON();
			drafts = body.p_payload; version = body.p_base_version + 1;
			return route.fulfill({ json: version });
		}
		if (url.includes("/rpc/apply_match_proposal_to_group")) {
			applications++;
			proposals = [];
			const body = route.request().postDataJSON();
			expect(body.p_base_version).toBe(version);
			drafts = { ...drafts, teams: drafts.teams.map(team => team.id === body.p_team_id
				? { id: team.id, courtId: team.courtId, createdMs: team.createdMs, memberIds: [1, 2, 9, 10].map(uid), createdBy: "민수" } : team),
				reservations: drafts.reservations.filter(item => item.teamId !== body.p_team_id) };
			return route.fulfill({ json: { drafts, version: ++version, proposal: { id: body.p_id, status: "applied" } } });
		}
		return route.abort();
	});
	await page.goto("/e2e/match-proposals.html?role=admin");
	await expect(page.locator("canvas")).toHaveCount(1);
	await expect.poll(() => page.evaluate(() => [...window.proposalTest.board.getState().drafts.values()].map(team => team.anchorMemberIds.length))).toEqual([0, 0]);
	await page.waitForTimeout(300);
	await pressCourt(page, 1);
	await pressCourt(page, 2);
	await expect.poll(() => page.evaluate(() => [...window.proposalTest.board.getState().drafts.values()].map(team => team.anchorMemberIds.length))).toEqual([4, 4]);
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().loading)).toBe(false);
	return { errors, applications: () => applications, setProposals: (items: MatchProposal[]) => { proposals = items; } };
}

async function moveCard(page: Page, key: string, to: { x: number; y: number }) {
	const canvas = (await page.locator("canvas").boundingBox())!;
	const { point, scale } = await page.evaluate(key => {
		const card = window.proposalTest.scene().entities.find(item => item.key === key)!;
		return { point: card.point, scale: window.proposalTest.board.getState().scale };
	}, key);
	// Header area avoids player magnets and the footer controls.
	await page.mouse.move(canvas.x + point.x * scale, canvas.y + (point.y - 80) * scale);
	await page.mouse.down();
	await page.mouse.move(canvas.x + to.x * scale, canvas.y + (to.y - 80) * scale, { steps: 12 });
	await page.mouse.up();
	await page.waitForTimeout(350);
}

async function pressCard(page: Page, key: string) {
	const canvas = (await page.locator("canvas").boundingBox())!;
	const { point, appearance, scale } = await page.evaluate(key => {
		const card = window.proposalTest.scene().entities.find(item => item.key === key);
		if (!card || card.kind !== "card") throw new Error("Missing court");
		return { point: card.point, appearance: card.appearance, scale: window.proposalTest.board.getState().scale };
	}, key);
	const rect = cardControls(appearance.showUnconfirm || appearance.showEdit).main;
	await page.mouse.click(canvas.x + (point.x + rect.x + rect.width / 2) * scale, canvas.y + (point.y + rect.y + rect.height / 2) * scale);
}

const pressCourt = (page: Page, court: number) => pressCard(page, `team:court-${court}`);

for (const width of [390, 1280]) test(`overlapping magnets prepares a green next team at ${width}px`, async ({ page }, testInfo) => {
	await page.setViewportSize({ width, height: 900 });
	const transport = await setup(page);
	await page.evaluate(() => {
		const api = window.proposalTest;
		const original = [...api.session.getState().sessionPlayers.values()][0];
		const players = Array.from({ length: 16 }, (_, i) => ({ ...original, id: `next${i}`, playerId: `next${i}`, memberId: null,
			name: `선수${i + 1}`, gender: "M" as const, gameCount: 0 }));
		api.session.setState({ sessionPlayers: new Map(players.map(p => [p.id, p])),
			courts: [1, 2].map((id, i) => ({ id, match: { id: `live${id}`, courtId: id, gameType: "남복" as const,
				teamA: [`next${i * 4}`, `next${i * 4 + 1}`], teamB: [`next${i * 4 + 2}`, `next${i * 4 + 3}`], startedAt: new Date().toISOString() } })),
			handleComplete: async id => api.session.setState(s => ({ courts: s.courts.map(c => c.id === id ? { ...c, match: null } : c) })) });
	});
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().magnets.size)).toBe(16);
	await page.getByRole("button", { name: "정렬", exact: true }).click();
	const search = (await page.getByRole("button", { name: "회원 찾기", exact: true }).boundingBox())!;
	const create = page.getByRole("button", { name: "다음 팀 미리 매칭", exact: true });
	const plus = (await create.boundingBox())!;
	expect(plus.x).toBe(search.x);
	expect(plus.y + plus.height).toBeLessThan(search.y);
	expect(plus.width).toBe(44);
	await expect(create).toHaveText("");
	const points = await page.evaluate(() => {
		const bs = window.proposalTest.board.getState();
		const canvas = document.querySelector("canvas")!.getBoundingClientRect();
		return ["next8", "next9"].map(id => { const m = bs.magnets.get(id)!;
			return { x: canvas.x + m.x * bs.scale, y: canvas.y + m.y * bs.scale }; });
	});
	await page.mouse.move(points[0].x, points[0].y);
	await page.mouse.down();
	await page.mouse.move(points[1].x, points[1].y, { steps: 12 });
	await page.mouse.up();
	const queued = () => page.evaluate(() => [...window.proposalTest.board.getState().drafts.values()].filter(t => t.courtId == null));
	await expect.poll(async () => (await queued()).map(t => t.anchorMemberIds)).toEqual([["next8", "next9"]]);
	const first = (await queued())[0];
	expect(first.anchor).toEqual(groupGridAnchor(2));
	await pressCard(page, `team:${first.id}`); // Existing automatic matching completes the dragged pair.
	await expect.poll(async () => (await queued())[0]?.anchorMemberIds.length).toBe(4);
	const prepared = (await queued())[0];
	expect(prepared.anchor).toEqual(first.anchor);
	expect(await page.evaluate(id => {
		const card = window.proposalTest.scene().entities.find(entity => entity.key === `team:${id}`);
		return card?.kind === "card" ? card.appearance : null;
	}, first.id)).toMatchObject({ fill: TEAM_READY_BG, stroke: TEAM_READY_STROKE, label: expect.stringContaining("다음 팀 1") });
	await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	await page.screenshot({ path: testInfo.outputPath(`green-next-team-${width}.png`) });
	await pressCourt(page, 1);
	await expect.poll(() => page.evaluate(() => window.proposalTest.session.getState().courts[0].match)).toBeNull();
	await page.waitForTimeout(300);
	expect(await page.evaluate(() => window.proposalTest.board.getState().drafts.get("court-1")?.anchorMemberIds)).toEqual([]);
	expect((await queued())[0].anchorMemberIds).toEqual(prepared.anchorMemberIds);
	await pressCourt(page, 1); // Explicit matching consumes the oldest prepared team.
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.get("court-1")?.anchorMemberIds)).toEqual(prepared.anchorMemberIds);
	expect(await page.evaluate(id => window.proposalTest.board.getState().drafts.has(id), first.id)).toBe(false);
	expect(transport.errors).toEqual([]);
});

for (const width of [390, 1280]) test(`persistent court groups and proposal overwrite at ${width}px`, async ({ page }, testInfo) => {
	await page.setViewportSize({ width, height: 900 });
	const transport = await setup(page);
	await expect(page.getByRole("button", { name: "다음 팀 미리 매칭", exact: true })).toBeVisible();
	transport.setProposals([{ id: uid(200), session_id: 1, created_by: uid(2), creator_name: "민수",
		player_ids: [1, 2, 9, 10].map(uid), player_names: ["운영진", "민수", "하늘", "예진"],
		status: "pending", created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" }]);
	await page.evaluate(ids => {
		const api = window.proposalTest;
		api.board.getState().dismissTeam("court-1"); api.board.getState().dismissTeam("court-2");
		api.board.getState().commitTeammates({ teamId: "court-1" }, ids.slice(0, 4));
		api.board.getState().commitTeammates({ teamId: "court-2" }, ids.slice(4, 8));
		api.proposals.setState({ proposals: [{ id: "00000000-0000-0000-0000-000000000200", session_id: 1,
			created_by: ids[1], creator_name: "민수", player_ids: [ids[0], ids[1], ids[8], ids[9]],
			player_names: ["운영진", "민수", "하늘", "예진"], status: "pending", created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" }] });
	}, Array.from({ length: 10 }, (_, i) => uid(i + 1)));
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().anchors.size)).toBe(1);
	await page.waitForTimeout(400);
	const before = await page.evaluate(() => [...window.proposalTest.board.getState().drafts.values()].map(team => ({ id: team.id, anchor: team.anchor })));
	await page.screenshot({ path: testInfo.outputPath(`courts-${width}-before.png`) });
	await moveCard(page, "proposal:00000000-0000-0000-0000-000000000200", before[0].anchor);
	await expect.poll(() => transport.applications()).toBe(1);
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.get("court-1")!.anchorMemberIds)).toEqual([1, 2, 9, 10].map(uid));
	expect(await page.evaluate(() => [...window.proposalTest.board.getState().drafts.values()].map(team => ({ id: team.id, anchor: team.anchor })))).toEqual(before);
	expect(await page.evaluate(() => window.proposalTest.session.getState().courts.every(court => !court.match))).toBe(true);
	await page.screenshot({ path: testInfo.outputPath(`courts-${width}-applied.png`) });
	// Exercise the real start/complete board actions and canvas hit testing; isolate only session transport.
	await page.evaluate(() => {
		const api = window.proposalTest;
		api.session.setState({ handleAssign: async (team, courtId) => {
			api.session.setState(s => ({ courts: s.courts.map(court => court.id === courtId ? { ...court, match: {
				id: "test-match", courtId: court.id, gameType: team.gameType, teamA: team.teamA, teamB: team.teamB, startedAt: new Date().toISOString(),
			} } : court) }));
		}, handleComplete: async courtId => {
			api.session.setState(s => ({ courts: s.courts.map(court => court.id === courtId ? { ...court, match: null } : court) }));
		} });
	});
	await pressCourt(page, 1);
	await expect.poll(() => page.evaluate(() => window.proposalTest.session.getState().courts[0].match?.id)).toBe("test-match");
	await page.waitForTimeout(300);
	const blockedProposal: MatchProposal = { id: uid(201), session_id: 1, created_by: uid(2), creator_name: "민수",
		player_ids: [3, 4, 5, 6].map(uid), player_names: ["지수", "현우", "수빈", "지훈"], status: "pending",
		created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" };
	transport.setProposals([blockedProposal]);
	await page.evaluate(proposal => window.proposalTest.proposals.setState({ proposals: [proposal] }), blockedProposal);
	await expect.poll(() => page.evaluate(() => window.proposalTest.proposals.getState().anchors.size)).toBe(1);
	await page.waitForTimeout(350);
	await moveCard(page, `proposal:${blockedProposal.id}`, before[0].anchor);
	await expect(page.getByText("경기 시작 전인 코트 그룹에만 제안을 넣을 수 있어요")).toBeVisible();
	expect(transport.applications()).toBe(1);
	expect(await page.evaluate(() => window.proposalTest.session.getState().courts[0].match?.id)).toBe("test-match");
	transport.setProposals([]);
	await page.evaluate(() => window.proposalTest.proposals.setState({ proposals: [] }));
	await pressCourt(page, 1);
	await expect.poll(() => page.evaluate(() => window.proposalTest.session.getState().courts[0].match)).toBeNull();
	await page.waitForTimeout(300);
	expect(await page.evaluate(() => window.proposalTest.board.getState().drafts.get("court-1")!.anchorMemberIds)).toEqual([]);
	await page.screenshot({ path: testInfo.outputPath(`courts-${width}-completed-empty.png`) });
	await pressCourt(page, 1);
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.get("court-1")!.anchorMemberIds.length)).toBe(4);
	expect(await page.evaluate(() => [...window.proposalTest.board.getState().drafts.values()].map(team => ({ id: team.id, anchor: team.anchor })))).toEqual(before);
	await page.screenshot({ path: testInfo.outputPath(`courts-${width}-next-team.png`) });
	expect(transport.errors).toEqual([]);
});

test("empty courts remain visible and arrange resets to three columns", async ({ page }) => {
	await setup(page);
	await page.evaluate(() => {
		const api = window.proposalTest;
		api.session.setState({ sessionPlayers: new Map(), courts: [1, 2, 3, 4].map(id => ({ id, match: null })) });
	});
	await expect.poll(() => page.evaluate(() => window.proposalTest.scene().entities.filter(item => item.kind === "card").length)).toBe(4);
	await page.evaluate(() => {
		const board = window.proposalTest.board.getState();
		board.setTeamAnchor("court-1", 610, 150); board.setTeamAnchor("court-2", 170, 162);
		board.setTeamAnchor("court-3", 610, 430); board.setTeamAnchor("court-4", 170, 422);
	});
	await page.getByRole("button", { name: "정렬", exact: true }).click();
	const anchors = () => page.evaluate(() => [...window.proposalTest.board.getState().drafts.values()].map(team => team.anchor));
	expect(await anchors()).toEqual([0, 1, 2, 3].map(groupGridAnchor));
	await page.getByRole("button", { name: "정렬", exact: true }).click();
	expect(await anchors()).toEqual([0, 1, 2, 3].map(groupGridAnchor));
});

test("removing empty court 3 keeps matches from courts 4 and 5 under their new numbers", async ({ page }, testInfo) => {
	const transport = await setup(page);
	await page.evaluate(async () => {
		const api = window.proposalTest;
		await api.flushDrafts();
		api.session.setState({ isEditor: false });
		const original = [...api.session.getState().sessionPlayers.values()][0];
		const players = Array.from({ length: 16 }, (_, i) => ({ ...original, id: `resize${i}`, playerId: `resize${i}`, memberId: null,
			name: `선수${i + 1}`, gender: "M" as const, gameCount: 0 }));
		api.session.setState({ sessionPlayers: new Map(players.map(p => [p.id, p])),
			courts: [1, 2, 3, 4, 5].map(id => ({ id, match: id === 3 ? null : {
				id: `match${id}`, courtId: id, gameType: "남복" as const,
				teamA: [`resize${(id < 3 ? id - 1 : id - 2) * 4}`, `resize${(id < 3 ? id - 1 : id - 2) * 4 + 1}`] as [string, string],
				teamB: [`resize${(id < 3 ? id - 1 : id - 2) * 4 + 2}`, `resize${(id < 3 ? id - 1 : id - 2) * 4 + 3}`] as [string, string],
				startedAt: new Date().toISOString(),
			} })), boardDrafts: { teams: [1, 2, 3, 4, 5].map(courtId => ({ id: `court-${courtId}`, courtId, memberIds: [], createdMs: courtId })), reservations: [] } });
	});
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.size)).toBe(5);
	await page.evaluate(() => {
		const api = window.proposalTest;
		// The same atomic snapshot shape returned by load_session_state after the SQL trigger.
		api.session.setState(s => ({ courts: s.courts.filter(c => c.id !== 3).map((c, i) => ({ ...c, id: i + 1, match: c.match && { ...c.match, courtId: i + 1 } })),
			boardDrafts: { teams: [1, 2, 4, 5].map((old, i) => ({ id: `court-${old}`, courtId: i + 1, memberIds: [], createdMs: old })), reservations: [] } }));
	});
	await expect.poll(() => page.evaluate(() => [...window.proposalTest.board.getState().drafts.values()].map(t => [t.id, t.courtId]))).toEqual([["court-1", 1], ["court-2", 2], ["court-4", 3], ["court-5", 4]]);
	expect(await page.evaluate(() => window.proposalTest.session.getState().courts.map(c => [c.id, c.match?.id]))).toEqual([[1, "match1"], [2, "match2"], [3, "match4"], [4, "match5"]]);
	await page.getByRole("button", { name: "정렬", exact: true }).click();
	await page.screenshot({ path: testInfo.outputPath("renumbered-courts.png") });
	await page.evaluate(() => window.proposalTest.session.setState(s => ({ courts: [...s.courts, { id: 5, match: null }] })));
	await expect.poll(() => page.evaluate(() => [...window.proposalTest.board.getState().drafts.values()].map(t => t.courtId).sort())).toEqual([1, 2, 3, 4, 5]);
	expect(await page.evaluate(() => window.proposalTest.board.getState().drafts.get("court-5")?.courtId)).toBe(4);
	expect(transport.errors).toEqual([]);
});

for (const width of [320, 390, 1280]) test(`prepared groups fill a three-column grid and move when matching is pressed at ${width}px`, async ({ page }, testInfo) => {
	await page.setViewportSize({ width, height: 900 });
	const transport = await setup(page);
	if (width === 1280) await page.setViewportSize({ width, height: 700 });
	await page.evaluate(() => {
		const api = window.proposalTest;
		const original = [...api.session.getState().sessionPlayers.values()][0];
		const players = Array.from({ length: 36 }, (_, i) => ({ ...original, id: `grid${i}`, playerId: `grid${i}`, memberId: null,
			name: `선수${i + 1}`, gender: "M" as const, gameCount: 0 }));
		api.board.getState().dismissTeam("court-1"); api.board.getState().dismissTeam("court-2");
		api.session.setState({ sessionPlayers: new Map(players.map(player => [player.id, player])),
			courts: [1, 2, 3].map((id, i) => ({ id, match: { id: `live${id}`, courtId: id, gameType: "남복" as const,
				teamA: [`grid${i * 4}`, `grid${i * 4 + 1}`], teamB: [`grid${i * 4 + 2}`, `grid${i * 4 + 3}`], startedAt: new Date().toISOString() } })),
			handleComplete: async id => api.session.setState(s => ({ courts: s.courts.map(c => c.id === id ? { ...c, match: null } : c) })) });
	});
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().magnets.size)).toBe(36);
	// Exercise the restored button and the existing picker instead of injecting the first draft.
	await page.getByRole("button", { name: "다음 팀 미리 매칭", exact: true }).click();
	await expect(page.getByRole("heading", { name: "추천 팀원" })).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath(`prepare-picker-${width}.png`) });
	await page.getByRole("button", { name: "자동편성", exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.size)).toBe(4);
	await page.getByRole("button", { name: "정렬", exact: true }).click();
	const first = await page.evaluate(() => [...window.proposalTest.board.getState().drafts.values()].find(t => t.courtId == null)!);
	for (let i = 0; i < 5; i++) await page.evaluate(() => window.proposalTest.board.getState().autoFillTarget({ newTeam: true }));
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.size)).toBe(9);
	const positions = () => page.evaluate(() => [...window.proposalTest.board.getState().drafts.values()].map(team => team.anchor));
	expect(await positions()).toEqual(Array.from({ length: 9 }, (_, i) => groupGridAnchor(i)));
	await page.getByRole("button", { name: "정렬", exact: true }).click();
	expect(await positions()).toEqual(Array.from({ length: 9 }, (_, i) => groupGridAnchor(i)));
	await expect.poll(() => page.evaluate(() => {
		const board = window.proposalTest.board.getState();
		const rect = document.querySelector("canvas")!.getBoundingClientRect();
		return [...board.drafts.values()].every(team => (team.anchor.x + 79) * board.scale <= rect.width && (team.anchor.y + 117) * board.scale <= rect.height);
	})).toBe(true);
	await page.screenshot({ path: testInfo.outputPath(`grid-${width}.png`) });
	await pressCourt(page, 2);
	await expect.poll(() => page.evaluate(() => window.proposalTest.session.getState().courts[1].match)).toBeNull();
	await page.waitForTimeout(300);
	expect(await page.evaluate(() => window.proposalTest.board.getState().drafts.get("court-2")?.anchorMemberIds)).toEqual([]);
	expect(await page.evaluate(id => window.proposalTest.board.getState().drafts.has(id), first.id)).toBe(true);
	await pressCourt(page, 2);
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.get("court-2")?.anchorMemberIds)).toEqual(first.anchorMemberIds);
	expect(await page.evaluate(id => window.proposalTest.board.getState().drafts.has(id), first.id)).toBe(false);
	expect(await page.evaluate(() => window.proposalTest.board.getState().drafts.get("court-2")?.anchor)).toEqual(groupGridAnchor(1));
	await page.screenshot({ path: testInfo.outputPath(`queue-assigned-${width}.png`) });
	const uiIssues = await page.evaluate(() => [...document.querySelectorAll("button")].flatMap(button => {
		const rect = button.getBoundingClientRect();
		if (!rect.width || !rect.height) return [];
		return !button.getAttribute("aria-label") && !button.textContent?.trim() ? ["unlabelled button"]
			: rect.left < 0 || rect.right > innerWidth + 1 ? [`overflow: ${button.getAttribute("aria-label")}`] : [];
	}));
	expect(uiIssues).toEqual([]);
	expect(transport.errors).toEqual([]);
});
