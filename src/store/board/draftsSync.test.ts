import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardDraftsPayload } from "../../types/board";

const h = vi.hoisted(() => ({
	save: vi.fn(), load: vi.fn(), toast: vi.fn(), sessionId: 1,
	session: { isEditor: true, multiEditor: false, _clientId: "editor" as string | null, _myName: "운영진", boardDraftsVersion: 7,
		applyDraftsIfNewer: vi.fn(), resyncFromServer: vi.fn(async () => {}) },
}));
vi.mock("../../lib/supabase", () => ({ dbBoardSaveDrafts: h.save, dbLoadSessionState: h.load }));
vi.mock("../sessionStore", () => ({ useSessionStore: { getState: () => h.session } }));
vi.mock("../appStore", () => ({ useAppStore: { getState: () => ({ sessionMeta: { sessionId: h.sessionId } }) } }));
vi.mock("../toastStore", () => ({ toast: h.toast }));
import {
	clearDraftsBase, flushBoardDrafts, getDraftsBase, hasPendingDraftSave, MULTI_REBASE_MAX, MULTI_SAVE_DEBOUNCE_MS,
	pushDraftsToRemote, registerBoardBridge, setDraftsBase,
} from "./draftsSync";
import { setLocalDragActive } from "./localDrag";

const payload = (x: number): BoardDraftsPayload => ({ teams: [], reservations: [],
	layout: { version: 1, teams: {}, courts: { "1": { x, y: 200 } }, magnets: {} } });
function deferred() {
	let resolve!: (value: number | null) => void;
	const promise = new Promise<number | null>(done => { resolve = done; });
	return { promise, resolve };
}
beforeEach(() => {
	vi.clearAllMocks(); h.sessionId = 1;
	Object.assign(h.session, { isEditor: true, multiEditor: false, _clientId: "editor", boardDraftsVersion: 7 });
	h.save.mockResolvedValue(9);
});
afterEach(async () => { await flushBoardDrafts(); });

describe("board save queue", () => {
	it("saves the last drag after leaving and advances the CAS base for queued coordinates", async () => {
		const first = deferred(); h.save.mockReturnValueOnce(first.promise);
		pushDraftsToRemote(payload(100)); pushDraftsToRemote(payload(200)); pushDraftsToRemote(payload(300));
		expect(h.save).toHaveBeenCalledTimes(1);
		expect(hasPendingDraftSave()).toBe(true);
		Object.assign(h.session, { isEditor: false, _clientId: null });
		first.resolve(8); await flushBoardDrafts();
		expect(h.save).toHaveBeenCalledTimes(2);
		expect(h.save).toHaveBeenLastCalledWith(1, "editor", "운영진", payload(300), 8);
		expect(h.session.applyDraftsIfNewer).toHaveBeenLastCalledWith(payload(300), 9);
		expect(hasPendingDraftSave()).toBe(false);
	});
	it("keeps late responses and queued payloads scoped to the session where they were edited", async () => {
		const first = deferred(); h.save.mockReturnValueOnce(first.promise);
		pushDraftsToRemote(payload(100)); pushDraftsToRemote(payload(200));
		h.sessionId = 2; h.session.boardDraftsVersion = 0;
		pushDraftsToRemote(payload(500));
		first.resolve(8); await flushBoardDrafts();
		expect(h.save.mock.calls.map(([id, , , data, version]) => [id, data.layout.courts[1].x, version]))
			.toEqual([[1, 100, 7], [1, 200, 8], [2, 500, 0]]);
		expect(h.session.applyDraftsIfNewer).toHaveBeenCalledTimes(1);
		expect(h.session.applyDraftsIfNewer).toHaveBeenCalledWith(payload(500), 9);
	});
	it("discards stale queued positions on a CAS conflict and resyncs instead of overwriting the new editor", async () => {
		const first = deferred(); h.save.mockReturnValueOnce(first.promise);
		pushDraftsToRemote(payload(100)); pushDraftsToRemote(payload(200));
		first.resolve(null); await flushBoardDrafts();
		expect(h.save).toHaveBeenCalledTimes(1);
		expect(h.session.resyncFromServer).toHaveBeenCalledWith({ force: true });
		expect(h.toast).toHaveBeenCalledTimes(1);
	});
	it("does not persist a viewer's local moves", async () => {
		h.session.isEditor = false;
		pushDraftsToRemote(payload(100)); await flushBoardDrafts();
		expect(h.save).not.toHaveBeenCalled();
	});
});

