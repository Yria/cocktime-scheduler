import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Group, Circle, Arc, Image as KonvaImage, Rect, Text } from "react-konva";
import useImage from "use-image";
import Konva from "konva";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { useDebugStore } from "../../store/debugStore";
import { skillScore as computeSkillScore } from "../../lib/teamSelection";
import { getPlayerPhotoUrl } from "../../lib/playerPhoto";
import { absToStage } from "../../lib/board/konvaEvents";
import { magnetGenderInk, magnetSkillAngle, MAGNET_SKILL_ARC_RATIO, MAGNET_GENDER_RING_W } from "../../lib/magnetStyle";
import {
	MAGNET_SIZE,
	MAGNET_R,
	MAGNET_HIT_R,
	RING_BG_COLOR,
	RING_FG_COLOR,
	GENDER_M_COLOR,
	GENDER_F_COLOR,
	GENDER_M_LIGHT,
	GENDER_F_LIGHT,
	RESERVATION_OPACITY,
	RESERVATION_STROKE,
	RESERVATION_DASH,
	RESERVATION_BADGE_BG,
	RESTING_OPACITY,
	RESTING_BADGE_BG,
	HILITE_STROKE,
} from "../../lib/board/constants";

const GRAD_H = MAGNET_SIZE * 0.7;
const NAME_FONT = 11;

/** 자석 우상단 라운드 배지(예약/휴식 공용). 캔버스 출력 동일성을 위해 폰트/perfectDraw 고정. */
const MagnetBadge = ({ text, fill }: { text: string; fill: string }) => (
	<Group x={MAGNET_R - 8} y={-MAGNET_R + 8} listening={false}>
		<Rect x={-16} y={-9} width={32} height={18} cornerRadius={9} fill={fill} perfectDrawEnabled={false} />
		<Text
			x={-16}
			y={-9}
			width={32}
			height={18}
			text={text}
			fontSize={10}
			fontStyle="bold"
			fontFamily="Inter, system-ui, sans-serif"
			fill="#FFFFFF"
			align="center"
			verticalAlign="middle"
			perfectDrawEnabled={false}
		/>
	</Group>
);

interface Props {
	playerId: string;
	offsetX?: number;
	offsetY?: number;
	/** anchor = 원본 멤버 / ghost = 예약. 기본 anchor. */
	kind?: "anchor" | "ghost";
	/** ghost일 때 해당 예약 id */
	reservationId?: string;
	/** 코트 배치된 경기중 선수 — 드래그 시 예약 생성, 항상 슬롯 복귀 */
	playing?: boolean;
	/** 휴식존에 들어간 휴식 선수 — 흐리게+배지, 존 밖으로 드래그 시 복귀 */
	resting?: boolean;
	onDragEnd?: (playerId: string, cx: number, cy: number) => void;
	onGhostDragEnd?: (resId: string, cx: number, cy: number) => void;
	onPlayingDragEnd?: (playerId: string, cx: number, cy: number) => void;
	/** 휴식 자석 드래그-엔드(절대좌표) — 존 밖이면 복귀 처리 */
	onRestingDragEnd?: (playerId: string, cx: number, cy: number) => void;
	/** 드래그 이동 중 절대좌표 — 휴식 필드 hover 감지 등 */
	onDragMove?: (playerId: string, cx: number, cy: number) => void;
	/** 자석 탭(드래그 아님) — 추천 팀원 모달 열기 */
	onClick?: (playerId: string) => void;
}

