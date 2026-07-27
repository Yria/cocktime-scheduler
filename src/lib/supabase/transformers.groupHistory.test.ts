import { describe, it, expect } from "vitest";
import { matchRowsToGroupHistory, mergeGroupHistory } from "./transformers";
import type { CompletedMatchTeamRow } from "./types";

function row(id: string, members: (string | null)[]): CompletedMatchTeamRow {
	return {
		id,
		team_a_p1: members[0] ?? null,
		team_a_p2: members[1] ?? null,
		team_b_p1: members[2] ?? null,
		team_b_p2: members[3] ?? null,
		game_type: "남복",
		ended_at: null,
	};
}

describe("matchRowsToGroupHistory — 완료 매치 → 그룹 이력 파생", () => {
	it("매치당 {matchId, 4인 members} 한 항목을 만든다", () => {
		const gh = matchRowsToGroupHistory([row("m1", ["a", "b", "c", "d"])]);
		expect(gh).toEqual([{ matchId: "m1", members: ["a", "b", "c", "d"] }]);
	});

	it("선수 삭제(FK SET NULL)로 비워진 자리는 members에서 제외한다", () => {
		const gh = matchRowsToGroupHistory([row("m1", ["a", null, "c", "d"])]);
		expect(gh[0].members).toEqual(["a", "c", "d"]);
	});
});

describe("mergeGroupHistory — resync 병합(matchId 집합 기준)", () => {
	const g = (matchId: string) => ({ matchId, members: [matchId + "-p1"] });

	it("서버에 새 항목이 없으면 로컬 참조를 그대로 반환한다(재렌더 방지)", () => {
		const local = [g("m1"), g("m2")];
		expect(mergeGroupHistory(local, [g("m1")])).toBe(local);
		expect(mergeGroupHistory(local, [])).toBe(local); // 조회 실패([])가 로컬을 지우지 않는다
	});

	it("서버가 새 항목을 가지면 서버 목록 + 로컬 선반영분(서버에 없는 것)으로 병합한다", () => {
		// broadcast 유실로 로컬이 m2를 놓친 상태 → 서버가 백필
		const merged = mergeGroupHistory([g("m1")], [g("m1"), g("m2")]);
		expect(merged.map((x) => x.matchId).sort()).toEqual(["m1", "m2"]);
	});

	it("로컬 선반영분(서버 스냅샷 이후 완료)은 병합 후에도 보존되고 중복이 없다", () => {
		// 서버 스냅샷(m1, m3-신규)과 그 직후 로컬 append(m2)가 공존 — 어느 쪽도 잃지 않는다
		const merged = mergeGroupHistory([g("m1"), g("m2")], [g("m1"), g("m3")]);
		expect(merged.map((x) => x.matchId).sort()).toEqual(["m1", "m2", "m3"]);
		expect(new Set(merged.map((x) => x.matchId)).size).toBe(merged.length);
	});
});
