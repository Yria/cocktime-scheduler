import { describe, it, expect } from "vitest";
import { resolveDropTarget } from "./dropResolver";
import type { DraftTeam, MagnetPosition, Reservation } from "../../types/board";

function mag(playerId: string, x: number, y: number, teamId: string | null = null): MagnetPosition {
	return { playerId, x, y, teamId };
}
function draft(id: string, anchorMemberIds: string[], x: number, y: number): DraftTeam {
	return { id, anchorMemberIds, anchor: { x, y }, createdAt: 0 };
}
function magnets(...ms: MagnetPosition[]): Map<string, MagnetPosition> {
	return new Map(ms.map((m) => [m.playerId, m]));
}
function drafts(...ds: DraftTeam[]): Map<string, DraftTeam> {
	return new Map(ds.map((d) => [d.id, d]));
}
const noRes = new Map<string, Reservation>();

describe("resolveDropTarget — 자유 자석", () => {
	it("다른 자유 자석 근접 → createPair", () => {
		const m = magnets(mag("a", 100, 100), mag("b", 500, 500));
		const t = resolveDropTarget("b", { x: 120, y: 100 }, m, new Map(), noRes);
		expect(t).toEqual({ kind: "createPair", partnerId: "a", anchor: { x: 110, y: 100 } });
	});

	it("팀 박스 안(정원 미만) → attach", () => {
		const m = magnets(mag("a", 300, 300, "T"), mag("b", 500, 500));
		const t = resolveDropTarget("b", { x: 300, y: 300 }, m, drafts(draft("T", ["a"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "attach", teamId: "T" });
	});

	it("정원 4인 팀(비멤버) → attach 안 함, 자유 파트너도 없으면 move", () => {
		const m = magnets(
			mag("a", 300, 300, "T"),
			mag("b", 300, 300, "T"),
			mag("c", 300, 300, "T"),
			mag("d", 300, 300, "T"),
			mag("e", 5000, 5000),
		);
		const t = resolveDropTarget("e", { x: 300, y: 300 }, m, drafts(draft("T", ["a", "b", "c", "d"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "move", to: { x: 300, y: 300 } });
	});

	it("경기중 선수는 페어 대상에서 제외 → move", () => {
		const m = magnets(mag("p", 100, 100), mag("b", 500, 500));
		const t = resolveDropTarget("b", { x: 110, y: 100 }, m, new Map(), noRes, new Set(["p"]));
		expect(t).toEqual({ kind: "move", to: { x: 110, y: 100 } });
	});
});

describe("resolveDropTarget — anchor 멤버", () => {
	it("빈 공간 → detach", () => {
		const m = magnets(mag("a", 300, 300, "T"));
		const t = resolveDropTarget("a", { x: 1500, y: 1500 }, m, drafts(draft("T", ["a"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "detach", to: { x: 1500, y: 1500 } });
	});

	it("다른 팀 박스 안 → reserve(원본 유지)", () => {
		const m = magnets(mag("a", 300, 300, "T1"), mag("x", 700, 300, "T2"));
		const ds = drafts(draft("T1", ["a"], 300, 300), draft("T2", ["x"], 700, 300));
		const t = resolveDropTarget("a", { x: 700, y: 300 }, m, ds, noRes);
		expect(t).toEqual({ kind: "reserve", toTeamId: "T2" });
	});

	it("자기 팀 박스 안 → none(스냅백)", () => {
		const m = magnets(mag("a", 300, 300, "T"));
		const t = resolveDropTarget("a", { x: 310, y: 305 }, m, drafts(draft("T", ["a"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "none" });
	});

	it("자유 자석 근접 → reservePair", () => {
		const m = magnets(mag("a", 300, 300, "T1"), mag("c", 900, 900));
		const t = resolveDropTarget("a", { x: 900, y: 900 }, m, drafts(draft("T1", ["a"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "reservePair", partnerId: "c", anchor: { x: 900, y: 900 } });
	});
});
