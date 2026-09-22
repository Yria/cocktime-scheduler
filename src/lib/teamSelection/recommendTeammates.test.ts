import { describe, expect, it, vi } from "vitest";
import type { SessionPlayer } from "../../types";
import { autoFillTeammates, recommendTeammates, RECOMMEND_WEIGHTS, type RecommendContext } from "./recommendTeammates";
import { allowedGameType, buildExchangeState, exchangeCost, groupCapacity } from "./groupPolicy";
import { determineGameType } from "./pairPlayers";

const epoch = Date.UTC(2026, 8, 18, 10);
function player(id: string, overrides: Partial<SessionPlayer> = {}): SessionPlayer {
	return { id, playerId: id, memberId: null, name: id, gender: "M", skills: { grade: 5 }, allowMixedSingle: false,
		status: "waiting", gameCount: 0, mixedCount: 0, waitSince: null, joinedAtMatch: 0, cockChecked: true, ...overrides };
}
function context(overrides: Partial<RecommendContext> = {}): RecommendContext {
	return { groupHistory: [], lastGameType: {}, playingIds: new Set(), ...overrides };
}
function group(matchId: string, members: string[], minute = 0) {
	return { matchId, members, completedAt: new Date(epoch + minute * 60000).toISOString() };
}
const ids = (ps: SessionPlayer[]) => ps.map(p => p.id);
const fill = (ps: SessionPlayer[], ctx = context()) => autoFillTeammates([], ps, ctx, 4, undefined, { maxPlaying: 3 });

