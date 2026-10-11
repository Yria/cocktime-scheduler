import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRow } from "../lib/supabase/types";
import type { SessionChannelHandlers } from "../lib/supabase/sessionChannels";
import type { SessionStateSnapshot } from "../lib/supabase/board";

vi.mock("../lib/supabase", async (importOriginal) => ({
	...await importOriginal<typeof import("../lib/supabase")>(),
	dbLoadSessionState: vi.fn(),
	dbLoadCompletedMatchTeams: vi.fn().mockResolvedValue([]),
	dbBoardSaveDrafts: vi.fn(),
	dbBoardClaimEditor: vi.fn().mockResolvedValue(null),
	dbBoardTakeoverEditor: vi.fn().mockResolvedValue(null),
	dbBoardHandoffEditor: vi.fn().mockResolvedValue(null),
	dbBoardReleaseEditor: vi.fn().mockResolvedValue(undefined),
	dbAdminSetBoardMultiEditor: vi.fn(),
}));
vi.mock("../lib/supabase/clubSettings", () => ({ fetchGroupSettings: vi.fn().mockResolvedValue(null), grantCockSupport: vi.fn() }));
vi.mock("../lib/supabase/sessionChannels", () => ({
	createSessionChannels: vi.fn().mockReturnValue({ broadcastChannel: null, metaChannel: null }),
}));
vi.mock("../lib/supabase/dragChannel", () => ({
	createDragChannel: vi.fn(() => ({ send: vi.fn(), close: vi.fn() })),
}));
vi.mock("./sessionEditorLock", async (importOriginal) => ({
	...await importOriginal<typeof import("./sessionEditorLock")>(),
	installLockLifecycle: vi.fn(),
}));

import {
	dbAdminSetBoardMultiEditor,
	dbBoardClaimEditor,
	dbBoardHandoffEditor,
	dbBoardReleaseEditor,
	dbBoardTakeoverEditor,
	dbLoadSessionState,
} from "../lib/supabase";
import { createSessionChannels } from "../lib/supabase/sessionChannels";
import { createDragChannel } from "../lib/supabase/dragChannel";
import { useRemoteDragStore } from "./remoteDragStore";
import { appActions, useAppStore } from "./appStore";
import { useAuthStore } from "./authStore";
import { useSessionStore } from "./sessionStore";
import { useToastStore } from "./toastStore";

const SID = 7;
const snap = (over: Partial<SessionStateSnapshot> = {}): SessionStateSnapshot => ({
	drafts: { teams: [], reservations: [] }, version: 0, matchStateVersion: 0, syncVersion: 1, courtCount: 2,
	matches: [], players: [], editorClientId: null, editorName: null, editorLeaseUntil: null, ...over,
});
const row = (over: Partial<SessionRow>) => ({ id: SID, is_active: true, ...over }) as SessionRow;

function enter(isAdmin = true, userId = "me") {
	useAuthStore.setState({ ready: true, memberLoaded: true, isAdmin, user: { id: userId } as never, myName: isAdmin ? "운영진" : "회원" });
	useSessionStore.getState().subscribe(SID, () => {});
	const calls = vi.mocked(createSessionChannels).mock.calls;
	return calls[calls.length - 1][3] as SessionChannelHandlers;
}
const toasts = () => useToastStore.getState().items.map(t => t.message);

beforeEach(() => {
	vi.clearAllMocks();
	useSessionStore.getState().unsubscribe();
	vi.clearAllMocks();
	appActions.clearSession();
	useAppStore.setState({ sessionMeta: { sessionId: SID, courtCount: 2, singleWomanIds: [], cockCheckEnabled: true, isScheduled: false } });
	useToastStore.getState().clear();
});

describe("동시 편집 플래그 — 진입 스냅샷", () => {
	it("운영진은 editor_* 가 남을 가리켜도 편집자가 되고, 진입 채움은 안내 토스트가 없다", async () => {
		enter(true);
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ multiEditor: true, editorClientId: "other", editorName: "남" }));
		await useSessionStore.getState().resyncFromServer();
		expect(useSessionStore.getState()).toMatchObject({ multiEditor: true, isEditor: true, editorTakenBy: null, lockSynced: true });
		expect(toasts()).toEqual([]);
	});
	it("회원은 동시 편집이어도 보기 전용이다", async () => {
		enter(false, "member");
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ multiEditor: true }));
		await useSessionStore.getState().resyncFromServer();
		expect(useSessionStore.getState()).toMatchObject({ multiEditor: true, isEditor: false });
	});
	it("구서버 스냅샷(키 없음)은 기존 단일 편집자 판정이다", async () => {
		enter(true);
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ editorClientId: "other", editorName: "남" }));
		await useSessionStore.getState().resyncFromServer();
		expect(useSessionStore.getState()).toMatchObject({ multiEditor: false, isEditor: false, holderClientId: "other" });
	});
});

