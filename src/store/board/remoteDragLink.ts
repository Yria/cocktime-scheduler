// 동시 편집 실시간 드래그 채널(board-drag:{sessionId})의 연결 수명 — sessionStore 가 '운영진 && 동시 편집'
// 조건이 바뀔 때마다 setRemoteDragLink 로 원하는 상태를 알린다(같은 세션이면 멱등). 회원·단일 편집 모드는
// null 이라 채널 자체가 없다(Realtime 메시지 0건).
import { getClientId } from "../../lib/deviceName";
import { createDragChannel, type DragChannelHandle } from "../../lib/supabase/dragChannel";
import { useRemoteDragStore } from "../remoteDragStore";

let link: { sessionId: number; name: string; handle: DragChannelHandle } | null = null;

export function setRemoteDragLink(target: { sessionId: number; name: string; appliedVersion: () => number } | null) {
	if (link && target && link.sessionId === target.sessionId && link.name === target.name) return;
	if (link) {
		link.handle.close();
		link = null;
		useRemoteDragStore.getState().connect(null);
	}
	if (!target) return;
	const store = useRemoteDragStore.getState();
	const handle = createDragChannel(target.sessionId, (message) => useRemoteDragStore.getState().receive(message));
	const connId = getClientId();
	// seq 는 연결별 단조 증가. 같은 탭 리로드는 connId 가 같으므로 시계 기준으로 이어 붙여 역행으로 버려지지 않게 한다.
	let seq = 0;
	link = { sessionId: target.sessionId, name: target.name, handle };
	store.connect({
		connId,
		name: target.name,
		send: (k, ph, x, y) => {
			seq = Math.max(seq + 1, Date.now());
			handle.send({ k, ph, x: Math.round(x), y: Math.round(y), c: connId, n: target.name, s: seq });
		},
	}, target.appliedVersion);
}

/** 테스트·디버그용 — 현재 연결된 세션 id. */
export function remoteDragLinkSession(): number | null {
	return link?.sessionId ?? null;
}
