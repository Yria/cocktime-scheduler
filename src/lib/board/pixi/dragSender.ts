import type { StagePoint } from "../../../types/board";
import type { DragPhase } from "../../supabase/dragChannel";

/** 송신 포트 — 없으면(회원·단일 편집) 아무것도 보내지 않는다. */
export interface DragSendPort {
	send: (key: string, phase: DragPhase, x: number, y: number) => void;
}

/** move 최소 간격(leading+trailing). 최대 4Hz. */
export const DRAG_SEND_INTERVAL_MS = 250;
/** 직전 송신 좌표에서 이만큼 못 움직였으면 move 를 생략한다. */
export const DRAG_SEND_MIN_PX = 4;
/** 손가락을 멈추고 들고만 있어도 수신측 TTL(1.5s)에 지워지지 않도록 마지막 좌표를 다시 보내는 주기. */
export const DRAG_KEEPALIVE_MS = 1000;

/**
 * 실시간 드래그 송신 스로틀 — Pixi 런타임의 시작/이동/드롭/취소를 board-drag 메시지로 바꾼다.
 * start·end·cancel 은 즉시, move 는 250ms leading+trailing 스로틀 + 4px 미만 생략. 탭이 hidden 이면 보내지 않는다.
 * 포트는 start 시점에 정해지고, 그 드래그 동안만 쓴다(중간에 포트가 사라지면 그 뒤 메시지는 버린다).
 */
export function createDragSender(getPort: () => DragSendPort | null, isHidden: () => boolean = () => typeof document !== "undefined" && document.hidden) {
	let key: string | null = null;
	let last: StagePoint = { x: 0, y: 0 };
	let lastAt = 0;
	let pending: StagePoint | null = null;
	let trailing: ReturnType<typeof setTimeout> | null = null;
	let keepalive: ReturnType<typeof setInterval> | null = null;

	const emit = (phase: DragPhase, point: StagePoint) => {
		const port = getPort();
		if (!key || !port) { stop(); return; }
		port.send(key, phase, point.x, point.y);
		last = point; lastAt = Date.now();
	};
	const clearTimers = () => {
		if (trailing) { clearTimeout(trailing); trailing = null; }
		if (keepalive) { clearInterval(keepalive); keepalive = null; }
	};
	const stop = () => { clearTimers(); key = null; pending = null; };
	const flush = () => {
		trailing = null;
		const point = pending; pending = null;
		if (!point || !key || isHidden()) return;
		if (Math.hypot(point.x - last.x, point.y - last.y) < DRAG_SEND_MIN_PX) return;
		emit("move", point);
	};

	return {
		get active() { return key !== null; },
		start(nextKey: string, point: StagePoint) {
			if (key) this.cancel();
			if (!getPort() || isHidden()) return;
			key = nextKey;
			emit("start", point);
			keepalive = setInterval(() => {
				if (key && !isHidden() && Date.now() - lastAt >= DRAG_KEEPALIVE_MS) emit("move", pending ?? last);
			}, DRAG_KEEPALIVE_MS);
		},
		move(point: StagePoint) {
			if (!key) return;
			pending = point;
			if (trailing) return;
			const wait = DRAG_SEND_INTERVAL_MS - (Date.now() - lastAt);
			if (wait <= 0) flush();
			else trailing = setTimeout(flush, wait);
		},
		end(point: StagePoint) {
			if (!key) return;
			clearTimers();
			emit("end", point);
			stop();
		},
		cancel() {
			if (!key) return;
			clearTimers();
			emit("cancel", last);
			stop();
		},
	};
}

export type DragSender = ReturnType<typeof createDragSender>;
