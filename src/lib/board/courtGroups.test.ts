import { describe, it, expect } from "vitest";
import { reconcileCourtGroups } from "./courtGroups";
import { groupGridAnchor, nextGroupAnchor } from "./groupGrid";
import type { DraftTeam } from "../../types/board";

describe("코트와 예비 그룹", () => {
	it("코트 복원/추가/삭제를 반복해도 예비 그룹은 유지한다", () => {
		const waiting: DraftTeam = { id: "waiting", anchor: groupGridAnchor(4), anchorMemberIds: ["a", "b"], createdAt: 100 };
		const state = { drafts: new Map([[waiting.id, waiting]]), magnets: new Map(), reservations: new Map(), courtAnchors: new Map() };
		const courts = [1, 2, 3, 4].map(id => ({ id, match: null }));
		reconcileCourtGroups(state, courts);
		reconcileCourtGroups(state, courts);
		expect(state.drafts.size).toBe(5);
		expect(state.drafts.get("waiting")).toEqual(waiting);
		expect(courts.map(court => state.drafts.get(`court-${court.id}`)?.anchor)).toEqual(courts.map((_, index) => groupGridAnchor(index)));
		reconcileCourtGroups(state, courts.slice(0, 2));
		expect([...state.drafts.keys()].sort()).toEqual(["court-1", "court-2", "waiting"]);
	});
	it("새 그룹은 3×3 격자를 좌상단부터 채우고 해제된 칸을 재사용한다", () => {
		const points: ReturnType<typeof groupGridAnchor>[] = [];
		for (let i = 0; i < 10; i++) points.push(nextGroupAnchor(points));
		expect(new Set(points.slice(0, 9).map(p => p.x)).size).toBe(3);
		expect(new Set(points.slice(0, 9).map(p => p.y)).size).toBe(3);
		expect(points[9]).toEqual(groupGridAnchor(9));
		expect(nextGroupAnchor(points.filter((_, i) => i !== 4))).toEqual(groupGridAnchor(4));
	});
	it("중간 빈 코트 삭제 후 재증설해도 번호가 당겨진 그룹과 예비 명단을 덮어쓰지 않는다", () => {
		const retained: DraftTeam = { id: "court-5", courtId: 4, anchor: groupGridAnchor(4), anchorMemberIds: ["a", "b"], createdAt: 5 };
		const prepared: DraftTeam = { id: "court-3", anchor: groupGridAnchor(2), anchorMemberIds: ["c", "d"], createdAt: 100 };
		const state = { drafts: new Map([[retained.id, retained], [prepared.id, prepared]]), magnets: new Map(), reservations: new Map(), courtAnchors: new Map() };
		const courts = [1, 2, 3, 4, 5].map(id => ({ id, match: null }));
		reconcileCourtGroups(state, courts);
		reconcileCourtGroups(state, courts);
		expect(state.drafts.get("court-5")).toEqual(retained);
		expect(state.drafts.get("court-3")).toEqual(prepared);
		expect([...state.drafts.values()].filter(team => team.courtId != null).map(team => team.courtId).sort()).toEqual([1, 2, 3, 4, 5]);
		expect(state.drafts.get("court-5-1")?.courtId).toBe(5);
		expect(state.drafts.get("court-3-1")?.courtId).toBe(3);
	});
});
