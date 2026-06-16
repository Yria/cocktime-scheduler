import { describe, it, expect } from "vitest";
import { scatterFromSource } from "./scatter";
import { MAGNET_SIZE } from "./constants";
import type { DraftTeam, MagnetPosition } from "../../types/board";

const MIN_DIST = MAGNET_SIZE; // MIN_MAG_DIST (딱 맞닿는 거리)

function mag(playerId: string, x: number, y: number, teamId: string | null = null): MagnetPosition {
	return { playerId, x, y, teamId };
}
function mags(...ms: MagnetPosition[]): Map<string, MagnetPosition> {
	return new Map(ms.map((m) => [m.playerId, m]));
}
function noDrafts(): Map<string, DraftTeam> {
	return new Map();
}
function dist(a: MagnetPosition, b: MagnetPosition): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("scatterFromSource — 드롭 지점 기준 BFS 방사형 흩어짐", () => {
	it("자석 소스: 겹친 자석을 최소거리 밖으로 밀고, 소스는 고정", () => {
		const m = mags(mag("s", 400, 500), mag("b", 410, 500)); // 거리 10 겹침
		scatterFromSource({ kind: "magnet", id: "s", x: 400, y: 500 }, m, noDrafts(), 2000, 2000, undefined, 0);
		expect(m.get("s")).toMatchObject({ x: 400, y: 500 }); // 소스 불변
		expect(dist(m.get("s")!, m.get("b")!)).toBeGreaterThanOrEqual(MIN_DIST - 0.6);
	});

	it("연쇄(BFS): 한 줄로 겹친 자석들이 모두 최소거리 이상으로 분리된다", () => {
		const m = mags(mag("s", 400, 500), mag("b", 425, 500), mag("c", 450, 500), mag("d", 475, 500));
		scatterFromSource({ kind: "magnet", id: "s", x: 400, y: 500 }, m, noDrafts(), 2000, 2000, undefined, 0);
		const arr = ["s", "b", "c", "d"].map((id) => m.get(id)!);
		for (let i = 0; i < arr.length; i++) {
			for (let j = i + 1; j < arr.length; j++) {
				expect(dist(arr[i], arr[j])).toBeGreaterThanOrEqual(MIN_DIST - 1);
			}
		}
	});

	it("국소성: 멀리 떨어진 자석은 건드리지 않는다", () => {
		const m = mags(mag("s", 400, 500), mag("far", 1500, 500));
		scatterFromSource({ kind: "magnet", id: "s", x: 400, y: 500 }, m, noDrafts(), 2000, 2000, undefined, 0);
		expect(m.get("far")).toMatchObject({ x: 1500, y: 500 });
	});

	it("화면 경계를 넘지 않는다(벽에 막히면 빈자리로)", () => {
		// s가 오른쪽 벽 근처, b는 s보다 더 오른쪽 → 오른쪽으로 못 밀고 빈자리 탐색
		const m = mags(mag("s", 360, 500), mag("b", 365, 500));
		scatterFromSource({ kind: "magnet", id: "s", x: 360, y: 500 }, m, noDrafts(), 400, 800, undefined, 0);
		const b = m.get("b")!;
		expect(b.x).toBeGreaterThanOrEqual(0);
		expect(b.x).toBeLessThanOrEqual(400);
		expect(b.y).toBeGreaterThanOrEqual(0);
		expect(b.y).toBeLessThanOrEqual(800);
		expect(dist(m.get("s")!, b)).toBeGreaterThanOrEqual(MIN_DIST - 1); // 그래도 분리됨
	});

	it("그룹(rect) 소스: 박스 안 자석을 밖으로 밀어낸다", () => {
		const m = mags(mag("m", 305, 510)); // 팀(300,500) 박스 안
		const drafts = new Map<string, DraftTeam>([
			["T", { id: "T", anchorMemberIds: [], anchor: { x: 300, y: 500 }, createdAt: 0 }],
		]);
		scatterFromSource({ kind: "rect", x: 300, y: 500 }, m, drafts, 2000, 2000, undefined, 0);
		const mm = m.get("m")!;
		// 팀 박스 밖으로 충분히 밀려남(가장 가까운 경계가 ~111px이므로 중심에서 100 이상)
		expect(Math.hypot(mm.x - 300, mm.y - 500)).toBeGreaterThanOrEqual(100);
	});
});
