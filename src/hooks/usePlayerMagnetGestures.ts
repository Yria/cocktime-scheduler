import { useCallback, useEffect, useRef } from "react";
import type Konva from "konva";
import { useDebugStore } from "../store/debugStore";

interface Options {
	playerId: string;
	/** 콕 체크 on인데 미확인 — 단일 탭이 추천 대신 콕 확인 다이얼로그로 분기 */
	cockPending: boolean;
	/** 자석 탭(드래그 아님) — 추천 팀원 모달 열기 */
	onClick?: (playerId: string) => void;
	/** 콕 미확인 자석 탭 — 콕 제출 확인 다이얼로그 열기 */
	onCockCheck?: (playerId: string) => void;
	/** 더블탭 시 그룹/예약/휴식에서 빠짐 — groupRef를 쓰므로 PlayerMagnet에 남기고 콜백으로 주입 */
	removeFromGroup: () => void;
}

/**
 * 보드 자석(PlayerMagnet)의 탭/더블탭/롱프레스 제스처 훅.
 * 반환한 핸들러들을 Konva Group의 click/tap·pointer 이벤트에 그대로 연결하고,
 * clearTap/clearLongPress는 드래그 시작 시(usePlayerMagnetDrag) 대기 중 제스처 취소용으로 쓴다.
 */
export function usePlayerMagnetGestures({ playerId, cockPending, onClick, onCockCheck, removeFromGroup }: Options) {
	// ── 더블탭 → 매칭 이력(디버그) 모달 ──────────────────────
	// 두 번 연속 탭하면 매칭 이력을 연다. 단일 탭(추천/콕 확인)은 더블탭과 구분하려고
	// DBLTAP_MS 만큼 지연 후 발동한다. 드래그 시작/언마운트 시 대기 중인 단일 탭은 취소.
	// 터치 탭은 브라우저가 ~300ms 뒤 호환(ghost) click 을 추가로 쏠 수 있다(Konva가 보통 touchstart
	// preventDefault로 막지만 보장 X). 그 호환 click 을 같은 입력의 중복으로 흡수하려고 마지막 "터치" 탭
	// 시각(lastTouch)을 기록하고, 그 직후의 mouse/click 이벤트는 무시한다(타임스탬프만으로는 정상 더블탭과
	// 구분 불가하므로 이벤트 modality 로 판별).
	const DBLTAP_MS = 280;
	const COMPAT_CLICK_MS = 500;
	const tap = useRef<{ count: number; timer: ReturnType<typeof setTimeout> | null; lastTouch: number }>({
		count: 0,
		timer: null,
		lastTouch: 0,
	});

	const clearTap = useCallback(() => {
		if (tap.current.timer !== null) {
			clearTimeout(tap.current.timer);
			tap.current.timer = null;
		}
		tap.current.count = 0;
	}, []);

	useEffect(() => clearTap, [clearTap]);

	// ── 롱프레스 → 매칭 이력(디버그) 모달 ──────────────────────
	// "제자리에서 꾹" 만 롱프레스 — 누른 뒤 LONGPRESS_MOVE_TOL(px) 넘게 움직이면(=드래그 의도) 즉시 취소한다.
	// (Konva 드래그 임계(3px)·dragstart보다 먼저 움직임을 잡아, 천천히 잡고 끌 때 롱프레스가 잘못 발동하는 것 방지.)
	// fired=true면 뒤따르는 탭(touchend의 onTap)은 같은 입력의 잔상 → 흡수.
	const LONGPRESS_MS = 500;
	const LONGPRESS_MOVE_TOL = 8; // 누른 지점에서 이만큼(px) 넘게 이동하면 롱프레스 취소
	const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean; x: number; y: number }>({
		timer: null,
		fired: false,
		x: 0,
		y: 0,
	});
	const clearLongPress = useCallback(() => {
		if (longPress.current.timer !== null) {
			clearTimeout(longPress.current.timer);
			longPress.current.timer = null;
		}
	}, []);
	useEffect(() => clearLongPress, [clearLongPress]);
	const handlePointerDown = useCallback(
		(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
			longPress.current.fired = false;
			clearLongPress();
			const p = e.target.getStage()?.getPointerPosition();
			longPress.current.x = p?.x ?? 0;
			longPress.current.y = p?.y ?? 0;
			longPress.current.timer = setTimeout(() => {
				longPress.current.timer = null;
				longPress.current.fired = true;
				clearTap(); // 대기 중 단일 탭 취소
				if (typeof navigator !== "undefined") navigator.vibrate?.(30);
				useDebugStore.getState().openDebug(playerId);
			}, LONGPRESS_MS);
		},
		[clearLongPress, clearTap, playerId],
	);
	// 누른 채 일정 거리 이상 움직이면(드래그 의도) 롱프레스 취소 — Konva dragstart보다 먼저 잡는다.
	const handlePointerMove = useCallback(
		(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
			if (longPress.current.timer === null) return;
			const p = e.target.getStage()?.getPointerPosition();
			if (!p) return;
			const dx = p.x - longPress.current.x;
			const dy = p.y - longPress.current.y;
			if (dx * dx + dy * dy > LONGPRESS_MOVE_TOL * LONGPRESS_MOVE_TOL) clearLongPress();
		},
		[clearLongPress],
	);
	const handlePointerUp = useCallback(() => clearLongPress(), [clearLongPress]);

	const handleClick = useCallback(
		(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
			e.cancelBubble = true;
			// 롱프레스로 이미 디버그를 열었으면 뒤따르는 탭은 같은 입력의 잔상 → 흡수.
			if (longPress.current.fired) {
				longPress.current.fired = false;
				return;
			}
			// 터치 탭 직후 따라오는 호환(ghost) click 은 같은 입력의 중복 → 무시. (mouse/desktop click 은 그대로 처리.)
			const ev = e.evt;
			const isTouch =
				"touches" in ev || ("pointerType" in ev && (ev as PointerEvent).pointerType === "touch");
			const now = Date.now();
			if (isTouch) {
				tap.current.lastTouch = now;
			} else if (now - tap.current.lastTouch < COMPAT_CLICK_MS) {
				tap.current.lastTouch = 0; // 호환 click 은 탭당 1개 — 하나만 흡수하고 이후 실제 mouse click 은 통과
				return; // 터치 탭 직후의 호환 click → 중복 흡수
			}

			tap.current.count += 1;
			if (tap.current.count >= 2) {
				// 더블탭 → 그룹/예약/휴식에서 빠짐(없으면 무동작)
				clearTap();
				if (typeof navigator !== "undefined") navigator.vibrate?.(30);
				removeFromGroup();
				return;
			}
			// 첫 탭 → 더블탭 가능성을 잠시 기다렸다가 단일 탭 동작(콕 확인 / 추천).
			if (tap.current.timer !== null) clearTimeout(tap.current.timer);
			tap.current.timer = setTimeout(() => {
				tap.current.timer = null;
				tap.current.count = 0;
				if (cockPending) {
					onCockCheck?.(playerId);
					return;
				}
				onClick?.(playerId);
			}, DBLTAP_MS);
		},
		[onClick, onCockCheck, cockPending, playerId, clearTap, removeFromGroup],
	);

	return { handleClick, handlePointerDown, handlePointerMove, handlePointerUp, clearTap, clearLongPress };
}