describe("중복 + 실력: 실제 네 명 선정", () => {
	it("대기 팀이 가능하면 판수·중복·실력에서 유리한 경기중 후보도 선택하지 않는다", () => {
		const waiting = ["a", "b", "c", "d"].map(id => player(id, { gameCount: 20, skills: { grade: 1 } }));
		const playing = ["e", "f", "g", "h"].map(id => player(id, { skills: { grade: 10 } }));
		const ctx = context({ playingIds: new Set(ids(playing)), groupHistory: [group("old", ids(waiting))] });
		expect(ids(fill([...waiting, ...playing], ctx))).toEqual(ids(waiting));
		expect(recommendTeammates([], [...waiting, ...playing], ctx).every(r => !ctx.playingIds.has(r.player.id))).toBe(true);
	});
	it("대기 인원이 부족할 때만 최소 인원을 예약하고 코트 기반 경기중 판별을 따른다", () => {
		const ps = ["a", "b", "c", "d", "e", "f"].map(id => player(id));
		const ctx = context({ playingIds: new Set(["d", "e", "f"]) }); // status update may lag court assignment.
		const picked = fill(ps, ctx);
		expect(picked).toHaveLength(4);
		expect(picked.filter(p => ctx.playingIds.has(p.id))).toHaveLength(1);
		expect(autoFillTeammates([], ps, ctx, 4).every(p => !ctx.playingIds.has(p.id))).toBe(true);
	});
	it("네 명이 모두 경기중이면 새 팀을 만들지 않는다", () => {
		const ps = ["a", "b", "c", "d"].map(id => player(id));
		expect(fill(ps, context({ playingIds: new Set(ids(ps)) }))).toEqual([]);
	});
	it.each([0, 1, 2])("추가 예약 상한 %i명을 넘지 않는다", maxPlaying => {
		const fixed = [player("a")], ps = ["b", "c", "d"].map(id => player(id));
		const ctx = context({ playingIds: new Set(["c", "d"]) });
		const picked = autoFillTeammates(fixed, ps, ctx, 3, undefined, { maxPlaying });
		expect(picked.filter(p => ctx.playingIds.has(p.id)).length).toBeLessThanOrEqual(maxPlaying);
	});
	it.each([3, 4, 5])("여성 %i점의 여1남3 경계는 수동 허용 플래그와 무관하다", grade => {
		const ps = ["a", "b", "c"].map(id => player(id));
		ps.push(player("woman", { gender: "F", skills: { grade }, allowMixedSingle: grade < 4 }));
		expect(fill(ps)).toHaveLength(grade >= 4 ? 4 : 0);
		if (grade >= 4) expect(determineGameType(ps as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer], [])).toBe("혼합");
	});
	it.each([0, 2, 4])("여성 %i명인 일반 복식을 허용한다", women => {
		const ps = Array.from({ length: 4 }, (_, i) => player(String(i), { gender: i < women ? "F" : "M" }));
		expect(fill(ps)).toHaveLength(4);
	});
	it("여3남1은 자동으로 완성하지 않는다", () => {
		const ps = Array.from({ length: 4 }, (_, i) => player(String(i), { gender: i < 3 ? "F" : "M" }));
		expect(fill(ps)).toEqual([]);
		expect(recommendTeammates(ps.slice(0, 3), ps.slice(3), context())).toEqual([]);
	});
	it("대기자 네 명의 성별 구성이 불가하면 경기중 한 명으로 허용 구성을 완성한다", () => {
		const ps = ["a", "b", "c"].map(id => player(id));
		ps.push(player("low", { gender: "F", skills: { grade: 3 } }), player("busy-woman", { gender: "F", skills: { grade: 4 } }));
		const ctx = context({ playingIds: new Set(["busy-woman"]) });
		const selected = fill(ps, ctx);
		expect(ids(selected)).toContain("busy-woman");
		expect(allowedGameType(selected)).not.toBeNull();
	});
	it("한 팀의 선택으로 두 번째 코트가 불가능해지지 않게 한다", () => {
		const ps = Array.from({ length: 6 }, (_, i) => player(`m${i}`));
		ps.push(player("high", { gender: "F", skills: { grade: 4 } }), player("low", { gender: "F", skills: { grade: 3 } }));
		const picked = fill(ps);
		expect(groupCapacity(6, 1, 1)).toBe(2);
		expect(allowedGameType(picked)).not.toBeNull();
		expect(allowedGameType(ps.filter(p => !picked.includes(p)))).not.toBeNull();
	});
	it("수동 확정 멤버로 최대 코트 수가 불가능해져도 그 멤버를 바꾸지 않는다", () => {
		const fixed = ["a", "b", "c"].map(id => player(id));
		const pool = ["d", "e", "f"].map(id => player(id));
		pool.push(player("high", { gender: "F", skills: { grade: 4 } }), player("low", { gender: "F", skills: { grade: 3 } }));
		const chosen = autoFillTeammates([...fixed, pool[3]], pool.filter(p => p.id !== "high"), context(), 1);
		expect(chosen).toEqual([]); // Already complete; fixed members are untouched.
		const selected = autoFillTeammates(fixed, [pool[3], pool[4]], context(), 1);
		expect(ids(selected)).toEqual(["high"]);
	});
	it("새 만남 때문에 추천용 판수가 두 판 이상 앞선 사람을 우대하지 않는다", () => {
		const waiting = ["a", "b", "c", "d"].map(id => player(id, { gameCount: 4 }));
		const late = player("late", { gameCount: 6 });
		const ctx = context({ groupHistory: [group("old", ids(waiting))] });
		expect(ids(fill([...waiting, late], ctx))).toEqual(ids(waiting));
	});
	it("중복 우선순위가 같으면 오래 기다린 사람의 조합을 선호한다", () => {
		vi.spyOn(Date, "now").mockReturnValue(epoch);
		try {
			const ps = ["a", "b", "c", "d", "old"].map(id => player(id, { waitSince: new Date(epoch - (id === "old" ? 20 : 1) * 60000).toISOString() }));
			expect(ids(fill(ps))).toContain("old");
		} finally { vi.restoreAllMocks(); }
	});
	it("경기중 시간은 대기 점수를 받지 않는다", () => {
		const fixed = [player("a"), player("b"), player("c")];
		const ps = [player("busy-old", { waitSince: new Date(0).toISOString() }), player("busy-new")];
		const ranked = recommendTeammates(fixed, ps, context({ playingIds: new Set(ids(ps)) }));
		expect(ranked[0].priority.quality).toBe(ranked[1].priority.quality);
	});
	it("개별 탐욕 선발 대신 고정 멤버와 최선의 전체 조합을 선택하고 추천과 일치한다", () => {
		const ps = Array.from({ length: 8 }, (_, i) => player(String(i)));
		const ctx = context({ groupHistory: [group("one", ["0", "1", "2", "3"]), group("two", ["4", "5", "6", "7"])] });
		const chosen = autoFillTeammates([ps[0]], ps.slice(1), ctx, 3);
		const ranked = recommendTeammates([ps[0]], ps.slice(1), ctx);
		expect(ids(chosen)).toContain(ranked[0].player.id);
		const groupIds = new Set(["0", ...ids(chosen)]);
		expect([...groupIds].filter(id => Number(id) < 4)).toHaveLength(2);
	});
	it("휴식·미확인·중복 ID·확정 멤버를 후보에서 제거하고 콕 체크 OFF는 허용한다", () => {
		const ps = [player("a"), player("b"), player("c"), player("unchecked", { cockChecked: false }), player("resting", { status: "resting" })];
		expect(ids(fill([...ps, ps[0]], context({ cockCheckEnabled: false })))).toEqual(["a", "b", "c", "unchecked"]);
		expect(ids(fill(ps, context({ cockCheckEnabled: true })))).toEqual(["a", "b", "c"]);
		expect(ids(autoFillTeammates([ps[0]], ps, context(), 3))).not.toContain("a");
	});
	it("후보 부족 시 가능한 부분 팀만 반환하고 요청 수와 네 명 상한을 지킨다", () => {
		const fixed = [player("a")], pool = [player("b"), player("c")];
		expect(autoFillTeammates(fixed, pool, context(), 3)).toHaveLength(2);
		expect(autoFillTeammates(fixed, pool, context(), 1)).toHaveLength(1);
		expect(autoFillTeammates(fixed, pool, context(), 0)).toEqual([]);
		expect(autoFillTeammates(fixed, pool, context(), NaN)).toEqual([]);
	});
	it("풀과 이력을 변경하지 않으며 32명을 넘는 ID도 구분한다", () => {
		const ps = Array.from({ length: 36 }, (_, i) => player(`p${i}`, { gameCount: i < 32 ? 20 : 0 }));
		const ctx = context({ groupHistory: [group("old", ["p0", "p1", "p2", "p3"])] });
		const before = structuredClone({ ps, ctx });
		expect(ids(fill(ps, ctx))).toEqual(["p32", "p33", "p34", "p35"]);
		expect({ ps, ctx }).toEqual(before);
	});
});

