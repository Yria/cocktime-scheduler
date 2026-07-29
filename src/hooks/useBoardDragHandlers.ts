import { useCallback, useRef } from "react";
import { isInRestField, isInDetachZone } from "../lib/board/geometry";
import { cockPendingIds, playingIdsFromCourts } from "../lib/board/membership";
import { resolveDropTarget } from "../lib/board/dropResolver";
import { useBoardStore } from "../store/boardStore";
import { useSessionStore } from "../store/sessionStore";

/**
 * 보드 자석 드래그/드롭 핸들러 묶음.
 * - 드래그 이동 중: 휴식존 hover → hot, '팀에서 빼기' 드롭존 hover → detachHot, 겹침 대상 → hoverTarget(하이라이트).
 * - 드롭: 네비 영역(팀 소속) → detach / 하단 휴식존 → 휴식 토글 / 그 외 → 자유 배치(handleDrop).
 *   **휴식 토글**: 하단 휴식존(칠판 하단 경계 아래 = 바텀 바)에 놓으면 대기자는 휴식으로, 휴식자는 복귀로
 *   — 진입·해제가 같은 존의 대칭 동작이다(2026-07 펼침 패널 폐지). 존이 칠판 밖이라 자석이 거기서
 *   출발할 수 없으므로 detach와 마찬가지로 "출발 존" 가드가 필요 없다.
 * - ghost: 드롭존 → 예약 취소, 그 외 → handleGhostDrop.
 * 좌표(cx,cy)는 PlayerMagnet에서 줌/팬 보정된 논리 좌표. viewH = 보이는 논리 영역 높이(stageH/scale).
 */
export function useBoardDragHandlers(viewH: number) {
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

			// 휴식존 hot
			const restHot = isInRestField(point, viewH);
			if (restHot !== hotRef.current) {
				hotRef.current = restHot;
				setRestFieldHot(restHot);
			}

			// 휴식존 위에선 드롭이 항상 휴식 토글 우선(onMagnetDragEnd)이라 빼기/겹침 해석 결과가 버려진다.
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
			// 슬롯 단위 하이라이트 — 합류(빈칸)/교체(점유) 모두 가리킨 칸을 하이라이트. 페어는 상대 자석.
			let hover: { kind: "slot"; teamId: string; slotIndex: number } | { kind: "magnet"; id: string } | null = null;
			if (target.kind === "attach" && target.slot !== undefined) hover = { kind: "slot", teamId: target.teamId, slotIndex: target.slot };
			else if (target.kind === "replace") hover = { kind: "slot", teamId: target.teamId, slotIndex: target.slot };
			else if (target.kind === "createPair") hover = { kind: "magnet", id: target.partnerId };
			store.setHoverTarget(hover);
		},
		[viewH, setRestFieldHot],
	);

	const clearHot = useCallback(() => {
		if (hotRef.current) {
			hotRef.current = false;
			setRestFieldHot(false);
		}
	}, [setRestFieldHot]);

	// 자유/anchor/휴식 드래그-엔드: 빼기존(팀 소속) → detach / 휴식존 → 휴식 토글 / 그 외 → handleDrop.
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
			// 하단 휴식존 드롭 → 휴식 토글(대기자는 휴식 진입, 휴식자는 복귀). 자석은 두 경우 모두
			// 보드에 남고 위치는 restPlayer/unrestPlayer가 정렬 자리로 잡는다.
			if (isInRestField(point, viewH)) {
				if (useSessionStore.getState().restingIds.includes(playerId)) unrestPlayer(playerId);
				else restPlayer(playerId);
				return;
			}
			handleDrop(playerId, point);
		},
		[handleDrop, viewH, restPlayer, unrestPlayer, clearHot],
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

	return { onMagnetDragMove, onMagnetDragEnd, onGhostDragEnd };
}
