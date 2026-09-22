import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRow, SessionSnapshot } from "../lib/supabase/types";
import type { SessionChannelHandlers } from "../lib/supabase/sessionChannels";

vi.mock("../lib/supabase", async (importOriginal) => ({
	...await importOriginal<typeof import("../lib/supabase")>(),
	fetchActiveSession: vi.fn(),
	fetchSessionSnapshot: vi.fn(),
	startSession: vi.fn(),
	updateSession: vi.fn(),
	dbEndSession: vi.fn(),
	dbBoardSaveDrafts: vi.fn(),
	dbBoardReleaseEditor: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/supabase/members", () => ({ fetchMembers: vi.fn().mockResolvedValue([]) }));
vi.mock("../lib/supabase/clubSettings", () => ({ fetchGroupSettings: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/supabase/sessionChannels", () => ({
	createSessionChannels: vi.fn().mockReturnValue({ broadcastChannel: null, metaChannel: null }),
}));
vi.mock("./sessionEditorLock", async (importOriginal) => ({
	...await importOriginal<typeof import("./sessionEditorLock")>(),
	installLockLifecycle: vi.fn(),
}));

import { dbBoardReleaseEditor, dbBoardSaveDrafts, dbEndSession, fetchActiveSession, fetchSessionSnapshot, startSession, updateSession } from "../lib/supabase";
import { flushBoardDrafts, pushDraftsToRemote } from "./board/draftsSync";
import { createSessionChannels } from "../lib/supabase/sessionChannels";
import { appActions, useAppStore, type SessionMeta } from "./appStore";
import { useAuthStore } from "./authStore";
import { useSessionStore } from "./sessionStore";
import { useToastStore } from "./toastStore";

const meta: SessionMeta = { sessionId: 7, courtCount: 2, singleWomanIds: [], cockCheckEnabled: true, isScheduled: false };
const settings = { courtCount: 2, singleWomanIds: [], cockCheckEnabled: true };
const active = { id: 7, is_active: true, status: "active", court_count: 2, cock_check_enabled: true, scheduled_at: null } as SessionRow;
const snapshot: SessionSnapshot = { session: active, players: [], matches: [], completedMatches: [] };

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

beforeEach(() => {
	vi.clearAllMocks();
	appActions.clearSession();
	useAppStore.setState({ sessionMeta: meta, setupGuests: [{ id: "guest-old", name: "이전 게스트", gender: "M", skills: { grade: 5 } }] });
	useAuthStore.setState({ ready: true, memberLoaded: true, isAdmin: true, user: { id: "admin" } as never, myName: "운영진" });
	useToastStore.getState().clear();
	vi.mocked(fetchActiveSession).mockResolvedValue(active);
	vi.mocked(fetchSessionSnapshot).mockResolvedValue(snapshot);
	vi.mocked(dbEndSession).mockResolvedValue(true);
});
afterEach(() => { appActions.clearSession(); });

describe("leaving a board during a position save", () => {
	it("finishes queued drops before releasing the original session's lock", async () => {
		const pending = deferred<number | null>();
		vi.mocked(dbBoardSaveDrafts).mockReturnValueOnce(pending.promise).mockResolvedValue(2);
		useSessionStore.setState({ isEditor: true, _clientId: "editor", _myName: "운영진", boardDraftsVersion: 0 });
		pushDraftsToRemote({ teams: [], reservations: [], layout: { version: 1, teams: {}, courts: { "1": { x: 200, y: 300 } }, magnets: {} } });
		pushDraftsToRemote({ teams: [], reservations: [], layout: { version: 1, teams: {}, courts: { "1": { x: 400, y: 300 } }, magnets: {} } });
		useSessionStore.getState().unsubscribe();
		expect(dbBoardReleaseEditor).not.toHaveBeenCalled();
		useAppStore.setState({ sessionMeta: { ...meta, sessionId: 8 } });
		pending.resolve(1); await flushBoardDrafts();
		await vi.waitFor(() => expect(dbBoardReleaseEditor).toHaveBeenCalledWith(7, "editor"));
		expect(dbBoardSaveDrafts).toHaveBeenCalledTimes(2);
		expect(vi.mocked(dbBoardSaveDrafts).mock.calls[1][4]).toBe(1);
	});
	it("does not release ownership if the same device returns while saving", async () => {
		const pending = deferred<number | null>();
		vi.mocked(dbBoardSaveDrafts).mockReturnValueOnce(pending.promise);
		useSessionStore.setState({ isEditor: true, _clientId: "editor", boardDraftsVersion: 0 });
		pushDraftsToRemote({ teams: [], reservations: [] });
		useSessionStore.getState().unsubscribe();
		useSessionStore.setState({ _clientId: "editor" });
		pending.resolve(1); await flushBoardDrafts();
		expect(dbBoardReleaseEditor).not.toHaveBeenCalled();
	});
});

describe("즉석 세션 권한", () => {
	it.each([null, meta])("일반 회원은 세션 생성과 설정 변경을 저장할 수 없다 (%j)", async (sessionMeta) => {
		useAuthStore.setState({ isAdmin: false });
		useAppStore.setState({ sessionMeta });
		expect(await appActions.startOrUpdateSession([], settings)).toBe(false);
		expect(startSession).not.toHaveBeenCalled();
		expect(updateSession).not.toHaveBeenCalled();
	});
	it("권한 조회가 끝나기 전에는 세션을 생성하지 않는다", async () => {
		useAuthStore.setState({ memberLoaded: false });
		useAppStore.setState({ sessionMeta: null });
		expect(await appActions.startOrUpdateSession([], settings)).toBe(false);
		expect(startSession).not.toHaveBeenCalled();
	});
	it("운영진은 즉석 세션을 생성할 수 있다", async () => {
		useAppStore.setState({ sessionMeta: null });
		vi.mocked(startSession).mockResolvedValue({ sessionId: 8, sessionPlayers: [] });
		expect(await appActions.startOrUpdateSession([], settings)).toBe(true);
		expect(useAppStore.getState().sessionMeta).toMatchObject({ sessionId: 8, isScheduled: false });
	});
	it("운영진은 진행 중인 세션의 설정을 저장할 수 있다", async () => {
		vi.mocked(updateSession).mockResolvedValueOnce(true);
		expect(await appActions.startOrUpdateSession([], settings)).toBe(true);
		expect(updateSession).toHaveBeenCalledWith(7, 2, [], [], true);
		expect(useAppStore.getState().sessionMeta).toEqual(meta);
	});
});

describe("종료한 세션의 로비 상태", () => {
	it("종료 성공은 로비로 이동하기 전에 세션과 참가자 상태를 비운다", async () => {
		useSessionStore.setState({ isEditor: true, waitingIds: ["old-player"] });
		const onEnd = vi.fn(() => {
			expect(useAppStore.getState().sessionMeta).toBeNull();
			expect(useAppStore.getState().setupGuests).toEqual([]);
			expect(useSessionStore.getState().waitingIds).toEqual([]);
		});
		await useSessionStore.getState().handleEndSession(onEnd);
		expect(dbEndSession).toHaveBeenCalledWith(7);
		expect(onEnd).toHaveBeenCalledOnce();
	});
	it("종료 실패는 세션을 유지하고 오류를 알린다", async () => {
		vi.mocked(dbEndSession).mockResolvedValue(false);
		useSessionStore.setState({ isEditor: true });
		const onEnd = vi.fn();
		await useSessionStore.getState().handleEndSession(onEnd);
		expect(onEnd).not.toHaveBeenCalled();
		expect(useAppStore.getState().sessionMeta).toEqual(meta);
		expect(useToastStore.getState().items[0]?.message).toContain("종료하지 못했습니다");
	});
	it("다른 기기의 종료 알림도 로비 이동 전에 세션을 비운다", () => {
		const onEnd = vi.fn(() => expect(useAppStore.getState().sessionMeta).toBeNull());
		useSessionStore.getState().subscribe(7, onEnd);
		const handlers: SessionChannelHandlers = vi.mocked(createSessionChannels).mock.calls[0][3];
		handlers.onEnd();
		expect(onEnd).toHaveBeenCalledOnce();
		// 예전 세션에서 늦게 온 중복 종료 알림이 새 세션을 지우면 안 된다.
		useAppStore.setState({ sessionMeta: { ...meta, sessionId: 8 } });
		handlers.onEnd();
		expect(useAppStore.getState().sessionMeta?.sessionId).toBe(8);
		expect(onEnd).toHaveBeenCalledOnce();
	});
	it("재조회에 활성 세션이 없으면 이전 입장 정보를 지운다", async () => {
		vi.mocked(fetchActiveSession).mockResolvedValue(null);
		expect(await appActions.checkActiveSession()).toBe(false);
		expect(useAppStore.getState().sessionMeta).toBeNull();
	});
	it("활성 세션은 로비 재조회 후에도 입장할 수 있다", async () => {
		expect(await appActions.checkActiveSession()).toBe(true);
		expect(useAppStore.getState().sessionMeta).toEqual(meta);
	});
	it("조회 오류를 세션 종료로 오인하지 않는다", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.mocked(fetchActiveSession).mockRejectedValueOnce(new Error("offline"));
		expect(await appActions.checkActiveSession()).toBe(true);
		expect(useAppStore.getState().sessionMeta).toEqual(meta);
		log.mockRestore();
	});
	it("종료 전에 시작한 활성 세션 조회가 늦게 와도 입장 정보를 복원하지 않는다", async () => {
		const pending = deferred<SessionRow | null>();
		vi.mocked(fetchActiveSession).mockReturnValueOnce(pending.promise);
		const checking = appActions.checkActiveSession();
		appActions.clearSession(7);
		pending.resolve(active);
		expect(await checking).toBe(false);
		expect(useAppStore.getState().sessionMeta).toBeNull();
		expect(fetchSessionSnapshot).not.toHaveBeenCalled();
	});
	it("종료 전에 시작한 스냅샷 로딩도 종료된 세션을 복원하지 않는다", async () => {
		useAppStore.setState({ sessionMeta: null });
		const pending = deferred<SessionSnapshot | null>();
		vi.mocked(fetchSessionSnapshot).mockReturnValueOnce(pending.promise);
		const loading = appActions.loadSession(active);
		appActions.clearSession();
		pending.resolve(snapshot);
		expect(await loading).toBe(false);
		expect(useAppStore.getState().sessionMeta).toBeNull();
	});
	it("조회 사이에 종료된 세션의 스냅샷을 보드로 불러오지 않는다", async () => {
		useAppStore.setState({ sessionMeta: null });
		vi.mocked(fetchSessionSnapshot).mockResolvedValueOnce({ ...snapshot, session: { ...active, is_active: false, status: "closed" } });
		expect(await appActions.loadSession(active)).toBe(false);
		expect(useAppStore.getState().sessionMeta).toBeNull();
	});
	it("설정 저장 중 종료 알림을 받으면 저장 응답이 입장 정보를 복원하지 않는다", async () => {
		const pending = deferred<boolean>();
		vi.mocked(updateSession).mockReturnValueOnce(pending.promise);
		const saving = appActions.startOrUpdateSession([], settings);
		appActions.clearSession(7);
		pending.resolve(true);
		expect(await saving).toBe(false);
		expect(useAppStore.getState().sessionMeta).toBeNull();
	});
});
