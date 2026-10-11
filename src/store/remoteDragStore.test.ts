import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDragMessage, type DragMessage } from "../lib/supabase/dragChannel";
import { REMOTE_DRAG_HOLD_MAX_MS, REMOTE_DRAG_LIVE_TTL_MS, useRemoteDragStore } from "./remoteDragStore";

let applied = 5;
const msg = (over: Partial<DragMessage>): DragMessage => ({ k: "free:a", ph: "start", x: 10, y: 20, c: "z", n: "남", s: 1, ...over });
const store = () => useRemoteDragStore.getState();

beforeEach(() => {
	vi.useFakeTimers();
	applied = 5;
	store().connect({ connId: "me", name: "나", send: vi.fn() }, () => applied);
});
afterEach(() => {
	store().connect(null);
	vi.useRealTimers();
});

describe("원격 드래그 수신", () => {
	it("포트가 없으면(회원·단일 편집) 아무것도 받지 않는다", () => {
		store().connect(null);
		store().receive(msg({}));
		expect(store().drags.size).toBe(0);
	});

	it("자기 연결의 메시지와 seq 역행은 버린다", () => {
		store().receive(msg({ c: "me" }));
		expect(store().drags.size).toBe(0);
		store().receive(msg({ s: 5, x: 50 }));
		store().receive(msg({ ph: "move", s: 4, x: 40 })); // 늦게 도착한 옛 move
		store().receive(msg({ ph: "move", s: 5, x: 45 })); // 같은 seq 중복
		expect(store().drags.get("free:a")).toMatchObject({ x: 50, phase: "live", name: "남" });
		store().receive(msg({ ph: "move", s: 6, x: 60 }));
		expect(store().drags.get("free:a")?.x).toBe(60);
	});

	it("start 를 놓친 move 는 시작으로 받고, 같은 연결의 다른 live 항목은 끝난 것으로 본다", () => {
		store().receive(msg({ ph: "move", k: "free:a", s: 1 }));
		store().receive(msg({ k: "free:b", s: 2 }));
		expect([...store().drags.keys()]).toEqual(["free:b"]);
	});

	it("move 기준 1.5s 무소식이면 지운다", () => {
		store().receive(msg({}), Date.now());
		vi.advanceTimersByTime(REMOTE_DRAG_LIVE_TTL_MS - 100);
		store().receive(msg({ ph: "move", s: 2 }), Date.now());
		vi.advanceTimersByTime(REMOTE_DRAG_LIVE_TTL_MS - 100);
		expect(store().drags.size).toBe(1);
		vi.advanceTimersByTime(300);
		expect(store().drags.size).toBe(0);
	});

	it("end 뒤에는 최종 좌표로 유지하다가 이 기기 보드가 새 버전을 반영하면 지운다", () => {
		store().receive(msg({}));
		store().receive(msg({ ph: "end", s: 2, x: 99 }));
		expect(store().drags.get("free:a")).toMatchObject({ phase: "held", x: 99, heldVersion: 5 });
		vi.advanceTimersByTime(REMOTE_DRAG_LIVE_TTL_MS + 500); // live TTL 은 held 에 적용되지 않는다
		expect(store().drags.size).toBe(1);
		applied = 6;
		vi.advanceTimersByTime(150);
		expect(store().drags.size).toBe(0);
	});

	it("확정 버전이 안 오면 3.5s 뒤 지운다", () => {
		store().receive(msg({}));
		store().receive(msg({ ph: "end", s: 2 }));
		vi.advanceTimersByTime(REMOTE_DRAG_HOLD_MAX_MS - 200);
		expect(store().drags.size).toBe(1);
		vi.advanceTimersByTime(400);
		expect(store().drags.size).toBe(0);
	});

	it("cancel 은 즉시 지우고, 다른 연결의 cancel·end 는 무시한다", () => {
		store().receive(msg({}));
		store().receive(msg({ ph: "cancel", c: "y", s: 9 }));
		store().receive(msg({ ph: "end", c: "y", s: 10 }));
		expect(store().drags.get("free:a")?.phase).toBe("live");
		store().receive(msg({ ph: "cancel", s: 2 }));
		expect(store().drags.size).toBe(0);
	});
});

describe("페이로드 검증", () => {
	it("모양이 틀리면 버린다", () => {
		expect(parseDragMessage(msg({}))).toEqual(msg({}));
		expect(parseDragMessage({ ...msg({}), ph: "drop" })).toBeNull();
		expect(parseDragMessage({ ...msg({}), x: "NaN" })).toBeNull();
		expect(parseDragMessage({ ...msg({}), k: "" })).toBeNull();
		expect(parseDragMessage(null)).toBeNull();
		expect(parseDragMessage({ ...msg({}), n: 3 })?.n).toBe("");
	});
});
