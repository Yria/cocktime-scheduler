/**
 * remoteDragStore
 *
 * 동시 편집 중 '다른 운영진이 지금 끌고 있는 항목' 수신 상태(board-drag 채널). boardStore 와 분리한다 —
 * boardStore 를 건드리면 저장 subscribe 가 돌고, 이 값은 보드 권위가 아니라 표시 전용이기 때문.
 *
 * 수명:
 *  · start/move → live(목표 좌표 갱신). 마지막 수신 후 LIVE_TTL_MS 무소식이면 유실로 보고 지운다.
 *  · end → held(최종 좌표 유지). 이 기기 보드가 그 뒤의 서버 버전을 반영했거나 HOLD_MAX_MS 가 지나면 지운다
 *    (드롭 직후 확정 저장이 도착하기 전 원래 자리로 튀었다 돌아오는 깜빡임 방지).
 *  · cancel → 즉시 지운다.
 * 자기 연결(c)의 메시지와 연결별 seq 역행은 버린다. 송신 포트(port)는 운영진 && 동시 편집일 때만 존재한다.
 */
import { create } from "zustand";
import type { DragMessage, DragPhase } from "../lib/supabase/dragChannel";

export const REMOTE_DRAG_LIVE_TTL_MS = 1500;
export const REMOTE_DRAG_HOLD_MAX_MS = 3500;
const SWEEP_MS = 100;

export interface RemoteDrag {
	key: string;
	x: number;
	y: number;
	/** 잡은 연결(탭) id. */
	c: string;
	name: string;
	phase: "live" | "held";
	/** 이 항목을 처음 받은 시각(동시 잡기 판정용). */
	startedAt: number;
	/** start 를 못 받고 move(keepalive 포함)부터 받았다 — 상대가 언제 잡았는지 모른다(이 기기보다 먼저일 수 있다). */
	joinedLate: boolean;
	/** 마지막 수신 시각(live TTL 기준). */
	lastAt: number;
	/** held 로 바뀐 시각과 그때 이 기기 보드가 반영한 서버 버전. */
	heldAt?: number;
	heldVersion?: number;
}

/** 송신 포트 — 이 기기의 연결 id·표시명과 전송 함수. 런타임은 이 값이 있을 때만 보낸다. */
export interface DragPort {
	connId: string;
	name: string;
	send: (key: string, phase: DragPhase, x: number, y: number) => void;
}

interface RemoteDragState {
	drags: ReadonlyMap<string, RemoteDrag>;
	port: DragPort | null;
	/** 수신 처리. now 는 테스트 주입용. */
	receive: (message: DragMessage, now?: number) => void;
	/** TTL·hold 만료 청소. 타이머가 부르지만 테스트에서 직접 부를 수 있다. */
	sweep: (now?: number) => void;
	/** 연결(포트)과 '이 기기 보드가 반영한 서버 버전' 공급자를 붙인다. null 이면 끊고 비운다. */
	connect: (port: DragPort | null, appliedVersion?: () => number) => void;
	/** 화면에 남은 원격 드래그 전부 비움(연결 유지). */
	clear: () => void;
}

// 표시와 무관한 수신 장부 — 연결별 마지막 seq. 렌더 구독을 깨우지 않게 store 밖에 둔다.
const lastSeq = new Map<string, number>();
let appliedVersionOf: (() => number) | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function syncSweepTimer(size: number, sweep: () => void) {
	if (size > 0 && !sweepTimer) sweepTimer = setInterval(sweep, SWEEP_MS);
	else if (size === 0 && sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
}

export const useRemoteDragStore = create<RemoteDragState>((set, get) => {
	const commit = (drags: Map<string, RemoteDrag>) => {
		set({ drags });
		syncSweepTimer(drags.size, () => get().sweep());
	};
	return {
		drags: new Map(),
		port: null,
		receive: (message, now = Date.now()) => {
			const port = get().port;
			if (!port || message.c === port.connId) return;
			const prev = lastSeq.get(message.c);
			if (prev !== undefined && message.s <= prev) return;
			lastSeq.set(message.c, message.s);
			const current = get().drags;
			const existing = current.get(message.k);
			if (message.ph === "cancel") {
				if (existing?.c !== message.c) return;
				const drags = new Map(current); drags.delete(message.k); commit(drags); return;
			}
			if (message.ph === "end") {
				// start/move 를 못 받은 end 는 보여 줄 게 없다 — 무시(확정 결과는 저장 경로로 온다).
				if (existing?.c !== message.c) return;
				const drags = new Map(current);
				drags.set(message.k, { ...existing, x: message.x, y: message.y, phase: "held", lastAt: now,
					heldAt: now, heldVersion: appliedVersionOf?.() ?? 0 });
				commit(drags); return;
			}
			// start/move — 한 연결은 한 번에 하나만 끈다. 같은 연결의 다른 live 항목은 끝난 것으로 본다
			// (end 유실). held 는 저장 확정을 기다리는 중이라 남긴다. start 를 놓친 move 는 start 로 취급한다.
			const drags = new Map(current);
			for (const [key, drag] of current) if (key !== message.k && drag.c === message.c && drag.phase === "live") drags.delete(key);
			const same = existing?.c === message.c && existing.phase === "live" && message.ph !== "start";
			drags.set(message.k, {
				key: message.k, x: message.x, y: message.y, c: message.c, name: message.n, phase: "live",
				startedAt: same ? existing.startedAt : now, joinedLate: same ? existing.joinedLate : message.ph !== "start", lastAt: now,
			});
			commit(drags);
		},
		sweep: (now = Date.now()) => {
			const current = get().drags;
			if (current.size === 0) { syncSweepTimer(0, () => {}); return; }
			const version = appliedVersionOf?.() ?? 0;
			let drags: Map<string, RemoteDrag> | null = null;
			for (const [key, drag] of current) {
				const expired = drag.phase === "live"
					? now - drag.lastAt > REMOTE_DRAG_LIVE_TTL_MS
					: now - (drag.heldAt ?? 0) > REMOTE_DRAG_HOLD_MAX_MS || version > (drag.heldVersion ?? 0);
				if (!expired) continue;
				drags ??= new Map(current);
				drags.delete(key);
			}
			if (drags) commit(drags);
		},
		connect: (port, appliedVersion) => {
			lastSeq.clear();
			appliedVersionOf = port ? appliedVersion ?? null : null;
			set({ port });
			commit(new Map());
		},
		clear: () => { lastSeq.clear(); commit(new Map()); },
	};
});

/** key 가 원격에서 잡혀 있는지(live/held 모두 — 확정 전까지 소프트락). */
export function remoteDragOf(key: string): RemoteDrag | undefined {
	return useRemoteDragStore.getState().drags.get(key);
}
