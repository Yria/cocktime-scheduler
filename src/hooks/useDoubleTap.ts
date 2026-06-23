import { useCallback, useEffect, useRef } from "react";

const DBLTAP_MS = 280;

/**
 * DOM 클릭에서 단일 탭/더블 탭을 구분하는 핸들러를 만든다(목록처럼 항목이 여러 개인 경우용).
 *
 * - 첫 탭은 `delay`(기본 280ms) 후 `onSingle` 발동. 같은 항목을 그 안에 다시 탭하면 대기 중 단일탭을
 *   취소하고 `onDouble` 발동.
 * - 대기 중 *다른* 항목을 탭하면 직전 항목의 단일탭을 즉시 확정한 뒤 새 항목의 대기를 시작한다.
 *
 * 보드 자석(PlayerMagnet)의 Konva 기반 더블탭과 동일한 의도지만, 이 훅은 일반 DOM 클릭
 * (PlayerCard 등 HTML 버튼)에서 쓰도록 항목 키(id) 기준으로 동작한다. 반환 핸들러를 map 안의
 * 각 항목 onClick에 `(id, arg)` 로 호출한다(훅은 목록당 1회 호출).
 */
export function useDoubleTap<T>(
	onSingle: (arg: T) => void,
	onDouble: (arg: T) => void,
	delay = DBLTAP_MS,
): (id: string, arg: T) => void {
	const st = useRef<{ id: string | null; arg: T | null; timer: ReturnType<typeof setTimeout> | null }>({
		id: null,
		arg: null,
		timer: null,
	});

	useEffect(
		() => () => {
			if (st.current.timer !== null) clearTimeout(st.current.timer);
		},
		[],
	);

	return useCallback(
		(id: string, arg: T) => {
			const s = st.current;
			if (s.timer !== null && s.id === id) {
				// 같은 항목 두 번째 탭 → 더블탭(대기 중 단일탭 취소)
				clearTimeout(s.timer);
				s.timer = null;
				s.id = null;
				s.arg = null;
				onDouble(arg);
				return;
			}
			// 대기 중 다른 항목 → 그 단일탭을 즉시 확정
			if (s.timer !== null && s.arg !== null) {
				clearTimeout(s.timer);
				onSingle(s.arg);
			}
			s.id = id;
			s.arg = arg;
			s.timer = setTimeout(() => {
				const pending = s.arg;
				s.timer = null;
				s.id = null;
				s.arg = null;
				if (pending !== null) onSingle(pending);
			}, delay);
		},
		[onSingle, onDouble, delay],
	);
}
