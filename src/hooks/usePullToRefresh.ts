import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * 당겨서 새로고침(pull-to-refresh) — iOS standalone PWA 처럼 브라우저 새로고침 UI 가 없는 환경용.
 * 스크롤 컨테이너가 최상단(scrollTop<=0)일 때 아래로 당기면 거리를 추적하고, 임계(THRESHOLD)를
 * 넘긴 채 놓으면 onRefresh 를 호출한다. 기본 onRefresh 는 location.reload(앱 코드까지 갱신).
 *
 * 반환: pull(현재 당김 거리, 인디케이터용), refreshing(새로고침 트리거됨), ready(임계 도달).
 */
const THRESHOLD = 70; // 이만큼 당겨 놓으면 새로고침
const MAX_PULL = 110; // 인디케이터 최대 당김(고무줄 저항감)

export function usePullToRefresh(
	scrollRef: RefObject<HTMLElement | null>,
	onRefresh: () => void | Promise<void> = () => window.location.reload(),
): { pull: number; refreshing: boolean; ready: boolean } {
	const [pull, setPull] = useState(0);
	const [refreshing, setRefreshing] = useState(false);
	// 제스처 로직용 ref(렌더 유발 없이 최신값 참조) — 모두 아래 단일 effect 안에서만 read/write 한다.
	const startY = useRef<number | null>(null);
	const activeRef = useRef(false);
	const pullRef = useRef(0);
	const onRefreshRef = useRef(onRefresh);
	useEffect(() => {
		onRefreshRef.current = onRefresh;
	});

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;

		// 당김 거리: 로직용 ref + 렌더용 state 동시 갱신
		const setDist = (d: number) => {
			pullRef.current = d;
			setPull(d);
		};

		const onTouchStart = (e: TouchEvent) => {
			// 스크롤 최상단에서 시작한 단일 터치만 당김 제스처 후보
			if (el.scrollTop <= 0 && e.touches.length === 1) {
				startY.current = e.touches[0].clientY;
				activeRef.current = false;
			} else {
				startY.current = null;
			}
		};

		const onTouchMove = (e: TouchEvent) => {
			if (startY.current == null) return;
			const dy = e.touches[0].clientY - startY.current;
			if (dy <= 0) {
				// 위로 스크롤로 전환 — 제스처 취소
				if (activeRef.current) {
					activeRef.current = false;
					setDist(0);
				}
				return;
			}
			// 아래로 당기는 중 + 컨테이너가 여전히 최상단이면 당김 활성화
			if (el.scrollTop <= 0) {
				activeRef.current = true;
				// 고무줄 저항: 당길수록 둔해지게(제곱근 감쇠)
				const damped = Math.min(MAX_PULL, Math.sqrt(dy) * 7);
				setDist(damped);
				// 네이티브 오버스크롤 bounce 대신 인디케이터를 쓰기 위해 기본 동작 차단
				if (e.cancelable) e.preventDefault();
			}
		};

		const onTouchEnd = () => {
			if (startY.current == null) return;
			const triggered = activeRef.current && pullRef.current >= THRESHOLD;
			startY.current = null;
			activeRef.current = false;
			if (triggered) {
				setRefreshing(true);
				setDist(THRESHOLD); // 스피너 위치 고정
				// 약간 지연 후 새로고침(스피너가 보이도록).
				// reload(동기)면 페이지가 사라지고, 재쿼리(async)면 완료 후 인디케이터 해제.
				setTimeout(() => {
					Promise.resolve(onRefreshRef.current()).finally(() => {
						setRefreshing(false);
						setDist(0);
					});
				}, 150);
			} else {
				setDist(0);
			}
		};

		// touchmove 에서 preventDefault 하려면 passive:false 필요
		el.addEventListener("touchstart", onTouchStart, { passive: true });
		el.addEventListener("touchmove", onTouchMove, { passive: false });
		el.addEventListener("touchend", onTouchEnd, { passive: true });
		el.addEventListener("touchcancel", onTouchEnd, { passive: true });
		return () => {
			el.removeEventListener("touchstart", onTouchStart);
			el.removeEventListener("touchmove", onTouchMove);
			el.removeEventListener("touchend", onTouchEnd);
			el.removeEventListener("touchcancel", onTouchEnd);
		};
	}, [scrollRef]);

	return { pull, refreshing, ready: pull >= THRESHOLD };
}