describe("개인별 실력대 교류 보정", () => {
	const ps = [1, 2, 4, 5, 8, 9, 3, 10].map((grade, i) => player(String(i), { skills: { grade } }));
	const active = new Set(ids(ps));
	it("본인이 출전한 완료 경기만 쌓고 반대 실력대를 만나면 0으로 초기화한다", () => {
		const history = [group("a", ["0", "1", "2", "3"], 1), group("b", ["0", "1", "4", "5"], 2), group("c", ["0", "1", "2", "3"], 3)];
		const state = buildExchangeState(ps, history, active, epoch + 4 * 60000);
		expect(state.gaps.get("0")).toBe(1);
		expect(state.gaps.get("4")).toBe(0);
		expect(state.gaps.get("6")).toBe(0);
		expect(state.targets.get("0")).toEqual([2]);
	});
	it("완료 시각으로 정렬해 새로고침·역순 수신·중복 수신에도 같은 교류 공백을 얻는다", () => {
		const history = [group("a", ["0", "1", "2", "3"], 1), group("b", ["0", "1", "4", "5"], 2)];
		expect(buildExchangeState(ps, [history[1], history[0], history[1]], active, epoch + 3 * 60000))
			.toEqual(buildExchangeState(ps, history, active, epoch + 3 * 60000));
	});
	it("반대 구간이 없으면 존재하는 다른 구간을 대상으로 하고 단일 구간은 빚을 만들지 않는다", () => {
		const state = buildExchangeState(ps.slice(0, 4), [], new Set(["0", "1", "2", "3"]), epoch);
		expect(state.targets.get("0")).toEqual([1]);
		const one = buildExchangeState(ps.slice(0, 2), [group("a", ["0", "1"])], new Set(["0", "1"]), epoch + 1000);
		expect(exchangeCost(["0", "1"], one)).toBe(0);
	});
	it("늦게 합류한 반대 실력대 때문에 합류 전 경기부터 빚을 만들지 않는다", () => {
		const people = ps.map(p => ({ ...p, joinedAt: new Date(epoch + (p.skills.grade >= 7 ? 3 * 60000 : 0)).toISOString() }));
		const history = [group("a", ["0", "1", "2", "3"], 1), group("b", ["0", "1", "2", "3"], 2)];
		const state = buildExchangeState(people, history, active, epoch + 4 * 60000);
		expect(state.gaps.get("0")).toBe(0);
		expect(state.targets.get("0")).toEqual([2]);
	});
	it("반대 구간을 못 만난 출전이 늘면 고정된 근접 선호를 넘어선다", () => {
		const low = ["a", "b", "c", "d"].map(id => player(id, { skills: { grade: 1 } }));
		const high = ["e", "f", "g", "h"].map(id => player(id, { skills: { grade: 10 } }));
		const people = [...low, ...high];
		const state = buildExchangeState(people, [], new Set(ids(people)), epoch);
		state.gaps.forEach((_, id) => state.gaps.set(id, 8));
		expect(81 + exchangeCost(["a", "b", "e", "f"], state)).toBeLessThan(exchangeCost(ids(low), state));
		const ctx = context({ players: people });
		expect(new Set(fill(people, ctx).map(p => p.skills.grade)).size).toBe(1);
	});
	it("실력 가중치 0은 교류 이력 때문에 순서를 바꾸지 않는다", () => {
		const ctx = context({ players: ps, groupHistory: [group("a", ["0", "1", "2", "3"])] });
		const weights = { ...RECOMMEND_WEIGHTS, W_SKILL: 0 };
		const a = autoFillTeammates([], ps, ctx, 4, weights);
		const b = autoFillTeammates([], ps.map(p => ({ ...p, skills: { grade: 5 } })), ctx, 4, weights);
		expect(ids(a)).toEqual(ids(b));
	});
});

