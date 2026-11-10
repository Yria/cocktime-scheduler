import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Court, SessionPlayer } from "../../types";

// 실제 보드 store 로 회원 완료 경로(§3.4)를 끝까지 돌린다 — 편집자가 아닌 회원의 편성 계획이 실제 액션(autoFillEmptyCourts)을
// 통과하는지, 저장은 member_commit_completion_drafts 로만 가는지, 끝난 뒤 claimEdit() 이 다시 닫히는지.
const h = vi.hoisted(() => ({
	session: {} as Record<string, unknown>,
	memberComplete: vi.fn(), commit: vi.fn(), save: vi.fn(), load: vi.fn(), applied: vi.fn(),
}));

vi.mock("../sessionStore", () => ({
	useSessionStore: { getState: () => h.session },
	applyMemberCompletion: (_match: unknown, courtId: number, players: SessionPlayer[]) => {
		h.applied(courtId, players);
		const map = new Map(h.session.sessionPlayers as Map<string, SessionPlayer>);
		for (const p of players) map.set(p.id, p);
		h.session.sessionPlayers = map;
		h.session.courts = (h.session.courts as Court[]).map((c) => (c.id === courtId ? { ...c, match: null } : c));
	},
}));
vi.mock("../appStore", () => ({ useAppStore: { getState: () => ({ sessionMeta: { sessionId: 1, singleWomanIds: [] } }) } }));
vi.mock("../../lib/supabase", () => ({ dbBoardSaveDrafts: h.save, dbLoadSessionState: h.load }));
vi.mock("../../lib/supabase/matchResults", () => ({ memberCompleteMatch: h.memberComplete, commitCompletionDrafts: h.commit }));

import { useBoardStore } from "../boardStore";
import { useAuthStore } from "../authStore";
import { claimEdit, clearDraftsBase, serializeBoardDrafts, setDraftsBase, syncState, withoutDraftSave } from "./draftsSync";
import type { BoardDraftsPayload } from "../../types/board";

/** 이 기기가 서버 버전 5 를 그렸다 — applyRemoteDrafts 가 남기는 머지 기준(raw 는 서버 원본, 기본은 로컬과 같다). */
function drewServer(raw?: BoardDraftsPayload) {
	const projection = serializeBoardDrafts(useBoardStore.getState());
	setDraftsBase(1, 5, projection, raw ?? projection);
}

function player(id: string, extra: Partial<SessionPlayer> = {}): SessionPlayer {
	return { id, playerId: id, memberId: `m-${id}`, name: id, gender: "M", skills: { grade: 5 },
		allowMixedSingle: false, status: "waiting", gameCount: 0, mixedCount: 0, waitSince: null, joinedAtMatch: 0, cockChecked: true, ...extra };
}

beforeEach(() => {
	vi.clearAllMocks();
	const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
	h.session = {
		isEditor: false, multiEditor: false, cockCheckEnabled: true, restingIds: [], groupHistory: [], lastGameType: {},
		boardDraftsVersion: 5, _myName: "회원", _channel: null,
		sessionPlayers: new Map(ids.map((id) => [id, player(id, ["a", "b", "c", "d"].includes(id) ? { status: "playing" } : {})])),
		courts: [{ id: 1, match: { id: "M1", courtId: 1, gameType: "남복", teamA: ["a", "b"], teamB: ["c", "d"], startedAt: "2026-11-09" } }],
		applyDraftsIfNewer: vi.fn(), resyncFromServer: vi.fn(async () => true),
	};
	clearDraftsBase();
	useAuthStore.setState({ memberId: "m-a" });
	useBoardStore.getState().reset();
	useBoardStore.getState().bindSession(1);
	useBoardStore.setState((s) => {
		for (const [i, id] of ids.entries()) s.magnets.set(id, { playerId: id, x: 40 + i * 74, y: 500, teamId: null });
		s.drafts.set("court-1", { id: "court-1", courtId: 1, anchorMemberIds: [], createdAt: 1, anchor: { x: 200, y: 180 } });
		s.drafts.set("T", { id: "T", anchorMemberIds: ["e", "f", "g", "h"], createdAt: 2, anchor: { x: 400, y: 180 } });
		for (const id of ["e", "f", "g", "h"]) s.magnets.get(id)!.teamId = "T";
	});
	drewServer();
	h.memberComplete.mockResolvedValue({ ok: true, courtId: 1, result: null,
		updatedPlayers: ["a", "b", "c", "d"].map((id) => player(id)) });
	h.commit.mockResolvedValue({ status: "ok", version: 6, chosen: 0 });
});

