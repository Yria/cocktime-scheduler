import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Application, Container } from "pixi.js";
import type { BoardState } from "../../../store/board/types";
import type { SessionState } from "../../../store/sessionStoreState";
import type { SessionPlayer } from "../../../types";
import { clampScale } from "../../../store/board/zoom";

const stores = vi.hoisted(() => ({
	board: undefined as unknown as StoreApi<BoardState>,
	session: undefined as unknown as StoreApi<SessionState>,
	openDebug: vi.fn(),
}));
vi.mock("../../../store/boardStore", () => ({ useBoardStore: {
	getState: () => stores.board.getState(),
	subscribe: (listener: Parameters<StoreApi<BoardState>["subscribe"]>[0]) => stores.board.subscribe(listener),
} }));
vi.mock("../../../store/sessionStore", () => ({ useSessionStore: {
	getState: () => stores.session.getState(),
	subscribe: (listener: Parameters<StoreApi<SessionState>["subscribe"]>[0]) => stores.session.subscribe(listener),
} }));
vi.mock("../../../store/debugStore", () => ({ useDebugStore: { getState: () => ({ openDebug: stores.openDebug }) } }));

import { BoardRuntime, type BoardCallbacks } from "./runtime";

class TestCanvas extends EventTarget {
	style = { touchAction: "" };
	private captured = new Set<number>();
	getBoundingClientRect() { return { left: 0, top: 0, width: 390, height: 600 }; }
	setPointerCapture(id: number) { this.captured.add(id); }
	hasPointerCapture(id: number) { return this.captured.has(id); }
	releasePointerCapture(id: number) { this.captured.delete(id); }
}

function node() {
	const value = { x: 0, y: 0, position: { set: vi.fn<(x: number, y: number) => void>() }, scale: { set: vi.fn() } };
	value.position.set.mockImplementation((x, y) => { value.x = x; value.y = y; });
	return value;
}

function player(id: string): SessionPlayer {
	return { id, playerId: id, memberId: null, name: id, gender: "M", skills: { grade: 5 },
		allowMixedSingle: false, status: "waiting", gameCount: 0, mixedCount: 0, waitSince: null, joinedAtMatch: 0, cockChecked: true };
}

let frames: Map<number, (time: number) => void>;
let nextFrame: number;
let runtimes: BoardRuntime[];

function frame() {
	const callbacks = [...frames.values()];
	frames.clear();
	for (const callback of callbacks) callback(performance.now());
}

