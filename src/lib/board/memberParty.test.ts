import { describe, expect, it } from "vitest";
import type { Court, SessionPlayer } from "../../types";
import { getMemberPartyCandidates, selectMemberParty } from "./memberParty";
import type { RecommendPoolInputs } from "./recommendPool";

function player(id: string, overrides: Partial<SessionPlayer> = {}): SessionPlayer {
	return {
		id,
		playerId: id,
		memberId: `member-${id}`,
		name: id,
		gender: "M",
		skills: { grade: 5 },
		allowMixedSingle: false,
		status: "waiting",
		gameCount: 0,
		mixedCount: 0,
		waitSince: null,
		joinedAtMatch: 0,
		cockChecked: true,
		...overrides,
	};
}

function makeInputs(players: SessionPlayer[]): RecommendPoolInputs {
	return {
		sessionPlayers: new Map(players.map((p) => [p.id, p])),
		magnets: new Map(players.map((p) => [p.id, { playerId: p.id, x: 0, y: 0, teamId: null }])),
		drafts: new Map(),
		reservations: new Map(),
		courts: [],
		groupHistory: [],
		lastGameType: {},
		cockCheckEnabled: false,
	};
}

describe("selectMemberParty", () => {
	it("4명 초과 홀드 시 경기수가 적은 회원을 우선하고 첫 참가자나 미참가자를 고정 선발하지 않는다", () => {
		const inputs = makeInputs([
			player("outsider"),
			player("first-holder", { gameCount: 12 }),
			...Array.from({ length: 4 }, (_, i) => player(`p${i}`, { gameCount: i + 1 })),
		]);
		const held = ["first-holder", "p3", "p2", "p1", "p0"];

		expect(selectMemberParty(held, inputs)?.sort()).toEqual(["p0", "p1", "p2", "p3"]);
	});

	it("홀드 후보 안에서 기존 그룹 이력을 반영해 완전 재결성을 피한다", () => {
		const inputs = makeInputs([
			...["a", "b", "c", "d"].map((id) => player(id)),
			player("e", { gameCount: 1 }),
		]);
		const held = ["a", "b", "c", "d", "e"];
		expect(selectMemberParty(held, inputs)?.sort()).toEqual(["a", "b", "c", "d"]);

		inputs.groupHistory = [{ matchId: "previous", members: ["a", "b", "c", "d"] }];
		expect(selectMemberParty(held, inputs)?.sort()).toEqual(["a", "b", "c", "e"]);
	});

	it("선발된 4명을 실력 균형에 맞춰 앞 2명과 뒤 2명의 페어로 반환한다", () => {
		const players = [1, 4, 6, 9].map((grade) => player(`p${grade}`, { skills: { grade } }));
		const inputs = makeInputs(players);
		const selected = selectMemberParty(players.map((p) => p.id), inputs)!;
		const total = (ids: string[]) => ids.reduce((sum, id) => sum + inputs.sessionPlayers.get(id)!.skills.grade, 0);

		expect(new Set(selected).size).toBe(4);
		expect(total(selected.slice(0, 2))).toBe(10);
		expect(total(selected.slice(2))).toBe(10);
	});

	it.each([0, 1, 2, 3])("홀드한 회원이 %i명이면 전체 대기자가 충분해도 취소한다", (count) => {
		const players = ["a", "b", "c", "d", "e"].map((id) => player(id));
		expect(selectMemberParty(players.slice(0, count).map((p) => p.id), makeInputs(players))).toBeNull();
	});

	it("중복 홀드는 한 명으로 세며 유효한 회원 4명만 선발한다", () => {
		const inputs = makeInputs(["a", "b", "c", "d"].map((id) => player(id)));
		expect(selectMemberParty(["a", "a", "b", "b", "c"], inputs)).toBeNull();
		expect(selectMemberParty(["a", "a", "b", "c", "d", "d"], inputs)?.sort()).toEqual(["a", "b", "c", "d"]);
	});

	it.each([
		"status-playing",
		"court-playing",
		"reserved",
		"anchored",
		"draft-before-magnet-sync",
		"resting",
		"cock-unchecked",
		"nonmember",
		"missing-magnet",
		"missing-player",
	])("%s 참가자는 제외하고 남은 3명으로는 파티를 만들지 않는다", (reason) => {
		const candidate = player("excluded");
		if (reason === "status-playing") candidate.status = "playing";
		if (reason === "resting") candidate.status = "resting";
		if (reason === "cock-unchecked") candidate.cockChecked = false;
		if (reason === "nonmember") candidate.memberId = null;
		const inputs = makeInputs([candidate, ...["a", "b", "c", "outsider"].map((id) => player(id))]);
		if (reason === "court-playing") {
			inputs.courts = [{
				id: 1,
				match: {
					id: "active-match",
					courtId: 1,
					gameType: "남복",
					teamA: ["excluded", "other1"],
					teamB: ["other2", "other3"],
					startedAt: "2026-09-06T00:00:00Z",
				},
			}] satisfies Court[];
		}
		if (reason === "reserved") {
			inputs.reservations = new Map([["res", { id: "res", playerId: "excluded", teamId: "other-team", createdAt: 0 }]]);
		}
		if (reason === "anchored") {
			inputs.magnets = new Map([...inputs.magnets, ["excluded", { playerId: "excluded", x: 0, y: 0, teamId: "other-team" }]]);
		}
		if (reason === "anchored" || reason === "draft-before-magnet-sync") {
			inputs.drafts = new Map([["other-team", { id: "other-team", anchorMemberIds: ["excluded"], anchor: { x: 0, y: 0 }, createdAt: 0 }]]);
		}
		if (reason === "cock-unchecked") inputs.cockCheckEnabled = true;
		if (reason === "missing-magnet") inputs.magnets = new Map([...inputs.magnets].filter(([id]) => id !== "excluded"));
		if (reason === "missing-player") inputs.sessionPlayers = new Map([...inputs.sessionPlayers].filter(([id]) => id !== "excluded"));

		expect(selectMemberParty(["excluded", "a", "b", "c"], inputs)).toBeNull();
		expect(getMemberPartyCandidates(inputs).map((p) => p.id)).toEqual(["a", "b", "c", "outsider"]);
	});

	it("입력 배열과 보드·선수·이력을 수정하지 않는다", () => {
		const held = Object.freeze(["a", "b", "c", "d", "e"]);
		const inputs = makeInputs(held.map((id) => player(id)));
		inputs.groupHistory = [{ matchId: "previous", members: ["a", "b", "c", "d"] }];
		inputs.lastGameType = { a: "남복" };
		const before = structuredClone(inputs);

		expect(selectMemberParty(held, inputs)).toHaveLength(4);
		expect(inputs).toEqual(before);
		expect(held).toEqual(["a", "b", "c", "d", "e"]);
	});
});
