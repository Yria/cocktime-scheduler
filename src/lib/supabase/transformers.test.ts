import { describe, it, expect } from "vitest";
import { matchLogTeams, type LogPlayer } from "./transformers";
import type { MatchRow, PlayerSnapshotEntry } from "./types";

const skills = { 클리어: "V", 스매시: "V", 로테이션: "V", 드랍: "V", 헤어핀: "V", 푸시: "V" } as const;

function snap(id: string, name: string): PlayerSnapshotEntry {
	return { id, name, gender: "M", skills: { ...skills } };
}

function match(over: Partial<MatchRow>): MatchRow {
	return {
		id: "m1",
		session_id: 1,
		court_id: 1,
		game_type: "남복",
		team_a_p1: "a1",
		team_a_p2: "a2",
		team_b_p1: "b1",
		team_b_p2: "b2",
		status: "completed",
		started_at: "",
		ended_at: "",
		player_snapshot: null,
		assigned_by: null,
		...over,
	};
}

const pm = (entries: [string, LogPlayer][]) => new Map(entries);

describe("matchLogTeams", () => {
	it("스냅샷이 있으면 스냅샷 이름을 쓴다(선수가 현재 맵에 없어도 = 삭제됨)", () => {
		const m = match({
			player_snapshot: [snap("a1", "철수"), snap("a2", "영희"), snap("b1", "민수"), snap("b2", "지은")],
		});
		const { teamA, teamB } = matchLogTeams(m, pm([])); // 현재 선수 맵 비어있음(전원 삭제)
		expect(teamA.map((p) => p.name)).toEqual(["철수", "영희"]);
		expect(teamB.map((p) => p.name)).toEqual(["민수", "지은"]);
	});

	it("스냅샷이 없으면 현재 선수 맵으로 폴백(구 매치)", () => {
		const m = match({ player_snapshot: null });
		const map = pm([
			["a1", { name: "철수", gender: "M" }],
			["a2", { name: "영희", gender: "F" }],
			["b1", { name: "민수", gender: "M" }],
			["b2", { name: "지은", gender: "F" }],
		]);
		const { teamA, teamB } = matchLogTeams(m, map);
		expect(teamA.map((p) => p.name)).toEqual(["철수", "영희"]);
		expect(teamB.map((p) => p.name)).toEqual(["민수", "지은"]);
	});

	it("스냅샷도 없고 맵에도 없으면 '?' (복구 불가 구 데이터)", () => {
		const m = match({ player_snapshot: null });
		const { teamA } = matchLogTeams(m, pm([["a2", { name: "영희", gender: "F" }]]));
		expect(teamA[0].name).toBe("?"); // a1 미존재
		expect(teamA[1].name).toBe("영희");
	});

	it("스냅샷 일부가 null(삭제된 위치)이면 그 위치만 맵 폴백", () => {
		const m = match({ player_snapshot: [snap("a1", "철수"), null, snap("b1", "민수"), snap("b2", "지은")] });
		const map = pm([["a2", { name: "영희(현재)", gender: "F" }]]);
		const { teamA } = matchLogTeams(m, map);
		expect(teamA[0].name).toBe("철수"); // 스냅샷
		expect(teamA[1].name).toBe("영희(현재)"); // null 위치 → 맵 폴백
	});
});
