import { type RefObject, useCallback, useEffect, useRef } from "react";
import Konva from "konva";
import { useBoardStore } from "../store/boardStore";
import { useSessionStore } from "../store/sessionStore";
import { absToStage } from "../lib/board/konvaEvents";

interface Options {
	playerId: string;
	/** ghost = 예약(경기중 빌려온 선수) 자석 */
	isGhost: boolean;
	/** 코트 배치된 경기중 선수 — 드래그 시 예약 생성, 항상 슬롯 복귀 */
	playing: boolean;
	/** 휴식존에 들어간 휴식 선수 — 존 밖으로 드래그 시 복귀 */
	resting: boolean;
	/** ghost일 때 해당 예약 id */
	reservationId?: string;
	/** 팀/코트 멤버의 슬롯 offset — 드롭 후 슬롯 복귀 좌표 */
	offsetX?: number;
	offsetY?: number;
	onDragEnd?: (playerId: string, cx: number, cy: number) => void;
	onGhostDragEnd?: (resId: string, cx: number, cy: number) => void;
	onPlayingDragEnd?: (playerId: string, cx: number, cy: number) => void;
	/** 휴식 자석 드래그-엔드(절대좌표) — 존 밖이면 복귀 처리 */
	onRestingDragEnd?: (playerId: string, cx: number, cy: number) => void;
	/** 드래그 이동 중 절대좌표 — 휴식 필드 hover 감지 등 */
	onDragMove?: (playerId: string, cx: number, cy: number) => void;
	/** 드래그 시작 시 대기 중 단일 탭/롱프레스 취소(usePlayerMagnetGestures 반환값) */
	clearTap: () => void;
	clearLongPress: () => void;
	/** 방금 드래그로 놓인 자석 표시 — PlayerMagnet의 흩어짐 트윈과 공유하는 ref(같은 객체를 전달할 것) */
	justDragged: RefObject<boolean>;
}

/**
 * 보드 자석(PlayerMagnet)의 드래그 핸들러 훅 — rAF 코얼레싱된 dragmove, 드래그 정보 등록/최상단 올리기,
 * 드롭 시 종류별(onDragEnd/onGhostDragEnd/...) 콜백 분기와 슬롯 스냅백을 담당한다.
 */
