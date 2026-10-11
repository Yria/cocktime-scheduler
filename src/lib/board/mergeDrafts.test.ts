import { describe, expect, it } from "vitest";
import type { BoardDraftsPayload } from "../../types/board";
import { draftsFingerprint, mergeDrafts } from "./mergeDrafts";

type Team = BoardDraftsPayload["teams"][number];
const team = (id: string, memberIds: string[], extra: Partial<Team> = {}): Team => ({ id, memberIds, createdMs: extra.createdMs ?? 1, ...extra });
const drafts = (teams: Team[], reservations: BoardDraftsPayload["reservations"] = [], layout?: BoardDraftsPayload["layout"]): BoardDraftsPayload =>
	({ teams, reservations, ...(layout ? { layout } : {}) });
const teamOf = (p: BoardDraftsPayload, pid: string) => p.teams.filter((t) => t.memberIds.includes(pid)).map((t) => t.id);
const members = (p: BoardDraftsPayload, id: string) => [...(p.teams.find((t) => t.id === id)?.memberIds ?? [])].sort();

describe("mergeDrafts — 선수 배치 단위 3-way", () => {
	it("서로 다른 선수를 다른 팀에 넣은 변경은 양쪽 다 보존한다", () => {
		const base = drafts([team("X", ["a", "b"]), team("Y", ["c", "d"])]);
		const mine = drafts([team("X", ["a", "b", "e"]), team("Y", ["c", "d"])]);
		const theirs = drafts([team("X", ["a", "b"]), team("Y", ["c", "d", "f"])]);
		const { payload, changed } = mergeDrafts(base, mine, theirs);
		expect(members(payload, "X")).toEqual(["a", "b", "e"]);
		expect(members(payload, "Y")).toEqual(["c", "d", "f"]);
		expect(changed).toBe(true);
	});

	it("같은 팀에 서로 다른 선수를 추가해도 양쪽 다 남는다(슬롯 충돌은 theirs 우선)", () => {
		const base = drafts([team("X", ["a", "b"], { slots: { a: 0, b: 1 } })]);
		const mine = drafts([team("X", ["a", "b", "c"], { slots: { a: 0, b: 1, c: 2 } })]);
		const theirs = drafts([team("X", ["a", "b", "d"], { slots: { a: 0, b: 1, d: 2 } })]);
		const { payload } = mergeDrafts(base, mine, theirs);
		expect(members(payload, "X")).toEqual(["a", "b", "c", "d"]);
		const slots = payload.teams[0].slots!;
		expect(slots.d).toBe(2);
		expect(slots.c).toBeUndefined(); // 같은 칸 → mine 지정은 버리고 빈 칸 자동 채움에 맡긴다
	});

	it("A가 P를 X→Y로 옮기고 B가 X에 Q를 넣으면 P는 Y, Q는 X", () => {
		const base = drafts([team("X", ["p", "a", "b"], { createdMs: 1 }), team("Y", ["c"], { createdMs: 2 }), team("Z", ["d", "e"], { createdMs: 3 })]);
		// theirs(A, 먼저 저장): P를 Y로 이동 — 오래된 X 에서 새 Y 로.
		const theirs = drafts([team("X", ["a", "b"], { createdMs: 1 }), team("Y", ["c", "p"], { createdMs: 2 }), team("Z", ["d", "e"], { createdMs: 3 })]);
		// mine(B, 재시도): X 에 Q 추가 — B 의 X 에는 아직 P 가 있다.
		const mine = drafts([team("X", ["p", "a", "b", "q"], { createdMs: 1 }), team("Y", ["c"], { createdMs: 2 }), team("Z", ["d", "e"], { createdMs: 3 })]);
		const { payload } = mergeDrafts(base, mine, theirs);
		expect(teamOf(payload, "p")).toEqual(["Y"]);
		expect(teamOf(payload, "q")).toEqual(["X"]);
		expect(members(payload, "X")).toEqual(["a", "b", "q"]);
		expect(members(payload, "Y")).toEqual(["c", "p"]);
	});

	it("A가 X를 해체하고 그 멤버로 Y를 만들고 B가 X를 수정해도 X 부활로 Y가 유실되지 않는다", () => {
		const base = drafts([team("X", ["a", "b"], { createdMs: 1 })]);
		const theirs = drafts([team("Y", ["a", "b"], { createdMs: 5 })]);
		const mine = drafts([team("X", ["a", "b", "q"], { createdMs: 1, createdBy: "B" })]);
		const { payload } = mergeDrafts(base, mine, theirs);
		expect(members(payload, "Y")).toEqual(["a", "b"]);
		expect(payload.teams.find((t) => t.id === "X")).toBeUndefined(); // q 혼자라 I3 규칙으로 존재 불가
		expect(teamOf(payload, "q")).toEqual([]);
		expect(teamOf(payload, "a")).toEqual(["Y"]);
	});

	it("같은 선수를 양쪽이 다른 곳에 놓으면 중복 없이 한 곳에만 남는다", () => {
		const base = drafts([team("X", ["a", "b"]), team("Y", ["c", "d"]), team("Z", ["e", "f"])]);
		const mine = drafts([team("X", ["a", "b", "p"]), team("Y", ["c", "d"]), team("Z", ["e", "f"])]);
		const theirs = drafts([team("X", ["a", "b"]), team("Y", ["c", "d", "p"]), team("Z", ["e", "f"])]);
		const { payload } = mergeDrafts(base, mine, theirs);
		expect(teamOf(payload, "p")).toHaveLength(1);
		expect(teamOf(payload, "p")).toEqual(["X"]); // 재시도하는 쪽(mine)이 명시적으로 이긴다
	});

	it("정원을 넘기면 mine 쪽 추가분을 theirs 배치로 되돌린다", () => {
		const base = drafts([team("X", ["a", "b"]), team("Y", ["c", "d"])]);
		const mine = drafts([team("X", ["a", "b", "c"]), team("Y", ["d", "e"])]);
		const theirs = drafts([team("X", ["a", "b", "f", "g"]), team("Y", ["c", "d"])]);
		const { payload } = mergeDrafts(base, mine, theirs);
		expect(members(payload, "X")).toEqual(["a", "b", "f", "g"]);
		expect(teamOf(payload, "c")).toEqual(["Y"]);
		expect(teamOf(payload, "e")).toEqual(["Y"]);
	});

	it("팀 메타는 필드별 3-way — 내 확정과 상대의 코트 지정이 함께 남는다", () => {
		const base = drafts([team("X", ["a", "b", "c", "d"])]);
		const mine = drafts([team("X", ["a", "b", "c", "d"], { confirmedMs: 50 })]);
		const theirs = drafts([team("X", ["a", "b", "c", "d"], { createdBy: "A" })]);
		const { payload } = mergeDrafts(base, mine, theirs);
		expect(payload.teams[0]).toMatchObject({ confirmedMs: 50, createdBy: "A" });
	});

	it("예약은 id 키별 3-way, anchor 확정 선수의 예약은 남기지 않는다", () => {
		const base = drafts([team("X", ["a", "b"]), team("Y", ["c", "d"])]);
		const mine = drafts([team("X", ["a", "b"]), team("Y", ["c", "d"])], [{ id: "r1", playerId: "p", teamId: "X", createdMs: 2 }]);
		const theirs = drafts([team("X", ["a", "b"]), team("Y", ["c", "d", "p"])], [{ id: "r2", playerId: "z", teamId: "Y", createdMs: 3 }]);
		const { payload } = mergeDrafts(base, mine, theirs);
		expect(payload.reservations.map((r) => r.id)).toEqual(["r2"]); // p 는 Y anchor 가 됐으므로 r1 제거
	});

	it("layout undefined 는 빈 맵으로 정규화하고 좌표는 mine 변경분만 mine", () => {
		const L = (magnets: Record<string, { x: number; y: number }>) => ({ version: 1 as const, teams: {}, courts: {}, magnets });
		const base = drafts([], [], undefined);
		const mine = drafts([], [], L({ a: { x: 10, y: 10 } }));
		const theirs = drafts([], [], L({ b: { x: 20, y: 20 } }));
		const r1 = mergeDrafts(base, mine, theirs);
		expect(r1.payload.layout?.magnets).toEqual({ a: { x: 10, y: 10 }, b: { x: 20, y: 20 } });
		// 내가 안 움직인 좌표는 상대 좌표를 그대로 쓴다.
		const old = drafts([], [], L({ b: { x: 1, y: 1 } }));
		const r2 = mergeDrafts(old, old, theirs);
		expect(r2.payload.layout?.magnets).toEqual({ b: { x: 20, y: 20 } });
		expect(r2.changed).toBe(false);
		// 셋 다 없으면 결과에도 없다.
		expect(mergeDrafts(drafts([]), drafts([]), drafts([])).payload.layout).toBeUndefined();
	});

	it("결과가 theirs 와 같으면 changed=false(저장 생략)", () => {
		const base = drafts([team("X", ["a", "b"])]);
		const theirs = drafts([team("X", ["a", "b", "c"])]);
		expect(mergeDrafts(base, base, theirs).changed).toBe(false);
		// 같은 변경을 양쪽이 했어도 changed=false
		expect(mergeDrafts(base, theirs, theirs).changed).toBe(false);
		expect(draftsFingerprint(mergeDrafts(base, base, theirs).payload)).toBe(draftsFingerprint(theirs));
	});

	it("내가 손대지 않은 로컬 정제(base 투영과 같은 값)는 theirs 원본을 지우지 않는다", () => {
		// base 투영: 이 기기엔 g 자석이 없어 X 에서 빠져 보인다. mine 도 같다. theirs 원본에는 g 가 있다.
		const baseProjection = drafts([team("X", ["a", "b"])]);
		const theirsRaw = drafts([team("X", ["a", "b", "g"])]);
		const { payload, changed } = mergeDrafts(baseProjection, baseProjection, theirsRaw);
		expect(members(payload, "X")).toEqual(["a", "b", "g"]);
		expect(changed).toBe(false);
	});
});
