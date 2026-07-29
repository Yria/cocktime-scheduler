import { describe, it, expect } from "vitest";
import { canonicalizeDrafts, reconcileMembership } from "./remoteDrafts";
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

describe("reconcileMembership / canonicalizeDrafts — 매칭확정(confirmedMs) 동기화", () => {
	it("유효 멤버 4명이면 confirmedMs·createdBy를 그대로 전달한다", () => {
		const payload: BoardDraftsPayload = {
			teams: [{ id: "T", memberIds: ["a", "b", "c", "d"], createdMs: 0, createdBy: "샘", confirmedMs: 777 }],
			reservations: [],
		};
		const mags = magnets(["a", "b", "c", "d"]);
		const { drafts } = reconcileMembership(payload, mags, noAnchors, VW, VH, new Set());

		expect(drafts.get("T")!.confirmedMs).toBe(777);
		expect(drafts.get("T")!.createdBy).toBe("샘");
	});

	it("anchor 3 + ghost 1 = 4명이어도 confirmedMs 유지(예약 포함 정원)", () => {
		const payload: BoardDraftsPayload = {
			teams: [{ id: "T", memberIds: ["a", "b", "c"], createdMs: 0, confirmedMs: 777 }],
			reservations: [{ id: "r1", playerId: "g", teamId: "T", createdMs: 1 }],
		};
		const mags = magnets(["a", "b", "c", "g"]);
		const { drafts } = reconcileMembership(payload, mags, noAnchors, VW, VH, new Set());

		expect(drafts.get("T")!.confirmedMs).toBe(777);
	});

	it("I2 필터로 멤버가 4명 미만이 되면 confirmedMs를 버린다(스테일 확정 정제)", () => {
		const payload: BoardDraftsPayload = {
			teams: [{ id: "T", memberIds: ["a", "b", "c", "d"], createdMs: 0, confirmedMs: 777 }],
			reservations: [],
		};
		const mags = magnets(["a", "b", "c", "d"]);
		const { drafts } = reconcileMembership(payload, mags, noAnchors, VW, VH, new Set(["a"])); // a 경기중

		expect(drafts.get("T")!.anchorMemberIds.sort()).toEqual(["b", "c", "d"]);
		expect(drafts.get("T")!.confirmedMs).toBeUndefined();
	});

	it("canonicalizeDrafts: confirmedMs·createdBy만 달라도 다른 payload로 판정(동기화 트리거)", () => {
		const base: BoardDraftsPayload = {
			teams: [{ id: "T", memberIds: ["a", "b", "c", "d"], createdMs: 0 }],
			reservations: [],
		};
		const withConfirm: BoardDraftsPayload = {
			teams: [{ ...base.teams[0], confirmedMs: 777 }],
			reservations: [],
		};
		const withCreator: BoardDraftsPayload = {
			teams: [{ ...base.teams[0], createdBy: "샘" }],
			reservations: [],
		};
		expect(canonicalizeDrafts(withConfirm)).not.toBe(canonicalizeDrafts(base));
		expect(canonicalizeDrafts(withCreator)).not.toBe(canonicalizeDrafts(base));
		expect(canonicalizeDrafts(base)).toBe(canonicalizeDrafts({ ...base }));
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
