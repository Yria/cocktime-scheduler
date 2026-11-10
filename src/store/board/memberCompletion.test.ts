import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardDraftsPayload } from "../../types/board";
import type { BoardState } from "./types";

// 회원 경기완료 뒤 편성 1회 권한(MATCH_RESULT_ELO_SPEC §3.4) — claimEdit() 은 그 커밋의 동기 구간에서만 열린다.
const h = vi.hoisted(() => ({
	save: vi.fn(), load: vi.fn(), commit: vi.fn(), sessionId: 1,
	session: { isEditor: false, multiEditor: false, _clientId: "member", _myName: "회원", boardDraftsVersion: 7,
		boardDrafts: { teams: [], reservations: [] } as BoardDraftsPayload,
		applyDraftsIfNewer: vi.fn(), resyncFromServer: vi.fn(async () => true) },
}));
vi.mock("../../lib/supabase", () => ({ dbBoardSaveDrafts: h.save, dbLoadSessionState: h.load }));
vi.mock("../../lib/supabase/matchResults", () => ({ commitCompletionDrafts: h.commit }));
vi.mock("../sessionStore", () => ({ useSessionStore: { getState: () => h.session } }));
vi.mock("../appStore", () => ({ useAppStore: { getState: () => ({ sessionMeta: { sessionId: h.sessionId } }) } }));
vi.mock("../toastStore", () => ({ toast: vi.fn() }));

import { claimEdit, clearDraftsBase, completionGrantActive, getDraftsBase, runWithCompletionGrant, setDraftsBase } from "./draftsSync";
import {
	commitMemberArrangement, MEMBER_CANDIDATES_MAX, MEMBER_COMMIT_MAX_RETRIES, memberPayload, planMemberArrangement, planMemberCandidates,
	removesBoardMembers,
} from "./memberCompletion";
import { serializeBoardDrafts } from "./draftsSync";
import type { DraftTeam } from "../../types/board";

/** 편성 액션이 불릴 때마다 그 순간의 claimEdit() 을 기록하는 가짜 보드. */
function fakeBoard(opts: { throwIn?: "autoFill" } = {}) {
	const gate: Record<string, boolean[]> = {};
	const record = (name: string) => { (gate[name] ??= []).push(claimEdit()); };
	const state = {
		drafts: new Map(), reservations: new Map(), magnets: new Map(), courtAnchors: new Map(), manualLayout: false,
		ensureCourtGroups: vi.fn(() => record("ensureCourtGroups")),
		fillWaitingTeams: vi.fn(() => record("fillWaitingTeams")),
		autoFillEmptyCourts: vi.fn(() => {
			record("autoFillEmptyCourts");
			if (opts.throwIn === "autoFill") throw new Error("boom");
		}),
		scatterMagnets: vi.fn(() => record("scatterMagnets")),
		applyRemoteDrafts: vi.fn(),
	} as unknown as BoardState;
	const get = () => state;
	const set = vi.fn((fn: (s: BoardState) => void) => { record("set"); fn(state); });
	return { state, get, set, gate };
}

beforeEach(() => {
	vi.clearAllMocks();
	h.sessionId = 1;
	Object.assign(h.session, { isEditor: false, boardDraftsVersion: 7 });
	clearDraftsBase();
});

describe("runWithCompletionGrant", () => {
	it("opens claimEdit() for a non-editor only inside the synchronous callback", () => {
		expect(claimEdit()).toBe(false);
		const inside = runWithCompletionGrant(() => claimEdit());
		expect(inside).toBe(true);
		expect(claimEdit()).toBe(false);
		expect(completionGrantActive()).toBe(false);
	});

	it("closes the grant even when the callback throws", () => {
		expect(() => runWithCompletionGrant(() => { throw new Error("boom"); })).toThrow("boom");
		expect(claimEdit()).toBe(false);
		expect(completionGrantActive()).toBe(false);
	});

	it("does not carry the grant past an await", async () => {
		const seen: boolean[] = [];
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await runWithCompletionGrant(async () => {
			seen.push(claimEdit());
			await Promise.resolve();
			seen.push(claimEdit());
		});
		warn.mockRestore();
		expect(seen).toEqual([true, false]);
	});

	it("nests without leaking", () => {
		runWithCompletionGrant(() => {
			runWithCompletionGrant(() => expect(claimEdit()).toBe(true));
			expect(claimEdit()).toBe(true);
		});
		expect(claimEdit()).toBe(false);
	});
});