function setup({ editor = true, scale = 1 } = {}) {
	const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
	stores.session = createStore<SessionState>()(() => ({
		isEditor: editor, courts: [{ id: 1, match: null }], restingIds: [], cockCheckEnabled: true,
		sessionPlayers: new Map(ids.map((id) => [id, player(id)])),
	} as unknown as SessionState));
	const update = (patch: Partial<BoardState>) => {
		const state = stores.board.getState();
		if ((Object.keys(patch) as (keyof BoardState)[]).some((key) => state[key] !== patch[key])) stores.board.setState(patch);
	};
	stores.board = createStore<BoardState>()(() => ({
		magnets: new Map(ids.map((id, index) => [id, { playerId: id, x: 100 + index * 74, y: 400, teamId: null as string | null }])),
		drafts: new Map(), reservations: new Map(), courtAnchors: new Map(), assigningTeamIds: new Set(),
		scale, userScale: null, stageW: 390 / scale, stageH: 600 / scale, manualLayout: false,
		dragInfo: null, hoverTarget: null, restFieldHot: false, detachHot: false,
		setDragInfo: vi.fn((dragInfo) => update({ dragInfo })),
		clearDrag: vi.fn(() => update({ dragInfo: null, hoverTarget: null, detachHot: false })),
		setRestFieldHot: vi.fn((restFieldHot) => update({ restFieldHot })),
		setDetachHot: vi.fn((detachHot) => update({ detachHot })),
		setHoverTarget: vi.fn((hoverTarget) => {
			if (JSON.stringify(hoverTarget) !== JSON.stringify(stores.board.getState().hoverTarget)) update({ hoverTarget });
		}),
		markManualLayout: vi.fn(() => { if (stores.session.getState().isEditor) update({ manualLayout: true }); }),
		commitBoardView: vi.fn(({ scale: value, cssWidth, cssHeight, userChanged }) => {
			const next = clampScale(value);
			update({ scale: next, stageW: cssWidth / next, stageH: cssHeight / next,
				...(userChanged ? { userScale: next } : {}) });
		}),
		handleDrop: vi.fn((id, point) => {
			const magnets = new Map(stores.board.getState().magnets);
			const current = magnets.get(id);
			if (current) { magnets.set(id, { ...current, ...point }); update({ magnets }); }
		}),
		setTeamAnchor: vi.fn((id, x, y) => {
			const drafts = new Map(stores.board.getState().drafts);
			const current = drafts.get(id);
			if (current) { drafts.set(id, { ...current, anchor: { x, y } }); update({ drafts }); }
		}),
		setCourtAnchor: vi.fn((id, x, y) => {
			const courtAnchors = new Map(stores.board.getState().courtAnchors);
			courtAnchors.set(id, { x, y }); update({ courtAnchors });
		}),
		settleBoard: vi.fn(), handleGhostDrop: vi.fn(), handlePlayingMagnetDrop: vi.fn(),
		cancelReservation: vi.fn(), detachMember: vi.fn(), restPlayer: vi.fn(), unrestPlayer: vi.fn(),
		confirmTeam: vi.fn(), unconfirmTeam: vi.fn(), startMatch: vi.fn(), completeMatch: vi.fn(),
	} as unknown as BoardState));
	const canvas = new TestCanvas();
	const renderer = { screen: { width: 390, height: 600 }, resize: vi.fn((width: number, height: number) => { renderer.screen = { width, height }; }) };
	const app = { canvas, renderer, render: vi.fn() };
	const callbacks: BoardCallbacks = { onMagnetClick: vi.fn(), onCockCheck: vi.fn(), onSlotClick: vi.fn(), onEditMatch: vi.fn() };
	const runtime = new BoardRuntime(app as unknown as Application, 390, 600, callbacks);
	runtimes.push(runtime);
	const world = node();
	runtime.setWorld(world as unknown as Container);
	frame();
	return { runtime, app, world, canvas, callbacks, board: stores.board };
}

function addTeam(id = "T", ids = ["a", "b"]) {
	const state = stores.board.getState();
	const drafts = new Map(state.drafts);
	drafts.set(id, { id, anchorMemberIds: ids, anchor: { x: 200, y: 180 }, createdAt: 1 });
	const magnets = new Map(state.magnets);
	for (const playerId of ids) magnets.set(playerId, { ...magnets.get(playerId)!, teamId: id });
	stores.board.setState({ drafts, magnets });
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	frames = new Map(); nextFrame = 1; runtimes = [];
	vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => { const id = nextFrame++; frames.set(id, callback); return id; });
	vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
	vi.stubGlobal("window", new EventTarget());
	vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
});

