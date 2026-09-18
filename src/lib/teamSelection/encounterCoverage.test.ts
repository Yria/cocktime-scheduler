import { describe, expect, it } from "vitest";
import type { GroupHistoryEntry, SessionPlayer } from "../../types";
import { recommendTeammates, type RecommendContext } from "./recommendTeammates";

function player(id: string): SessionPlayer {
	return { id, playerId: id, memberId: null, name: id, gender: "M", skills: { grade: 5 }, allowMixedSingle: false,
		status: "waiting", gameCount: 0, mixedCount: 0, waitSince: null, joinedAtMatch: 0, cockChecked: true };
}
function ctx(groupHistory: GroupHistoryEntry[] = []): RecommendContext {
	return { groupHistory, playingIds: new Set(), lastGameType: {} };
}
const group = (matchId: string, ...members: string[]) => ({ matchId, members });
function score(history: GroupHistoryEntry[], members: string[]) {
	return recommendTeammates(members.slice(0, 3).map(player), [player(members[3])], ctx(history))[0].priority;
}

describe("네 명 전체의 반복 동반 비용", () => {
	it.each([[1, 0, 0], [2, 1, 1], [3, 2, 3], [4, 3, 6]])("과거와 %i명 겹침 → 최대 겹침 단계 %i, 반복 쌍 %i", (overlap, maximum, pairs) => {
		const members = ["a", "b", "c", "d"];
		const history = [group("m", ...members.slice(0, overlap), ...["x", "y", "z"].slice(0, 4 - overlap))];
		const result = score(history, members);
		expect(result.maximumOverlap).toBe(maximum);
		expect(result.repeatedPairs).toBe(pairs);
	});
	it("같은 두 사람의 반복 횟수를 모든 완료 경기에서 누적한다", () => {
		const result = score([group("m1", "a", "b", "x", "y"), group("m2", "a", "b", "w", "z")], ["a", "b", "c", "d"]);
		expect(result.maximumOverlap).toBe(1);
		expect(result.repeatedPairs).toBe(2);
	});
	it("같은 경기의 중복 수신은 비용을 두 번 더하지 않는다", () => {
		const history = group("m", "a", "b", "c", "d");
		expect(score([history, history], ["a", "b", "c", "d"])).toEqual(score([history], ["a", "b", "c", "d"]));
	});
	it("완료하지 않은 경기는 완료 이력과 교류 공백에 미리 반영하지 않는다", () => {
		const context = { ...ctx(), ongoingGroups: [["a", "b", "c", "d"]] };
		const result = recommendTeammates(["a", "b", "c"].map(player), [player("d")], context)[0].priority;
		expect(result.maximumOverlap).toBe(0);
		expect(result.repeatedPairs).toBe(0);
	});
	it("3명 중복보다 2명 중복을, 같은 최대 겹침이면 반복 쌍이 적은 조합을 먼저 추천한다", () => {
		const context = ctx([group("m1", "a", "b", "repeat-three", "x"), group("m2", "a", "repeat-two", "y", "z")]);
		const ranked = recommendTeammates(["a", "b", "c"].map(player), ["repeat-three", "repeat-two", "fresh"].map(player), context);
		expect(ranked.map(r => r.player.id)).toEqual(["fresh", "repeat-two", "repeat-three"]);
	});
});
