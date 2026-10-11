/**
 * dragChannel.ts
 *
 * 동시 편집(sessions.board_multi_editor) 중 운영진끼리 '지금 끌고 있는 항목'을 실시간으로 보여 주는 전용 채널.
 * - 이름 board-drag:{sessionId}. session-bc 에 섞지 않는다 — 거기 실으면 회원 전원에게 fan-out 된다.
 * - broadcast self:false, ack:false, presence 없음. 구독/송신은 운영진 && 동시 편집일 때만(sessionStore 가 결정).
 * - 보드 상태의 권위가 아니다(유실돼도 무해). 확정 결과는 여전히 board_drafts 저장 → sessions 행 이벤트로 온다.
 * transport 배선과 페이로드 검증만 둔다 — 수신 상태는 remoteDragStore, 송신 스로틀은 Pixi 런타임(dragSender).
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./client";

export type DragPhase = "start" | "move" | "end" | "cancel";

/** 'drag' 이벤트 페이로드. 필드명이 짧은 이유: 드래그 중 초당 수 건이 운영진 수만큼 fan-out 된다. */
export interface DragMessage {
	/** 보드 항목 키(view.key — free:/anchor:/ghost:/team:/court: …). 기기와 무관하게 같은 항목이면 같은 키. */
	k: string;
	ph: DragPhase;
	/** stage 월드 좌표(항목 중심). 기기 해상도·줌과 무관하다. */
	x: number;
	y: number;
	/** 탭 단위 연결 id(getClientId). 같은 사람의 다른 기기를 구분하려고 user.id 를 쓰지 않는다. */
	c: string;
	/** 잡은 사람 표시명. */
	n: string;
	/** 연결별 단조 증가 번호 — 역행(늦게 도착한 옛 move)은 버린다. */
	s: number;
}

const PHASES: ReadonlySet<string> = new Set(["start", "move", "end", "cancel"]);

/** 수신 페이로드 검증 — 채널은 public 이라 모양을 믿지 않는다. 이상하면 null. */
export function parseDragMessage(payload: unknown): DragMessage | null {
	if (!payload || typeof payload !== "object") return null;
	const p = payload as Record<string, unknown>;
	if (typeof p.k !== "string" || !p.k || p.k.length > 200) return null;
	if (typeof p.ph !== "string" || !PHASES.has(p.ph)) return null;
	if (typeof p.c !== "string" || !p.c || p.c.length > 100) return null;
	const x = Number(p.x); const y = Number(p.y); const s = Number(p.s);
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(s)) return null;
	const n = typeof p.n === "string" ? p.n.slice(0, 40) : "";
	return { k: p.k, ph: p.ph as DragPhase, x, y, c: p.c, n, s };
}

export interface DragChannelHandle {
	/** 구독 완료 전에는 버린다 — 미구독 send 는 REST 폴백으로 새는 요청이 된다. */
	send: (message: DragMessage) => void;
	close: () => void;
}

export function createDragChannel(sessionId: number, onMessage: (message: DragMessage) => void): DragChannelHandle {
	let joined = false;
	let closed = false;
	const channel: RealtimeChannel = supabase.channel(`board-drag:${sessionId}`, {
		config: { broadcast: { self: false, ack: false } },
	});
	channel.on("broadcast", { event: "drag" }, ({ payload }) => {
		const message = parseDragMessage(payload);
		if (message) onMessage(message);
	});
	channel.subscribe((status) => { joined = status === "SUBSCRIBED"; });
	return {
		send: (message) => {
			if (!joined || closed) return;
			void channel.send({ type: "broadcast", event: "drag", payload: message });
		},
		close: () => {
			if (closed) return;
			closed = true; joined = false;
			void supabase.removeChannel(channel);
		},
	};
}
