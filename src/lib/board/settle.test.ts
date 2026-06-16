import { describe, expect, it } from "vitest";
import type { DraftTeam, MagnetPosition } from "../../types/board";
import { TEAM_BOX_BELOW, TEAM_W } from "./constants";
import { KEEPOUT_X } from "./keepout";
import { settleFreeMagnets } from "./settle";

const MAG_R = 32;
const MIN_DIST = 64; // MIN_MAG_DIST

function mag(playerId: string, x: number, y: number, teamId: string | null = null): MagnetPosition {
	return { playerId, x, y, teamId };
}
function mags(...ms: MagnetPosition[]): Map<string, MagnetPosition> {
	return new Map(ms.map((m) => [m.playerId, m]));
}
function team(id: string, x: number, y: number): DraftTeam {
	return { id, anchorMemberIds: [], anchor: { x, y }, createdAt: 0 };
}
function dist(a: MagnetPosition, b: MagnetPosition): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("settleFreeMagnets — 자유 자석 겹침 정리", () => {
	it("겹친 두 자유 자석을 최소거리 이상으로 분리한다", () => {
		const m = mags(mag("a", 400, 500), mag("b", 410, 500));
		settleFreeMagnets(m, new Map(), 2000, 2000);
		expect(dist(m.get("a")!, m.get("b")!)).toBeGreaterThanOrEqual(MIN_DIST - 1);
	});

	it("excludeIds 자석은 움직이지 않는다", () => {
		const m = mags(mag("keep", 400, 500), mag("move", 410, 500));
		settleFreeMagnets(m, new Map(), 2000, 2000, new Set(["keep"]));
		expect(m.get("keep")).toMatchObject({ x: 400, y: 500 });
	});

	it("팀에 묶인(teamId≠null) 자석은 정리 대상이 아니다", () => {
		const m = mags(mag("anchored", 300, 500, "T"));
		settleFreeMagnets(m, new Map([["T", team("T", 300, 500)]]), 2000, 2000);
		expect(m.get("anchored")).toMatchObject({ x: 300, y: 500 });
	});

	it("팀 박스 안에 있던 자유 자석은 박스(keep-out) 밖으로 밀려난다", () => {
		// 팀 anchor(300,500) 정중앙에 자유 자석 → keep-out 밖으로
		const m = mags(mag("free", 300, 500));
		settleFreeMagnets(m, new Map([["T", team("T", 300, 500)]]), 2000, 2000);
		const f = m.get("free")!;
		const insideX = Math.abs(f.x - 300) < KEEPOUT_X;
		const insideY = f.y - 500 > -(TEAM_BOX_BELOW + MAG_R) && f.y - 500 < TEAM_BOX_BELOW + MAG_R;
		expect(insideX && insideY).toBe(false);
	});

	it("경계 케이스: keep-out 경계 바로 밖(<)의 자석은 밀지 않는다", () => {
		// dx가 KEEPOUT_X와 정확히 같으면 배타적 경계상 '밖' → 그대로 둔다
		const x = 300 + KEEPOUT_X;
		const m = mags(mag("edge", x, 500));
		settleFreeMagnets(m, new Map([["T", team("T", 300, 500)]]), 2000, 2000);
		expect(m.get("edge")).toMatchObject({ x, y: 500 });
		expect(KEEPOUT_X).toBe(TEAM_W / 2 + MAG_R);
	});
});