describe("planMemberArrangement", () => {
	it("runs the editor's full planning order with the grant open, court fill scoped to that court", () => {
		const { state, get, set, gate } = fakeBoard();
		planMemberArrangement(get, set, 2, ["a", "b", "c", "d"]);
		// 편집자와 같은 순서: 예약 승격 → 합류 대기 채우기 → 그 코트 그룹 채우기(예비팀 우선, 없으면 자동 편성) → 흩기.
		expect(state.fillWaitingTeams).toHaveBeenCalledExactlyOnceWith(undefined);
		expect(state.autoFillEmptyCourts).toHaveBeenCalledExactlyOnceWith(2, undefined);
		expect((state.fillWaitingTeams as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
			.toBeLessThan((state.autoFillEmptyCourts as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
		expect(state.scatterMagnets).toHaveBeenCalledExactlyOnceWith(["a", "b", "c", "d"]);
		for (const name of ["ensureCourtGroups", "set", "fillWaitingTeams", "autoFillEmptyCourts", "scatterMagnets"]) {
			expect(gate[name]?.every(Boolean), name).toBe(true);
		}
		expect(claimEdit()).toBe(false);
	});

	it("safe plan moves a ready reserve team only (no waiting-team fill, no composition); exclusions reach both steps", () => {
		const safe = fakeBoard();
		planMemberArrangement(safe.get, safe.set, 2, [], { compose: false });
		expect(safe.state.autoFillEmptyCourts).toHaveBeenCalledExactlyOnceWith(2, { queuedOnly: true });
		expect(safe.state.fillWaitingTeams).not.toHaveBeenCalled();
		const alt = fakeBoard();
		planMemberArrangement(alt.get, alt.set, 2, [], { excludeIds: ["x"] });
		expect(alt.state.fillWaitingTeams).toHaveBeenCalledExactlyOnceWith({ excludeIds: ["x"] });
		expect(alt.state.autoFillEmptyCourts).toHaveBeenCalledExactlyOnceWith(2, { excludeIds: ["x"] });
	});

	it("closes the grant when a planning step throws", () => {
		const { get, set } = fakeBoard({ throwIn: "autoFill" });
		expect(() => planMemberArrangement(get, set, 1, [])).toThrow("boom");
		expect(claimEdit()).toBe(false);
	});
});

/**
 * 편성 결과가 실제 drafts 로 나오는 가짜 보드. 상태는 매번 새 Map 으로 바꾼다(immer 처럼) — 후보마다 되돌릴 수 있게.
 * 코트1 그룹 C1. queued 가 있으면 예비팀 Q 를 C1 로 옮기고, 없으면(편성 모드) 풀 앞에서 4명을 C1 에 넣는다.
 */
function composingBoard(pool: string[], opts: { queued?: string[] } = {}) {
	const team = (id: string, anchorMemberIds: string[], courtId?: number): DraftTeam =>
		({ id, anchorMemberIds, anchor: { x: 0, y: 0 }, createdAt: 1, ...(courtId != null ? { courtId } : {}) });
	const drafts = new Map<string, DraftTeam>([["C1", team("C1", [], 1)]]);
	if (opts.queued) drafts.set("Q", team("Q", opts.queued));
	const state = {
		drafts, reservations: new Map(), magnets: new Map(), courtAnchors: new Map(), manualLayout: false,
		ensureCourtGroups: vi.fn(),
		fillWaitingTeams: vi.fn(),
		autoFillEmptyCourts: vi.fn((_courtId?: number, o?: { queuedOnly?: boolean; excludeIds?: readonly string[] }) => {
			const q = state.drafts.get("Q");
			if (q) {
				const next = new Map(state.drafts);
				next.delete("Q");
				next.set("C1", team("C1", q.anchorMemberIds, 1));
				state.drafts = next;
				return;
			}
			if (o?.queuedOnly) return;
			const picks = pool.filter((id) => !o?.excludeIds?.includes(id)).slice(0, 4);
			if (picks.length < 4) return;
			state.drafts = new Map(state.drafts).set("C1", team("C1", picks, 1));
		}),
		scatterMagnets: vi.fn(),
		applyRemoteDrafts: vi.fn(),
	} as unknown as BoardState;
	const get = () => state;
	const set = vi.fn((fn: (s: BoardState) => void) => { fn(state); });
	const raw = serializeBoardDrafts(state);
	return { state, get, set, raw };
}
const courtGroup = (payload: BoardDraftsPayload) => payload.teams.find((t) => t.id === "C1")?.memberIds;

describe("planMemberCandidates", () => {
	it("forms a new group when no reserve team is ready; alternatives drop each newly added player; safe plan last", () => {
		const { state, get, set, raw } = composingBoard(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
		const list = planMemberCandidates(get, set, 1, ["a"], raw);
		expect(list).toHaveLength(MEMBER_CANDIDATES_MAX);
		expect(list.map((c) => courtGroup(c.payload))).toEqual([
			["p1", "p2", "p3", "p4"],
			["p2", "p3", "p4", "p5"],
			["p1", "p3", "p4", "p5"],
			["p1", "p2", "p4", "p5"],
			[], // 안전 후보: 예비팀이 없으니 그대로(운영진이 채운다)
		]);
		expect(list[0].plan.added).toEqual(["p1", "p2", "p3", "p4"]);
		expect(state.fillWaitingTeams).toHaveBeenNthCalledWith(1, undefined);
		expect(state.fillWaitingTeams).toHaveBeenNthCalledWith(2, { excludeIds: ["p1"] });
		expect(state.autoFillEmptyCourts).toHaveBeenLastCalledWith(1, { queuedOnly: true });
		// 로컬 보드는 가장 유력한 0번 후보 상태로 남는다.
		expect(state.drafts).toBe(list[0].board.drafts);
		expect(claimEdit()).toBe(false);
	});

	it("puts a ready reserve team on the court — same as the safe plan, so a single candidate", () => {
		const { get, set, raw } = composingBoard(["p1", "p2", "p3", "p4", "p5"], { queued: ["q1", "q2", "q3", "q4"] });
		const list = planMemberCandidates(get, set, 1, [], raw);
		expect(list.map((c) => courtGroup(c.payload))).toEqual([["q1", "q2", "q3", "q4"]]);
		expect(list[0].payload.teams.some((t) => t.id === "Q")).toBe(false);
	});

	it("dedupes identical payloads (an alternative that cannot form a group equals the safe plan)", () => {
		const { get, set, raw } = composingBoard(["p1", "p2", "p3", "p4"]);
		const list = planMemberCandidates(get, set, 1, [], raw);
		expect(list.map((c) => courtGroup(c.payload))).toEqual([["p1", "p2", "p3", "p4"], []]);
		const jsons = list.map((c) => JSON.stringify(c.payload));
		expect(new Set(jsons).size).toBe(jsons.length);
	});

	it("restores the starting board when a plan throws", () => {
		const { state, get, set, raw } = composingBoard(["p1", "p2", "p3", "p4", "p5"]);
		const start = state.drafts;
		(state.autoFillEmptyCourts as ReturnType<typeof vi.fn>)
			.mockImplementationOnce(() => { state.drafts = new Map(); })
			.mockImplementationOnce(() => { throw new Error("boom"); });
		expect(() => planMemberCandidates(get, set, 1, [], raw)).toThrow("boom");
		expect(state.drafts).toBe(start);
		expect(claimEdit()).toBe(false);
	});
});

/**
 * 자동 편성의 유연 풀처럼 합류 대기팀 W 에서 선수를 빼 와 코트 그룹 C1 을 채우는 가짜 보드.
 * pool 앞에서 4명(excludeIds 제외)을 C1 에 넣고, W 에서 빠진 뒤 W 가 2명 미만이면 해체한다(dissolveIfUnderTwo).
 */
function pullingBoard(pool: string[], waiting: string[]) {
	const team = (id: string, anchorMemberIds: string[], courtId?: number): DraftTeam =>
		({ id, anchorMemberIds, anchor: { x: 0, y: 0 }, createdAt: 1, ...(courtId != null ? { courtId } : {}) });
	const state = {
		drafts: new Map<string, DraftTeam>([["C1", team("C1", [], 1)], ["W", team("W", waiting)]]),
		reservations: new Map(), magnets: new Map(), courtAnchors: new Map(), manualLayout: false,
		ensureCourtGroups: vi.fn(), fillWaitingTeams: vi.fn(), scatterMagnets: vi.fn(), applyRemoteDrafts: vi.fn(),
		autoFillEmptyCourts: vi.fn((_courtId?: number, o?: { queuedOnly?: boolean; excludeIds?: readonly string[] }) => {
			if (o?.queuedOnly) return;
			const picks = pool.filter((id) => !o?.excludeIds?.includes(id)).slice(0, 4);
			if (picks.length < 4) return;
			const next = new Map(state.drafts).set("C1", team("C1", picks, 1));
			const left = (next.get("W")?.anchorMemberIds ?? []).filter((id) => !picks.includes(id));
			if (left.length < 2) next.delete("W");
			else next.set("W", team("W", left));
			state.drafts = next;
		}),
	} as unknown as BoardState;
	const get = () => state;
	const set = vi.fn((fn: (s: BoardState) => void) => { fn(state); });
	return { state, get, set, raw: serializeBoardDrafts(state) };
}

describe("planMemberCandidates — 다른 그룹에서 빼 온 선수", () => {
	it("counts a player pulled out of a waiting team as newly combined, so an alternative routes around them", () => {
		// W(w1,w2,w3) 에서 w1 이 빠져 C1 으로 — w1 은 groupedIds 로는 '원래 그룹에 있던 사람'이지만 새 조합이다.
		const { state, get, set, raw } = pullingBoard(["p1", "w1", "p2", "p3", "p4"], ["w1", "w2", "w3"]);
		const list = planMemberCandidates(get, set, 1, [], raw);
		expect(list[0].plan.added).toEqual(["p1", "w1", "p2", "p3"]); // 새로 든 사람·옮겨진 사람 번갈아. 제자리 w2·w3 는 아님.
		expect(state.autoFillEmptyCourts).toHaveBeenCalledWith(1, { excludeIds: ["w1"] });
		expect(list.map((c) => courtGroup(c.payload))).toContainEqual(["p1", "p2", "p3", "p4"]);
	});

	it("does not send a plan that drops someone from the server board (a dissolved 2-person waiting team) — the server would skip it", () => {
		// W(w1,w2) 에서 w1 을 빼면 W 가 해체돼 w2 가 내려간다 → 그 후보는 빼고, w1 을 뺀 대안·안전 후보는 남긴다.
		const { get, set, raw } = pullingBoard(["p1", "w1", "p2", "p3", "p4"], ["w1", "w2"]);
		const list = planMemberCandidates(get, set, 1, [], raw);
		expect(list.some((c) => removesBoardMembers(raw, c.payload))).toBe(false);
		expect(list.map((c) => courtGroup(c.payload))).toEqual([["p1", "p2", "p3", "p4"], []]);
	});
});

describe("removesBoardMembers", () => {
	const team = (id: string, memberIds: string[]) => ({ id, memberIds, createdMs: 1 });
	const raw: BoardDraftsPayload = { teams: [team("Q", ["a", "b"])], reservations: [{ id: "g", playerId: "c", teamId: "Q", createdMs: 1 }] };
	it("matches the server's add-only guard: anchors stay anchors, reservations stay or get promoted", () => {
		expect(removesBoardMembers(raw, raw)).toBe(false);
		expect(removesBoardMembers(raw, { teams: [team("C1", ["a", "b", "c"])], reservations: [] })).toBe(false);
		expect(removesBoardMembers(raw, { teams: [team("Q", ["a"])], reservations: raw.reservations })).toBe(true);
		expect(removesBoardMembers(raw, { teams: raw.teams, reservations: [] })).toBe(true);
	});
});

describe("memberPayload", () => {
	const team = (id: string, memberIds: string[], courtId?: number) => ({ id, memberIds, createdMs: 1, ...(courtId != null ? { courtId } : {}) });

	it("keeps server placements this device could not draw (only the plan's own changes are applied)", () => {
		// 서버: 예비팀 Q 에 방금 합류한 x 가 있다. 이 기기는 x 자석이 아직 없어 Q 를 [p,q] 로만 본다.
		const raw: BoardDraftsPayload = { teams: [team("C1", [], 1), team("Q", ["p", "q", "x"])], reservations: [] };
		const before: BoardDraftsPayload = { teams: [team("C1", [], 1), team("Q", ["p", "q"])], reservations: [] };
		// 계획: 끝난 a·b 를 코트 그룹 C1 에 올린다.
		const after: BoardDraftsPayload = { teams: [team("C1", ["a", "b"], 1), team("Q", ["p", "q"])], reservations: [] };
		const out = memberPayload({ before, after }, raw);
		const byId = new Map(out.teams.map((t) => [t.id, t.memberIds]));
		expect(byId.get("Q")).toEqual(expect.arrayContaining(["p", "q", "x"]));
		expect(byId.get("C1")).toEqual(expect.arrayContaining(["a", "b"]));
	});

	it("does not leak viewer-local magnet positions into the shared layout", () => {
		const layout = (magnets: Record<string, { x: number; y: number }>) => ({ version: 1 as const, teams: {}, courts: {}, magnets });
		const raw: BoardDraftsPayload = { teams: [team("C1", [], 1)], reservations: [], layout: layout({ f: { x: 1, y: 1 }, a: { x: 5, y: 5 } }) };
		// 관전자가 로컬로 f 를 옮겨 둔 상태(미동기화) — 계획 전부터 로컬에만 있다.
		const before: BoardDraftsPayload = { ...raw, layout: layout({ f: { x: 99, y: 99 }, a: { x: 5, y: 5 } }) };
		// 계획은 끝난 a 만 흩는다.
		const after: BoardDraftsPayload = { ...raw, layout: layout({ f: { x: 99, y: 99 }, a: { x: 40, y: 40 } }) };
		const out = memberPayload({ before, after }, raw);
		expect(out.layout?.magnets?.f).toEqual({ x: 1, y: 1 });
		expect(out.layout?.magnets?.a).toEqual({ x: 40, y: 40 });
	});
});

describe("commitMemberArrangement", () => {
	/** 이 기기가 서버 버전 v 를 그린 상태(applyRemoteDrafts 가 머지 기준을 기록). */
	const drewVersion = (v: number, raw: BoardDraftsPayload = { teams: [], reservations: [] }) => setDraftsBase(1, v, raw, raw);
	/** resyncFromServer 가 받아 올 서버 스냅샷 — 세션 store 를 그 버전으로 갈아 끼운다. */
	const serverAt = (...versions: number[]) => {
		for (const v of versions) {
			h.session.resyncFromServer.mockImplementationOnce(async () => {
				Object.assign(h.session, { boardDraftsVersion: v, boardDrafts: { teams: [], reservations: [] } });
				return true;
			});
		}
	};
	const boardWithApply = () => {
		const board = fakeBoard();
		(board.state.applyRemoteDrafts as ReturnType<typeof vi.fn>).mockImplementation((payload: BoardDraftsPayload, version: number) => {
			setDraftsBase(1, version, payload, payload);
		});
		return board;
	};

	it("commits with the drawn base version and never uses board_save_drafts", async () => {
		drewVersion(7);
		const { get, set } = boardWithApply();
		h.commit.mockResolvedValueOnce({ status: "ok", version: 8, chosen: 0 });
		await expect(commitMemberArrangement(get, set, 1, "M", 1, ["a"])).resolves.toBe("ok");
		expect(h.commit).toHaveBeenCalledExactlyOnceWith(1, "M", 7, [expect.objectContaining({ teams: [], reservations: [] })]);
		expect(h.session.applyDraftsIfNewer).toHaveBeenCalledWith(expect.anything(), 8);
		expect(getDraftsBase(1)?.version).toBe(8);
		expect(h.session.resyncFromServer).not.toHaveBeenCalled();
		expect(h.save).not.toHaveBeenCalled();
		expect(claimEdit()).toBe(false);
	});

	it("loads the server state first when this device has no merge base", async () => {
		const { state, get, set } = boardWithApply();
		serverAt(9);
		h.commit.mockResolvedValueOnce({ status: "ok", version: 10, chosen: 0 });
		await expect(commitMemberArrangement(get, set, 1, "M", 1, [])).resolves.toBe("ok");
		expect(state.applyRemoteDrafts).toHaveBeenCalledTimes(1);
		expect(h.commit.mock.calls.map((call) => call[2])).toEqual([9]);
	});

	it("on stale reloads the whole server snapshot (matches·players too) and replans, at most twice more", async () => {
		drewVersion(7);
		const { state, get, set } = boardWithApply();
		h.commit.mockResolvedValue({ status: "stale", version: 9 });
		serverAt(9, 10);
		await expect(commitMemberArrangement(get, set, 1, "M", 1, [])).resolves.toBe("stale");
		expect(h.commit).toHaveBeenCalledTimes(1 + MEMBER_COMMIT_MAX_RETRIES);
		expect(h.commit.mock.calls.map((call) => call[2])).toEqual([7, 9, 10]);
		// drafts 만이 아니라 resyncFromServer 로 경기·선수까지 받아야 방금 시작된 코트를 다시 채우지 않는다.
		expect(h.load).not.toHaveBeenCalled();
		expect(state.applyRemoteDrafts).toHaveBeenCalledTimes(MEMBER_COMMIT_MAX_RETRIES);
		// 시도마다 전체 계획 + 안전 계획(이 가짜 보드는 아무도 새로 넣지 않으니 대안 없음).
		expect(state.autoFillEmptyCourts).toHaveBeenCalledTimes(2 * (1 + MEMBER_COMMIT_MAX_RETRIES));
		expect(h.session.resyncFromServer).toHaveBeenLastCalledWith({ force: true }); // 저장 못 한 로컬 계획을 버린다
		expect(h.session.resyncFromServer).toHaveBeenCalledTimes(MEMBER_COMMIT_MAX_RETRIES + 1);
		expect(h.save).not.toHaveBeenCalled();
		expect(claimEdit()).toBe(false);
	});

	it("succeeds on a retry after one stale", async () => {
		drewVersion(7);
		const { get, set } = boardWithApply();
		h.commit.mockResolvedValueOnce({ status: "stale", version: 9 }).mockResolvedValueOnce({ status: "ok", version: 10, chosen: 0 });
		serverAt(9);
		await expect(commitMemberArrangement(get, set, 1, "M", 1, [])).resolves.toBe("ok");
		expect(h.commit.mock.calls.map((call) => call[2])).toEqual([7, 9]);
		expect(h.session.resyncFromServer).toHaveBeenCalledTimes(1);
	});

	it("stops with error when the reload fails", async () => {
		drewVersion(7);
		const { get, set } = boardWithApply();
		h.commit.mockResolvedValueOnce({ status: "stale", version: 9 });
		h.session.resyncFromServer.mockResolvedValueOnce(false);
		await expect(commitMemberArrangement(get, set, 1, "M", 1, [])).resolves.toBe("error");
		expect(h.commit).toHaveBeenCalledTimes(1);
	});

	it("gives up without retry on error (grant expired/used) and converges to the server", async () => {
		drewVersion(7);
		const { get, set } = boardWithApply();
		h.commit.mockResolvedValueOnce({ status: "error", message: "no completion grant" });
		await expect(commitMemberArrangement(get, set, 1, "M", 1, [])).resolves.toBe("error");
		expect(h.commit).toHaveBeenCalledTimes(1);
		expect(h.session.resyncFromServer).toHaveBeenCalledWith({ force: true });
		expect(claimEdit()).toBe(false);
	});

	it("keeps the grant closed for the member even when the commit RPC throws", async () => {
		drewVersion(7);
		const { get, set } = boardWithApply();
		h.commit.mockRejectedValueOnce(new Error("network"));
		await expect(commitMemberArrangement(get, set, 1, "M", 1, [])).rejects.toThrow("network");
		expect(claimEdit()).toBe(false);
		expect(completionGrantActive()).toBe(false);
	});

	it("adopts the candidate the server chose: local board, merge base and session drafts follow it", async () => {
		const board = composingBoard(["p1", "p2", "p3", "p4", "p5"]);
		setDraftsBase(1, 7, board.raw, board.raw);
		h.commit.mockImplementationOnce(async (_s: number, _m: string, _v: number, payloads: BoardDraftsPayload[]) => {
			expect(payloads.map(courtGroup)).toEqual([["p1", "p2", "p3", "p4"], ["p2", "p3", "p4", "p5"], ["p1", "p3", "p4", "p5"], ["p1", "p2", "p4", "p5"], []]);
			return { status: "ok", version: 8, chosen: 2 };
		});
		await expect(commitMemberArrangement(board.get, board.set, 1, "M", 1, [])).resolves.toBe("ok");
		expect(board.state.drafts.get("C1")?.anchorMemberIds).toEqual(["p1", "p3", "p4", "p5"]);
		expect(courtGroup(getDraftsBase(1)!.raw)).toEqual(["p1", "p3", "p4", "p5"]);
		expect(getDraftsBase(1)?.version).toBe(8);
		expect(courtGroup(h.session.applyDraftsIfNewer.mock.calls[0][0] as BoardDraftsPayload)).toEqual(["p1", "p3", "p4", "p5"]);
		expect(h.session.resyncFromServer).not.toHaveBeenCalled();
	});

	it("rejected (every candidate broke a server rule): no retry, converges to the server, reason not surfaced", async () => {
		drewVersion(7);
		const { get, set } = boardWithApply();
		h.commit.mockResolvedValueOnce({ status: "rejected" });
		await expect(commitMemberArrangement(get, set, 1, "M", 1, [])).resolves.toBe("rejected");
		expect(h.commit).toHaveBeenCalledTimes(1);
		expect(h.session.resyncFromServer).toHaveBeenCalledWith({ force: true });
		expect(claimEdit()).toBe(false);
	});
});
