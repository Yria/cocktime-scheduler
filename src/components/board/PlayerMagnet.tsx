import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Group, Circle, Arc, Image as KonvaImage, Path, Rect, Text } from "react-konva";
import useImage from "use-image";
import Konva from "konva";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { usePlayerMagnetGestures } from "../../hooks/usePlayerMagnetGestures";
import { usePlayerMagnetDrag } from "../../hooks/usePlayerMagnetDrag";
import { MagnetBadge } from "./MagnetBadge";
import { skillScore as computeSkillScore } from "../../lib/teamSelection";
import { getPlayerPhotoUrl } from "../../lib/playerPhoto";
import { getNameInitial } from "../../lib/player";
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
	COCK_PENDING_COLOR,
} from "../../lib/board/constants";

const GRAD_H = MAGNET_SIZE * 0.7;
const NAME_FONT = 11;

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
	/** 우선배치(그룹 지정)된 멤버 — 핀 배지 표시(시각 전용, 점수 영향 없음). 내부 prop명은 forcedIds와 일관되게 forced 유지. */
	forced?: boolean;
	onDragEnd?: (playerId: string, cx: number, cy: number) => void;
	onGhostDragEnd?: (resId: string, cx: number, cy: number) => void;
	onPlayingDragEnd?: (playerId: string, cx: number, cy: number) => void;
	/** 휴식 자석 드래그-엔드(절대좌표) — 존 밖이면 복귀 처리 */
	onRestingDragEnd?: (playerId: string, cx: number, cy: number) => void;
	/** 드래그 이동 중 절대좌표 — 휴식 필드 hover 감지 등 */
	onDragMove?: (playerId: string, cx: number, cy: number) => void;
	/** 자석 탭(드래그 아님) — 추천 팀원 모달 열기 */
	onClick?: (playerId: string) => void;
	/** 콕 미확인 자석 탭 — 콕 제출 확인 다이얼로그 열기 */
	onCockCheck?: (playerId: string) => void;
}

