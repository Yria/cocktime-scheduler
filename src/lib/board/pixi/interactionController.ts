import type { StagePoint } from "../../../types/board";
import { clampScale, ZOOM_STEP } from "../../../store/board/zoom";
import type { BoardSource } from "./types";

export interface BoardInteractionTarget {
	key: string;
	source?: BoardSource;
	/** Rendered center in world coordinates, including any current motion offset. */
	point: StagePoint;
	draggable: boolean;
	onTap?: () => void;
	onDoubleTap?: () => void;
	onLongPress?: () => void;
}

/** Canvas CSS pixels, never backing-buffer/DPR coordinates. */
export interface BoardPointerSample extends StagePoint {
	id: number;
}

export interface BoardInteractionPorts {
	pick: (world: StagePoint) => BoardInteractionTarget | null;
	getScale: () => number;
	/** Must synchronously update the effective scale returned by getScale. */
	onZoom: (scale: number) => void;
	commitZoom: (hasEffectiveChange: boolean) => void;
	onDragStart: (target: BoardInteractionTarget) => void;
	onDragMove: (target: BoardInteractionTarget, worldCenter: StagePoint) => void;
	onDragEnd: (target: BoardInteractionTarget, worldCenter: StagePoint) => void;
	/** Discard previews and restore any uncommitted zoom from the current store. */
	onCancel: () => void;
}

export interface BoardInteractionController {
	pointerDown: (sample: BoardPointerSample) => void;
	pointerMove: (sample: BoardPointerSample) => void;
	pointerUp: (sample: BoardPointerSample) => void;
	wheel: (deltaY: number) => void;
	flushZoom: () => void;
	cancel: () => void;
	dispose: () => void;
}

const DRAG_DISTANCE = 3;
const LONG_PRESS_DISTANCE = 8;
const DOUBLE_TAP_MS = 280;
const LONG_PRESS_MS = 500;
const WHEEL_COMMIT_MS = 120;

type Timer = ReturnType<typeof setTimeout>;
interface Press {
	phase: "pressed" | "dragging";
	id: number;
	target: BoardInteractionTarget | null;
	start: StagePoint;
	offset: StagePoint;
	longPressTimer: Timer | null;
	longPressFired: boolean;
}
interface Pinch {
	phase: "pinching";
	ids: readonly [number, number];
	distance: number;
}
type Gesture = Press | Pinch | { phase: "suppressed" };

function isMagnet(target: BoardInteractionTarget): boolean {
	return target.source != null && target.source.kind !== "team" && target.source.kind !== "court";
}

/**
 * Input policy only: the host owns pointer capture, authoritative permissions,
 * source validation, rendering and store commands. Timers make this controller
 * independent of DOM/Pixi while retaining the existing magnet gestures.
 */