describe("completeMatchAsMember", () => {
	it("opens the request in member mode only for a roster member who is not the editor", () => {
		useAuthStore.setState({ memberId: "m-e" });
		useBoardStore.getState().requestCompleteMatch(1);
		expect(useBoardStore.getState().completeRequest).toBeNull();
		useAuthStore.setState({ memberId: "m-a" });
		useBoardStore.getState().requestCompleteMatch(1);
		expect(useBoardStore.getState().completeRequest).toEqual({ courtId: 1, matchId: "M1", mode: "member" });
	});

	it("does not open member mode for the editor while its own edits are blocked (exclusiveDraftEdit)", () => {
		h.session.isEditor = true;
		syncState.exclusiveDraftEdit = true;
		try {
			useBoardStore.getState().requestCompleteMatch(1);
			expect(useBoardStore.getState().completeRequest).toBeNull();
		} finally {
			syncState.exclusiveDraftEdit = false;
		}
		useBoardStore.getState().requestCompleteMatch(1);
		expect(useBoardStore.getState().completeRequest).toMatchObject({ mode: "editor" });
	});

	it("member planning never reaches board_save_drafts, even on an editor device", async () => {
		Object.assign(h.session, { isEditor: true, _clientId: "editor-device" });
		h.save.mockResolvedValue(6);
		syncState.exclusiveDraftEdit = true; // 편집자지만 막혀 있어 claimEdit() 은 false — 계획은 grant 로만 돈다.
		try {
			const out = await useBoardStore.getState().completeMatchAsMember(1, "M1", null);
			expect(out).toMatchObject({ status: "completed", arrange: "ok" });
		} finally {
			syncState.exclusiveDraftEdit = false;
		}
		await new Promise((r) => setTimeout(r, 0));
		expect(h.commit).toHaveBeenCalledOnce();
		expect(h.save).not.toHaveBeenCalled();
		// 대조: 같은 기기의 평범한 편집은 저장 구독을 탄다(가드가 구독 자체를 끄지 않았다).
		withoutDraftSave(() => useBoardStore.setState((s) => { s.drafts.delete("court-1"); }));
		await new Promise((r) => setTimeout(r, 0));
		expect(h.save).not.toHaveBeenCalled();
		useBoardStore.setState((s) => { s.drafts.set("X", { id: "X", anchorMemberIds: ["a", "b"], createdAt: 9, anchor: { x: 0, y: 0 } }); });
		await new Promise((r) => setTimeout(r, 0));
		expect(h.save).toHaveBeenCalled();
	});

	it("completes, moves the ready next team onto the freed court group, and commits once via the grant RPC", async () => {
		// 결과 창에서 고친 실제 편(A편 = a·c)도 RPC 까지 그대로 간다.
		const out = await useBoardStore.getState().completeMatchAsMember(1, "M1", "A", ["a", "c"]);
		expect(out).toMatchObject({ status: "completed", arrange: "ok" });
		expect(h.memberComplete).toHaveBeenCalledExactlyOnceWith("M1", 1, "A", ["a", "c"]);
		expect(h.applied).toHaveBeenCalledOnce();
		expect(h.commit).toHaveBeenCalledOnce();
		const [sessionId, matchId, base, payloads] = h.commit.mock.calls[0];
		expect([sessionId, matchId, base]).toEqual([1, "M1", 5]);
		// 준비된 예비팀을 옮기는 계획은 안전 계획과 같다 — 후보 하나.
		expect(payloads).toHaveLength(1);
		const payload = payloads[0];
		const courtTeam = payload.teams.find((t: { courtId?: number }) => t.courtId === 1);
		expect([...courtTeam.memberIds].sort()).toEqual(["e", "f", "g", "h"]);
		expect(payload.teams.some((t: { id: string }) => t.id === "T")).toBe(false);
		expect(h.save).not.toHaveBeenCalled(); // 회원은 board_save_drafts 를 쓰지 않는다
		expect(claimEdit()).toBe(false);
		expect(useBoardStore.getState().assigningTeamIds.size).toBe(0);
	});

	it("does not leave other editing actions open for the member afterwards", async () => {
		await useBoardStore.getState().completeMatchAsMember(1, "M1", null);
		const before = useBoardStore.getState().drafts;
		useBoardStore.getState().dismissTeam("court-1");
		expect(useBoardStore.getState().drafts).toBe(before);
	});

	it("reports already-completed without arranging and without a second RPC on double tap", async () => {
		h.memberComplete.mockResolvedValueOnce({ ok: false, reason: "already_completed", message: "Match already completed or not found" });
		const [first, second] = await Promise.all([
			useBoardStore.getState().completeMatchAsMember(1, "M1", "B"),
			useBoardStore.getState().completeMatchAsMember(1, "M1", "B"),
		]);
		expect(first.status).toBe("already_completed");
		expect(second.status).toBe("busy");
		expect(h.memberComplete).toHaveBeenCalledOnce();
		expect(h.commit).not.toHaveBeenCalled();
		expect(claimEdit()).toBe(false);
	});

	it("still reports completion when the arrangement commit throws, and the grant stays closed", async () => {
		h.commit.mockRejectedValueOnce(new Error("network"));
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const out = await useBoardStore.getState().completeMatchAsMember(1, "M1", null);
		err.mockRestore();
		expect(out).toMatchObject({ status: "completed", arrange: "error" });
		expect(claimEdit()).toBe(false);
	});

	it("keeps server placements this device could not draw (late players are not wiped)", async () => {
		// 서버엔 예비팀 U(x,y,z)가 있는데 이 기기는 그 선수 자석을 아직 못 받아 U 를 그리지 못했다.
		const local = serializeBoardDrafts(useBoardStore.getState());
		drewServer({ ...local, teams: [...local.teams, { id: "U", memberIds: ["x", "y", "z"], createdMs: 3 }] });
		await useBoardStore.getState().completeMatchAsMember(1, "M1", null);
		const payload = h.commit.mock.calls[0][3][0];
		expect(payload.teams.find((t: { id: string }) => t.id === "U")?.memberIds).toEqual(["x", "y", "z"]);
	});

	it("forms a new group when no team is ready, with alternatives and the safe plan last; adopts the server's choice", async () => {
		useBoardStore.setState((s) => {
			s.drafts.delete("T");
			for (const id of ["e", "f", "g", "h"]) s.magnets.get(id)!.teamId = null;
		});
		drewServer();
		h.commit.mockResolvedValueOnce({ status: "ok", version: 6, chosen: 1 });
		const out = await useBoardStore.getState().completeMatchAsMember(1, "M1", null);
		expect(out).toMatchObject({ status: "completed", arrange: "ok" });
		const payloads = h.commit.mock.calls[0][3] as BoardDraftsPayload[];
		const court = (p: BoardDraftsPayload) => p.teams.find((t) => t.courtId === 1)!.memberIds;
		expect(payloads.length).toBeGreaterThanOrEqual(3);
		expect(payloads.length).toBeLessThanOrEqual(5);
		expect(court(payloads[0])).toHaveLength(4); // 0번: 새 그룹 자동 편성
		expect(court(payloads.at(-1)!)).toEqual([]); // 마지막: 안전 후보(예비팀이 없으니 그대로)
		// 대안은 0번이 새로 넣은 사람 중 한 명을 뺀 편성이다.
		expect(court(payloads[1])).toHaveLength(4);
		expect(court(payloads[0]).filter((id) => !court(payloads[1]).includes(id))).toHaveLength(1);
		expect(new Set(payloads.map((p) => JSON.stringify(p))).size).toBe(payloads.length);
		// 서버가 1번을 골랐다 — 로컬 보드도 그 편성이다.
		expect([...useBoardStore.getState().drafts.get("court-1")!.anchorMemberIds].sort()).toEqual([...court(payloads[1])].sort());
		expect(claimEdit()).toBe(false);
	});
});
