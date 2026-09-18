import { describe, expect, it } from "vitest";
import { dropProposalMember, removeProposalMember, type ProposalGroup } from "./matchProposals";

const bounds = { width: 800, height: 600 };
const point = { x: 200, y: 250 };
const group = (ids: string[]): ProposalGroup => ({ id: "one", playerIds: ids, anchor: point });

describe("private proposal composition", () => {
	it("allows one member in open space without mutating the input", () => {
		const groups: ProposalGroup[] = [];
		expect(dropProposalMember(groups, "a", point, [], bounds, "new")).toEqual([{ id: "new", playerIds: ["a"], anchor: point }]);
		expect(groups).toEqual([]);
	});
	it("pairs overlapping free magnets and never selects an already grouped partner", () => {
		const magnets = [{ playerId: "b", x: 210, y: 250, teamId: null }];
		expect(dropProposalMember([], "a", point, magnets, bounds, "new")[0].playerIds).toEqual(["b", "a"]);
		const other = { ...group(["b"]), anchor: { x: 600, y: 250 } };
		expect(dropProposalMember([other], "a", point, magnets, bounds, "new")[1].playerIds).toEqual(["a"]);
	});
	it("enforces four without silently replacing a selected member", () => {
		const original = [group(["a", "b", "c", "d"])];
		expect(dropProposalMember(original, "e", point, [], bounds, "new")).toEqual(original);
		expect(dropProposalMember(original, "a", point, [], bounds, "new")).toEqual(original);
	});
	it("moves a member between local groups and retains one-person groups", () => {
		const groups = [group(["a", "b"]), { id: "two", playerIds: ["c"], anchor: { x: 600, y: 250 } }];
		const next = dropProposalMember(groups, "b", { x: 600, y: 250 }, [], bounds, "new");
		expect(next.map((item) => item.playerIds)).toEqual([["a"], ["c", "b"]]);
		expect(groups[0].playerIds).toEqual(["a", "b"]);
	});
	it("dragging out removes membership; removing the last member removes only that group", () => {
		expect(dropProposalMember([group(["a", "b"])], "a", { x: 700, y: 500 }, [], bounds, "new")[0].playerIds).toEqual(["b"]);
		expect(removeProposalMember([group(["a"])], "a")).toEqual([]);
	});
});
