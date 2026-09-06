import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoardInteractionController, type BoardInteractionTarget } from "./interactionController";

function magnet(key = "free:a", overrides: Partial<BoardInteractionTarget> = {}): BoardInteractionTarget {
	return {
		key,
		source: { kind: "free", playerId: key },
		point: { x: 100, y: 100 },
		draggable: true,
		onTap: vi.fn(),
		onDoubleTap: vi.fn(),
		onLongPress: vi.fn(),
		...overrides,
	};
}

function setup(target: BoardInteractionTarget | null = magnet(), initialScale = 1) {
	let scale = initialScale;
	const ports = {
		pick: vi.fn(() => target),
		getScale: () => scale,
		onZoom: vi.fn((next: number) => { scale = next; }),
		commitZoom: vi.fn(),
		onDragStart: vi.fn(),
		onDragMove: vi.fn(),
		onDragEnd: vi.fn(),
		onCancel: vi.fn(),
	};
	const controller = createBoardInteractionController(ports);
	const down = (x = 100, y = 100, id = 1) => controller.pointerDown({ id, x, y });
	const move = (x: number, y = 100, id = 1) => controller.pointerMove({ id, x, y });
	const up = (x = 100, y = 100, id = 1) => controller.pointerUp({ id, x, y });
	return { controller, ports, target, down, move, up };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("magnet taps", () => {
	it("delays a single tap by 280 ms without treating it as a drag", () => {
		const target = magnet();
		const s = setup(target);
		s.down();
		s.up();
		vi.advanceTimersByTime(279);
		expect(target.onTap).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(target.onTap).toHaveBeenCalledOnce();
		expect(s.ports.onDragStart).not.toHaveBeenCalled();
	});

	it("double tap consumes the pending single tap", () => {
		const target = magnet();
		const s = setup(target);
		s.down();
		s.up();
		vi.advanceTimersByTime(100);
		s.down();
		s.up();
		vi.runAllTimers();
		expect(target.onDoubleTap).toHaveBeenCalledOnce();
		expect(target.onTap).not.toHaveBeenCalled();
	});

	it("keeps different reservations of the same player separate", () => {
		const a = magnet("ghost:r1", { source: { kind: "ghost", playerId: "p", teamId: "t1", reservationId: "r1" } });
		const b = magnet("ghost:r2", { source: { kind: "ghost", playerId: "p", teamId: "t2", reservationId: "r2" } });
		const s = setup(a);
		s.down();
		s.up();
		s.ports.pick.mockReturnValue(b);
		s.down();
		s.up();
		vi.advanceTimersByTime(280);
		expect(a.onTap).toHaveBeenCalledOnce();
		expect(b.onTap).toHaveBeenCalledOnce();
		expect(b.onDoubleTap).not.toHaveBeenCalled();
	});

	it("buttons activate immediately and releasing over another target cancels", () => {
		const target: BoardInteractionTarget = { key: "button", point: { x: 0, y: 0 }, draggable: false, onTap: vi.fn() };
		const s = setup(target);
		s.down();
		s.up();
		expect(target.onTap).toHaveBeenCalledOnce();
		s.down();
		s.ports.pick.mockReturnValue(null);
		s.up();
		expect(target.onTap).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("card sources do not acquire magnet tap or long-press behavior", () => {
		const target = magnet("team:t", { source: { kind: "team", teamId: "t" } });
		const s = setup(target);
		s.down();
		vi.advanceTimersByTime(500);
		s.up();
		vi.runAllTimers();
		expect(target.onTap).not.toHaveBeenCalled();
		expect(target.onLongPress).not.toHaveBeenCalled();
	});
});

describe("long press and dragging", () => {
	it("long press fires at 500 ms and consumes the following tap", () => {
		const target = magnet();
		const s = setup(target);
		s.down();
		vi.advanceTimersByTime(499);
		expect(target.onLongPress).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		s.up();
		vi.runAllTimers();
		expect(target.onLongPress).toHaveBeenCalledOnce();
		expect(target.onTap).not.toHaveBeenCalled();
	});

	it("non-draggable magnets cancel long press only after 8 CSS px", () => {
		const target = magnet("anchor:a", { draggable: false });
		const s = setup(target, 0.5);
		s.down(50, 50);
		s.move(58, 50);
		vi.advanceTimersByTime(499);
		s.move(58.01, 50);
		vi.advanceTimersByTime(1);
		expect(target.onLongPress).not.toHaveBeenCalled();
		expect(s.ports.onDragStart).not.toHaveBeenCalled();
	});

	it("uses a 3 CSS px drag threshold and preserves the grabbed offset through zoom", () => {
		const target = magnet();
		const s = setup(target, 0.5);
		s.down(55, 60); // world pointer 110,120, center 100,100
		expect(s.ports.pick).toHaveBeenLastCalledWith({ x: 110, y: 120 });
		s.move(57.9, 60);
		expect(s.ports.onDragStart).not.toHaveBeenCalled();
		s.move(58, 60);
		expect(s.ports.onDragStart).toHaveBeenCalledExactlyOnceWith(target);
		expect(s.ports.onDragMove).toHaveBeenLastCalledWith(target, { x: 106, y: 100 });
		s.up(70, 80);
		expect(s.ports.onDragEnd).toHaveBeenCalledExactlyOnceWith(target, { x: 130, y: 140 });
		vi.runAllTimers();
		expect(target.onTap).not.toHaveBeenCalled();
		expect(target.onLongPress).not.toHaveBeenCalled();
	});

	it("uses the pointerup sample even when no final pointermove arrived", () => {
		const s = setup();
		s.down();
		s.up(150, -10);
		expect(s.ports.onDragEnd).toHaveBeenCalledExactlyOnceWith(s.target, { x: 150, y: -10 });
	});

	it("dragging the same target cancels a pending single tap", () => {
		const target = magnet();
		const s = setup(target);
		s.down();
		s.up();
		s.down();
		s.move(110);
		vi.runAllTimers();
		expect(target.onTap).not.toHaveBeenCalled();
		s.up(110);
		expect(s.ports.onDragEnd).toHaveBeenCalledOnce();
	});

	it("allows the host to cancel invalid sources inside drag start", () => {
		const s = setup();
		s.ports.onDragStart.mockImplementation(() => s.controller.cancel());
		s.down();
		s.move(120);
		s.up(130);
		expect(s.ports.onCancel).toHaveBeenCalledOnce();
		expect(s.ports.onDragMove).not.toHaveBeenCalled();
		expect(s.ports.onDragEnd).not.toHaveBeenCalled();
	});
});

describe("pinch and wheel", () => {
	it("a second finger cancels dragging, zooms, and suppresses the remaining finger", () => {
		const s = setup(null, 0.8);
		s.ports.pick.mockReturnValue(magnet());
		s.down(100, 100, 1);
		s.move(110, 100, 1);
		s.down(210, 100, 2);
		expect(s.ports.onCancel).toHaveBeenCalledOnce();
		s.move(222.5, 100, 2);
		expect(s.ports.getScale()).toBe(0.9);
		s.up(235, 100, 2); // final sample increases distance to 125
		expect(s.ports.getScale()).toBe(1);
		expect(s.ports.commitZoom).toHaveBeenCalledExactlyOnceWith(true);
		s.move(150, 100, 1);
		s.up(150, 100, 1);
		expect(s.ports.onDragEnd).not.toHaveBeenCalled();
		expect(s.ports.onDragStart).toHaveBeenCalledOnce();
	});

	it("remembers a zoom that returns to its starting value", () => {
		const s = setup(null, 0.8);
		s.down(100, 100, 1);
		s.down(200, 100, 2);
		s.move(212.5, 100, 2);
		s.move(200, 100, 2);
		s.up(200, 100, 2);
		expect(s.ports.getScale()).toBe(0.8);
		expect(s.ports.commitZoom).toHaveBeenCalledExactlyOnceWith(true);
	});

	it("clamped gestures and wheel at maximum do not create manual intent", () => {
		const s = setup(null);
		s.controller.wheel(-1);
		vi.advanceTimersByTime(120);
		expect(s.ports.onZoom).not.toHaveBeenCalled();
		expect(s.ports.commitZoom).toHaveBeenCalledExactlyOnceWith(false);
	});

	it("accumulates every wheel step and commits only at the end of its burst", () => {
		const s = setup(null);
		s.controller.wheel(1);
		s.controller.wheel(100);
		vi.advanceTimersByTime(100);
		s.controller.wheel(-100);
		expect(s.ports.getScale()).toBe(0.9);
		vi.advanceTimersByTime(119);
		expect(s.ports.commitZoom).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(s.ports.commitZoom).toHaveBeenCalledExactlyOnceWith(true);
	});

	it("flushes pending wheel changes before picking a new drag source", () => {
		const s = setup();
		s.controller.wheel(1);
		s.down(90, 90);
		expect(s.ports.commitZoom).toHaveBeenCalledExactlyOnceWith(true);
		expect(s.ports.pick).toHaveBeenCalledWith({ x: 100, y: 100 });
		vi.advanceTimersByTime(120);
		expect(s.ports.commitZoom).toHaveBeenCalledOnce();
	});

	it("pinch prevents a pending tap or long press from firing", () => {
		const target = magnet();
		const s = setup(target);
		s.down();
		s.up();
		s.down();
		s.down(200, 100, 2);
		vi.runAllTimers();
		expect(target.onTap).not.toHaveBeenCalled();
		expect(target.onLongPress).not.toHaveBeenCalled();
	});
});

describe("cancellation and disposal", () => {
	it("cancels drag exactly once and ignores its late pointerup", () => {
		const s = setup();
		s.down();
		s.move(110);
		s.controller.cancel();
		s.controller.cancel();
		s.up(120);
		vi.runAllTimers();
		expect(s.ports.onCancel).toHaveBeenCalledOnce();
		expect(s.ports.onDragEnd).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("cancellation discards pending tap and uncommitted wheel zoom", () => {
		const target = magnet();
		const s = setup(target);
		s.down();
		s.up();
		s.controller.wheel(1);
		s.controller.cancel();
		vi.runAllTimers();
		expect(target.onTap).not.toHaveBeenCalled();
		expect(s.ports.commitZoom).not.toHaveBeenCalled();
		expect(s.ports.onCancel).toHaveBeenCalledOnce();
	});

	it("dispose clears all timers and makes further input inert", () => {
		const target = magnet();
		const s = setup(target);
		s.down();
		s.controller.dispose();
		s.controller.dispose();
		s.up();
		s.down();
		s.controller.wheel(1);
		s.controller.flushZoom();
		vi.runAllTimers();
		expect(s.ports.onCancel).toHaveBeenCalledOnce();
		expect(target.onTap).not.toHaveBeenCalled();
		expect(target.onLongPress).not.toHaveBeenCalled();
		expect(s.ports.onZoom).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
