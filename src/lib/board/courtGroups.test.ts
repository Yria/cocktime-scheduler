import { describe, it, expect } from "vitest";
import type { DraftTeam } from "../../types/board";
import { alignCourtGroups, reconcileCourtGroups } from "./courtGroups";

const team = (id: string, x: number, y: number): DraftTeam => ({ id, courtId: Number(id), anchor: { x, y }, anchorMemberIds: [], createdAt: 0 });

describe("gentle court alignment", () => {
	it("does not keep merging nearby rows on repeated clicks", () => {
		const teams = [team("1", 100, 150), team("2", 350, 174), team("3", 600, 175)];
		const before = structuredClone(teams);
		for (let i = 0; i < 5; i++) alignCourtGroups(teams);
		expect(teams).toEqual(before);
	});
	it("aligns a nearby column without changing order or creating overlap", () => {
		const teams = [team("1", 102, 150), team("2", 110, 420), team("3", 450, 162), team("4", 452, 410)];
		alignCourtGroups(teams);
		expect(teams.map(team => team.anchor)).toEqual([{ x: 106, y: 156 }, { x: 106, y: 415 }, { x: 451, y: 156 }, { x: 451, y: 415 }]);
		const once = structuredClone(teams);
		alignCourtGroups(teams);
		expect(teams).toEqual(once);
	});
	it("does not hide a legacy waiting roster inside an occupied court during migration", () => {
		const waiting = { ...team("old", 400, 420), courtId: undefined, anchorMemberIds: ["a", "b"] };
		const state = { drafts: new Map([[waiting.id, waiting]]), magnets: new Map(), reservations: new Map(), courtAnchors: new Map() };
		reconcileCourtGroups(state, [
			{ id: 1, match: { id: "live", courtId: 1, gameType: "남복", teamA: ["c", "d"], teamB: ["e", "f"], startedAt: "" } },
			{ id: 2, match: null },
		], 800);
		expect(state.drafts.get("old")).toMatchObject({ courtId: 2, anchorMemberIds: ["a", "b"], anchor: { x: 400, y: 420 } });
		expect(state.drafts.get("court-1")).toMatchObject({ courtId: 1, anchorMemberIds: [] });
	});
});
