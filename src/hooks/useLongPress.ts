import { useCallback, useEffect, useRef } from "react";

const LONGPRESS_MS = 500;

/**
 * DOM 롱프레스(꾹 누르기) 감지 핸들러를 만든다. PlayerMagnet(Konva)의 롱프레스와 동일한 의도지만
 * 일반 HTML 요소용(목록처럼 항목이 여러 개인 경우 항목 키로 동작).
 *
 * 사용:
 *   const lp = useLongPress<SessionPlayer>((p) => openDebug(p.id));
 *   <div onPointerDown={() => lp.start(id, arg)} onPointerUp={lp.cancel} onPointerLeave={lp.cancel}
 *        onClick={() => { if (lp.didFire()) return; ...단일/더블탭... }} />
 *
 * - `start`: 누름 시작 → ms 후 onLongPress 발동(타이머).
 * - `cancel`: 손 뗌/벗어남/드래그 → 타이머 취소.
 * - `didFire`: 직전 롱프레스 발동 여부(읽으면 리셋). onClick 맨 앞에서 호출해 롱프레스 뒤 잔상 click 흡수.
 */
export function useLongPress<T>(onLongPress: (arg: T) => void, ms = LONGPRESS_MS) {
	const st = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });

	const clear = useCallback(() => {
		if (st.current.timer !== null) {
			clearTimeout(st.current.timer);
			st.current.timer = null;
		}
	}, []);

	useEffect(() => clear, [clear]);

	const start = useCallback(
		(_id: string, arg: T) => {
			st.current.fired = false;
			clear();
			st.current.timer = setTimeout(() => {
				st.current.timer = null;
				st.current.fired = true;
				if (typeof navigator !== "undefined") navigator.vibrate?.(30);
				onLongPress(arg);
			}, ms);
		},
		[clear, onLongPress, ms],
	);

	const cancel = useCallback(() => clear(), [clear]);

	const didFire = useCallback(() => {
		const f = st.current.fired;
		st.current.fired = false;
		return f;
	}, []);

	return { start, cancel, didFire };
}
