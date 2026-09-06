import { describe, expect, it } from "vitest";
import type { BoardState } from "../../../store/board/types";
import type { SessionState } from "../../../store/sessionStoreState";
import type { Court, SessionPlayer } from "../../../types";
import type { DraftTeam } from "../../../types/board";
import { CTA_DISABLED_COLOR, CTA_PLAY_COLOR, CTA_START_COLOR, TEAM_BOX_ABOVE, TEAM_CONFIRMED_BG, TEAM_READY_BG, TEAM_RESERVED_BG, TEAM_W } from "../constants";
import { createBoardProjection } from "./projection";
import type { BoardSnapshot, CardView, MagnetView } from "./types";

function player(id: string): SessionPlayer {
	return { id, playerId: id, memberId: null, name: id, gender: "M", skills: { grade: 5 },
		allowMixedSingle: false, status: "waiting", gameCount: 0, mixedCount: 0, waitSince: null, joinedAtMatch: 0, cockChecked: true };
}

function fixture(ids = ["a", "b", "c", "d", "e", "f", "g", "h"]) {
	const bs = {
		magnets: new Map(ids.map((id, index) => [id, { playerId: id, x: 40 + index * 74, y: 500, teamId: null as string | null }])),
		drafts: new Map(), reservations: new Map(), courtAnchors: new Map(), dragInfo: null,
	} as unknown as BoardState;
	const ss = {
		sessionPlayers: new Map(ids.map((id) => [id, player(id)])), courts: [{ id: 1, match: null }],
		restingIds: [], cockCheckEnabled: true, isEditor: true,
	} as unknown as SessionState;
	return { bs, ss };
}

function team(bs: BoardState, id: string, ids: string[], extra: Partial<DraftTeam> = {}) {
	bs.drafts.set(id, { id, anchorMemberIds: ids, anchor: { x: 200, y: 180 }, createdAt: 1, ...extra });
	for (const playerId of ids) bs.magnets.set(playerId, { ...bs.magnets.get(playerId)!, teamId: id });
}

function court(id: number, ids: [string, string, string, string]): Court {
	return { id, match: { id: `match-${id}`, courtId: id, gameType: "남복", teamA: [ids[0], ids[1]], teamB: [ids[2], ids[3]], startedAt: "2026-09-06T00:00:00Z" } };
}

function card(snapshot: BoardSnapshot, key: string): CardView {
	const entity = snapshot.entities.find((view) => view.key === key);
	if (entity?.kind !== "card") throw new Error(`Missing card ${key}`);
	return entity;
}