describe("동시 편집 플래그 — 행 이벤트 전환", () => {
	async function asEditor() {
		const handlers = enter(true);
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ editorClientId: "me", editorName: "운영진" }));
		await useSessionStore.getState().resyncFromServer();
		expect(useSessionStore.getState().isEditor).toBe(true);
		return handlers;
	}
	it("OFF→ON: 같은 행에서 editor_* 가 비워져도 편집권 상실로 보지 않고 중립 안내만 한다", async () => {
		const handlers = await asEditor();
		handlers.onSessionRowUpdate(row({ board_multi_editor: true, editor_client_id: null, editor_name: null, editor_lease_until: null }));
		expect(useSessionStore.getState()).toMatchObject({ multiEditor: true, isEditor: true, editorTakenBy: null });
		expect(toasts()).toEqual(["동시 편집이 켜졌어요. 운영진 모두 보드를 편집할 수 있어요"]);
	});
	it("ON→OFF: 운영진 모두 보기 전용(자유)으로 돌아가고 뺏김 다이얼로그 없이 안내한다", async () => {
		const handlers = enter(true);
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ multiEditor: true }));
		await useSessionStore.getState().resyncFromServer();
		handlers.onSessionRowUpdate(row({ board_multi_editor: false, editor_client_id: null, editor_name: null, editor_lease_until: null }));
		expect(useSessionStore.getState()).toMatchObject({ multiEditor: false, isEditor: false, lockFree: true, editorTakenBy: null });
		expect(toasts()).toEqual(["동시 편집이 꺼졌어요. 편집하려면 '편집 권한 가져오기'를 눌러 주세요"]);
	});
	it("ON→OFF 직후 다른 기기가 바로 점유해도 같은 이벤트면 뺏김 다이얼로그를 띄우지 않는다", async () => {
		const handlers = enter(true);
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ multiEditor: true }));
		await useSessionStore.getState().resyncFromServer();
		handlers.onSessionRowUpdate(row({ board_multi_editor: false, editor_client_id: "other", editor_name: "남" }));
		expect(useSessionStore.getState()).toMatchObject({ isEditor: false, holderClientId: "other", editorTakenBy: null });
	});
	it("플래그 OFF 그대로면 기존처럼 남의 점유를 뺏김으로 알린다", async () => {
		const handlers = await asEditor();
		handlers.onSessionRowUpdate(row({ board_multi_editor: false, editor_client_id: "other", editor_name: "남" }));
		expect(useSessionStore.getState()).toMatchObject({ multiEditor: false, isEditor: false, editorTakenBy: "남" });
		expect(toasts()).toEqual([]);
	});
	it("키가 없는 행(구서버)은 플래그를 건드리지 않는다", async () => {
		const handlers = enter(true);
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ multiEditor: true }));
		await useSessionStore.getState().resyncFromServer();
		handlers.onSessionRowUpdate(row({ editor_client_id: null, match_assign_count: 1 }));
		expect(useSessionStore.getState().multiEditor).toBe(true);
	});
	it("워치독(skipLock)도 플래그 전환은 반영하고 같은 스냅샷의 락으로 맞춘다", async () => {
		await asEditor();
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ syncVersion: 2, multiEditor: true }));
		await useSessionStore.getState().resyncFromServer({ skipLock: true });
		expect(useSessionStore.getState()).toMatchObject({ multiEditor: true, isEditor: true, holderClientId: null, editorTakenBy: null });
	});
	it("운영진 여부가 늦게 바뀌면 동시 편집의 isEditor 를 다시 계산한다", async () => {
		enter(false, "late");
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ multiEditor: true }));
		await useSessionStore.getState().resyncFromServer();
		expect(useSessionStore.getState().isEditor).toBe(false);
		useAuthStore.setState({ isAdmin: true });
		expect(useSessionStore.getState().isEditor).toBe(true);
	});
});