// ── 동시 편집(multiEditor): 디바운스·base 머지·rebase-retry ─────────────────
type Team = BoardDraftsPayload["teams"][number];
const team = (id: string, memberIds: string[]): Team => ({ id, memberIds, createdMs: 1 });
const roster = (...teams: Team[]): BoardDraftsPayload => ({ teams, reservations: [] });
const ids = (p: BoardDraftsPayload, id: string) => [...(p.teams.find(t => t.id === id)?.memberIds ?? [])].sort();

describe("동시 편집 저장(multiEditor)", () => {
	// 보드 store 대역 — local 이 이 기기 화면, apply 는 applyRemoteDrafts 처럼 base 를 기록한다.
	let local: BoardDraftsPayload;
	const apply = vi.fn((payload: BoardDraftsPayload, version: number, base?: { projection: BoardDraftsPayload; raw: BoardDraftsPayload }) => {
		local = payload;
		setDraftsBase(h.sessionId, version, base?.projection ?? payload, base?.raw ?? payload);
	});
	const snap = (drafts: BoardDraftsPayload, version: number, multiEditor = true) => ({ drafts, version, multiEditor });
	const base0 = roster(team("X", ["a", "b"]), team("Y", ["c", "d"]));
	let infoSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		h.session.multiEditor = true;
		h.load.mockReset();
		local = base0;
		registerBoardBridge({ serialize: () => local, project: (p) => p, apply });
		setDraftsBase(1, 7, base0, base0);
		infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
	});
	afterEach(async () => {
		await flushBoardDrafts();
		setLocalDragActive(false);
		clearDraftsBase();
		infoSpy.mockRestore();
		vi.useRealTimers();
	});

	it("연속 드롭을 디바운스로 묶어 한 번만 저장하고, 기준 버전은 로컬이 반영한 버전을 쓴다", async () => {
		vi.useFakeTimers();
		h.session.boardDraftsVersion = 12; // 화면에 아직 안 그린 새 버전 — 그 위에 덮어쓰면 안 된다
		pushDraftsToRemote(roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d"])));
		pushDraftsToRemote(roster(team("X", ["a", "b", "e", "f"]), team("Y", ["c", "d"])));
		expect(hasPendingDraftSave()).toBe(true);
		await vi.advanceTimersByTimeAsync(MULTI_SAVE_DEBOUNCE_MS - 1);
		expect(h.save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await flushBoardDrafts();
		expect(h.save).toHaveBeenCalledTimes(1);
		const [, , , sent, base] = h.save.mock.calls[0];
		expect(ids(sent, "X")).toEqual(["a", "b", "e", "f"]);
		expect(base).toBe(7);
		expect(getDraftsBase(1)?.version).toBe(9);
		expect(h.session.applyDraftsIfNewer).toHaveBeenLastCalledWith(sent, 9);
	});

	it("로컬 정제만 다른(내가 손대지 않은) 저장은 서버 원본을 지우지 않고, 바뀐 게 없으면 저장을 생략한다", async () => {
		// 서버 원본에는 g 가 있지만 이 기기엔 g 자석이 없어 투영에서 빠졌다.
		const raw = roster(team("X", ["a", "b", "g"]), team("Y", ["c", "d"]));
		const withoutG = (p: BoardDraftsPayload) => ({ ...p, teams: p.teams.map(t => ({ ...t, memberIds: t.memberIds.filter(id => id !== "g") })) });
		registerBoardBridge({ serialize: () => local, project: withoutG, apply });
		setDraftsBase(1, 7, base0, raw);
		pushDraftsToRemote(base0); await flushBoardDrafts();
		expect(h.save).not.toHaveBeenCalled();
		pushDraftsToRemote(roster(team("X", ["a", "b"]), team("Y", ["c", "d", "e"]))); await flushBoardDrafts();
		const [, , , sent] = h.save.mock.calls[0];
		expect(ids(sent, "X")).toEqual(["a", "b", "g"]);
		expect(ids(sent, "Y")).toEqual(["c", "d", "e"]);
	});

	it("CAS 충돌이면 서버 최신과 머지해 다시 저장한다 — await 동안의 로컬 편집까지 포함", async () => {
		const theirs = roster(team("X", ["a", "b"]), team("Y", ["c", "d", "f"]));
		const load = deferred();
		h.save.mockResolvedValueOnce(null).mockResolvedValueOnce(10);
		h.load.mockReturnValueOnce(load.promise.then(() => snap(theirs, 9)));
		local = roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d"]));
		pushDraftsToRemote(local);
		const done = flushBoardDrafts();
		await vi.waitFor(() => expect(h.load).toHaveBeenCalledTimes(1));
		// 스냅샷을 기다리는 사이 한 번 더 드롭(저장 큐에도 들어간다).
		local = roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d"]), team("Z", ["g", "h"]));
		pushDraftsToRemote(local);
		load.resolve(0); await done; await flushBoardDrafts();
		expect(h.session.applyDraftsIfNewer).toHaveBeenCalledWith(theirs, 9);
		const merged = apply.mock.calls[0][0];
		expect(ids(merged, "X")).toEqual(["a", "b", "e"]);
		expect(ids(merged, "Y")).toEqual(["c", "d", "f"]);
		expect(ids(merged, "Z")).toEqual(["g", "h"]);
		expect(apply.mock.calls[0][2]).toEqual({ projection: theirs, raw: theirs });
		expect(h.save).toHaveBeenCalledTimes(2);
		const [, , , sent, base] = h.save.mock.calls[1];
		expect(base).toBe(9);
		expect(ids(sent, "Z")).toEqual(["g", "h"]);
		expect(ids(sent, "Y")).toEqual(["c", "d", "f"]);
		expect(h.toast).not.toHaveBeenCalled();
		expect(h.session.resyncFromServer).not.toHaveBeenCalled();
	});

	it("머지 결과가 서버와 같으면 적용만 하고 다시 저장하지 않는다", async () => {
		const theirs = roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d"]));
		h.save.mockResolvedValueOnce(null);
		h.load.mockResolvedValueOnce(snap(theirs, 9));
		local = roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d"]));
		pushDraftsToRemote(local); await flushBoardDrafts();
		expect(h.save).toHaveBeenCalledTimes(1);
		expect(apply).toHaveBeenCalledTimes(1);
		expect(getDraftsBase(1)?.version).toBe(9);
	});

	it("로컬 드래그 중이면 rebase 적용을 드롭 뒤로 미룬다", async () => {
		const theirs = roster(team("X", ["a", "b"]), team("Y", ["c", "d", "f"]));
		h.save.mockResolvedValueOnce(null).mockResolvedValueOnce(10);
		h.load.mockResolvedValueOnce(snap(theirs, 9));
		local = roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d"]));
		setLocalDragActive(true);
		pushDraftsToRemote(local);
		const done = flushBoardDrafts();
		await vi.waitFor(() => expect(h.load).toHaveBeenCalledTimes(1));
		await new Promise(r => setTimeout(r, 5));
		expect(apply).not.toHaveBeenCalled();
		local = roster(team("X", ["a", "b", "e", "q"]), team("Y", ["c", "d"])); // 드롭 결과
		setLocalDragActive(false);
		await done; await flushBoardDrafts();
		expect(ids(apply.mock.calls[0][0], "X")).toEqual(["a", "b", "e", "q"]);
		expect(ids(apply.mock.calls[0][0], "Y")).toEqual(["c", "d", "f"]);
	});

	it("디바운스 대기 중 동시 편집이 꺼지면 단일 편집자 저장으로 바꾸지 않고 버린 뒤 서버 상태로 수렴한다", async () => {
		vi.useFakeTimers();
		pushDraftsToRemote(roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d"])));
		h.session.multiEditor = false; // 다른 운영진이 토글 OFF(editor_* 도 비워짐)
		await vi.advanceTimersByTimeAsync(MULTI_SAVE_DEBOUNCE_MS);
		await flushBoardDrafts();
		expect(h.save).not.toHaveBeenCalled(); // 머지 안 된 mine 으로 남의 버전을 덮거나 편집권을 잡지 않는다
		expect(h.session.resyncFromServer).toHaveBeenCalledWith({ force: true });
		expect(h.toast).not.toHaveBeenCalled();
		expect(getDraftsBase(1)).toBeNull();
	});

	it("서버가 저장한 머지 결과가 로컬과 다르면(정원 초과로 밀림) 저장된 값을 화면에 그린다", async () => {
		setDraftsBase(1, 7, base0, roster(team("X", ["a", "b", "g", "h"]), team("Y", ["c", "d"])));
		local = roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d", "f"]));
		pushDraftsToRemote(local); await flushBoardDrafts();
		const [, , , sent] = h.save.mock.calls[0];
		expect(ids(sent, "X")).toEqual(["a", "b", "g", "h"]); // 서버 쪽 4명이 차 있어 내가 넣은 e 가 밀려났다
		expect(ids(sent, "Y")).toEqual(["c", "d", "f"]);
		expect(apply).toHaveBeenCalledTimes(1);
		expect(apply.mock.calls[0][0]).toBe(sent);
		expect(apply.mock.calls[0][1]).toBe(9);
		expect(ids(local, "X")).toEqual(["a", "b", "g", "h"]);
	});

	it("머지 결과가 서버 원본과 같아 저장을 생략해도 어긋난 화면은 서버 값으로 맞춘다", async () => {
		const raw = roster(team("X", ["a", "b", "g", "h"]), team("Y", ["c", "d"]));
		setDraftsBase(1, 7, base0, raw);
		local = roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d"])); // 유일한 변경(e)이 정원 초과로 밀린다
		pushDraftsToRemote(local); await flushBoardDrafts();
		expect(h.save).not.toHaveBeenCalled();
		expect(apply).toHaveBeenCalledTimes(1);
		expect(apply.mock.calls[0][1]).toBe(7);
		expect(ids(local, "X")).toEqual(["a", "b", "g", "h"]);
	});

	it("저장 응답 전에 로컬이 더 바뀌었으면 화면을 덮지 않는다", async () => {
		setDraftsBase(1, 7, base0, roster(team("X", ["a", "b", "g", "h"]), team("Y", ["c", "d"])));
		const gate = deferred();
		h.save.mockReturnValueOnce(gate.promise);
		local = roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d", "f"]));
		pushDraftsToRemote(local);
		const done = flushBoardDrafts();
		local = roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d", "f", "k"])); // 응답 전 추가 드롭(아직 큐 전)
		gate.resolve(9); await done;
		expect(apply).not.toHaveBeenCalled();
	});

	it("서버에서 동시 편집이 꺼졌으면 폴백 토스트 없이 조용히 서버 상태로 전환한다", async () => {
		h.save.mockResolvedValueOnce(null);
		h.load.mockResolvedValueOnce(snap(base0, 9, false));
		pushDraftsToRemote(roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d"]))); await flushBoardDrafts();
		expect(h.session.resyncFromServer).toHaveBeenCalledWith({ force: true });
		expect(h.toast).not.toHaveBeenCalled();
		expect(apply).not.toHaveBeenCalled();
		expect(h.save).toHaveBeenCalledTimes(1);
	});

	it("서버 버전이 그대로면 CAS 원인이 아니므로 기존 폴백(강제 동기화 + 토스트)", async () => {
		h.save.mockResolvedValueOnce(null);
		h.load.mockResolvedValueOnce(snap(base0, 7));
		pushDraftsToRemote(roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d"]))); await flushBoardDrafts();
		expect(h.session.resyncFromServer).toHaveBeenCalledWith({ force: true });
		expect(h.toast).toHaveBeenCalledTimes(1);
		expect(apply).not.toHaveBeenCalled();
	});

	it(`rebase 는 최대 ${MULTI_REBASE_MAX}회, 넘으면 기존 폴백`, async () => {
		h.save.mockResolvedValue(null);
		let v = 8;
		h.load.mockImplementation(async () => snap(roster(team("X", ["a", "b"]), team("Y", ["c", "d", `f${v}`])), v++));
		local = roster(team("X", ["a", "b", "e"]), team("Y", ["c", "d"]));
		pushDraftsToRemote(local); await flushBoardDrafts();
		expect(h.save).toHaveBeenCalledTimes(MULTI_REBASE_MAX + 1);
		expect(apply).toHaveBeenCalledTimes(MULTI_REBASE_MAX);
		expect(h.session.resyncFromServer).toHaveBeenCalledWith({ force: true });
		expect(h.toast).toHaveBeenCalledTimes(1);
		expect(getDraftsBase(1)).toBeNull(); // 같은 버전 강제 원복도 다시 그리도록 기준을 비운다
	});
});