export function createBoardInteractionController(ports: BoardInteractionPorts): BoardInteractionController {
	const pointers = new Map<number, BoardPointerSample>();
	const pendingTaps = new Map<string, Timer>();
	let gesture: Gesture | null = null;
	let wheelTimer: Timer | null = null;
	let zoomPending = false;
	let zoomChanged = false;
	let disposed = false;

	const toWorld = (point: StagePoint): StagePoint => {
		const scale = ports.getScale();
		return { x: point.x / scale, y: point.y / scale };
	};
	const centerAt = (press: Press, sample: BoardPointerSample): StagePoint => {
		const world = toWorld(sample);
		return { x: world.x - press.offset.x, y: world.y - press.offset.y };
	};
	const clearLongPress = (press: Press) => {
		if (press.longPressTimer !== null) clearTimeout(press.longPressTimer);
		press.longPressTimer = null;
	};
	const clearTap = (key: string) => {
		const timer = pendingTaps.get(key);
		if (timer !== undefined) clearTimeout(timer);
		pendingTaps.delete(key);
	};
	const clearTaps = () => {
		for (const timer of pendingTaps.values()) clearTimeout(timer);
		pendingTaps.clear();
	};
	const clearWheelTimer = () => {
		if (wheelTimer !== null) clearTimeout(wheelTimer);
		wheelTimer = null;
	};
	const flushZoom = () => {
		if (disposed) return;
		clearWheelTimer();
		if (!zoomPending) return;
		const changed = zoomChanged;
		zoomPending = false;
		zoomChanged = false;
		ports.commitZoom(changed);
	};
	const applyZoom = (value: number) => {
		zoomPending = true;
		const next = clampScale(value);
		if (next === ports.getScale()) return;
		zoomChanged = true;
		ports.onZoom(next);
	};
	const cancel = () => {
		const hadWork = gesture !== null || pointers.size > 0 || pendingTaps.size > 0 || zoomPending;
		if (gesture?.phase === "pressed" || gesture?.phase === "dragging") clearLongPress(gesture);
		clearTaps();
		clearWheelTimer();
		pointers.clear();
		gesture = null;
		zoomPending = false;
		zoomChanged = false;
		if (hadWork) ports.onCancel();
	};
	const tap = (target: BoardInteractionTarget) => {
		if (!target.source) {
			target.onTap?.();
			return;
		}
		if (!isMagnet(target)) return;
		if (pendingTaps.has(target.key)) {
			clearTap(target.key);
			target.onDoubleTap?.();
			return;
		}
		if (!target.onTap && !target.onDoubleTap) return;
		const timer = setTimeout(() => {
			pendingTaps.delete(target.key);
			if (!disposed) target.onTap?.();
		}, DOUBLE_TAP_MS);
		pendingTaps.set(target.key, timer);
	};
	const pointerDown = (sample: BoardPointerSample) => {
		if (disposed || pointers.has(sample.id)) return;
		if (pointers.size === 0) flushZoom();
		pointers.set(sample.id, { ...sample });
		if (pointers.size === 2 && gesture?.phase !== "suppressed") {
			if (gesture?.phase === "pressed" || gesture?.phase === "dragging") clearLongPress(gesture);
			clearTaps();
			// Cancel the single-pointer operation without dropping its source. The
			// physical pointers stay tracked so the remaining finger can be ignored.
			gesture = { phase: "suppressed" };
			ports.onCancel();
			if (disposed || pointers.size !== 2) return;
			const [a, b] = [...pointers.values()];
			gesture = { phase: "pinching", ids: [a.id, b.id], distance: Math.hypot(a.x - b.x, a.y - b.y) };
			zoomPending = true;
			return;
		}
		if (pointers.size !== 1 || gesture?.phase === "suppressed") return;
		const world = toWorld(sample);
		const target = ports.pick(world);
		const press: Press = {
			phase: "pressed",
			id: sample.id,
			target,
			start: { x: sample.x, y: sample.y },
			offset: target ? { x: world.x - target.point.x, y: world.y - target.point.y } : { x: 0, y: 0 },
			longPressTimer: null,
			longPressFired: false,
		};
		gesture = press;
		if (target && isMagnet(target) && target.onLongPress) {
			press.longPressTimer = setTimeout(() => {
				press.longPressTimer = null;
				if (disposed || gesture !== press || press.phase !== "pressed") return;
				press.longPressFired = true;
				clearTap(target.key);
				target.onLongPress?.();
			}, LONG_PRESS_MS);
		}
	};
	const pointerMove = (sample: BoardPointerSample) => {
		if (disposed || !pointers.has(sample.id)) return;
		pointers.set(sample.id, { ...sample });
		const current = gesture;
		if (!current || current.phase === "suppressed") return;
		if (current.phase === "pinching") {
			if (pointers.size !== 2) return;
			const a = pointers.get(current.ids[0]);
			const b = pointers.get(current.ids[1]);
			if (!a || !b) return;
			const distance = Math.hypot(a.x - b.x, a.y - b.y);
			if (current.distance > 0 && distance > 0) applyZoom(ports.getScale() * distance / current.distance);
			current.distance = distance;
			return;
		}
		if (current.id !== sample.id || !current.target || current.longPressFired) return;
		const dx = sample.x - current.start.x;
		const dy = sample.y - current.start.y;
		if (dx * dx + dy * dy > LONG_PRESS_DISTANCE * LONG_PRESS_DISTANCE) clearLongPress(current);
		if (current.phase === "pressed" && current.target.draggable && Math.max(Math.abs(dx), Math.abs(dy)) >= DRAG_DISTANCE) {
			clearLongPress(current);
			clearTap(current.target.key);
			current.phase = "dragging";
			ports.onDragStart(current.target);
		}
		if (gesture === current && current.phase === "dragging") ports.onDragMove(current.target, centerAt(current, sample));
	};
	const pointerUp = (sample: BoardPointerSample) => {
		if (disposed || !pointers.has(sample.id)) return;
		// The release can contain a newer position than the last pointermove.
		pointerMove(sample);
		if (disposed || !pointers.has(sample.id)) return;
		pointers.delete(sample.id);
		const current = gesture;
		if (!current) return;
		if (current.phase === "pinching") {
			if (current.ids.includes(sample.id)) {
				gesture = pointers.size ? { phase: "suppressed" } : null;
				flushZoom();
			}
			return;
		}
		if (current.phase === "suppressed") {
			if (pointers.size === 0) gesture = null;
			return;
		}
		if (current.id !== sample.id) return;
		clearLongPress(current);
		gesture = null;
		if (!current.target) return;
		if (current.phase === "dragging") {
			ports.onDragEnd(current.target, centerAt(current, sample));
		} else if (!current.longPressFired && ports.pick(toWorld(sample))?.key === current.target.key) {
			tap(current.target);
		}
	};
	return {
		pointerDown,
		pointerMove,
		pointerUp,
		wheel: (deltaY) => {
			if (disposed || pointers.size > 0 || !Number.isFinite(deltaY) || deltaY === 0) return;
			applyZoom(ports.getScale() + (deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP));
			clearWheelTimer();
			wheelTimer = setTimeout(flushZoom, WHEEL_COMMIT_MS);
		},
		flushZoom,
		cancel,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			cancel();
		},
	};
}