// 2026-09-22 조사: 현재 동작을 기록한다. 재출전 우선순위 변경은 별도 정책 결정 대상이다.
describe("경기 완료 직후 재편성 재현 — 알고리즘 변경 없음", () => {
	it("기존 대기 4명이 한 번 함께 경기했으면 방금 끝난 선수 2명을 다시 고른다", () => {
		vi.spyOn(Date, "now").mockReturnValue(epoch);
		try {
			const waiting = ["a", "b", "c", "d"].map(id => player(id, {
				gameCount: 1, waitSince: new Date(epoch - 20 * 60000).toISOString(),
			}));
			const ended = ["e", "f", "g", "h"].map(id => player(id, {
				gameCount: 2, waitSince: new Date(epoch).toISOString(),
			}));
			const ctx = context({ groupHistory: [group("waiting-old", ids(waiting), -20), group("just-ended", ids(ended))] });
			const selected = fill([...waiting, ...ended], ctx);
			expect(selected.filter(p => ended.includes(p))).toHaveLength(2);
			expect(selected.filter(p => waiting.includes(p))).toHaveLength(2);
			// 대조군: 반복 이력만 빼면 판수/대기시간 점수에 따라 기존 대기 4명 모두 선택된다.
			expect(ids(fill([...waiting, ...ended], context()))).toEqual(ids(waiting));
		} finally { vi.restoreAllMocks(); }
	});
});
