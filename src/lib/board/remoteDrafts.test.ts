import { describe, it, expect } from "vitest";
import { reconcileMembership } from "./remoteDrafts";
import type { BoardDraftsPayload, MagnetPosition, StagePoint } from "../../types/board";

function magnets(ids: string[]): Map<string, MagnetPosition> {
	return new Map(ids.map((id) => [id, { playerId: id, x: 0, y: 0, teamId: null }]));
}
const noAnchors = new Map<string, StagePoint>();
const VW = 400;
const VH = 800;

describe("reconcileMembership — 불변식 I1(중복 anchor 제거)", () => {
	it("같은 선수가 두 팀 memberIds에 있으면 먼저 만들어진(createdMs↑) 팀만 유지", () => {
		const payload: BoardDraftsPayload = {
			teams: [
				{ id: "B", memberIds: ["p1", "p3"], createdMs: 10 },
				{ id: "A", memberIds: ["p1", "p2"], createdMs: 0 },
			],
			reservations: [],
		};
		const mags = magnets(["p1", "p2", "p3"]);
		const { drafts } = reconcileMembership(payload, mags, noAnchors, VW, VH, new Set());

		expect(drafts.get("A")!.anchorMemberIds.sort()).toEqual(["p1", "p2"]);
		expect(drafts.get("B")!.anchorMemberIds).toEqual(["p3"]); // p1은 A가 가져가 B에서 제거
		expect(mags.get("p1")!.teamId).toBe("A"); // 보유 팀과 자석이 일치
	});

	it("createdMs가 같으면 id가 앞선 팀이 유지(결정적 tie-break)", () => {
		const payload: BoardDraftsPayload = {
			teams: [
				{ id: "zeta", memberIds: ["p1", "p2"], createdMs: 5 },
				{ id: "alpha", memberIds: ["p1", "p3"], createdMs: 5 },
			],
			reservations: [],
		};
		const mags = magnets(["p1", "p2", "p3"]);
		const { drafts } = reconcileMembership(payload, mags, noAnchors, VW, VH, new Set());

		expect(drafts.get("alpha")!.anchorMemberIds.sort()).toEqual(["p1", "p3"]);
		expect(drafts.get("zeta")!.anchorMemberIds).toEqual(["p2"]);
		expect(mags.get("p1")!.teamId).toBe("alpha");
	});
});

describe("reconcileMembership — 불변식 I2(경기중 선수는 anchor 아님)", () => {
	it("팀 전원이 경기중이면 팀이 사라진다(유령 팀 부활 방지)", () => {
		const payload: BoardDraftsPayload = {
			teams: [{ id: "T", memberIds: ["a", "b", "c", "d"], createdMs: 0 }],
			reservations: [],
		};
		const mags = magnets(["a", "b", "c", "d"]);
		const { drafts } = reconcileMembership(
			payload, mags, noAnchors, VW, VH, new Set(["a", "b", "c", "d"]),
		);

		expect(drafts.size).toBe(0);
		for (const id of ["a", "b", "c", "d"]) expect(mags.get(id)!.teamId).toBeNull();
	});

	it("일부 멤버만 경기중이면 그 멤버만 anchor에서 빠지고 팀은 유지", () => {
		const payload: BoardDraftsPayload = {
			teams: [{ id: "T", memberIds: ["a", "b", "c"], createdMs: 0 }],
			reservations: [],
		};
		const mags = magnets(["a", "b", "c"]);
		const { drafts } = reconcileMembership(payload, mags, noAnchors, VW, VH, new Set(["a"]));

		expect(drafts.get("T")!.anchorMemberIds.sort()).toEqual(["b", "c"]);
		expect(mags.get("a")!.teamId).toBeNull(); // 경기중 → anchor 아님
		expect(mags.get("b")!.teamId).toBe("T");
	});
});

describe("reconcileMembership — ghost(예약)는 경기중이어도 보존(의도된 빌려주기)", () => {
	it("경기중 선수의 ghost 예약은 제거하지 않는다", () => {
		const payload: BoardDraftsPayload = {
			teams: [{ id: "T", memberIds: ["a"], createdMs: 0 }],
			reservations: [{ id: "r1", playerId: "p", teamId: "T", createdMs: 1 }],
		};
		const mags = magnets(["a", "p"]);
		const { drafts, reservations } = reconcileMembership(
			payload, mags, noAnchors, VW, VH, new Set(["p"]), // p는 경기중
		);

		expect(drafts.get("T")!.anchorMemberIds).toEqual(["a"]);
		expect(reservations.size).toBe(1); // 경기중 ghost 보존
		expect(reservations.get("r1")!.playerId).toBe("p");
	});
});
