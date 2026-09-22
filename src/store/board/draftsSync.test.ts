import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardDraftsPayload } from "../../types/board";

const h = vi.hoisted(() => ({
	save: vi.fn(), toast: vi.fn(), sessionId: 1,
	session: { isEditor: true, _clientId: "editor" as string | null, _myName: "운영진", boardDraftsVersion: 7,
		applyDraftsIfNewer: vi.fn(), resyncFromServer: vi.fn(async () => {}) },
}));
vi.mock("../../lib/supabase", () => ({ dbBoardSaveDrafts: h.save }));
vi.mock("../sessionStore", () => ({ useSessionStore: { getState: () => h.session } }));
vi.mock("../appStore", () => ({ useAppStore: { getState: () => ({ sessionMeta: { sessionId: h.sessionId } }) } }));
vi.mock("../toastStore", () => ({ toast: h.toast }));
import { flushBoardDrafts, hasPendingDraftSave, pushDraftsToRemote } from "./draftsSync";

const payload = (x: number): BoardDraftsPayload => ({ teams: [], reservations: [],
	layout: { version: 1, teams: {}, courts: { "1": { x, y: 200 } }, magnets: {} } });
function deferred() {
	let resolve!: (value: number | null) => void;
	const promise = new Promise<number | null>(done => { resolve = done; });
	return { promise, resolve };
}
beforeEach(() => {
	vi.clearAllMocks(); h.sessionId = 1;
	Object.assign(h.session, { isEditor: true, _clientId: "editor", boardDraftsVersion: 7 });
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
