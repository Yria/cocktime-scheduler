import { memo, useCallback } from "react";
import { Group, Rect, Text, Circle, Line } from "react-konva";
import type Konva from "konva";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { computeEmptySlots, computeSlotOffset } from "../../lib/board/geometry";
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
	CTA_DISABLED_COLOR,
} from "../../lib/board/constants";
import PlayerMagnet from "./PlayerMagnet";

interface Props {
	teamId: string;
	hasEmptyCourt: boolean;
	playingIds: Set<string>;
	onMagnetDragEnd: (playerId: string, cx: number, cy: number) => void;
	onGhostDragEnd: (resId: string, cx: number, cy: number) => void;
	/** 빈 슬롯(+) 클릭 → 추천 팀원 다이얼로그 열기 */
	onSlotClick?: (teamId: string) => void;
}

const TeamBackground = memo(function TeamBackground({
	teamId,
	hasEmptyCourt,
	playingIds,
	onMagnetDragEnd,
	onGhostDragEnd,
	onSlotClick,
}: Props) {
	const team = useBoardStore((s) => s.drafts.get(teamId));
	const drafts = useBoardStore((s) => s.drafts);
	const reservations = useBoardStore((s) => s.reservations);
	const magnets = useBoardStore((s) => s.magnets);
	const setTeamAnchor = useBoardStore((s) => s.setTeamAnchor);
	const settleBoard = useBoardStore((s) => s.settleBoard);
	const isEditor = useSessionStore((s) => s.isEditor); // 보기 전용이면 드래그/경기시작 비활성

	// 멤버 자석 드래그가 팀 Group으로 버블링된 경우(e.target≠그룹) 무시.
	// 안 하면 setTeamAnchor가 멤버의 로컬 좌표로 anchor를 덮어써 팀이 튄다.
	const handleDragMove = useCallback(
		(e: Konva.KonvaEventObject<DragEvent>) => {
			if (e.target !== e.currentTarget) return;
			setTeamAnchor(teamId, e.target.x(), e.target.y());
		},
		[teamId, setTeamAnchor],
	);

	const handleDragEnd = useCallback(
		(e: Konva.KonvaEventObject<DragEvent>) => {
			if (e.target !== e.currentTarget) return;
			setTeamAnchor(teamId, e.target.x(), e.target.y());
			// 드래그-엔드: 팀 패널에서 겹친 자유 자석 흩어짐
			settleBoard({ teamId });
		},
		[teamId, setTeamAnchor, settleBoard],
	);

	const handleDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
		if (e.target === e.currentTarget) e.target.moveToTop();
	}, []);

	if (!team) return null;

	const members = teamMembers(teamId, drafts, reservations);
	const count = members.length;
	const startable = isTeamStartable(teamId, drafts, reservations, magnets, playingIds);
	const isFull = count === 4;
	const ctaEnabled = startable && hasEmptyCourt && isEditor;

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

	const ctaLabel = !isEditor ? "보기 전용" : ctaEnabled ? "경기시작" : !startable ? "선수 경기중" : "코트 대기";
	const ctaColor = ctaEnabled ? CTA_START_COLOR : CTA_DISABLED_COLOR;

	const emptySlots = computeEmptySlots(count);
	const showVs = isFull;
	const showCta = isFull;

	const boxTop = -TEAM_GRID_HALF - TEAM_GAP - TEAM_LABEL_H - TEAM_PAD;
	let boxBottom = TEAM_GRID_HALF + TEAM_PAD;
	if (showCta) boxBottom += TEAM_CTA_GAP + TEAM_CTA_H;
	const boxH = boxBottom - boxTop;
	const halfW = TEAM_W / 2;
	const ctaY = boxBottom - TEAM_PAD - TEAM_CTA_H;

	const handleCta = () => {
		if (!ctaEnabled) return;
		void useBoardStore.getState().startMatch(teamId);
	};

	return (
		<Group
			id={`team-${teamId}`}
			x={team.anchor.x}
			y={team.anchor.y}
			draggable={isEditor}
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
				stroke={style.stroke}
				strokeWidth={2}
				shadowColor="rgba(0,0,0,0.3)"
				shadowBlur={12}
				shadowOffsetY={4}
				perfectDrawEnabled={false}
			/>

			<Text
				x={-halfW}
				y={boxTop + TEAM_PAD}
				width={TEAM_W}
				text={labelText}
				fontSize={11}
				fontStyle={showCta ? "bold" : "normal"}
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
					onMouseDown={(e) => { e.cancelBubble = true; }}
					onTouchStart={(e) => { e.cancelBubble = true; }}
					onClick={(e) => { e.cancelBubble = true; onSlotClick?.(teamId); }}
					onTap={(e) => { e.cancelBubble = true; onSlotClick?.(teamId); }}
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
					/>
				);
			})}

			{showCta && (
				<Group
					x={0}
					y={ctaY}
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
