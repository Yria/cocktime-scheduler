import { useCallback, useRef } from "react";
import { isInRestField, isInDetachZone } from "../lib/board/geometry";
import { playingIdsFromCourts } from "../lib/board/membership";
import { resolveDropTarget } from "../lib/board/dropResolver";
import { useBoardStore } from "../store/boardStore";
import { useSessionStore } from "../store/sessionStore";

/**
 * 보드 자석 드래그/드롭 핸들러 묶음.
 * - 드래그 이동 중: 휴식 필드 hover → hot, '팀에서 빼기' 드롭존 hover → detachHot, 겹침 대상 → hoverTarget(하이라이트).
 * - 드롭: 상단 드롭존(팀 소속) → detach / 하단 휴식 필드 → 휴식 / 그 외 → 자유 배치(handleDrop).
 * - ghost: 드롭존 → 예약 취소, 그 외 → handleGhostDrop.
 * 좌표(cx,cy)는 PlayerMagnet에서 줌/팬 보정된 논리 좌표.
 */
export function useBoardDragHandlers(stageH: number, restZoneOpen: boolean) {
	const setRestFieldHot = useBoardStore((s) => s.setRestFieldHot);
	const restPlayer = useBoardStore((s) => s.restPlayer);
	const unrestPlayer = useBoardStore((s) => s.unrestPlayer);
	const handleDrop = useBoardStore((s) => s.handleDrop);
	const handleGhostDrop = useBoardStore((s) => s.handleGhostDrop);

	const hotRef = useRef(false); // 휴식 hot 스로틀(상태 전환 시에만 store set)

	// 드래그 이동 중: 휴식 hot + 빼기 드롭존 hot + 겹침 하이라이트.
	const onMagnetDragMove = useCallback(
		(playerId: string, cx: number, cy: number) => {
			// 보기 전용은 자유 자석 로컬 이동만 — 멤버십 피드백(휴식/빼기/겹침) 없음.
			if (!useSessionStore.getState().isEditor) return;
			const point = { x: cx, y: cy };
			const store = useBoardStore.getState();

			// 휴식 필드 hot
			const restHot = isInRestField(point, stageH, restZoneOpen);
			if (restHot !== hotRef.current) {
				hotRef.current = restHot;
				setRestFieldHot(restHot);
			}

			// '팀에서 빼기' 드롭존 hot — 팀 소속(anchor/ghost) 자석을 끌 때만 활성
			const detachable = store.dragInfo?.detachable ?? false;
			const detachHot = detachable && isInDetachZone(point);
			store.setDetachHot(detachHot);

			// 겹침 하이라이트 — 빼기 드롭존 위면 하이라이트 없음(합류가 아니라 빼기 동작)
			if (detachHot) {
				store.setHoverTarget(null);
				return;
			}
			const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
			const target = resolveDropTarget(playerId, point, store.magnets, store.drafts, store.reservations, playingIds);
			const hover =
				target.kind === "attach"
					? { kind: "team" as const, id: target.teamId }
					: target.kind === "reserve"
						? { kind: "team" as const, id: target.toTeamId }
						: target.kind === "createPair" || target.kind === "reservePair"
							? { kind: "magnet" as const, id: target.partnerId }
							: null;
			store.setHoverTarget(hover);
		},
		[stageH, restZoneOpen, setRestFieldHot],
	);

	const clearHot = useCallback(() => {
		if (hotRef.current) {
			hotRef.current = false;
			setRestFieldHot(false);
		}
	}, [setRestFieldHot]);

	// 자유/anchor 드래그-엔드: 빼기존(팀 소속) → detach / 휴식 필드 → 휴식 / 그 외 → handleDrop.
	const onMagnetDragEnd = useCallback(
		(playerId: string, cx: number, cy: number) => {
			clearHot();
			const point = { x: cx, y: cy };
			const store = useBoardStore.getState();
			// 보기 전용은 자유 자석 로컬 이동만(handleDrop이 viewer 분기로 처리) — 휴식/빼기/멤버십 없음.
			if (!useSessionStore.getState().isEditor) {
				handleDrop(playerId, point);
				return;
			}
			const mag = store.magnets.get(playerId);
			if (mag && mag.teamId !== null && isInDetachZone(point)) {
				store.detachMember(playerId, point);
				return;
			}
			if (isInRestField(point, stageH, restZoneOpen)) {
				restPlayer(playerId);
				return;
			}
			handleDrop(playerId, point);
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

	// ghost 드래그-엔드: 빼기존 → 예약 취소, 그 외 → handleGhostDrop.
	const onGhostDragEnd = useCallback(
		(resId: string, cx: number, cy: number) => {
			const point = { x: cx, y: cy };
			if (isInDetachZone(point)) {
				useBoardStore.getState().cancelReservation(resId);
				return;
			}
			handleGhostDrop(resId, point);
		},
		[handleGhostDrop],
	);

	return { onMagnetDragMove, onMagnetDragEnd, onRestingDragEnd, onGhostDragEnd };
}
