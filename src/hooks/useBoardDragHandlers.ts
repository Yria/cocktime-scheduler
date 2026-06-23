import { useCallback, useRef } from "react";
import { isInRestField, isInDetachZone } from "../lib/board/geometry";
import { cockPendingIds, playingIdsFromCourts } from "../lib/board/membership";
import { resolveDropTarget } from "../lib/board/dropResolver";
import { useBoardStore } from "../store/boardStore";
import { useSessionStore } from "../store/sessionStore";

/**
 * 보드 자석 드래그/드롭 핸들러 묶음.
 * - 드래그 이동 중: 휴식 필드 hover → hot, '팀에서 빼기' 드롭존 hover → detachHot, 겹침 대상 → hoverTarget(하이라이트).
 * - 드롭: 상단 드롭존(팀 소속) → detach / 하단 휴식 필드 → 휴식 / 그 외 → 자유 배치(handleDrop).
 *   단, 자석이 그 존에서 "출발"했다면(dragInfo.from) 같은 존으로의 드롭은 무효(실패) — 존 안에 놓여 있던
 *   자석을 살짝 움직였다고 의도치 않게 빼기/휴식되는 것 방지.
 * - ghost: 드롭존 → 예약 취소, 그 외 → handleGhostDrop.
 * 좌표(cx,cy)는 PlayerMagnet에서 줌/팬 보정된 논리 좌표. viewH = 보이는 논리 영역 높이(stageH/scale).
 */
export function useBoardDragHandlers(viewH: number, restFieldH: number) {
	const setRestFieldHot = useBoardStore((s) => s.setRestFieldHot);
	const restPlayer = useBoardStore((s) => s.restPlayer);
	const unrestPlayer = useBoardStore((s) => s.unrestPlayer);
	const handleDrop = useBoardStore((s) => s.handleDrop);
	const handleGhostDrop = useBoardStore((s) => s.handleGhostDrop);

	const hotRef = useRef(false); // 휴식 hot 스로틀(상태 전환 시에만 store set)

	// 드래그 이동 중: 휴식 hot + 빼기 드롭존 hot + 겹침 하이라이트.
	const onMagnetDragMove = useCallback(
		(playerId: string, cx: number, cy: number) => {
			// 읽기 모드는 자유 자석 로컬 이동만 — 멤버십 피드백(휴식/빼기/겹침) 없음.
			if (!useSessionStore.getState().isEditor) return;
			const point = { x: cx, y: cy };
			const store = useBoardStore.getState();

			// 휴식 필드 hot
			const restHot = isInRestField(point, viewH, restFieldH);
			if (restHot !== hotRef.current) {
				hotRef.current = restHot;
				setRestFieldHot(restHot);
			}

			// 휴식 필드 위에선 드롭이 항상 휴식 우선(onMagnetDragEnd)이라 빼기/겹침 해석 결과가 버려진다.
			// 매 프레임 resolveDropTarget(O(자석수))·cockPendingIds(O(선수수))를 도는 낭비를 생략 → 휴식존 프레임드랍 해소.
			if (restHot) {
				store.setDetachHot(false);
				store.setHoverTarget(null); // 동일값(null)이면 store 가드로 리렌더 없음
				return;
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
			const ss = useSessionStore.getState();
			const playingIds = playingIdsFromCourts(ss.courts);
			const notReadyIds = cockPendingIds(ss.sessionPlayers.values(), ss.cockCheckEnabled);
			const target = resolveDropTarget(playerId, point, store.magnets, store.drafts, store.reservations, playingIds, notReadyIds);
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
		[viewH, restFieldH, setRestFieldHot],
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
			// 읽기 모드는 자유 자석 로컬 이동만(handleDrop이 읽기 분기로 처리) — 휴식/빼기/멤버십 없음.
			if (!useSessionStore.getState().isEditor) {
				handleDrop(playerId, point);
				return;
			}
			// 출발 존 가드: 같은 존에서 출발했다면 그 존으로의 드롭은 무효(빼기/휴식 안 함).
			// 중요 — 막힌 경우 handleDrop으로 "폴백하지 않고" return한다: 폴백하면 resolveDropTarget이
			// 빈 공간 앵커 드롭(상단 빼기존/하단 휴식밴드의 빈 영역)을 'detach'로 재해석해 가드를 우회,
			// 멤버가 결국 빠져버린다. return하면 PlayerMagnet이 앵커=슬롯·자유=원위치로 스냅백한다.
			const origin = store.dragInfo?.from ?? null;
			const startedInDetach = origin != null && isInDetachZone(origin);
			const startedInRest = origin != null && isInRestField(origin, viewH, restFieldH);

			const mag = store.magnets.get(playerId);
			if (mag && mag.teamId !== null && isInDetachZone(point)) {
				if (!startedInDetach) store.detachMember(playerId, point); // 시작이 빼기존이면 무효(스냅백)
				return;
			}
			if (isInRestField(point, viewH, restFieldH)) {
				if (!startedInRest) restPlayer(playerId); // 시작이 휴식존이면 무효(스냅백)
				return;
			}
			handleDrop(playerId, point);
		},
		[handleDrop, restFieldH, viewH, restPlayer, clearHot],
	);

	// 휴식 자석 드래그-엔드: 패널 밖(위)으로 빼면 복귀, 패널 안이면 슬롯으로 스냅백(PlayerMagnet 처리).
	const onRestingDragEnd = useCallback(
		(playerId: string, cx: number, cy: number) => {
			clearHot();
			// 패널 열림 상태에서만 호출되므로 restFieldH = 펼침 패널 높이. 패널 밖(위)으로 빼면 복귀.
			if (!isInRestField({ x: cx, y: cy }, viewH, restFieldH)) unrestPlayer(playerId, { x: cx, y: cy });
		},
		[viewH, restFieldH, unrestPlayer, clearHot],
	);

	// ghost 드래그-엔드: 빼기존 → 예약 취소, 그 외 → handleGhostDrop.
	// 빼기존에서 출발했으면 빼기존 드롭은 무효(예약 유지) — anchor와 동일한 출발 존 가드.
	const onGhostDragEnd = useCallback(
		(resId: string, cx: number, cy: number) => {
			const point = { x: cx, y: cy };
			const origin = useBoardStore.getState().dragInfo?.from ?? null;
			const startedInDetach = origin != null && isInDetachZone(origin);
			if (isInDetachZone(point)) {
				// 막힌 경우 handleGhostDrop으로 폴백하면 "빈 공간 = 예약취소" 규칙으로 가드가 무력화되므로 return.
				if (!startedInDetach) useBoardStore.getState().cancelReservation(resId);
				return;
			}
			handleGhostDrop(resId, point);
		},
		[handleGhostDrop],
	);

	return { onMagnetDragMove, onMagnetDragEnd, onRestingDragEnd, onGhostDragEnd };
}
