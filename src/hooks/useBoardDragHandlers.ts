import { useCallback, useRef } from "react";
import { isInRestField, isInDetachZone } from "../lib/board/geometry";
import { cockPendingIds, playingIdsFromCourts } from "../lib/board/membership";
import { resolveDropTarget } from "../lib/board/dropResolver";
import { useBoardStore } from "../store/boardStore";
import { useSessionStore } from "../store/sessionStore";

/**
 * 보드 자석 드래그/드롭 핸들러 묶음.
 * - 드래그 이동 중: 휴식 필드 hover → hot, '팀에서 빼기' 드롭존 hover → detachHot, 겹침 대상 → hoverTarget(하이라이트).
 * - 드롭: 네비 영역(팀 소속) → detach / 하단 휴식 필드 → 휴식 / 그 외 → 자유 배치(handleDrop).
 *   휴식 펼침 패널은 칠판 안 넓은 영역이라, 패널 위에 놓여 있던 자유 자석을 살짝 움직였다고 휴식되지 않게
 *   "그 존에서 출발했으면(dragInfo.from) 같은 존 드롭은 무효" 가드를 둔다(startedInRest). detach는 존이
 *   칠판 밖(네비)이라 자석이 거기서 출발할 수 없어 출발 가드가 필요 없다.
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
			// 빼기존(네비)은 칠판 밖이라 자석이 거기서 출발할 수 없음 → 출발 가드 없이 바로 detach.
			const mag = store.magnets.get(playerId);
			if (mag && mag.teamId !== null && isInDetachZone(point)) {
				store.detachMember(playerId, point);
				return;
			}
			// 휴식 출발 가드(펼침 패널 전용): 같은 휴식 영역에서 출발했다면 그 영역 드롭은 무효(스냅백).
			// 접힘 상태(restFieldH=0)면 origin.y ≥ stageH가 성립할 수 없어 가드가 자동 비활성(영향 없음).
			// 중요 — 막힌 경우 handleDrop으로 "폴백하지 않고" return한다: 폴백하면 resolveDropTarget이
			// 휴식 영역 빈 공간 앵커 드롭을 다른 동작으로 재해석해 가드를 우회할 수 있다. return하면
			// PlayerMagnet이 앵커=슬롯·자유=원위치로 스냅백한다.
			const origin = store.dragInfo?.from ?? null;
			const startedInRest = origin != null && isInRestField(origin, viewH, restFieldH);
			if (isInRestField(point, viewH, restFieldH)) {
				if (!startedInRest) restPlayer(playerId); // 시작이 휴식 영역이면 무효(스냅백)
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

	// ghost 드래그-엔드: 빼기존(네비) → 예약 취소, 그 외 → handleGhostDrop.
	// 빼기존은 칠판 밖이라 예약 ghost가 거기서 출발할 수 없어 출발 가드 불필요(anchor와 동일).
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
