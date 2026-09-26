import { describe, expect, it } from "vitest";
import type { Court, SessionPlayer } from "../../types";
import { avoidGroupError, buildAvoidMap } from "./avoidGroups";
import { autoFillTeammates, recommendTeammates, type RecommendContext } from "./recommendTeammates";
import { planWaitingTeamFills } from "./fillWaitingTeams";
import { buildRecommendData } from "../board/recommendPool";
import { prefersWaitingDraft } from "../board/waitingDrafts";

function player(id: string, overrides: Partial<SessionPlayer> = {}): SessionPlayer {
	return { id, playerId: id, memberId: `m-${id}`, name: id, gender: "M", skills: { grade: 5 }, status: "waiting", gameCount: 0,
		mixedCount: 0, waitSince: null, joinedAtMatch: 0, allowMixedSingle: false, cockChecked: true, ...overrides };
}
const ids = (players: readonly SessionPlayer[]) => players.map(p => p.id).sort();
function context(players: SessionPlayer[], groups: string[][], overrides: Partial<RecommendContext> = {}): RecommendContext {
	return { playingIds: new Set(), groupHistory: [], lastGameType: {}, avoid: buildAvoidMap(groups, players), ...overrides };
}
const together = (picked: readonly string[], a: string, b: string) => picked.includes(a) && picked.includes(b);