afterEach(() => {
	for (const runtime of runtimes) runtime.dispose();
	vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("BoardRuntime input and scene integration", () => {
	it("draws on invalidation and leaves no continuous idle frame loop", () => {
		const { app, runtime } = setup();
		expect(app.render).toHaveBeenCalledTimes(1);
		expect(frames.size).toBe(0);
		runtime.committed(); runtime.committed();
		expect(frames.size).toBe(1);
		frame();
		expect(app.render).toHaveBeenCalledTimes(2);
		expect(frames.size).toBe(0);
	});

	it("keeps pointer frames out of committed positions and uses the final release and grab offset", () => {
		const { runtime, board } = setup({ scale: 0.5 });
		const commands = board.getState();
		runtime.controller.pointerDown({ id: 1, x: 55, y: 205 });
		runtime.controller.pointerMove({ id: 1, x: 70, y: 230 });
		frame();
		runtime.controller.pointerMove({ id: 1, x: 80, y: 240 });
		frame();
		expect(commands.handleDrop).not.toHaveBeenCalled();
		expect(commands.setTeamAnchor).not.toHaveBeenCalled();
		expect(commands.commitBoardView).not.toHaveBeenCalled();
		expect(board.getState().magnets.get("a")).toMatchObject({ x: 100, y: 400 });
		runtime.controller.pointerUp({ id: 1, x: 95, y: 260 });
		expect(commands.handleDrop).toHaveBeenCalledExactlyOnceWith("a", { x: 180, y: 510 });
		expect(runtime.getSnapshot().drag).toBeNull();
		expect(board.getState().dragInfo).toBeNull();
	});

	it("marks editor card movement at drag start and commits anchor and settle only once", () => {
		const { runtime, board } = setup();
		addTeam();
		const commands = board.getState();
		runtime.controller.pointerDown({ id: 1, x: 200, y: 90 });
		runtime.controller.pointerMove({ id: 1, x: 220, y: 100 });
		frame();
		expect(commands.markManualLayout).toHaveBeenCalledTimes(1);
		expect(board.getState().manualLayout).toBe(true);
		expect(commands.setTeamAnchor).not.toHaveBeenCalled();
		expect(board.getState().drafts.get("T")!.anchor).toEqual({ x: 200, y: 180 });
		runtime.controller.pointerUp({ id: 1, x: 280, y: 120 });
		expect(commands.setTeamAnchor).toHaveBeenCalledExactlyOnceWith("T", 280, 210);
		expect(commands.settleBoard).toHaveBeenCalledExactlyOnceWith({ teamId: "T" });
	});

	it("allows viewer local team movement but prevents viewer anchor membership edits", () => {
		const { runtime, board } = setup({ editor: false });
		addTeam();
		const commands = board.getState();
		runtime.controller.pointerDown({ id: 1, x: 165, y: 145 });
		runtime.controller.pointerMove({ id: 1, x: 240, y: 200 });
		runtime.controller.pointerUp({ id: 1, x: 240, y: 200 });
		expect(commands.handleDrop).not.toHaveBeenCalled();
		expect(runtime.getSnapshot().drag).toBeNull();
		runtime.controller.pointerDown({ id: 2, x: 200, y: 90 });
		runtime.controller.pointerMove({ id: 2, x: 220, y: 100 });
		runtime.controller.pointerUp({ id: 2, x: 220, y: 100 });
		expect(commands.setTeamAnchor).toHaveBeenCalledTimes(1);
		expect(board.getState().manualLayout).toBe(false);
	});

	it("cancels an active drag on player removal without issuing a stale drop", () => {
		const { runtime, board } = setup();
		const commands = board.getState();
		runtime.controller.pointerDown({ id: 1, x: 100, y: 400 });
		runtime.controller.pointerMove({ id: 1, x: 110, y: 410 });
		const players = new Map(stores.session.getState().sessionPlayers);
		players.delete("a"); stores.session.setState({ sessionPlayers: players });
		expect(runtime.getSnapshot().drag).toBeNull();
		runtime.controller.pointerUp({ id: 1, x: 160, y: 430 });
		expect(commands.handleDrop).not.toHaveBeenCalled();
	});

	it("cancels an editor drag immediately when editing permission is lost", () => {
		const { runtime, board } = setup();
		const commands = board.getState();
		runtime.controller.pointerDown({ id: 1, x: 100, y: 400 });
		runtime.controller.pointerMove({ id: 1, x: 110, y: 410 });
		stores.session.setState({ isEditor: false });
		expect(runtime.getSnapshot().drag).toBeNull();
		runtime.controller.pointerUp({ id: 1, x: 160, y: 430 });
		expect(commands.handleDrop).not.toHaveBeenCalled();
	});

	it("routes anchor top-zone removal and free-player rest drops through existing commands", () => {
		const { runtime, board } = setup();
		addTeam();
		const commands = board.getState();
		runtime.controller.pointerDown({ id: 1, x: 165, y: 145 });
		runtime.controller.pointerMove({ id: 1, x: 170, y: 120 });
		runtime.controller.pointerUp({ id: 1, x: 180, y: -10 });
		expect(commands.detachMember).toHaveBeenCalledExactlyOnceWith("a", { x: 180, y: -10 });
		runtime.controller.pointerDown({ id: 2, x: 248, y: 400 });
		runtime.controller.pointerMove({ id: 2, x: 248, y: 450 });
		runtime.controller.pointerUp({ id: 2, x: 248, y: 610 });
		expect(commands.restPlayer).toHaveBeenCalledExactlyOnceWith("c");
		expect(commands.handleDrop).not.toHaveBeenCalled();
	});

	it("does not confuse multiple ghosts and cancels when a reservation changes parents", () => {
		const { runtime, board } = setup();
		addTeam("A", ["a"]); addTeam("B", ["b"]);
		const state = board.getState();
		const drafts = new Map(state.drafts);
		drafts.set("B", { ...drafts.get("B")!, anchor: { x: 350, y: 180 } });
		board.setState({ drafts, reservations: new Map([
			["r1", { id: "r1", playerId: "c", teamId: "A", createdAt: 1 }],
			["r2", { id: "r2", playerId: "c", teamId: "B", createdAt: 2 }],
		]) });
		runtime.controller.pointerDown({ id: 1, x: 235, y: 145 });
		runtime.controller.pointerMove({ id: 1, x: 240, y: 160 });
		expect(runtime.getSnapshot().drag?.view.source).toMatchObject({ kind: "ghost", reservationId: "r1", teamId: "A" });
		const reservations = new Map(board.getState().reservations);
		reservations.set("r1", { ...reservations.get("r1")!, teamId: "B" });
		board.setState({ reservations });
		expect(runtime.getSnapshot().drag).toBeNull();
		runtime.controller.pointerUp({ id: 1, x: 250, y: 250 });
		expect(state.handleGhostDrop).not.toHaveBeenCalled();
		expect(state.cancelReservation).not.toHaveBeenCalled();
	});

	it("submits the selected reservation id on a valid ghost drop", () => {
		const { runtime, board } = setup();
		addTeam("A", ["a"]);
		board.setState({ reservations: new Map([["r1", { id: "r1", playerId: "c", teamId: "A", createdAt: 1 }]]) });
		runtime.controller.pointerDown({ id: 1, x: 235, y: 145 });
		runtime.controller.pointerMove({ id: 1, x: 240, y: 160 });
		runtime.controller.pointerUp({ id: 1, x: 260, y: 250 });
		expect(board.getState().handleGhostDrop).toHaveBeenCalledExactlyOnceWith("r1", { x: 260, y: 250 });
	});

	it("accepts a legitimate source transition performed by the drop command itself", () => {
		const { runtime, board } = setup();
		const handleDrop = vi.mocked(board.getState().handleDrop);
		handleDrop.mockImplementation(() => addTeam("new-team", ["a", "b"]));
		runtime.controller.pointerDown({ id: 1, x: 100, y: 400 });
		runtime.controller.pointerMove({ id: 1, x: 115, y: 400 });
		runtime.controller.pointerUp({ id: 1, x: 174, y: 400 });
		expect(handleDrop).toHaveBeenCalledTimes(1);
		expect(runtime.getSnapshot().drag).toBeNull();
		expect(runtime.getSnapshot().scene.entities.some((view) => view.key === "free:a")).toBe(false);
		expect(runtime.getSnapshot().scene.entities.find((view) => view.key === "team:new-team")).toMatchObject({
			members: [{ source: { kind: "anchor", teamId: "new-team", playerId: "a" } }, { source: { kind: "anchor", teamId: "new-team", playerId: "b" } }],
		});
	});

	it("routes a playing-player drag to reservation logic while the original match stays intact", () => {
		const { runtime, board } = setup();
		board.setState({ courtAnchors: new Map([[1, { x: 200, y: 180 }]]) });
		stores.session.setState({ courts: [{ id: 1, match: { id: "match-1", courtId: 1, gameType: "남복", teamA: ["a", "b"], teamB: ["c", "d"], startedAt: "2026-09-06T00:00:00Z" } }] });
		const match = stores.session.getState().courts[0].match;
		runtime.controller.pointerDown({ id: 1, x: 165, y: 145 });
		runtime.controller.pointerMove({ id: 1, x: 180, y: 180 });
		runtime.controller.pointerUp({ id: 1, x: 300, y: 420 });
		expect(board.getState().handlePlayingMagnetDrop).toHaveBeenCalledExactlyOnceWith("a", { x: 300, y: 420 });
		expect(board.getState().handleDrop).not.toHaveBeenCalled();
		expect(stores.session.getState().courts[0].match).toBe(match);
	});

	it("keeps wheel zoom local until flush and preserves it across unrelated notifications", () => {
		const { runtime, board, world } = setup();
		runtime.controller.wheel(1); frame();
		expect(world.scale.set).toHaveBeenLastCalledWith(0.9);
		expect(board.getState().scale).toBe(1);
		stores.session.setState({ presenceCount: 4 });
		runtime.committed(); frame();
		expect(world.scale.set).toHaveBeenLastCalledWith(0.9);
		runtime.controller.flushZoom();
		expect(board.getState().commitBoardView).toHaveBeenCalledExactlyOnceWith({ scale: 0.9, cssWidth: 390, cssHeight: 600, userChanged: true });
	});

	it("redraws an externally committed scale while the scene is otherwise idle", () => {
		const { board, world, app } = setup();
		board.setState({ scale: 0.8, stageW: 487.5, stageH: 750 });
		expect(frames.size).toBe(1);
		frame();
		expect(world.scale.set).toHaveBeenLastCalledWith(0.8);
		expect(app.render).toHaveBeenCalledTimes(2);
	});

	it("restores the latest committed camera on interrupted uncommitted zoom", () => {
		const { runtime, board, world } = setup();
		runtime.controller.wheel(1); frame();
		expect(world.scale.set).toHaveBeenLastCalledWith(0.9);
		window.dispatchEvent(new Event("blur"));
		frame();
		expect(world.scale.set).toHaveBeenLastCalledWith(1);
		expect(board.getState().scale).toBe(1);
		expect(board.getState().commitBoardView).not.toHaveBeenCalled();
	});

	it("does not flush a pending wheel gesture for a redundant size observation", () => {
		const { runtime, board } = setup();
		runtime.controller.wheel(1);
		runtime.resize(390, 600);
		expect(board.getState().commitBoardView).not.toHaveBeenCalled();
		expect(board.getState().scale).toBe(1);
		runtime.controller.flushZoom();
		expect(board.getState().scale).toBe(0.9);
	});

	it("keeps the existing delayed tap and prevents duplicate operations after dispose", () => {
		const { runtime, callbacks, board } = setup();
		runtime.controller.pointerDown({ id: 1, x: 100, y: 400 });
		runtime.controller.pointerUp({ id: 1, x: 100, y: 400 });
		vi.advanceTimersByTime(279);
		expect(callbacks.onMagnetClick).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(callbacks.onMagnetClick).toHaveBeenCalledExactlyOnceWith("a");
		runtime.controller.pointerDown({ id: 2, x: 100, y: 400 });
		runtime.controller.pointerMove({ id: 2, x: 110, y: 410 });
		runtime.dispose(); runtime.dispose();
		runtime.controller.pointerUp({ id: 2, x: 200, y: 450 });
		expect(board.getState().handleDrop).not.toHaveBeenCalled();
		expect(frames.size).toBe(0);
	});
});
