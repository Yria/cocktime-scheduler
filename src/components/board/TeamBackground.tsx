import { memo, useCallback } from "react";
import { Group, Rect, Text, Circle, Line } from "react-konva";
import type Konva from "konva";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { computeEmptySlots, computeSlotOffset } from "../../lib/board/geometry";
import { isSelfDrag, stopTap } from "../../lib/board/konvaEvents";
import {
	findReservation,
	isTeamStartable,
	teamMembers,
} from "../../lib/board/membership";
import {
	TEAM_W,
	TEAM_PAD,
	TEAM_GAP,
	TEAM_CORNER_R,
	TEAM_LABEL_H,
	TEAM_VS_H,
	TEAM_CTA_H,
	TEAM_CTA_GAP,
	TEAM_GRID_HALF,
	EMPTY_SLOT_R,
	TEAM_FORMING_BG,
	TEAM_FORMING_STROKE,
	TEAM_READY_BG,
	TEAM_READY_STROKE,
	TEAM_PLAYING_BG,
	TEAM_PLAYING_STROKE,
	TEXT_SECONDARY,
	STROKE_DEFAULT,
	CTA_START_COLOR,
	CTA_QUEUE_COLOR,
	CTA_DISABLED_COLOR,
	HILITE_STROKE,
} from "../../lib/board/constants";
import PlayerMagnet from "./PlayerMagnet";

interface Props {
	teamId: string;
	hasEmptyCourt: boolean;
	playingIds: Set<string>;
	onMagnetDragEnd: (playerId: string, cx: number, cy: number) => void;
	onGhostDragEnd: (resId: string, cx: number, cy: number) => void;
	/** 드래그 이동 중(논리 좌표) — 빼기존 hot·겹침 하이라이트 갱신 */
	onMagnetDragMove?: (playerId: string, cx: number, cy: number) => void;
	/** 빈 슬롯(+) 클릭 → 추천 팀원 다이얼로그 열기 */
	onSlotClick?: (teamId: string) => void;
}

