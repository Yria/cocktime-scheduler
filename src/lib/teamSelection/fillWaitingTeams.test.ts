import { describe, expect, it } from "vitest";
import type { SessionPlayer } from "../../types";
import { canCompleteFrom, planWaitingTeamFills } from "./fillWaitingTeams";
import { autoFillTeammates, type RecommendContext } from "./recommendTeammates";
import { allowedGameType } from "./groupPolicy";

function player(id: string, gender: "M" | "F" = "M", grade = 5): SessionPlayer {
	return { id, playerId: id, memberId: null, name: id, gender, skills: { grade }, status: "waiting", gameCount: 0,
		mixedCount: 0, waitSince: null, joinedAtMatch: 0, allowMixedSingle: false, cockChecked: true };
}
const context = (overrides: Partial<RecommendContext> = {}): RecommendContext => ({ playingIds: new Set(), groupHistory: [], lastGameType: {}, ...overrides });
const ids = (players: readonly SessionPlayer[]) => players.map(p => p.id);

describe("경기 완료 후 합류 대기팀 채우기", () => {
	it("같이 끝난 네 명을 두 팀에 나눠 넣고 한 선수는 한 번만 배정한다", () => {
		const teams = [{ id: "first", members: [player("e"), player("f")] }, { id: "second", members: [player("g"), player("h")] }];
		const ended = ["a", "b", "c", "d"].map(id => player(id));
		const plan = planWaitingTeamFills(teams, ended, context({ groupHistory: [{ matchId: "ended", members: ids(ended) }] }));
		expect([...plan.values()].map(picks => picks.length)).toEqual([2, 2]);
		expect(new Set([...plan.values()].flatMap(ids)).size).toBe(4);
	});
	it("기존 대기자도 포함하고 동반 이력이 같으면 더 오래 기다린 선수를 우선한다", () => {
		const waiting = [player("old-a"), player("old-b")].map(p => ({ ...p, waitSince: new Date(Date.now() - 20 * 60000).toISOString() }));
		const plan = planWaitingTeamFills([{ id: "t", members: [player("e"), player("f")] }], [...waiting, player("new-a"), player("new-b")], context());
		expect(ids(plan.get("t")!)).toEqual(ids(waiting));
	});
	it("유연한 먼저 만든 팀이 나중 팀의 유일한 여성 후보를 가져가지 않는다", () => {
		const teams = [{ id: "older", members: [player("m1"), player("m2")] }, { id: "later", members: [player("f1", "F", 2), player("f2", "F", 2), player("f3", "F", 2)] }];
		const pool = [player("needed", "F", 5), player("m3"), player("m4")];
		const plan = planWaitingTeamFills(teams, pool, context());
		expect(ids(plan.get("older")!)).toEqual(["m3", "m4"]);
		expect(ids(plan.get("later")!)).toEqual(["needed"]);
	});
	it("가능한 완성 팀 수를 우선하고 동률이면 먼저 만든 팀부터 완성한다", () => {
		const teams = [{ id: "two-slots", members: [player("a"), player("b")] },
			{ id: "one-slot-1", members: [player("c"), player("d"), player("e")] },
			{ id: "one-slot-2", members: [player("f"), player("g"), player("h")] }];
		const pool = [player("i"), player("j")];
		expect([...planWaitingTeamFills(teams, pool, context()).keys()]).toEqual(["one-slot-1", "one-slot-2"]);
		expect([...planWaitingTeamFills(teams.slice(0, 2), pool, context()).keys()]).toEqual(["two-slots"]);
	});
	it("부족하거나 성별 구성이 불가능하면 일부만 채우지 않고 빈자리를 유지한다", () => {
		const teams = [{ id: "t", members: [player("a", "F", 2), player("b", "F", 2), player("c", "F", 2)] }];
		expect(planWaitingTeamFills(teams, [player("man")], context()).size).toBe(0);
		expect(planWaitingTeamFills([{ id: "two", members: [player("a"), player("b")] }], [player("only")], context()).size).toBe(0);
	});
	it("경기 중·휴식·미확인 선수와 중복 후보를 사용하지 않는다", () => {
		const teams = [{ id: "t", members: [player("a"), player("b")] }];
		const pool = [player("c"), player("c"), player("playing"), { ...player("resting"), status: "resting" as const }, { ...player("unchecked"), cockChecked: false }];
		expect(planWaitingTeamFills(teams, pool, context({ cockCheckEnabled: true, playingIds: new Set(["playing"]) })).size).toBe(0);
		expect(planWaitingTeamFills(teams, [player("c"), player("d")], context({ playingIds: new Set(["a"]) })).size).toBe(0);
	});
	it("한 명만 있는 코트 그룹도 대상으로 계산하고, 가능 여부는 성별 구성으로 판단한다", () => {
		const court = [{ id: "court", members: [player("seed")] }];
		expect(planWaitingTeamFills(court, [player("a"), player("b"), player("c")], context()).get("court")).toHaveLength(3);
		expect(canCompleteFrom([player("w", "F", 2)], [player("a"), player("b"), player("c")])).toBe(false);
		expect(canCompleteFrom([player("w", "F", 2)], [player("a"), player("b"), player("x", "F", 2)])).toBe(true);
	});
	it("대기팀은 경기 중 선수를 예약하지 않고 2명만 골라 빈자리를 남긴다", () => {
		const pool = [player("a"), player("b"), player("c"), player("d"), player("busy")];
		const ctx = context({ playingIds: new Set(["busy"]) });
		const picks = autoFillTeammates([], pool, ctx, 2, undefined, { targetSize: 2 });
		expect(picks).toHaveLength(2);
		expect(ids(picks)).not.toContain("busy");
		expect(autoFillTeammates([], pool, ctx, 4)).toHaveLength(4);
	});
	it("여성 구성의 모든 작은 조합에서 가능한 두 팀 완성을 놓치지 않는다", () => {
		// Four anchored and four free players, each male / low-grade woman / high-grade woman.
		const variant = (n: number, id: string) => player(id, n === 0 ? "M" : "F", n === 1 ? 2 : 5);
		for (let mask = 0; mask < 3 ** 6; mask++) {
			let n = mask;
			const ps = Array.from({ length: 6 }, (_, i) => { const p = variant(n % 3, `${i}`); n = Math.floor(n / 3); return p; });
			const teams = [{ id: "first", members: ps.slice(0, 3) }, { id: "second", members: ps.slice(3, 6) }];
			for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
				const pool = [variant(a, "6"), variant(b, "7")];
				const possible = (allowedGameType([...teams[0].members, pool[0]]) && allowedGameType([...teams[1].members, pool[1]]))
					|| (allowedGameType([...teams[0].members, pool[1]]) && allowedGameType([...teams[1].members, pool[0]]));
				if (possible) expect(planWaitingTeamFills(teams, pool, context()).size).toBe(2);
			}
		}
	});
});