describe("Pixi board projection", () => {
	it("keeps team/free/court order, world card positions and local member slots", () => {
		const { bs, ss } = fixture();
		team(bs, "T", ["a", "b"], { slots: { a: 3, b: 1 } });
		ss.courts = [court(1, ["e", "f", "g", "h"])];
		bs.courtAnchors.set(1, { x: 360, y: 250 });
		const snapshot = createBoardProjection()(bs, ss);
		expect(snapshot.entities.map((view) => view.key)).toEqual(["team:T", "free:c", "free:d", "court:1:match-1"]);
		expect(card(snapshot, "team:T").members.map((view) => view.point)).toEqual([{ x: 35, y: 35 }, { x: 35, y: -35 }]);
		expect(card(snapshot, "team:T").emptySlots).toEqual([0, 2]);
		expect(card(snapshot, "court:1:match-1").point).toEqual({ x: 360, y: 250 });
		expect(card(snapshot, "court:1:match-1").members[0].point).toEqual({ x: -35, y: -35 });
		expect(snapshot.entities[1].point).toEqual({ x: 188, y: 500 });
	});

	it("uses the occupied-court index for fallback locations and preserves viewer interaction", () => {
		const { bs, ss } = fixture();
		ss.isEditor = false;
		ss.courts = [{ id: 1, match: null }, court(2, ["a", "b", "c", "d"]), court(3, ["e", "f", "g", "h"])];
		const snapshot = createBoardProjection()(bs, ss);
		const first = card(snapshot, "court:2:match-2");
		const second = card(snapshot, "court:3:match-3");
		expect(first.point).toEqual({ x: TEAM_W / 2 + 12, y: TEAM_BOX_ABOVE + 8 });
		expect(second.point.x).toBe(TEAM_W / 2 + 12 + TEAM_W + 20);
		expect(first).toMatchObject({ draggable: false, appearance: { label: "2번 코트 · 경기중", ctaLabel: "보기 전용", ctaEnabled: false, showEdit: false } });
		expect(first.members.every((member) => member.draggable && !member.cockPending)).toBe(true);
	});

	it("preserves forming, ready, confirmed and reserved card presentation", () => {
		const { bs, ss } = fixture();
		team(bs, "T", ["a", "b"], { createdBy: "운영자" });
		expect(card(createBoardProjection()(bs, ss), "team:T").appearance).toMatchObject({
			label: "팀 구성 중 · 2/4 · by 운영자", ctaLabel: "2명 더 필요", ctaColor: CTA_DISABLED_COLOR, labelBold: false, showVs: false,
		});
		team(bs, "T", ["a", "b", "c", "d"]);
		expect(card(createBoardProjection()(bs, ss), "team:T").appearance).toMatchObject({ fill: TEAM_READY_BG, ctaLabel: "매칭확정", ctaColor: CTA_START_COLOR, ctaEnabled: true });
		team(bs, "T", ["a", "b", "c", "d"], { confirmedMs: 5 });
		expect(card(createBoardProjection()(bs, ss), "team:T").appearance).toMatchObject({ fill: TEAM_CONFIRMED_BG, label: "매칭확정 1번째", ctaLabel: "경기시작", ctaColor: CTA_PLAY_COLOR, blink: true, showUnconfirm: true });
		team(bs, "T", ["a", "b", "c"], { confirmedMs: 5 });
		bs.magnets.set("d", { ...bs.magnets.get("d")!, teamId: null });
		bs.reservations.set("r", { id: "r", playerId: "d", teamId: "T", createdAt: 1 });
		ss.courts = [court(1, ["d", "e", "f", "g"])];
		const reserved = card(createBoardProjection()(bs, ss), "team:T");
		expect(reserved.confirmed).toBe(false);
		expect(reserved.appearance).toMatchObject({ fill: TEAM_RESERVED_BG, label: "4/4 · 예약 포함(경기중)", ctaLabel: "예약 대기", ctaEnabled: false, blink: false });
	});

	it("retains confirmed rank and next-up distinction, including a full court and viewer", () => {
		const { bs, ss } = fixture();
		team(bs, "later", ["a", "b", "c", "d"], { confirmedMs: 20 });
		team(bs, "first", ["e", "f", "g", "h"], { confirmedMs: 10 });
		let snapshot = createBoardProjection()(bs, ss);
		expect(card(snapshot, "team:later").appearance).toMatchObject({ label: "매칭확정 2번째", blink: false });
		expect(card(snapshot, "team:first").appearance.blink).toBe(true);
		ss.courts = [court(1, ["i", "j", "k", "l"])];
		snapshot = createBoardProjection()(bs, ss);
		expect(card(snapshot, "team:first").appearance).toMatchObject({ ctaLabel: "코트 대기", ctaEnabled: false, blink: false });
		ss.isEditor = false;
		expect(card(createBoardProjection()(bs, ss), "team:first")).toMatchObject({ draggable: true, appearance: { showUnconfirm: false, ctaEnabled: false } });
	});

	it("keeps multiple ghosts distinct and reveals the dragged player's existing slots", () => {
		const { bs, ss } = fixture();
		team(bs, "A", ["a"]);
		team(bs, "B", ["b"]);
		bs.reservations.set("r1", { id: "r1", playerId: "c", teamId: "A", createdAt: 1 });
		bs.reservations.set("r2", { id: "r2", playerId: "c", teamId: "B", createdAt: 2 });
		const project = createBoardProjection();
		const before = project(bs, ss);
		expect(card(before, "team:A").members[1]).toMatchObject({ key: "ghost:r1", ghost: true, source: { reservationId: "r1" } });
		expect(card(before, "team:B").members[1].key).toBe("ghost:r2");
		const after = project({ ...bs, dragInfo: { playerId: "c", detachable: true, restable: false } }, ss);
		expect(card(after, "team:A").emptySlots).toEqual([1, 2, 3]);
		expect(card(after, "team:B").emptySlots).toEqual([1, 2, 3]);
		expect(card(after, "team:A").members).toBe(card(before, "team:A").members);
	});

	it("projects resting and cock-check states without suppressing the player", () => {
		const { bs, ss } = fixture(["a", "b", "c"]);
		ss.sessionPlayers.set("a", { ...player("a"), cockChecked: false });
		ss.sessionPlayers.set("b", { ...player("b"), cockChecked: false, status: "resting" });
		ss.restingIds = ["b"];
		ss.isEditor = false;
		const snapshot = createBoardProjection()(bs, ss);
		expect(snapshot.entities[0]).toMatchObject({ key: "free:a", cockPending: true, resting: false, draggable: true });
		expect(snapshot.entities[1]).toMatchObject({ key: "free:b", cockPending: false, resting: true, draggable: true });
	});

	it("refreshes a ghost source when the same reservation moves to another team", () => {
		const { bs, ss } = fixture();
		team(bs, "A", ["a", "b"]);
		team(bs, "B", ["d", "e"]);
		bs.reservations.set("r", { id: "r", playerId: "c", teamId: "A", createdAt: 1 });
		const project = createBoardProjection();
		const before = project(bs, ss);
		const oldGhost = card(before, "team:A").members[2];
		const reservations = new Map(bs.reservations);
		reservations.set("r", { ...reservations.get("r")!, teamId: "B" });
		const after = project({ ...bs, reservations }, ss);
		const movedGhost = card(after, "team:B").members[2];
		expect(movedGhost.key).toBe(oldGhost.key);
		expect(movedGhost.point).toEqual(oldGhost.point);
		expect(movedGhost).not.toBe(oldGhost);
		expect(movedGhost.source).toMatchObject({ kind: "ghost", reservationId: "r", teamId: "B" });
	});

	it("uses existing playing-anchor display gating without mutating remote state", () => {
		const { bs, ss } = fixture();
		team(bs, "stale", ["a", "b"]);
		ss.courts = [court(1, ["a", "b", "c", "d"])];
		const original = bs.drafts.get("stale");
		const snapshot = createBoardProjection()(bs, ss);
		expect(snapshot.entities.some((entity) => entity.key === "team:stale")).toBe(false);
		expect(bs.drafts.get("stale")).toBe(original);
		expect(bs.magnets.get("a")!.teamId).toBe("stale");
	});

	it("reuses unrelated entity references and unchanged snapshots across store notifications", () => {
		const { bs, ss } = fixture();
		team(bs, "T", ["a", "b"]);
		const project = createBoardProjection();
		const before = project(bs, ss);
		expect(project({ ...bs, scale: 0.8, hoverTarget: { kind: "magnet", id: "c" } }, ss)).toBe(before);
		const moved = new Map(bs.magnets);
		moved.set("c", { ...moved.get("c")!, x: 777 });
		const after = project({ ...bs, magnets: moved }, ss);
		expect(card(after, "team:T")).toBe(card(before, "team:T"));
		expect(after.entities.find((view) => view.key === "free:d")).toBe(before.entities.find((view) => view.key === "free:d"));
		expect((after.entities.find((view) => view.key === "free:c") as MagnetView).point.x).toBe(777);
		expect(project({ ...bs, magnets: new Map(moved) }, { ...ss, presenceCount: 3 })).toBe(after);
	});

	it("updates changed players and removes missing players while keeping slot occupancy", () => {
		const { bs, ss } = fixture();
		team(bs, "T", ["a", "b"]);
		const project = createBoardProjection();
		const before = project(bs, ss);
		const changed = new Map(ss.sessionPlayers);
		changed.set("a", { ...changed.get("a")!, name: "새 이름" });
		changed.delete("b");
		const after = project(bs, { ...ss, sessionPlayers: changed });
		const view = card(after, "team:T");
		expect(view.members).toHaveLength(1);
		expect(view.members[0].player.name).toBe("새 이름");
		expect(view.emptySlots).toEqual([2, 3]);
		expect(after.entities.find((entity) => entity.key === "free:c")).toBe(before.entities.find((entity) => entity.key === "free:c"));
	});

	it("waits for a roster member's magnet token, then displays its court slot", () => {
		const { bs, ss } = fixture();
		ss.courts = [court(1, ["a", "b", "c", "d"])];
		const token = bs.magnets.get("a")!;
		bs.magnets.delete("a");
		const project = createBoardProjection();
		const before = project(bs, ss);
		expect(card(before, "court:1:match-1").members.map((member) => member.player.id)).toEqual(["b", "c", "d"]);
		const magnets = new Map(bs.magnets);
		magnets.set("a", token);
		const after = project({ ...bs, magnets }, ss);
		const members = card(after, "court:1:match-1").members;
		expect(members.map((member) => member.player.id)).toEqual(["a", "b", "c", "d"]);
		expect(members[0].point).toEqual({ x: -35, y: -35 });
		expect(members[1]).toBe(card(before, "court:1:match-1").members[0]);
	});
});
