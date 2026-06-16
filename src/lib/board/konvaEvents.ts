/**
 * konvaEvents.ts
 *
 * Konva 보드 이벤트 공용 헬퍼.
 */
import type Konva from "konva";

/**
 * 드래그 이벤트가 자기 자신(Group)에서 발생했는지 판별.
 * 멤버 자석 드래그가 부모 카드/팀 Group으로 버블링된 경우(target≠currentTarget)를 걸러
 * anchor가 멤버 좌표로 덮어써지는 것을 막는다.
 */
export function isSelfDrag(e: Konva.KonvaEventObject<DragEvent>): boolean {
	return e.target === e.currentTarget;
}

/**
 * 캔버스 위 탭/클릭이 부모로 버블링되어 드래그·카드 클릭으로 오인되는 것을 막는 핸들러 묶음.
 * onClick/onTap에서 onActivate를 호출한다. Konva Group에 spread해서 사용:
 *   <Group {...stopTap(() => onEditMatch(id))}>
 */
export function stopTap(onActivate?: () => void) {
	const stop = (e: Konva.KonvaEventObject<Event>) => {
		e.cancelBubble = true;
	};
	const activate = (e: Konva.KonvaEventObject<Event>) => {
		e.cancelBubble = true;
		onActivate?.();
	};
	return {
		onMouseDown: stop,
		onTouchStart: stop,
		onClick: activate,
		onTap: activate,
	};
}
