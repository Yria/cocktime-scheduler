import { test, expect, type Page } from "@playwright/test";
import type { ProposalTestApi } from "./match-proposals";
import type { MatchProposal } from "../src/lib/supabase/matchProposals";
import type { BoardDraftsPayload } from "../src/types/board";
import { cardControls } from "../src/lib/board/pixi/cardControls";

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
	await page.goto("/e2e/match-proposals.html?role=admin&autofill=true");
	await expect(page.locator("canvas")).toHaveCount(1);
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

async function pressCourt(page: Page, court: number) {
	const canvas = (await page.locator("canvas").boundingBox())!;
	const { point, appearance, scale } = await page.evaluate(id => {
		const card = window.proposalTest.scene().entities.find(item => item.key === `team:court-${id}`);
		if (!card || card.kind !== "card") throw new Error("Missing court");
		return { point: card.point, appearance: card.appearance, scale: window.proposalTest.board.getState().scale };
	}, court);
	const rect = cardControls(appearance.showUnconfirm || appearance.showEdit).main;
	await page.mouse.click(canvas.x + (point.x + rect.x + rect.width / 2) * scale, canvas.y + (point.y + rect.y + rect.height / 2) * scale);
}

for (const width of [390, 1280]) test(`persistent court groups and proposal overwrite at ${width}px`, async ({ page }, testInfo) => {
	await page.setViewportSize({ width, height: 900 });
	const transport = await setup(page);
	await expect(page.getByRole("button", { name: "새 팀", exact: true })).toHaveCount(0);
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
	await expect.poll(() => page.evaluate(() => window.proposalTest.board.getState().drafts.get("court-1")!.anchorMemberIds.length)).toBe(4);
	expect(await page.evaluate(() => [...window.proposalTest.board.getState().drafts.values()].map(team => ({ id: team.id, anchor: team.anchor })))).toEqual(before);
	await page.screenshot({ path: testInfo.outputPath(`courts-${width}-next-team.png`) });
	expect(transport.errors).toEqual([]);
});

test("empty courts remain visible and arrange only aligns nearby rows", async ({ page }) => {
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
	expect(await anchors()).toEqual([{ x: 610, y: 156 }, { x: 170, y: 156 }, { x: 610, y: 426 }, { x: 170, y: 426 }]);
	await page.getByRole("button", { name: "정렬", exact: true }).click();
	expect(await anchors()).toEqual([{ x: 610, y: 156 }, { x: 170, y: 156 }, { x: 610, y: 426 }, { x: 170, y: 426 }]);
});
