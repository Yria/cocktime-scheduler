import { describe, it, expect } from "vitest";
import {
	teamMembers,
	teamMemberCount,
	isMemberOf,
	deriveLifecycle,
	isTeamStartable,
	playingIdsFromCourts,
	cockPendingIds,
} from "./membership";
import type { DraftTeam, MagnetPosition, Reservation } from "../../types/board";
import type { Court, SessionPlayer } from "../../types";

function mag(playerId: string, teamId: string | null = null): MagnetPosition {
	return { playerId, x: 0, y: 0, teamId };
}
function draft(id: string, anchorMemberIds: string[]): DraftTeam {
	return { id, anchorMemberIds, anchor: { x: 0, y: 0 }, createdAt: 0 };
}
function res(id: string, playerId: string, teamId: string, createdAt = 0): Reservation {
	return { id, playerId, teamId, createdAt };
}
function mapOf<T extends { id?: string; playerId?: string }>(items: T[], key: (t: T) => string): Map<string, T> {
	return new Map(items.map((t) => [key(t), t]));
}

describe("teamMembers", () => {
	it("anchor 먼저, ghost는 createdAt 순으로 뒤에 붙고 슬롯 0..n", () => {
		const drafts = mapOf([draft("T", ["a", "b"])], (d) => d.id);
		const reservations = mapOf(
			[res("r2", "d", "T", 200), res("r1", "c", "T", 100)],
			(r) => r.id,
		);
		const members = teamMembers("T", drafts, reservations);
		expect(members).toEqual([
			{ playerId: "a", kind: "anchor", slot: 0 },
			{ playerId: "b", kind: "anchor", slot: 1 },
			{ playerId: "c", kind: "ghost", slot: 2 },
			{ playerId: "d", kind: "ghost", slot: 3 },
		]);
	});

	it("같은 선수가 anchor이자 ghost면 중복 제거(anchor 유지)", () => {
		const drafts = mapOf([draft("T", ["a"])], (d) => d.id);
		const reservations = mapOf([res("r1", "a", "T")], (r) => r.id);
		const members = teamMembers("T", drafts, reservations);
		expect(members).toHaveLength(1);
		expect(members[0]).toEqual({ playerId: "a", kind: "anchor", slot: 0 });
	});
});

describe("teamMemberCount / isMemberOf", () => {
	const drafts = mapOf([draft("T", ["a", "b"])], (d) => d.id);
	const reservations = mapOf([res("r1", "c", "T")], (r) => r.id);
	it("anchor + ghost 합산", () => {
		expect(teamMemberCount("T", drafts, reservations)).toBe(3);
	});
	it("anchor도 ghost도 멤버", () => {
		expect(isMemberOf("a", "T", drafts, reservations)).toBe(true);
		expect(isMemberOf("c", "T", drafts, reservations)).toBe(true);
		expect(isMemberOf("z", "T", drafts, reservations)).toBe(false);
	});
});

describe("deriveLifecycle", () => {
	const magnets = mapOf([mag("p", "T"), mag("q", null)], (m) => m.playerId);
	it("playingIds에 있으면 playing(다른 상태보다 우선)", () => {
		expect(deriveLifecycle("p", magnets, new Set(["p"]))).toBe("playing");
	});
	it("teamId 있으면 anchored", () => {
		expect(deriveLifecycle("p", magnets, new Set())).toBe("anchored");
	});
	it("teamId 없으면 free", () => {
		expect(deriveLifecycle("q", magnets, new Set())).toBe("free");
	});
});

describe("isTeamStartable", () => {
	it("4명 전원 free(또는 자기 팀 anchor)면 true", () => {
		const drafts = mapOf([draft("T", ["a", "b", "c", "d"])], (d) => d.id);
		const magnets = mapOf(["a", "b", "c", "d"].map((id) => mag(id, "T")), (m) => m.playerId);
		expect(isTeamStartable("T", drafts, new Map(), magnets, new Set())).toBe(true);
	});
	it("4명 미만이면 false", () => {
		const drafts = mapOf([draft("T", ["a", "b", "c"])], (d) => d.id);
		const magnets = mapOf(["a", "b", "c"].map((id) => mag(id, "T")), (m) => m.playerId);
		expect(isTeamStartable("T", drafts, new Map(), magnets, new Set())).toBe(false);
	});
	it("멤버 중 경기중이 있으면 false", () => {
		const drafts = mapOf([draft("T", ["a", "b", "c", "d"])], (d) => d.id);
		const magnets = mapOf(["a", "b", "c", "d"].map((id) => mag(id, "T")), (m) => m.playerId);
		expect(isTeamStartable("T", drafts, new Map(), magnets, new Set(["c"]))).toBe(false);
	});
	it("ghost 멤버가 다른 팀에 anchor로 묶여 있으면 false", () => {
		const drafts = mapOf([draft("T", ["a", "b", "c"]), draft("OTHER", ["d"])], (d) => d.id);
		const reservations = mapOf([res("r1", "d", "T")], (r) => r.id);
		const magnets = mapOf(
			[mag("a", "T"), mag("b", "T"), mag("c", "T"), mag("d", "OTHER")],
			(m) => m.playerId,
		);
		expect(isTeamStartable("T", drafts, reservations, magnets, new Set())).toBe(false);
	});
	it("ghost 멤버가 free면 true", () => {
		const drafts = mapOf([draft("T", ["a", "b", "c"])], (d) => d.id);
		const reservations = mapOf([res("r1", "d", "T")], (r) => r.id);
		const magnets = mapOf(
			[mag("a", "T"), mag("b", "T"), mag("c", "T"), mag("d", null)],
			(m) => m.playerId,
		);
		expect(isTeamStartable("T", drafts, reservations, magnets, new Set())).toBe(true);
	});
});

describe("playingIdsFromCourts", () => {
	it("코트 match의 teamA/teamB를 모두 모은다", () => {
		const courts: Court[] = [
			{ id: 1, match: { id: "m", courtId: 1, gameType: "남복", teamA: ["a", "b"], teamB: ["c", "d"], startedAt: "" } },
			{ id: 2, match: null },
		];
		expect(playingIdsFromCourts(courts)).toEqual(new Set(["a", "b", "c", "d"]));
	});
});

describe("cockPendingIds", () => {
	const sp = (id: string, cockChecked: boolean): SessionPlayer => ({
		id, playerId: id, memberId: null, name: id, gender: "M",
		skills: { grade: 5 },
		allowMixedSingle: false, status: "waiting", gameCount: 0, mixedCount: 0,
		waitSince: null, joinedAtMatch: 0, cockChecked,
	});
	it("콕체크 on이면 미확인(cockChecked=false) id만 반환", () => {
		const ids = cockPendingIds([sp("a", true), sp("b", false), sp("c", false)], true);
		expect([...ids].sort()).toEqual(["b", "c"]);
	});
	it("콕체크 off면 빈 집합(전원 매칭 대기)", () => {
		const ids = cockPendingIds([sp("a", false), sp("b", false)], false);
		expect(ids.size).toBe(0);
	});
});
