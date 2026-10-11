import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDragSender, DRAG_KEEPALIVE_MS } from "./dragSender";

let hidden = false;
const setup = (withPort = true) => {
	const send = vi.fn();
	const sender = createDragSender(() => withPort ? { send } : null, () => hidden);
	return { send, sender };
};

beforeEach(() => { hidden = false; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("실시간 드래그 송신 스로틀", () => {
	it("포트가 없으면 보내지 않고 활성화도 되지 않는다", () => {
		const { send, sender } = setup(false);
		sender.start("free:a", { x: 0, y: 0 });
		sender.move({ x: 50, y: 0 }); sender.end({ x: 60, y: 0 });
		expect(sender.active).toBe(false);
		expect(send).not.toHaveBeenCalled();
	});

	it("연속 move 는 250ms 에 한 번(마지막 좌표)만 보낸다", () => {
		const { send, sender } = setup();
		sender.start("k", { x: 0, y: 0 });
		for (let i = 1; i <= 10; i++) { vi.advanceTimersByTime(20); sender.move({ x: i * 10, y: 0 }); }
		vi.advanceTimersByTime(250);
		expect(send.mock.calls.map((call) => call.slice(1))).toEqual([["start", 0, 0], ["move", 100, 0]]);
	});

	it("탭이 숨겨지면 시작·이동을 보내지 않는다", () => {
		const { send, sender } = setup();
		hidden = true;
		sender.start("k", { x: 0, y: 0 });
		expect(sender.active).toBe(false);
		hidden = false;
		sender.start("k", { x: 0, y: 0 });
		hidden = true;
		vi.advanceTimersByTime(300);
		sender.move({ x: 100, y: 0 });
		vi.advanceTimersByTime(300);
		expect(send.mock.calls.map((call) => call[1])).toEqual(["start"]);
	});

	it("들고만 있어도 마지막 좌표를 주기적으로 다시 보내 수신측 TTL 에 지워지지 않는다", () => {
		const { send, sender } = setup();
		sender.start("k", { x: 5, y: 5 });
		vi.advanceTimersByTime(DRAG_KEEPALIVE_MS * 2 + 10);
		expect(send.mock.calls.map((call) => call.slice(1))).toEqual([["start", 5, 5], ["move", 5, 5], ["move", 5, 5]]);
		sender.cancel();
		vi.advanceTimersByTime(DRAG_KEEPALIVE_MS * 3);
		expect(send.mock.calls.at(-1)?.slice(1)).toEqual(["cancel", 5, 5]);
		expect(send).toHaveBeenCalledTimes(4);
	});

	it("새 시작은 이전 드래그를 cancel 로 정리한다", () => {
		const { send, sender } = setup();
		sender.start("a", { x: 0, y: 0 });
		sender.start("b", { x: 1, y: 1 });
		expect(send.mock.calls.map((call) => call.slice(0, 2))).toEqual([["a", "start"], ["a", "cancel"], ["b", "start"]]);
	});
});
