import { memo, useCallback } from "react";
import { Group, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { Court } from "../../types";
import { useBoardStore } from "../../store/boardStore";
import { computeSlotOffset } from "../../lib/board/geometry";
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
	TEAM_PLAYING_BG,
	TEAM_PLAYING_STROKE,
	CTA_FINISH_COLOR,
} from "../../lib/board/constants";
import PlayerMagnet from "./PlayerMagnet";

interface Props {
	court: Court;
	/** 기본 위치(코트 레인). 사용자가 드래그하면 courtAnchors가 우선. */
	x: number;
	y: number;
}

/**
 * 코트에 배치되어 경기중인 매치 카드. 카드 자체는 드래그 이동 가능.
 * 멤버 자석을 끌어내 다른 팀/선수에 겹치면 예약(ghost)이 생성된다(원본은 코트 유지).
 * "경기완료" → boardStore.completeMatch → sessionStore.handleComplete(DB).
 */
const CourtMatchCard = memo(function CourtMatchCard({ court, x, y }: Props) {
	const completeMatch = useBoardStore((s) => s.completeMatch);
	const handlePlayingDrop = useBoardStore((s) => s.handlePlayingMagnetDrop);
	const setCourtAnchor = useBoardStore((s) => s.setCourtAnchor);
	const settleBoard = useBoardStore((s) => s.settleBoard);
	const stored = useBoardStore((s) => s.courtAnchors.get(court.id));
	const match = court.match;

	const handleComplete = useCallback(() => {
		void completeMatch(court.id);
	}, [completeMatch, court.id]);

	// 멤버 자석 드래그가 코트 카드 Group으로 버블링된 경우 무시(카드가 튀는 것 방지).
	const handleDragMove = useCallback(
		(e: Konva.KonvaEventObject<DragEvent>) => {
			if (e.target !== e.currentTarget) return;
			setCourtAnchor(court.id, e.target.x(), e.target.y());
		},
		[court.id, setCourtAnchor],
	);

	const handleDragEnd = useCallback(
		(e: Konva.KonvaEventObject<DragEvent>) => {
			if (e.target !== e.currentTarget) return;
			setCourtAnchor(court.id, e.target.x(), e.target.y());
			// 드래그-엔드: 코트 카드에서 겹친 자유 자석 흩어짐
			settleBoard({ courtId: court.id });
		},
		[court.id, setCourtAnchor, settleBoard],
	);

	const handleDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
		if (e.target === e.currentTarget) e.target.moveToTop();
	}, []);

	const onMemberDragEnd = useCallback(
		(playerId: string, cx: number, cy: number) => {
			handlePlayingDrop(playerId, { x: cx, y: cy });
		},
		[handlePlayingDrop],
	);

	if (!match) return null;
	const ids = [...match.teamA, ...match.teamB];

	const halfW = TEAM_W / 2;
	const boxTop = -TEAM_GRID_HALF - TEAM_GAP - TEAM_LABEL_H - TEAM_PAD;
	const boxBottom = TEAM_GRID_HALF + TEAM_PAD + TEAM_CTA_GAP + TEAM_CTA_H;
	const boxH = boxBottom - boxTop;
	const ctaY = boxBottom - TEAM_PAD - TEAM_CTA_H;

	return (
		<Group
			id={`court-${court.id}`}
			x={stored?.x ?? x}
			y={stored?.y ?? y}
			draggable
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
				fill={TEAM_PLAYING_BG}
				stroke={TEAM_PLAYING_STROKE}
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
				text={`${court.id}번 코트 · 경기중`}
				fontSize={11}
				fontStyle="bold"
				fontFamily="Inter, system-ui, sans-serif"
				fill={TEAM_PLAYING_STROKE}
				align="center"
				listening={false}
				perfectDrawEnabled={false}
			/>

			<Text
				x={-halfW}
				y={-TEAM_VS_H / 2}
				width={TEAM_W}
				text="vs"
				fontSize={10}
				fontStyle="bold"
				fontFamily="Inter, system-ui, sans-serif"
				fill={`${TEAM_PLAYING_STROKE}80`}
				align="center"
				listening={false}
				perfectDrawEnabled={false}
			/>

			{ids.map((pid, i) => {
				const off = computeSlotOffset(i, 4);
				return (
					<PlayerMagnet
						key={pid}
						playerId={pid}
						offsetX={off.x}
						offsetY={off.y}
						playing
						onPlayingDragEnd={onMemberDragEnd}
					/>
				);
			})}

			<Group
				x={0}
				y={ctaY}
				onMouseDown={(e) => {
					e.cancelBubble = true;
				}}
				onTouchStart={(e) => {
					e.cancelBubble = true;
				}}
				onClick={handleComplete}
				onTap={handleComplete}
			>
				<Rect
					x={-halfW + TEAM_PAD}
					y={0}
					width={TEAM_W - TEAM_PAD * 2}
					height={TEAM_CTA_H}
					cornerRadius={8}
					fill={CTA_FINISH_COLOR}
					perfectDrawEnabled={false}
				/>
				<Text
					x={-halfW + TEAM_PAD}
					y={0}
					width={TEAM_W - TEAM_PAD * 2}
					height={TEAM_CTA_H}
					text="경기완료"
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
		</Group>
	);
});

export default CourtMatchCard;
