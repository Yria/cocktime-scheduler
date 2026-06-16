import { useCallback, useRef } from "react";
import { isInRestField } from "../lib/board/geometry";
import { useBoardStore } from "../store/boardStore";

/**
 * 보드 자석 드래그/드롭 핸들러 묶음.
 * - 드래그 이동 중 휴식 필드 hover → hot 하이라이트(상태 전환 시에만 store 갱신, hotRef 스로틀).
 * - 드롭: 휴식 필드면 휴식 처리, 아니면 자유 배치(handleDrop).
 * - 휴식 자석을 패널 밖(위)으로 빼면 복귀(unrestPlayer).
 */
export function useBoardDragHandlers(stageH: number, restZoneOpen: boolean) {
	const setRestFieldHot = useBoardStore((s) => s.setRestFieldHot);
	const restPlayer = useBoardStore((s) => s.restPlayer);
	const unrestPlayer = useBoardStore((s) => s.unrestPlayer);
	const handleDrop = useBoardStore((s) => s.handleDrop);
	const handleGhostDrop = useBoardStore((s) => s.handleGhostDrop);

	const hotRef = useRef(false); // 드래그 프레임마다 store set 남발 방지(상태 전환 시에만)

	// 드래그 이동 중: 휴식 필드 위로 들어오면 액티베이트(hot) 하이라이트.
	const onMagnetDragMove = useCallback(
		(_playerId: string, cx: number, cy: number) => {
			const hot = isInRestField({ x: cx, y: cy }, stageH, restZoneOpen);
			if (hot !== hotRef.current) {
				hotRef.current = hot;
				setRestFieldHot(hot);
			}
		},
		[stageH, restZoneOpen, setRestFieldHot],
	);

	const clearHot = useCallback(() => {
		if (hotRef.current) {
			hotRef.current = false;
			setRestFieldHot(false);
		}
	}, [setRestFieldHot]);

	// 자유 이동: 드롭한 자리에 그대로 둔다. 단, 하단 휴식 필드에 드롭하면 휴식 처리.
	const onMagnetDragEnd = useCallback(
		(playerId: string, cx: number, cy: number) => {
			clearHot();
			if (isInRestField({ x: cx, y: cy }, stageH, restZoneOpen)) {
				restPlayer(playerId);
				return;
			}
			handleDrop(playerId, { x: cx, y: cy });
		},
		[handleDrop, restZoneOpen, stageH, restPlayer, clearHot],
	);

	// 휴식 자석 드래그-엔드: 패널 밖(위)으로 빼면 복귀, 패널 안이면 슬롯으로 스냅백(PlayerMagnet 처리).
	const onRestingDragEnd = useCallback(
		(playerId: string, cx: number, cy: number) => {
			clearHot();
			if (!isInRestField({ x: cx, y: cy }, stageH, true)) unrestPlayer(playerId, { x: cx, y: cy });
		},
		[stageH, unrestPlayer, clearHot],
	);

	const onGhostDragEnd = useCallback(
		(resId: string, cx: number, cy: number) => {
			handleGhostDrop(resId, { x: cx, y: cy });
		},
		[handleGhostDrop],
	);

	return { onMagnetDragMove, onMagnetDragEnd, onRestingDragEnd, onGhostDragEnd };
}