export function usePlayerMagnetDrag({
	playerId,
	isGhost,
	playing,
	resting,
	reservationId,
	offsetX,
	offsetY,
	onDragEnd,
	onGhostDragEnd,
	onPlayingDragEnd,
	onRestingDragEnd,
	onDragMove,
	clearTap,
	clearLongPress,
	// Ref 접미사 별칭: react-hooks 컴파일러 규칙이 파라미터 ref의 .current 변이를 허용하게 한다
	justDragged: justDraggedRef,
}: Options) {
	// 드래그 중 이 컴포넌트가 언마운트되면(원격 팀 해체 등으로 부모 Group destroy) dragend가 안 와
	// clearDrag가 누락돼 드롭존이 고착될 수 있다 → 언마운트 시 내가 드래그 주인이면 정리.
	useEffect(
		() => () => {
			if (useBoardStore.getState().dragInfo?.playerId === playerId) useBoardStore.getState().clearDrag();
		},
		[playerId],
	);

	// dragmove는 pointermove마다(60~120Hz) 발사된다 — hover/휴식 해석을 화면 프레임(rAF)당 1회로 코얼레싱해
	// 프레임드랍을 막는다. 최신 좌표만 보관하고 프레임당 마지막 좌표로 onDragMove를 1회 호출.
	// (자석 시각 이동은 Konva가 직접 처리하므로 이 throttle과 무관 — 드래그 부드러움엔 영향 없음.)
	const dragRaf = useRef<number | null>(null);
	const lastDragPt = useRef<{ x: number; y: number } | null>(null);
	const cancelDragRaf = useCallback(() => {
		if (dragRaf.current !== null) {
			cancelAnimationFrame(dragRaf.current);
			dragRaf.current = null;
		}
	}, []);
	useEffect(() => cancelDragRaf, [cancelDragRaf]); // 언마운트 시 대기 중 rAF 정리

	const handleDragMove = useCallback(
		(e: Konva.KonvaEventObject<DragEvent>) => {
			if (!onDragMove) return;
			lastDragPt.current = absToStage(e.target); // 줌/팬 보정 → 논리 좌표(최신만 보관)
			if (dragRaf.current !== null) return; // 이번 프레임 이미 예약됨 — 코얼레싱
			dragRaf.current = requestAnimationFrame(() => {
				dragRaf.current = null;
				const p = lastDragPt.current;
				if (p) onDragMove(playerId, p.x, p.y);
			});
		},
		[onDragMove, playerId],
	);

	const handleDragStart = useCallback(
		(e: Konva.KonvaEventObject<DragEvent>) => {
			clearTap(); // 드래그 의도 → 대기 중 단일 탭 취소
			clearLongPress(); // 드래그면 롱프레스(디버그) 아님
			const store = useBoardStore.getState();
			// 드래그 정보 등록 — 팀 소속(anchor/ghost)이면 상단 '팀에서 빼기', 휴식 가능하면 하단 '휴식하기' 밴드 노출.
			const teamBound = isGhost || !!store.magnets.get(playerId)?.teamId;
			// 휴식 가능: 편집자의 free/anchor 대기 자석(예약/경기중/이미 휴식 제외).
			const restable = useSessionStore.getState().isEditor && !isGhost && !playing && !resting;
			// 드래그 시작 논리좌표 — 출발 존(빼기/휴식)에서 같은 존으로의 드롭을 무효화하는 가드용.
			const from = absToStage(e.target);
			store.setDragInfo({ playerId, detachable: teamBound, restable, from });
			// 휴식 패널이 열려 있으면 보드 자석 드래그 시작 시 접는다(가림 해소 + 접힘 휴식 밴드로 자연 전환).
			// 휴식 자석(패널 내부 출발)은 유지 — 드래그 대상이 패널 안이라 접으면 안 됨.
			if (!resting && store.restZoneOpen) store.closeRestZone();
			// 드래그 중인 자석을 항상 최상단으로: 자석을 부모 내 최상단으로 올리고,
			// 팀/코트 카드 멤버라면 그 부모 그룹도 Layer 최상단으로 끌어올린다
			// (안 그러면 멤버가 부모 그룹 안에서만 위로 가서 다른 자석/카드 아래에 깔린다).
			e.target.moveToTop();
			const parent = e.target.getParent();
			if (parent instanceof Konva.Group) parent.moveToTop();
		},
		[clearTap, clearLongPress, isGhost, playing, resting, playerId],
	);

	const handleDragEnd = useCallback(
		(e: Konva.KonvaEventObject<DragEvent>) => {
			cancelDragRaf(); // 드롭 후 늦은 hover 갱신 방지(대기 중 rAF 취소)
			// 방금 드래그로 놓인 자석 본인은 흩어짐 트윈에서 제외(이미 드롭 위치에 있음)
			justDraggedRef.current = true;
			const p = absToStage(e.target); // 줌/팬 보정 → 논리 좌표
			if (isGhost && reservationId) onGhostDragEnd?.(reservationId, p.x, p.y);
			else if (playing) onPlayingDragEnd?.(playerId, p.x, p.y);
			else if (resting) onRestingDragEnd?.(playerId, p.x, p.y);
			else onDragEnd?.(playerId, p.x, p.y);

			// 슬롯 복귀: ghost/playing/resting이거나, 드롭 후에도 여전히 팀 anchor면 슬롯(offset)으로.
			// 애니메이션(.to) 대신 즉시 위치 설정 — reserve/reservePair로 인한 동시 re-render와
			// 트윈이 충돌해 자석이 떨리며 튀는 현상을 방지한다.
			const mag = useBoardStore.getState().magnets.get(playerId);
			const stillAnchored = !!mag?.teamId;
			if (isGhost || playing || resting || stillAnchored) {
				e.target.position({ x: offsetX ?? 0, y: offsetY ?? 0 });
				e.target.getLayer()?.batchDraw();
			} else if (mag && !(e.target.getParent() instanceof Konva.Group)) {
				// 자유 자석(Layer 직속)만 스토어 좌표로 정합. 드롭 거부(none)면 원위치 복귀,
				// 자유 이동(move)이면 드롭 위치 그대로(스토어와 동일 좌표라 무동작).
				// 거부 시엔 상태 변화가 없어 re-render가 안 일어나므로 여기서 직접 되돌려야 한다.
				// (방금 detach된 멤버는 아직 팀 Group 자식이라 제외 — 여기서 잡으면 team.anchor만큼
				//  어긋나 한 프레임 튄다. React 재마운트가 자유 자석으로 올바른 위치에 놓는다.)
				e.target.position({ x: mag.x, y: mag.y });
				e.target.getLayer()?.batchDraw();
			}
			// 드래그 종료 — 드롭존/하이라이트 상태 초기화(모든 종류 공통).
			// 반드시 위 onDragEnd/onGhostDragEnd 콜백 "이후"에 호출해야 한다: 그 핸들러들이 출발 존 가드를
			// 위해 dragInfo.from 을 읽는데, clearDrag 가 먼저 돌면 from 이 null 이 돼 가드가 무력화된다.
			useBoardStore.getState().clearDrag();
		},
		[playerId, isGhost, playing, resting, reservationId, onDragEnd, onGhostDragEnd, onPlayingDragEnd, onRestingDragEnd, offsetX, offsetY, cancelDragRaf, justDraggedRef],
	);

	return { handleDragStart, handleDragMove, handleDragEnd };
}