const TeamBackground = memo(function TeamBackground({
	teamId,
	hasEmptyCourt,
	playingIds,
	onMagnetDragEnd,
	onGhostDragEnd,
	onMagnetDragMove,
	onSlotClick,
}: Props) {
	const team = useBoardStore((s) => s.drafts.get(teamId));
	const drafts = useBoardStore((s) => s.drafts);
	const reservations = useBoardStore((s) => s.reservations);
	const magnets = useBoardStore((s) => s.magnets);
	const setTeamAnchor = useBoardStore((s) => s.setTeamAnchor);
	const settleBoard = useBoardStore((s) => s.settleBoard);
	const isEditor = useSessionStore((s) => s.isEditor); // 보기 전용이면 드래그/경기시작 비활성(락 = 전부 차단)
	// 드래그 중 이 팀이 합류/예약 대상이 되면 박스 하이라이트
	const isHovered = useBoardStore((s) => s.hoverTarget?.kind === "team" && s.hoverTarget.id === teamId);

	// 멤버 자석 드래그가 팀 Group으로 버블링된 경우(e.target≠그룹) 무시.
	// 안 하면 setTeamAnchor가 멤버의 로컬 좌표로 anchor를 덮어써 팀이 튄다.
	const handleDragMove = useCallback(
		(e: Konva.KonvaEventObject<DragEvent>) => {
			if (!isSelfDrag(e)) return;
			setTeamAnchor(teamId, e.target.x(), e.target.y());
		},
		[teamId, setTeamAnchor],
	);

	const handleDragEnd = useCallback(
		(e: Konva.KonvaEventObject<DragEvent>) => {
			if (!isSelfDrag(e)) return;
			setTeamAnchor(teamId, e.target.x(), e.target.y());
			// 드래그-엔드: 팀 패널에서 겹친 자유 자석 흩어짐
			settleBoard({ teamId });
		},
		[teamId, setTeamAnchor, settleBoard],
	);

	const handleDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
		if (isSelfDrag(e)) e.target.moveToTop();
	}, []);

	if (!team) return null;

	const members = teamMembers(teamId, drafts, reservations);
	const count = members.length;
	const startable = isTeamStartable(teamId, drafts, reservations, magnets, playingIds);
	const isFull = count === 4;
	// CTA: 4명=경기시작(조건 충족 시) / 구성 중=자동편성(편집 권한만 있으면)
	const ctaEnabled = isFull ? startable && hasEmptyCourt && isEditor : isEditor;

	// 박스 스타일: 시작 가능=초록 / 4명이지만 대기=호박 / 구성 중=회색
	const style = startable
		? { fill: TEAM_READY_BG, stroke: TEAM_READY_STROKE }
		: isFull
			? { fill: TEAM_PLAYING_BG, stroke: TEAM_PLAYING_STROKE }
			: { fill: TEAM_FORMING_BG, stroke: TEAM_FORMING_STROKE };

	const labelText = !isFull
		? `팀 구성 중 · ${count}/4`
		: startable
			? "팀 완성 · 4/4"
			: "대기 · 선수 경기중";
	const labelColor = startable ? TEAM_READY_STROKE : isFull ? TEAM_PLAYING_STROKE : TEXT_SECONDARY;

	// 라벨은 팀 상태/액션 기준(편집 권한과 무관) — 보기 전용도 편집자와 같은 라벨을 회색 비활성으로 본다.
	const ctaLabel = !isFull
		? "자동편성"
		: !startable
			? "선수 경기중"
			: !hasEmptyCourt
				? "코트 대기"
				: "경기시작";
	// 구성 중 자동편성=파랑, 4명 경기시작=초록, 비활성(보기 전용·조건 미충족)=회색
	const ctaColor = !ctaEnabled ? CTA_DISABLED_COLOR : isFull ? CTA_START_COLOR : CTA_QUEUE_COLOR;

	const emptySlots = computeEmptySlots(count);
	const showVs = isFull;

	// 박스 높이는 상태/권한과 무관하게 항상 CTA 영역을 포함 — 시각 박스 = 드래그 히트영역(teamRect/TEAM_BOX_BELOW)과 일치.
	const boxTop = -TEAM_GRID_HALF - TEAM_GAP - TEAM_LABEL_H - TEAM_PAD;
	const boxBottom = TEAM_GRID_HALF + TEAM_PAD + TEAM_CTA_GAP + TEAM_CTA_H;
	const boxH = boxBottom - boxTop;
	const halfW = TEAM_W / 2;
	const ctaY = boxBottom - TEAM_PAD - TEAM_CTA_H;

	const handleCta = () => {
		if (!ctaEnabled) return;
		if (isFull) {
			void useBoardStore.getState().startMatch(teamId);
		} else {
			useBoardStore.getState().autoFillTeam(teamId);
		}
	};

	return (
		<Group
			id={`team-${teamId}`}
			x={team.anchor.x}
			y={team.anchor.y}
			draggable /* 그룹 위치는 로컬(미동기화) — 보기 전용도 이동 허용. 멤버십(CTA·슬롯)은 편집자만. */
			onDragStart={handleDragStart}
			onDragMove={handleDragMove}
			onDragEnd={handleDragEnd}
		>
			<Rect
				x={-halfW}
				y={boxTop}
				width={TEAM_W}
				height={boxH}
				cornerRadius={TEAM_CORNER_R}
				fill={style.fill}
				stroke={isHovered ? HILITE_STROKE : style.stroke}
				strokeWidth={isHovered ? 3.5 : 2}
				shadowColor={isHovered ? HILITE_STROKE : "rgba(0,0,0,0.3)"}
				shadowBlur={isHovered ? 16 : 12}
				shadowOffsetY={isHovered ? 0 : 4}
				perfectDrawEnabled={false}
			/>

			<Text
				x={-halfW}
				y={boxTop + TEAM_PAD}
				width={TEAM_W}
				text={labelText}
				fontSize={11}
				fontStyle={isFull ? "bold" : "normal"}
				fontFamily="Inter, system-ui, sans-serif"
				fill={labelColor}
				align="center"
				listening={false}
				perfectDrawEnabled={false}
			/>

			{showVs && (
				<Text
					x={-halfW}
					y={-TEAM_VS_H / 2}
					width={TEAM_W}
					text="vs"
					fontSize={10}
					fontStyle="bold"
					fontFamily="Inter, system-ui, sans-serif"
					fill={`${labelColor}80`}
					align="center"
					listening={false}
					perfectDrawEnabled={false}
				/>
			)}

			{emptySlots.map((slot, i) => (
				<Group
					key={`empty-${i}`}
					x={slot.x}
					y={slot.y}
					listening={!!onSlotClick}
					{...stopTap(() => onSlotClick?.(teamId))}
				>
					{/* 클릭 히트영역(투명 원) — + 선 사이 빈 공간도 잡도록 */}
					<Circle radius={EMPTY_SLOT_R} fill="rgba(0,0,0,0.001)" stroke={STROKE_DEFAULT} strokeWidth={2} perfectDrawEnabled={false} />
					<Line points={[-8, 0, 8, 0]} stroke={STROKE_DEFAULT} strokeWidth={2} listening={false} perfectDrawEnabled={false} />
					<Line points={[0, -8, 0, 8]} stroke={STROKE_DEFAULT} strokeWidth={2} listening={false} perfectDrawEnabled={false} />
				</Group>
			))}

			{members.map((m) => {
				const off = computeSlotOffset(m.slot, count);
				if (m.kind === "ghost") {
					const res = findReservation(m.playerId, teamId, reservations);
					return (
						<PlayerMagnet
							key={`ghost-${m.playerId}`}
							playerId={m.playerId}
							offsetX={off.x}
							offsetY={off.y}
							kind="ghost"
							reservationId={res?.id}
							onGhostDragEnd={onGhostDragEnd}
							onDragMove={onMagnetDragMove}
						/>
					);
				}
				return (
					<PlayerMagnet
						key={`anchor-${m.playerId}`}
						playerId={m.playerId}
						offsetX={off.x}
						offsetY={off.y}
						kind="anchor"
						onDragEnd={onMagnetDragEnd}
						onDragMove={onMagnetDragMove}
					/>
				);
			})}

			{/* CTA 버튼 — 항상 렌더(4명=경기시작, 구성 중=자동편성). 보기 전용/조건 미충족은 같은 라벨을 회색 비활성으로. */}
			{(
				<Group
					x={0}
					y={ctaY}
					listening={ctaEnabled}
					onMouseDown={(e) => {
						e.cancelBubble = true;
					}}
					onTouchStart={(e) => {
						e.cancelBubble = true;
					}}
					onClick={handleCta}
					onTap={handleCta}
				>
					<Rect
						x={-halfW + TEAM_PAD}
						y={0}
						width={TEAM_W - TEAM_PAD * 2}
						height={TEAM_CTA_H}
						cornerRadius={8}
						fill={ctaColor}
						perfectDrawEnabled={false}
					/>
					<Text
						x={-halfW + TEAM_PAD}
						y={0}
						width={TEAM_W - TEAM_PAD * 2}
						height={TEAM_CTA_H}
						text={ctaLabel}
						fontSize={13}
						fontStyle="bold"
						fontFamily="Inter, system-ui, sans-serif"
						fill="#FFFFFF"
						align="center"
						verticalAlign="middle"
						listening={false}
						perfectDrawEnabled={false}
					/>
				</Group>
			)}
		</Group>
	);
});

export default TeamBackground;