describe("같이 매칭하지 않기 묶음", () => {
	it("묶음 안의 모든 두 사람을 서로 피하게 하고, 회원이 아닌 선수는 건너뛴다", () => {
		const players = [player("a"), player("b"), player("c"), player("guest", { memberId: null })];
		const avoid = buildAvoidMap([["m-a", "m-b", "m-c", "m-gone"]], players);
		expect([...avoid.get("a")!].sort()).toEqual(["b", "c"]);
		expect([...avoid.get("c")!].sort()).toEqual(["a", "b"]);
		expect(avoid.has("guest")).toBe(false);
	});
	it("2~4명, 중복 없음, 같은 묶음 중복 저장 금지를 검사한다", () => {
		expect(avoidGroupError(["x"])).toMatch("2~4명");
		expect(avoidGroupError(["a", "b", "c", "d", "e"])).toMatch("2~4명");
		expect(avoidGroupError(["a", "a"])).toMatch("두 번");
		expect(avoidGroupError(["b", "a"], [["a", "b"]])).toMatch("이미");
		expect(avoidGroupError(["a", "b", "c"], [["a", "b"]])).toBeNull();
	});
	it("자동편성은 서로 피하는 두 사람을 같은 네 명에 넣지 않는다", () => {
		// a·b는 가장 오래 기다려 원래라면 함께 뽑힌다.
		const old = new Date(Date.now() - 30 * 60000).toISOString();
		const pool = [player("a", { waitSince: old }), player("b", { waitSince: old }), player("c"), player("d"), player("e")];
		const without = ids(autoFillTeammates([], pool, context(pool, []), 4));
		expect(together(without, "a", "b")).toBe(true);
		const picked = ids(autoFillTeammates([], pool, context(pool, [["m-a", "m-b"]]), 4));
		expect(picked).toHaveLength(4);
		expect(together(picked, "a", "b")).toBe(false);
	});
	it("확정 멤버와 피하는 후보는 추천에서 빠지고, 직접 넣은 두 사람은 그대로 두고 나머지만 채운다", () => {
		const pool = [player("c"), player("d"), player("e"), player("f")];
		const a = player("a"), b = player("b"), all = [a, b, ...pool];
		const ranked = recommendTeammates([a], pool, context(all, [["m-a", "m-c"]]));
		expect(ranked.map(r => r.player.id)).not.toContain("c");
		const picks = ids(autoFillTeammates([a, b], pool, context(all, [["m-a", "m-b"], ["m-a", "m-d"]]), 2));
		expect(picks).toHaveLength(2);
		expect(picks).not.toContain("d");
	});
	it("피하지 않고는 네 명을 만들 수 없으면 억지로 넣지 않는다", () => {
		const pool = [player("a"), player("b"), player("c"), player("d")];
		expect(autoFillTeammates([], pool, context(pool, [["m-a", "m-b"]]), 4)).toHaveLength(0);
	});
	it("경기 완료 후 합류 대기팀 채움도 묶음을 지킨다", () => {
		const teams = [{ id: "w", members: [player("x"), player("y")] }];
		const pool = [player("a"), player("b"), player("c")];
		const plan = planWaitingTeamFills(teams, pool, context([...teams[0].members, ...pool], [["m-x", "m-a"], ["m-y", "m-b"]]));
		expect(plan.size).toBe(0);
		const relaxed = planWaitingTeamFills(teams, pool, context([...teams[0].members, ...pool], [["m-x", "m-a"]]));
		expect(ids(relaxed.get("w")!)).toEqual(["b", "c"]);
	});
	it("보드 추천 입력의 회원 묶음을 이번 회차 선수로 바꿔 넣는다", () => {
		const players = [player("a"), player("b"), player("c"), player("d"), player("e")];
		const inputs = {
			drafts: new Map(), reservations: new Map(), courts: [], groupHistory: [], lastGameType: {}, cockCheckEnabled: false,
			sessionPlayers: new Map(players.map(p => [p.id, p])),
			magnets: new Map(players.map(p => [p.id, { playerId: p.id, x: 0, y: 0, teamId: null }])),
		};
		expect(buildRecommendData({ newTeam: true }, [], inputs)!.ctx.avoid).toBeUndefined();
		const data = buildRecommendData({ newTeam: true }, [], { ...inputs, avoidGroups: [["m-a", "m-b"]] })!;
		expect([...data.ctx.avoid!.get("a")!]).toEqual(["b"]);
		expect(together(ids(autoFillTeammates(data.confirmed, data.pool, data.ctx, 4)), "a", "b")).toBe(false);
	});
	it("대기팀 채움의 사전 배분이 묶음으로 막힌 팀 몫을 남겨도, 채울 수 있는 앞 팀은 채운다", () => {
		const woman = (id: string, grade: number) => player(id, { gender: "F", skills: { grade } });
		const menTeam = [player("m1"), player("m2"), player("m4")], womenTeam = [woman("w1", 3), woman("w2", 3), woman("w4", 3)];
		const pool = [player("m3"), woman("w3", 5)], all = [...menTeam, ...womenTeam, ...pool];
		const teams = [{ id: "men", members: menTeam }, { id: "women", members: womenTeam }];
		const plain = planWaitingTeamFills(teams, pool, context(all, []));
		expect([ids(plain.get("men")!), ids(plain.get("women")!)]).toEqual([["m3"], ["w3"]]);
		const plan = planWaitingTeamFills(teams, pool, context(all, [["m-m1", "m-m3"], ["m-w1", "m-w3"]]));
		expect(ids(plan.get("men")!)).toEqual(["w3"]);
		expect(plan.has("women")).toBe(false);
	});
	it("새 팀 기본값: 묶음 때문에 대기자만으로 네 명이 안 되면 경기 중 선수 예약 대신 합류 대기를 고른다", () => {
		const players = [..."abcdefgh"].map(id => player(id));
		const inputs = {
			drafts: new Map(), reservations: new Map(), groupHistory: [], lastGameType: {}, cockCheckEnabled: false,
			courts: [{ id: 1, match: { id: "m", courtId: 1, gameType: "남복", teamA: ["e", "f"], teamB: ["g", "h"], startedAt: "" } }, { id: 2, match: null }] as Court[],
			sessionPlayers: new Map(players.map(p => [p.id, p])),
			magnets: new Map(players.map(p => [p.id, { playerId: p.id, x: 0, y: 0, teamId: null }])),
		};
		expect(prefersWaitingDraft({ newTeam: true }, inputs)).toBe(false);
		expect(prefersWaitingDraft({ newTeam: true }, { ...inputs, avoidGroups: [["m-a", "m-b"]] })).toBe(true);
	});
	it("풀이 짧으면 뽑는 사람끼리 피할 때도 부분 편성을 줄여서 만들고, 네 명이 가능한 풀에서는 줄이지 않는다", () => {
		const a = player("a"), b = player("b"), c = player("c");
		expect(autoFillTeammates([a], [b, c], context([a, b, c], [["m-b", "m-c"]]), 3)).toHaveLength(1);
		const pool = [b, c, player("d")];
		expect(autoFillTeammates([a], pool, context([a, ...pool], [["m-b", "m-c"], ["m-b", "m-d"], ["m-c", "m-d"]]), 3)).toHaveLength(0);
	});
});
