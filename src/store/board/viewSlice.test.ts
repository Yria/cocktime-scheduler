import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import type { BoardState } from "./types";

const session = vi.hoisted(() => ({ isEditor: true }));
vi.mock("../sessionStore", () => ({ useSessionStore: { getState: () => session } }));

import { createViewSlice } from "./viewSlice";
import { SCALE_KEY, SCALE_LOCK_KEY } from "./zoom";

enableMapSet();

function makeStore() {
	return createStore<BoardState>()(devtools(immer((...args) => ({
		...createViewSlice(...args), magnets: new Map(), drafts: new Map(), reservations: new Map(), courtAnchors: new Map(), assigningTeamIds: new Set(),
	} as BoardState)), { enabled: false }));
}

beforeEach(() => {
	session.isEditor = true;
	vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("committed board camera", () => {
	it("publishes scale, user preference and logical bounds in one transaction", () => {
		const store = makeStore();
		const snapshots: { scale: number; userScale: number | null; width: number; height: number }[] = [];
		store.subscribe((state) => snapshots.push({ scale: state.scale, userScale: state.userScale, width: state.stageW, height: state.stageH }));
		store.getState().commitBoardView({ scale: 0.751, cssWidth: 390, cssHeight: 600, userChanged: true });
		expect(snapshots).toEqual([{ scale: 0.75, userScale: 0.75, width: 520, height: 800 }]);
		expect(localStorage.setItem).toHaveBeenCalledTimes(2);
		expect(localStorage.setItem).toHaveBeenCalledWith(SCALE_KEY, "0.75");
		expect(localStorage.setItem).toHaveBeenCalledWith(SCALE_LOCK_KEY, "1");
	});

	it("does not claim a manual preference when the controller reports no effective change", () => {
		const store = makeStore();
		store.getState().commitBoardView({ scale: 1.1, cssWidth: 390, cssHeight: 600, userChanged: false });
		expect(store.getState()).toMatchObject({ scale: 1, userScale: null, stageW: 390, stageH: 600 });
		expect(localStorage.setItem).not.toHaveBeenCalled();
		const listener = vi.fn();
		store.subscribe(listener);
		store.getState().commitBoardView({ scale: 1, cssWidth: 390, cssHeight: 600, userChanged: false });
		expect(listener).not.toHaveBeenCalled();
	});

	it("persists a gesture that changed scale and returned to its committed starting value", () => {
		const store = makeStore();
		store.getState().commitBoardView({ scale: 0.8, cssWidth: 400, cssHeight: 640 });
		expect(store.getState().userScale).toBeNull();
		store.getState().commitBoardView({ scale: 0.8, cssWidth: 400, cssHeight: 640, userChanged: true });
		expect(store.getState()).toMatchObject({ scale: 0.8, userScale: 0.8 });
		expect(localStorage.setItem).toHaveBeenCalledWith(SCALE_KEY, "0.8");
		expect(localStorage.setItem).toHaveBeenCalledWith(SCALE_LOCK_KEY, "1");
	});

	it("automatic fit and resize preserve the user's saved upper bound", () => {
		const store = makeStore();
		store.getState().commitBoardView({ scale: 0.8, cssWidth: 400, cssHeight: 640, userChanged: true });
		vi.mocked(localStorage.setItem).mockClear();
		store.getState().commitBoardView({ scale: 0.5, cssWidth: 300, cssHeight: 600 });
		expect(store.getState()).toMatchObject({ scale: 0.5, userScale: 0.8, stageW: 600, stageH: 1200 });
		expect(localStorage.setItem).not.toHaveBeenCalled();
	});

	it("ignores incomplete viewport observations and survives unavailable storage", () => {
		const store = makeStore();
		const previous = store.getState();
		previous.commitBoardView({ scale: 0.8, cssWidth: 0, cssHeight: 600, userChanged: true });
		previous.commitBoardView({ scale: Number.NaN, cssWidth: 390, cssHeight: 600, userChanged: true });
		expect(store.getState()).toBe(previous);
		vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error("Storage unavailable"); });
		previous.commitBoardView({ scale: 0.5, cssWidth: 390, cssHeight: 600, userChanged: true });
		expect(store.getState()).toMatchObject({ scale: 0.5, userScale: 0.5, stageW: 780, stageH: 1200 });
	});
});

describe("manual card placement marker", () => {
	it("marks editor card drags without changing layout coordinates or repeating notifications", () => {
		const store = makeStore();
		const previous = store.getState();
		const listener = vi.fn();
		store.subscribe(listener);
		previous.markManualLayout();
		store.getState().markManualLayout();
		expect(store.getState().manualLayout).toBe(true);
		expect(store.getState().magnets).toBe(previous.magnets);
		expect(store.getState().drafts).toBe(previous.drafts);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("keeps viewer automatic layout enabled", () => {
		session.isEditor = false;
		const store = makeStore();
		const previous = store.getState();
		previous.markManualLayout();
		expect(store.getState()).toBe(previous);
		expect(store.getState().manualLayout).toBe(false);
	});
});