describe("동시 편집 중 락 RPC 생략", () => {
	async function multi() {
		enter(true);
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ multiEditor: true }));
		await useSessionStore.getState().resyncFromServer();
	}
	it("가져오기·자동 점유·넘기기를 호출하지 않는다", async () => {
		await multi();
		useSessionStore.setState({ isEditor: false, lockFree: true }); // 방어선 확인용 — 스토어 가드가 막아야 한다
		await useSessionStore.getState().claimEditor();
		useSessionStore.getState().claimEditingIfFree();
		useSessionStore.setState({ isEditor: true });
		await useSessionStore.getState().handoffEditor("other", "남");
		expect(dbBoardTakeoverEditor).not.toHaveBeenCalled();
		expect(dbBoardClaimEditor).not.toHaveBeenCalled();
		expect(dbBoardHandoffEditor).not.toHaveBeenCalled();
	});
	it("나갈 때 편집 락 해제를 보내지 않는다", async () => {
		await multi();
		useSessionStore.getState().unsubscribe();
		await Promise.resolve();
		expect(dbBoardReleaseEditor).not.toHaveBeenCalled();
		expect(useSessionStore.getState().multiEditor).toBe(false);
	});
});

describe("setBoardMultiEditor", () => {
	it("운영진: RPC 후 스냅샷으로 바로 수렴한다", async () => {
		enter(true);
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap());
		await useSessionStore.getState().resyncFromServer();
		vi.mocked(dbAdminSetBoardMultiEditor).mockResolvedValueOnce(true);
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ syncVersion: 2, multiEditor: true }));
		expect(await useSessionStore.getState().setBoardMultiEditor(true)).toBe(true);
		expect(dbAdminSetBoardMultiEditor).toHaveBeenCalledWith(SID, true);
		expect(useSessionStore.getState()).toMatchObject({ multiEditor: true, isEditor: true });
	});
	it("회원은 호출하지 않는다", async () => {
		enter(false, "member");
		expect(await useSessionStore.getState().setBoardMultiEditor(true)).toBe(false);
		expect(dbAdminSetBoardMultiEditor).not.toHaveBeenCalled();
	});
	it("실패하면 오류 토스트를 띄우고 상태를 바꾸지 않는다", async () => {
		enter(true);
		vi.mocked(dbAdminSetBoardMultiEditor).mockResolvedValueOnce(null);
		expect(await useSessionStore.getState().setBoardMultiEditor(true)).toBe(false);
		expect(useSessionStore.getState().multiEditor).toBe(false);
		expect(toasts()).toEqual(["동시 편집 설정을 바꾸지 못했어요. 다시 시도해 주세요"]);
	});
});

describe("실시간 드래그 채널(board-drag) 구독", () => {
	const handle = () => vi.mocked(createDragChannel).mock.results.at(-1)?.value as { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
	it("운영진 && 동시 편집일 때만 열고, 꺼지면 닫고 원격 표시를 비운다", async () => {
		const handlers = enter(true);
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap());
		await useSessionStore.getState().resyncFromServer();
		expect(createDragChannel).not.toHaveBeenCalled();
		handlers.onSessionRowUpdate(row({ board_multi_editor: true, editor_client_id: null }));
		expect(createDragChannel).toHaveBeenCalledTimes(1);
		expect(vi.mocked(createDragChannel).mock.calls[0][0]).toBe(SID);
		expect(useRemoteDragStore.getState().port).toMatchObject({ name: "운영진" });
		// 같은 조건의 반복 이벤트는 다시 열지 않는다
		handlers.onSessionRowUpdate(row({ board_multi_editor: true, match_assign_count: 2 }));
		expect(createDragChannel).toHaveBeenCalledTimes(1);
		useRemoteDragStore.getState().receive({ k: "free:a", ph: "start", x: 1, y: 2, c: "z", n: "남", s: 1 });
		expect(useRemoteDragStore.getState().drags.size).toBe(1);
		handlers.onSessionRowUpdate(row({ board_multi_editor: false, editor_client_id: null }));
		expect(handle().close).toHaveBeenCalledTimes(1);
		expect(useRemoteDragStore.getState()).toMatchObject({ port: null });
		expect(useRemoteDragStore.getState().drags.size).toBe(0);
	});
	it("회원은 동시 편집이어도 채널을 열지 않는다", async () => {
		enter(false, "member");
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ multiEditor: true }));
		await useSessionStore.getState().resyncFromServer();
		expect(createDragChannel).not.toHaveBeenCalled();
		expect(useRemoteDragStore.getState().port).toBeNull();
	});
	it("운영진 여부가 늦게 확정되면 그때 열고, 나가면 닫는다", async () => {
		enter(false, "late");
		vi.mocked(dbLoadSessionState).mockResolvedValueOnce(snap({ multiEditor: true }));
		await useSessionStore.getState().resyncFromServer();
		expect(createDragChannel).not.toHaveBeenCalled();
		useAuthStore.setState({ isAdmin: true });
		expect(createDragChannel).toHaveBeenCalledTimes(1);
		useSessionStore.getState().unsubscribe();
		expect(handle().close).toHaveBeenCalledTimes(1);
		expect(useRemoteDragStore.getState().port).toBeNull();
	});
});