const PlayerMagnet = memo(function PlayerMagnet({
	playerId,
	offsetX,
	offsetY,
	kind = "anchor",
	reservationId,
	playing = false,
	resting = false,
	onDragEnd,
	onGhostDragEnd,
	onPlayingDragEnd,
	onRestingDragEnd,
	onDragMove,
	onClick,
}: Props) {
	const magnet = useBoardStore((s) => s.magnets.get(playerId));
	const player = useSessionStore((s) => s.sessionPlayers.get(playerId));
	const isEditor = useSessionStore((s) => s.isEditor); // 보기 전용이면 드래그 불가(락 = 전부 차단)
	const isGhost = kind === "ghost";
	// 드래그 중 다른 자석이 이 자석에 겹쳐 페어 대상이 되면 하이라이트
	const isHovered = useBoardStore((s) => s.hoverTarget?.kind === "magnet" && s.hoverTarget.id === playerId);

	// 렌더 목표 좌표(자유 자석=magnet.x/y, 팀/코트 멤버=슬롯 offset)
	const rx = offsetX ?? magnet?.x ?? 0;
	const ry = offsetY ?? magnet?.y ?? 0;

	// 부드러운 ease 흩어짐 애니메이션 — 좌표가 바뀌면 이전 위치에서 트윈.
	// 단, 방금 드래그로 놓인 자석 본인은 제외(이미 그 자리에 있으므로 튀지 않게).
	const groupRef = useRef<Konva.Group>(null);
	const prevPos = useRef({ x: rx, y: ry });
	const justDragged = useRef(false);
	useLayoutEffect(() => {
		const node = groupRef.current;
		const from = prevPos.current;
		prevPos.current = { x: rx, y: ry };
		if (!node) return;
		if (justDragged.current) {
			justDragged.current = false;
			return;
		}
		if (from.x === rx && from.y === ry) return;
		node.x(from.x);
		node.y(from.y);
		node.to({ x: rx, y: ry, duration: 0.22, easing: Konva.Easings.EaseInOut });
	}, [rx, ry]);

	const photoUrl = useMemo(() => (player ? getPlayerPhotoUrl(player.name) : ""), [player]);
	const [image, imgStatus] = useImage(photoUrl, "anonymous");
	const hasPhoto = imgStatus === "loaded" && image !== undefined;

	// ── 롱프레스 → 디버그 매칭 모달 ──────────────────────────
	// 누른 채 LONGPRESS_MS 유지하면 발동. 드래그 시작/손 뗌/이탈 시 취소.
	// 발동 직후 따라오는 tap(추천 모달)은 longFired 플래그로 1회 무시한다.
	const LONGPRESS_MS = 450;
	const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const longFired = useRef(false);

	const clearLongPress = useCallback(() => {
		if (longPressTimer.current !== null) {
			clearTimeout(longPressTimer.current);
			longPressTimer.current = null;
		}
	}, []);

	useEffect(() => clearLongPress, [clearLongPress]);

	// 드래그 중 이 컴포넌트가 언마운트되면(원격 팀 해체 등으로 부모 Group destroy) dragend가 안 와
	// clearDrag가 누락돼 '팀에서 빼기' 드롭존이 고착될 수 있다 → 언마운트 시 내가 드래그 주인이면 정리.
	useEffect(
		() => () => {
			if (useBoardStore.getState().dragInfo?.playerId === playerId) useBoardStore.getState().clearDrag();
		},
		[playerId],
	);

	const handlePointerDown = useCallback(() => {
		longFired.current = false;
		clearLongPress();
		longPressTimer.current = setTimeout(() => {
			longFired.current = true;
			longPressTimer.current = null;
			if (typeof navigator !== "undefined") navigator.vibrate?.(30);
			useDebugStore.getState().openDebug(playerId);
		}, LONGPRESS_MS);
	}, [playerId, clearLongPress]);

	const handleClick = useCallback(
		(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
			// 롱프레스가 막 발동했으면 뒤따르는 탭은 1회 삼킨다(추천 모달 안 열림).
			if (longFired.current) {
				longFired.current = false;
				e.cancelBubble = true;
				return;
			}
			if (!onClick) return;
			e.cancelBubble = true;
			onClick(playerId);
		},
		[onClick, playerId],
	);

	const handleDragMove = useCallback(
		(e: Konva.KonvaEventObject<DragEvent>) => {
			if (!onDragMove) return;
			const p = absToStage(e.target); // 줌/팬 보정 → 논리 좌표
			onDragMove(playerId, p.x, p.y);
		},
		[onDragMove, playerId],
	);

	const handleDragStart = useCallback(
		(e: Konva.KonvaEventObject<DragEvent>) => {
			clearLongPress(); // 드래그 의도 → 롱프레스 취소
			// 드래그 정보 등록 — 팀 소속(anchor/ghost)이면 '팀에서 빼기' 드롭존 노출.
			const teamBound = isGhost || !!useBoardStore.getState().magnets.get(playerId)?.teamId;
			useBoardStore.getState().setDragInfo({ playerId, detachable: teamBound });
			// 드래그 중인 자석을 항상 최상단으로: 자석을 부모 내 최상단으로 올리고,
			// 팀/코트 카드 멤버라면 그 부모 그룹도 Layer 최상단으로 끌어올린다
			// (안 그러면 멤버가 부모 그룹 안에서만 위로 가서 다른 자석/카드 아래에 깔린다).
			e.target.moveToTop();
			const parent = e.target.getParent();
			if (parent instanceof Konva.Group) parent.moveToTop();
		},
		[clearLongPress, isGhost, playerId],
	);

	const handleDragEnd = useCallback(
		(e: Konva.KonvaEventObject<DragEvent>) => {
			// 방금 드래그로 놓인 자석 본인은 흩어짐 트윈에서 제외(이미 드롭 위치에 있음)
			justDragged.current = true;
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
			// 드래그 종료 — 드롭존/하이라이트 상태 초기화(모든 종류 공통)
			useBoardStore.getState().clearDrag();
		},
		[playerId, isGhost, playing, resting, reservationId, onDragEnd, onGhostDragEnd, onPlayingDragEnd, onRestingDragEnd, offsetX, offsetY],
	);

	if (!magnet || !player) return null;

	const isF = player.gender === "F";
	const color = isF ? GENDER_F_COLOR : GENDER_M_COLOR;
	const lightColor = isF ? GENDER_F_LIGHT : GENDER_M_LIGHT;
	const skill = computeSkillScore(player);
	const skillAngle = magnetSkillAngle(skill);
	// 사진 반지름 = 전체 − 스킬 아크 밴드. (PlayerCard와 동일 비율)
	const arcW = MAGNET_SIZE * MAGNET_SKILL_ARC_RATIO;
	const innerR = MAGNET_R - arcW;

	const clipCircle = (ctx: Konva.Context) => {
		ctx.beginPath();
		ctx.arc(0, 0, innerR - 1, 0, Math.PI * 2, false);
		ctx.closePath();
	};

	return (
		<Group
			ref={groupRef}
			id={`magnet-${playerId}`}
			x={rx}
			y={ry}
			opacity={isGhost ? RESERVATION_OPACITY : resting ? RESTING_OPACITY : 1}
			draggable={isEditor}
			listening
			onDragStart={handleDragStart}
			onDragMove={handleDragMove}
			onDragEnd={handleDragEnd}
			onPointerDown={handlePointerDown}
			onPointerUp={clearLongPress}
			onPointerLeave={clearLongPress}
			onClick={handleClick}
			onTap={handleClick}
		>
			{/* 히트 영역 — 시각 반경보다 작게(MAGNET_HIT_R): 자석 주변/프레임은 부모 그룹 드래그로 떨어짐 */}
			<Circle radius={MAGNET_HIT_R} fill="transparent" />

			{/* 사진(또는 사진 없을 때 성별 light 배경 + 이니셜) — PlayerCard와 동일 */}
			{hasPhoto ? (
				<Group clipFunc={clipCircle}>
					<KonvaImage
						x={-innerR}
						y={-innerR}
						width={innerR * 2}
						height={innerR * 2}
						image={image}
						listening={false}
						perfectDrawEnabled={false}
					/>
				</Group>
			) : (
				<>
					<Circle radius={innerR} fill={lightColor} listening={false} perfectDrawEnabled={false} />
					<Text
						x={-innerR}
						y={-innerR}
						width={innerR * 2}
						height={innerR * 2}
						text={player.name.charAt(0)}
						fontSize={innerR * 0.8}
						fontStyle="bold"
						fontFamily="Inter, system-ui, sans-serif"
						fill={magnetGenderInk(player.gender)}
						align="center"
						verticalAlign="middle"
						listening={false}
						perfectDrawEnabled={false}
					/>
				</>
			)}

			{/* 이름 가독성용 하단 그라데이션(사진일 때만) */}
			{hasPhoto && (
				<Group clipFunc={clipCircle}>
					<Rect
						x={-MAGNET_R}
						y={MAGNET_R - GRAD_H}
						width={MAGNET_SIZE}
						height={GRAD_H}
						fillLinearGradientStartPoint={{ x: 0, y: GRAD_H }}
						fillLinearGradientEndPoint={{ x: 0, y: 0 }}
						fillLinearGradientColorStops={[0, "rgba(0,0,0,0.9)", 0.6, "rgba(0,0,0,0.4)", 1, "rgba(0,0,0,0)"]}
						listening={false}
						perfectDrawEnabled={false}
					/>
				</Group>
			)}

			{/* 성별 링 — 사진 바깥 가장자리 안쪽(아크 밴드 잠식 안 함) */}
			<Circle
				radius={innerR - MAGNET_GENDER_RING_W / 2}
				stroke={color}
				strokeWidth={MAGNET_GENDER_RING_W}
				listening={false}
				perfectDrawEnabled={false}
			/>

			{/* 스킬 아크 링(중립 트랙 + 초록) — 사진 바깥 밴드 전체 */}
			<Arc
				innerRadius={innerR}
				outerRadius={MAGNET_R}
				angle={360}
				rotation={-90}
				fill={RING_BG_COLOR}
				listening={false}
				perfectDrawEnabled={false}
			/>
			{skillAngle > 0 && (
				<Arc
					innerRadius={innerR}
					outerRadius={MAGNET_R}
					angle={skillAngle}
					rotation={-90}
					fill={RING_FG_COLOR}
					listening={false}
					perfectDrawEnabled={false}
				/>
			)}

			<Text
				x={-MAGNET_R}
				y={MAGNET_R - NAME_FONT - 10}
				width={MAGNET_SIZE}
				text={player.name}
				fontSize={NAME_FONT}
				fontStyle="bold"
				fontFamily="Inter, system-ui, sans-serif"
				fill="#FFFFFF"
				align="center"
				shadowColor="rgba(0,0,0,0.6)"
				shadowBlur={3}
				shadowOffsetY={1}
				listening={false}
				perfectDrawEnabled={false}
			/>

			{/* 외곽선: ghost는 점선 보라, 그 외 옅은 검정 */}
			<Circle
				radius={MAGNET_R}
				stroke={isGhost ? RESERVATION_STROKE : "rgba(0,0,0,0.15)"}
				strokeWidth={isGhost ? 2 : 1}
				dash={isGhost ? RESERVATION_DASH : undefined}
				listening={false}
				perfectDrawEnabled={false}
			/>

			{/* 겹침 하이라이트 — 드래그 중 페어 대상이 되면 스카이 링 */}
			{isHovered && (
				<Circle radius={MAGNET_R + 3} stroke={HILITE_STROKE} strokeWidth={3} shadowColor={HILITE_STROKE} shadowBlur={10} listening={false} perfectDrawEnabled={false} />
			)}

			{/* 예약 뱃지 */}
			{isGhost && <MagnetBadge text="예약" fill={RESERVATION_BADGE_BG} />}

			{/* 휴식 뱃지 */}
			{resting && <MagnetBadge text="휴식" fill={RESTING_BADGE_BG} />}
		</Group>
	);
});

export default PlayerMagnet;
