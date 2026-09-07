import { describe, expect, it } from "vitest";
import type { GroupHistoryEntry, SessionPlayer } from "../../types";
import { autoFillTeammates, recommendTeammates, RECOMMEND_WEIGHTS, type RecommendContext } from "./recommendTeammates";

function player(id: string, gameCount = 0): SessionPlayer {
	return {
		id, playerId: id, memberId: null, name: id, gender: "M", skills: { grade: 5 },
		allowMixedSingle: false, status: "waiting", gameCount, mixedCount: 0,
		waitSince: null, joinedAtMatch: 0, cockChecked: true,
	};
}
function ctx(groupHistory: GroupHistoryEntry[] = []): RecommendContext {
	return { groupHistory, playingIds: new Set(), lastGameType: {} };
}
function group(matchId: string, ...members: string[]): GroupHistoryEntry {
	return { matchId, members };
}

describe("같은 경기에서 아직 만나지 못한 상대와의 만남", () => {
	it("횟수가 조금 적은 기존 조합보다 새로운 두 쌍을 만드는 후보를 선택한다", () => {
		const confirmed = ["s1", "s2", "s3"].map(id => player(id));
		const a = player("a", 4);
		const b = player("b", 4);
		const history = [
			...Array.from({ length: 4 }, (_, i) => group(`a${i}`, "a", "s1", `x${i}`, `y${i}`)),
			...confirmed.map((s, i) => group(`b${i}`, "b", s.id, `u${i}`, `v${i}`)),
		];
		const old = recommendTeammates(confirmed, [a, b], ctx(history), { ...RECOMMEND_WEIGHTS, W_NEW_ENCOUNTER: 0 });
		const improved = recommendTeammates(confirmed, [a, b], ctx(history));
		expect(old[0].player.id).toBe("b");
		expect(improved[0].player.id).toBe("a");
		expect(improved[0].breakdown?.encounter).toBe(-24);
		expect(improved.find(row => row.player.id === "b")?.breakdown?.encounter).toBe(0);
	});

	it("첫 선발에서는 지금 후보들 중 만난 사람이 적은 참가자를 우대한다", () => {
		const pool = ["a", "b", "c", "isolated"].map(id => player(id));
		const ranked = recommendTeammates([], pool, ctx([group("m", "a", "b", "c", "absent")]));
		expect(ranked[0].player.id).toBe("isolated");
		expect(ranked[0].breakdown?.encounter).toBe(-12);
		expect(ranked.find(row => row.player.id === "a")?.breakdown?.encounter).toBe(-4);
	});

	it("이력이 없는 첫 경기에는 모두 같은 보너스로 기존 동점 순서를 유지한다", () => {
		const pool = ["c", "a", "b", "d"].map(id => player(id));
		const ranked = recommendTeammates([], pool, ctx());
		expect(ranked.map(row => row.player.id)).toEqual(["c", "a", "b", "d"]);
		expect(ranked.every(row => row.breakdown?.encounter === -12)).toBe(true);
	});

	it("같은 상대의 이력이 여러 번 있어도 미만남 인원은 한 번만 차감한다", () => {
		const confirmed = ["a", "b", "c"].map(id => player(id));
		const candidate = player("x");
		const once = [group("m1", "a", "x", "other1", "other2")];
		const repeated = [...once, group("m2", "a", "x", "other3", "other4")];
		const cost = (history: GroupHistoryEntry[]) => recommendTeammates(confirmed, [candidate], ctx(history))[0].breakdown?.encounter;
		expect(cost(once)).toBe(-24);
		expect(cost(repeated)).toBe(-24);
	});

	it("진행 중인 경기의 두 사람은 첫 만남으로 다시 보상하지 않는다", () => {
		const context = { ...ctx(), ongoingGroups: [["a", "x", "other1", "other2"]] };
		const ranked = recommendTeammates([player("a")], [player("x"), player("new")], context);
		expect(ranked.find(row => row.player.id === "x")?.breakdown?.encounter).toBe(0);
		expect(ranked.find(row => row.player.id === "x")?.breakdown?.group).toBe(0); // No premature completion penalty.
		expect(ranked.find(row => row.player.id === "new")?.breakdown?.encounter).toBe(-12);
	});

	it("이미 모두 만났거나 후보가 혼자면 첫 선발 보너스는 0이다", () => {
		const ranked = recommendTeammates([], [player("a"), player("b")], ctx([group("m", "a", "b")]));
		expect(ranked.every(row => row.breakdown?.encounter === 0)).toBe(true);
		const single = recommendTeammates([], [player("a")], ctx());
		expect(single[0].breakdown?.encounter).toBe(0);
		expect(Number.isFinite(single[0].score)).toBe(true);
	});

	it("현재 후보에 없는 과거 상대의 수는 첫 선발의 분모에 넣지 않는다", () => {
		const context = ctx([group("m", "a", "outside1", "outside2", "outside3")]);
		const ranked = recommendTeammates([], [player("a"), player("b")], context);
		expect(ranked.map(row => row.breakdown?.encounter)).toEqual([-12, -12]);
	});

	it("경기 중 선발 상한에 걸린 사람은 첫 선발의 만남 기회에서도 제외한다", () => {
		const context = {
			...ctx([group("m1", "a", "b", "c"), group("m2", "a", "playing")]),
			playingIds: new Set(["playing"]),
		};
		const pool = ["a", "b", "c", "playing"].map(id => player(id));
		const chosen = autoFillTeammates([], pool, context, 1, undefined, { maxPlaying: 0 });
		expect(chosen.map(p => p.id)).toEqual(["a"]);
	});

	it("새 만남 보정만으로는 4판 차이를 뒤집지 않으며 보너스는 최대 36점이다", () => {
		const confirmed = ["s1", "s2", "s3"].map(id => player(id));
		// Direct group penalties disabled to isolate the new bonus's finite bound.
		const weights = { ...RECOMMEND_WEIGHTS, W_GROUP2: 0, W_GROUP3: 0, W_GROUP4: 0 };
		const history = [group("m", "old", "s1", "s2", "s3")];
		const ranked = recommendTeammates(confirmed, [player("new", 4), player("old", 0)], ctx(history), weights);
		expect(ranked[0].player.id).toBe("old");
		expect(ranked.find(row => row.player.id === "new")?.breakdown?.encounter).toBe(-36);
	});
});