const PlayerMagnet = memo(function PlayerMagnet({
	playerId,
	offsetX,
	offsetY,
	kind = "anchor",
	reservationId,
	playing = false,
	resting = false,
	forced = false,
	onDragEnd,
	onGhostDragEnd,
	onPlayingDragEnd,
	onRestingDragEnd,
	onDragMove,
	onClick,
	onCockCheck,
}: Props) {
	const magnet = useBoardStore((s) => s.magnets.get(playerId));
	const player = useSessionStore((s) => s.sessionPlayers.get(playerId));
	const cockCheckEnabled = useSessionStore((s) => s.cockCheckEnabled);
	const isEditor = useSessionStore((s) => s.isEditor);
	const isGhost = kind === "ghost";
	// 자유 자석(팀 미소속·비ghost)은 보기 전용에서도 드래그해 로컬 위치 이동 가능(위치는 로컬·미동기화).
	// 팀 멤버(anchor/ghost)는 멤버십 변경이 되므로 편집자만.
	const isFreeMagnet = !isGhost && magnet?.teamId == null;
	// 콕 체크 on인데 미확인 → 비활성(매칭 대기 아님): 위치 이동은 가능하되 편성(팀 합류/페어)은 불가(dropResolver가 move/detach로 제한), 탭하면 확인 다이얼로그.
	const cockPending = cockCheckEnabled && !isGhost && !playing && !resting && player != null && !player.cockChecked;
	// 드래그 중 다른 자석이 이 자석에 겹쳐 페어 대상이 되면 하이라이트
	const isHovered = useBoardStore((s) => s.hoverTarget?.kind === "magnet" && s.hoverTarget.id === playerId);
	// 드래그 중에는 그림자(shadowBlur) 렌더를 끈다 — 드래그는 매 프레임 Layer 전체를 다시 그리는데
	// shadowBlur가 캔버스에서 가장 비싼 연산이라 구기기에서 프레임 드랍의 주원인. start/end 시 1회만 토글.
	const dragging = useBoardStore((s) => s.dragInfo != null);

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

	const photoUrl = useMemo(() => (player?.memberId ? getPlayerPhotoUrl(player.memberId) : ""), [player]);
	const [image, imgStatus] = useImage(photoUrl, "anonymous");
	const hasPhoto = imgStatus === "loaded" && image !== undefined;

	// 예약(ghost=경기중 빌려온 선수) 사진은 그레이스케일로 — opacity만으론 한눈에 구분이 약해 색을 죽인다.
	// Konva 필터는 노드 cache 필요 → 이미지 로드/ghost 여부 변할 때 캐시+필터 토글.
	const photoRef = useRef<Konva.Image>(null);
	useEffect(() => {
		const node = photoRef.current;
		if (!node) return;
		if (isGhost && hasPhoto) {
			node.cache();
			node.filters([Konva.Filters.Grayscale]);
		} else {
			node.clearCache();
			node.filters([]);
		}
		node.getLayer()?.batchDraw();
	}, [isGhost, hasPhoto, image]);

	// ── 더블탭 → "어딘가에서 빠짐"(해체/예약취소/휴식복귀) ──────────────────
	// 그룹 anchor → 팀에서 빼기, ghost → 예약 취소, 휴식 → 복귀. 자유 자석/경기중은 빠질 곳이 없어 무동작.
	// 현재 렌더 위치(slot offset 반영)를 drop으로 넘겨 그 자리에서 자연스럽게 흩어지게 한다.
	const removeFromGroup = useCallback(() => {
		const store = useBoardStore.getState();
		const node = groupRef.current;
		const fallback = store.magnets.get(playerId);
		const pos = node ? absToStage(node) : { x: fallback?.x ?? 0, y: fallback?.y ?? 0 };
		if (isGhost) {
			if (reservationId) store.cancelReservation(reservationId);
		} else if (resting) {
			store.unrestPlayer(playerId, pos);
		} else if (!playing && store.magnets.get(playerId)?.teamId != null) {
			store.detachMember(playerId, pos);
		}
	}, [isGhost, reservationId, resting, playing, playerId]);

	// 탭/더블탭/롱프레스 제스처 — 단일 탭(추천/콕 확인)·더블탭(빠짐)·롱프레스(디버그) 분기는 훅 내부.
	const { handleClick, handlePointerDown, handlePointerMove, handlePointerUp, clearTap, clearLongPress } =
		usePlayerMagnetGestures({ playerId, cockPending, onClick, onCockCheck, removeFromGroup });

	// 드래그 핸들러(rAF 코얼레싱·드롭 분기·슬롯 스냅백) — justDragged는 위 흩어짐 트윈과 공유하는 같은 ref.
	const { handleDragStart, handleDragMove, handleDragEnd } = usePlayerMagnetDrag({
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
		justDragged,
	});

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
			draggable={isEditor || isFreeMagnet}
			listening
			onDragStart={handleDragStart}
			onDragMove={handleDragMove}
			onDragEnd={handleDragEnd}
			onMouseDown={handlePointerDown}
			onTouchStart={handlePointerDown}
			onMouseMove={handlePointerMove}
			onTouchMove={handlePointerMove}
			onMouseUp={handlePointerUp}
			onTouchEnd={handlePointerUp}
			onClick={handleClick}
			onTap={handleClick}
		>
			{/* 자석 본체 — 예약/콕/휴식이면 흐리게(opacity). 상태 배지(예약·콕·휴식·잠금)는 이 그룹 밖에 둬 흐려지지 않게 한다. */}
			<Group opacity={cockPending ? 0.5 : isGhost ? RESERVATION_OPACITY : resting ? RESTING_OPACITY : 1}>
			{/* 히트 영역 — 시각 반경보다 작게(MAGNET_HIT_R): 자석 주변/프레임은 부모 그룹 드래그로 떨어짐 */}
			<Circle radius={MAGNET_HIT_R} fill="transparent" />

			{/* 사진(또는 사진 없을 때 성별 light 배경 + 이니셜) — PlayerCard와 동일. ghost는 그레이스케일/회색으로 죽임. */}
			{hasPhoto ? (
				<Group clipFunc={clipCircle}>
					<KonvaImage
						ref={photoRef}
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
					<Circle radius={innerR} fill={isGhost ? "#D1D5DB" : lightColor} listening={false} perfectDrawEnabled={false} />
					<Text
						x={-innerR}
						y={-innerR}
						width={innerR * 2}
						height={innerR * 2}
						text={getNameInitial(player.name)}
						fontSize={innerR * 0.8}
						fontStyle="bold"
						fontFamily="Inter, system-ui, sans-serif"
						fill={isGhost ? "#6B7280" : magnetGenderInk(player.gender)}
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

			{/* 성별 링 — 사진 바깥 가장자리 안쪽(아크 밴드 잠식 안 함). ghost는 회색. */}
			<Circle
				radius={innerR - MAGNET_GENDER_RING_W / 2}
				stroke={isGhost ? "#9CA3AF" : color}
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
					fill={isGhost ? "#9CA3AF" : RING_FG_COLOR}
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
				shadowEnabled={!dragging}
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

			{/* 콕 미확인(비활성) — 회색 워시 오버레이 + 앰버 점선링 + "콕?" 배지로 "탭해서 확인" 표시 */}
			{cockPending && (
				<>
					<Circle radius={innerR} fill="rgba(70,72,82,0.55)" listening={false} perfectDrawEnabled={false} />
					<Circle radius={MAGNET_R} stroke={COCK_PENDING_COLOR} strokeWidth={2.5} dash={[4, 3]} listening={false} perfectDrawEnabled={false} />
				</>
			)}

			{/* 겹침 하이라이트 — 드래그 중 페어 대상이 되면 스카이 링 */}
			{isHovered && (
				<Circle radius={MAGNET_R + 3} stroke={HILITE_STROKE} strokeWidth={3} shadowColor={HILITE_STROKE} shadowBlur={10} shadowEnabled={!dragging} listening={false} perfectDrawEnabled={false} />
			)}
			</Group>

			{/* ── 상태 배지(opacity 미적용 — 본체가 흐려도 상태는 또렷이) ── */}
			{/* 콕 미확인 배지 */}
			{cockPending && <MagnetBadge text="콕?" fill={COCK_PENDING_COLOR} />}

			{/* 예약(경기중 빌려온 선수) 뱃지 — "경기중"으로 표시 */}
			{isGhost && <MagnetBadge text="경기중" fill={RESERVATION_BADGE_BG} />}

			{/* 휴식 뱃지 */}
			{resting && <MagnetBadge text="휴식" fill={RESTING_BADGE_BG} />}

			{/* 우선배치(그룹 지정) 뱃지 — "우선배치"로 지정한 그룹 멤버(시각 전용, 실제 잠금 아님 — 드래그로 빼서 취소).
			    인디고 원 배지 + 흰색 핀(map-pin) 글리프. 밸런스/추천 점수엔 영향 없고 '이 팀은 의도적 그룹'임을 표시만 한다.
			    anchor + ghost(4명+예약 지정)에 전달 — 예약/휴식/콕 배지(우상단)와 겹치지 않게 우하단에 둔다. */}
			{forced && (
				<Group x={MAGNET_R - 8} y={MAGNET_R - 8} listening={false}>
					<Circle radius={9} fill="#6366F1" stroke="#FFFFFF" strokeWidth={1.5} listening={false} perfectDrawEnabled={false} />
					<Path
						data="M12 2a6 6 0 0 0-6 6c0 4.2 6 12 6 12s6-7.8 6-12a6 6 0 0 0-6-6zm0 8.2A2.2 2.2 0 1 1 12 5.8a2.2 2.2 0 0 1 0 4.4z"
						fill="#FFFFFF"
						scaleX={0.44}
						scaleY={0.44}
						offsetX={12}
						offsetY={11}
						listening={false}
						perfectDrawEnabled={false}
					/>
				</Group>
			)}
		</Group>
	);
});

export default PlayerMagnet;
