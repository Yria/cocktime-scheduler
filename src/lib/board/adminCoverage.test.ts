import { describe, expect, it } from "vitest";
import type { SessionPlayer } from "../../types";
import { adminCoverageDecision, availableAdminIds, coverageQueue, leavesNoAdmin, type CoverageInputs } from "./adminCoverage";

function fixture(): CoverageInputs {
	const players: SessionPlayer[] = Array.from({ length: 12 }, (_, i) => ({ id: String(i), memberId: `m${i}`, playerId: `m${i}`, name: `선수${i}`,
		gender: "M", skills: { grade: 5 }, status: "waiting", cockChecked: true, allowMixedSingle: false, gameCount: 0, mixedCount: 0, joinedAtMatch: 0, waitSince: null }));
	return { sessionPlayers: new Map(players.map(p => [p.id, p])), adminMemberIds: new Set(["m0", "m8"]), cockCheckEnabled: true,
		courts: [{ id: 1, match: { id: "busy", courtId: 1, gameType: "남복", teamA: ["8", "9"], teamB: ["10", "11"], startedAt: "" } }],
		drafts: new Map([ ["first", { id: "first", anchorMemberIds: ["0", "1", "2", "3"], createdAt: 10, confirmedMs: 10, anchor: { x: 0, y: 0 } }],
			["second", { id: "second", anchorMemberIds: ["4", "5", "6", "7"], createdAt: 20, confirmedMs: 20, anchor: { x: 0, y: 0 } }] ]),
		reservations: new Map(), magnets: new Map(players.map(p => [p.id, { playerId: p.id, teamId: +p.id < 4 ? "first" : +p.id < 8 ? "second" : null, x: 0, y: 0 }])) };
}
describe("administrator relay in the start queue", () => {
	it("defers the last administrator's group and selects the next ready group", () => {
		const s = fixture();
		expect(adminCoverageDecision(["0", "1", "2", "3"], s)).toMatchObject({ held: true, alternative: { key: "team:second" } });
		expect(leavesNoAdmin(["4", "5", "6", "7"], s)).toBe(false);
	});
	it("restores original priority when another administrator finishes, without moving the timestamp", () => {
		const s = fixture();
		const before = [...s.drafts.values()].map(t => t.confirmedMs);
		adminCoverageDecision(["0", "1", "2", "3"], s);
		s.courts = [];
		expect(coverageQueue(s).find(t => !leavesNoAdmin(t.ids, s))?.key).toBe("team:first");
		expect([...s.drafts.values()].map(t => t.confirmedMs)).toEqual(before);
	});
	it("holds the last administrator even without an alternative (including a sole administrator)", () => {
		const s = fixture(); s.drafts = new Map([["first", s.drafts.get("first")!]]); s.adminMemberIds = new Set(["m0"]);
		expect(adminCoverageDecision(["0", "1", "2", "3"], s)).toEqual({ held: true, alternative: undefined });
	});
	it("also holds a group containing both of the remaining administrators", () => {
		const s = fixture(); s.adminMemberIds = new Set(["m0", "m1"]);
		expect(leavesNoAdmin(["0", "1", "2", "3"], s)).toBe(true);
	});
	it("does not block ordinary groups if all administrators are already playing or absent", () => {
		const s = fixture(); s.adminMemberIds = new Set(["m8", "absent"]);
		expect(leavesNoAdmin(["0", "1", "2", "3"], s)).toBe(false);
	});
	it("counts resting staff as outside but excludes unchecked registrations", () => {
		const s = fixture(); s.courts = [];
		s.sessionPlayers.get("8")!.status = "resting";
		expect(leavesNoAdmin(["0", "1", "2", "3"], s)).toBe(false);
		s.sessionPlayers.get("8")!.cockChecked = false;
		expect(leavesNoAdmin(["0", "1", "2", "3"], s)).toBe(true);
		s.cockCheckEnabled = false;
		expect(leavesNoAdmin(["0", "1", "2", "3"], s)).toBe(false);
	});
	it("an unchecked administrator entering a game cannot bypass coverage", () => {
		const s = fixture(); s.adminMemberIds = new Set(["m0"]);
		s.sessionPlayers.get("0")!.cockChecked = false;
		expect(leavesNoAdmin(["0", "1", "2", "3"], s)).toBe(true);
	});
	it("uses courts and in-flight starts instead of stale player status", () => {
		const s = fixture(); s.courts = []; s.startingIds = new Set(["8", "9", "10", "11"]);
		expect(availableAdminIds(s)).toEqual(["0"]);
		expect(leavesNoAdmin(["0", "1", "2", "3"], s)).toBe(true);
	});
	it.each(["resting", "unchecked", "playing", "starting"])("does not offer an unavailable alternative: %s", state => {
		const s = fixture();
		if (state === "resting") s.sessionPlayers.get("4")!.status = "resting";
		if (state === "unchecked") s.sessionPlayers.get("4")!.cockChecked = false;
		if (state === "playing") s.courts[0].match!.teamA[1] = "4";
		if (state === "starting") s.startingIds = new Set(["4"]);
		expect(adminCoverageDecision(["0", "1", "2", "3"], s).alternative).toBeUndefined();
	});
	it("evaluates proposals without reserving their members, ignores closed or conflicting proposals", () => {
		const s = fixture(); s.drafts = new Map([["first", s.drafts.get("first")!]]);
		for (const id of ["4", "5", "6", "7"]) s.magnets.get(id)!.teamId = null;
		s.proposals = [{ id: "p", player_ids: ["4", "5", "6", "7"], status: "pending", created_at: "2026-09-18T00:00:00Z" }];
		expect(adminCoverageDecision(["0", "1", "2", "3"], s).alternative?.key).toBe("proposal:p");
		s.proposals[0].status = "started";
		expect(adminCoverageDecision(["0", "1", "2", "3"], s).alternative).toBeUndefined();
		s.proposals[0].status = "pending"; s.magnets.get("4")!.teamId = "other";
		expect(adminCoverageDecision(["0", "1", "2", "3"], s).alternative).toBeUndefined();
	});
});
