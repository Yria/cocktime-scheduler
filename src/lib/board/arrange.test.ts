import { describe, it, expect } from "vitest";
import { requiredBoardHeight, computeFitScale, arrangeBoard } from "./arrange";
import type { DraftTeam, MagnetPosition } from "../../types/board";
import type { SessionPlayer } from "../../types";

const FIT = { min: 0.5, max: 1, step: 0.05 };

describe("requiredBoardHeight", () => {
	it("자석이 하나도 없으면 0", () => {
		expect(requiredBoardHeight(0, 0, 390)).toBe(0);
	});

	it("자유 자석이 많을수록 필요한 세로 높이가 커진다", () => {
		expect(requiredBoardHeight(0, 30, 390)).toBeGreaterThan(requiredBoardHeight(0, 4, 390));
	});

	it("가로가 넓으면(열이 많아) 같은 인원의 필요 높이가 줄어든다", () => {
		expect(requiredBoardHeight(0, 30, 800)).toBeLessThan(requiredBoardHeight(0, 30, 390));
	});
});

describe("computeFitScale", () => {
	it("적은 인원은 1배에서 다 들어간다", () => {
		expect(computeFitScale(390, 700, 0, 4, FIT)).toBe(1);
	});

	it("많은 인원은 축소 배율을 반환한다(1배 미만, min 이상)", () => {
		const s = computeFitScale(390, 700, 0, 60, FIT);
		expect(s).toBeLessThan(1);
		expect(s).toBeGreaterThanOrEqual(0.5);
	});

	it("작은 화면+아주 많은 인원이면 하한(min)으로 떨어진다", () => {
		expect(computeFitScale(300, 300, 4, 80, FIT)).toBe(0.5);
	});

	it("반환된 배율에선 실제로 requiredBoardHeight ≤ viewH 가 성립한다(단, min 폴백 제외)", () => {
		const s = computeFitScale(390, 700, 2, 24, FIT);
		if (s > FIT.min) {
			expect(requiredBoardHeight(2, 24, 390 / s)).toBeLessThanOrEqual(700 / s);
		}
	});

	it("인원이 줄면 더 큰(또는 같은) 배율로 돌아온다(최대가 베스트)", () => {
		const many = computeFitScale(390, 700, 0, 50, FIT);
		const few = computeFitScale(390, 700, 0, 8, FIT);
		expect(few).toBeGreaterThanOrEqual(many);
	});
});

// ── 회귀(2026-08-01): 그룹이 많아도 자유 자석은 화면 안에 배치돼야 한다 ──────────
// 그룹 밴드 하단(groupAreaBottom)을 상한 없이 settle 의 topMargin 으로 넘기면 computeBounds 에서
// minY > maxY 로 역전되고, 클램프 max(minY, min(maxY, y)) 에서 minY 가 이겨 **모든 자유 자석이
// Stage 밖(y=minY)으로 고정**된다 → 대기 선수가 통째로 안 보인다(실측 390×700·그룹 5개: minY=744 > maxY=664).
// 자동 fit 의 축소가 구제하지만 manualLayout=true 인 편집자는 그 경로를 타지 않으므로 배치 자체가 안전해야 한다.
describe("arrangeBoard — 그룹이 화면을 넘겨도 자유 자석은 Stage 안에", () => {
	function run(viewW: number, viewH: number, groupCount: number, freeCount: number) {
		const magnets = new Map<string, MagnetPosition>();
		const sessionPlayers = new Map<string, SessionPlayer>();
		for (let i = 0; i < freeCount; i++) {
			const id = `f${i}`;
			magnets.set(id, { playerId: id, x: 0, y: 0, teamId: null });
		}
		const drafts = new Map<string, DraftTeam>();
		for (let i = 0; i < groupCount; i++) {
			const id = `T${i}`;
			const a1 = `t${i}a`;
			const a2 = `t${i}b`;
			for (const a of [a1, a2]) magnets.set(a, { playerId: a, x: 0, y: 0, teamId: id });
			drafts.set(id, { id, anchorMemberIds: [a1, a2], anchor: { x: 0, y: 0 }, createdAt: i });
		}
		arrangeBoard({
			magnets,
			drafts,
			reservations: new Map(),
			courtAnchors: new Map(),
			courts: [],
			sessionPlayers,
			playingIds: new Set(),
			restingIds: new Set(),
			cockPendingIds: new Set(),
			viewW,
			viewH,
		});
		return [...magnets.values()].filter((m) => m.teamId === null);
	}

	it("좁은 화면 + 그룹 5개에서도 자유 자석 y가 화면 높이를 넘지 않는다", () => {
		const free = run(390, 700, 5, 6);
		expect(free.length).toBe(6);
		for (const m of free) {
			expect(m.y).toBeLessThanOrEqual(700);
			expect(m.y).toBeGreaterThan(0);
		}
	});

	it("그룹이 아주 많아도(10개) 자유 자석이 전원 화면 밖으로 나가지 않는다", () => {
		const free = run(390, 700, 10, 4);
		for (const m of free) expect(m.y).toBeLessThanOrEqual(700);
	});

	it("여유 있는 화면에서는 기존대로 그룹 아래에 배치된다", () => {
		const free = run(800, 1200, 1, 4);
		for (const m of free) {
			expect(m.y).toBeLessThanOrEqual(1200);
			expect(m.y).toBeGreaterThan(0);
		}
	});
});
