import { memo, useCallback } from "react";
import { Group, Rect, Text, Circle, Line } from "react-konva";
import type Konva from "konva";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { computeSlotOffset, emptySlotIndices } from "../../lib/board/geometry";
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
	MAGNET_R,
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
	// 드래그 중 이 팀의 특정 슬롯이 대상이 되면 그 칸만 하이라이트(박스 전체 아님). null이면 비대상.
	const hoverSlot = useBoardStore((s) =>
		s.hoverTarget?.kind === "slot" && s.hoverTarget.teamId === teamId ? s.hoverTarget.slotIndex : null,
	);
	// 드래그 중 그림자 비활성 — 매 프레임 Layer redraw 시 팀 박스 shadowBlur 재계산을 피한다(구기기 프레임 드랍 방지).
	const dragging = useBoardStore((s) => s.dragInfo != null);
	// 드래그 중인 자석 id — 이 팀 멤버를 드래그하면 그 슬롯을 빈 칸(+)으로 보여주기 위함(N3).
	const draggedId = useBoardStore((s) => s.dragInfo?.playerId ?? null);

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
	// 매칭확정 가능 = 4명이고 시작 가능(isTeamStartable). 예약(ghost)이 끼어도 그 선수가 자유(경기 끝남)면
	// startable=true → 매칭확정. 예약자가 아직 경기중이면 startable=false → 고정배치 모드(시작 버튼 대신 잠금).
	const canStart = isFull && startable;
	// 잠금(🔒) 상태 — "고정배치"로 잠근 멤버(forcedIds) 중 현재 멤버(anchor+ghost)에 남은 것 ≥2.
	const intentional = members.filter((m) => team.forcedIds?.includes(m.playerId)).length >= 2;
	// CTA: 매칭확정(경기 시작 가능) / 그 외(구성 중 OR 4명이지만 예약자 경기중)=고정배치 토글(1명 비활성, 2명+ 활성).
	//   "자동편성"(자동 채움)은 그룹박스에서 제거되어 추천 모달 안 버튼으로 이동. 구성 중 채움은 빈 슬롯 탭→모달.
	const ctaEnabled = canStart ? hasEmptyCourt && isEditor : isEditor && count >= 2;

	// 박스 스타일: 시작 가능=초록 / 4명이지만 대기=호박 / 구성 중=회색
	const style = startable
		? { fill: TEAM_READY_BG, stroke: TEAM_READY_STROKE }
		: isFull
			? { fill: TEAM_PLAYING_BG, stroke: TEAM_PLAYING_STROKE }
			: { fill: TEAM_FORMING_BG, stroke: TEAM_FORMING_STROKE };

	const labelText = !isFull
		? `팀 구성 중 · ${count}/4`
		: canStart
			? "팀 완성 · 4/4"
			: "4/4 · 예약 포함(경기중)";
	const labelColor = startable ? TEAM_READY_STROKE : isFull ? TEAM_PLAYING_STROKE : TEXT_SECONDARY;

	// 라벨: 매칭확정 가능하면 상태 기준(매칭확정/코트 대기), 그 외(구성 중·4명+예약)는 고정 토글.
	const ctaLabel = canStart
		? !hasEmptyCourt
			? "코트 대기"
			: "매칭확정"
		: intentional
			? "고정 해제"
			: "고정배치";
	// 매칭확정=초록 / 잠금=인디고(🔒와 동일) / 고정배치=파랑 / 비활성=회색
	const ctaColor = !ctaEnabled
		? CTA_DISABLED_COLOR
		: canStart
			? CTA_START_COLOR
			: intentional
				? "#6366F1"
				: CTA_QUEUE_COLOR;

	// 드래그 중인 자석(이 팀 멤버면)의 슬롯은 빈 칸으로 취급 → 그 자리에 (+) 노출(자석은 Konva가 들고 이동 중).
	const occupiedSlots = new Set(members.filter((m) => m.playerId !== draggedId).map((m) => m.slot));
	const emptySlots = emptySlotIndices(occupiedSlots);
	const showVs = isFull;

	// 박스 높이는 상태/권한과 무관하게 항상 CTA 영역을 포함 — 시각 박스 = 드래그 히트영역(teamRect/TEAM_BOX_BELOW)과 일치.
	const boxTop = -TEAM_GRID_HALF - TEAM_GAP - TEAM_LABEL_H - TEAM_PAD;
	const boxBottom = TEAM_GRID_HALF + TEAM_PAD + TEAM_CTA_GAP + TEAM_CTA_H;
	const boxH = boxBottom - boxTop;
	const halfW = TEAM_W / 2;
	const ctaY = boxBottom - TEAM_PAD - TEAM_CTA_H;

	// 매칭확정 가능=경기 시작. 그 외(구성 중 2+ OR 4명+예약)=고정 토글(누르는 시점 멤버를 🔒 잠금/해제).
	const handleCta = () => {
		if (!ctaEnabled) return;
		if (canStart) void useBoardStore.getState().startMatch(teamId);
		else useBoardStore.getState().toggleForced(teamId);
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
				stroke={style.stroke}
				strokeWidth={2}
				shadowColor="rgba(0,0,0,0.3)"
				shadowBlur={12}
				shadowOffsetY={4}
				shadowEnabled={!dragging}
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

			{/* 드래그 중 가리킨 슬롯만 하이라이트(빈칸=합류, 점유=교체). 박스 전체가 아니라 그 칸에 링. */}
			{hoverSlot !== null && (
				<Circle
					x={computeSlotOffset(hoverSlot).x}
					y={computeSlotOffset(hoverSlot).y}
					radius={MAGNET_R + 4}
					stroke={HILITE_STROKE}
					strokeWidth={3.5}
					fill={`${HILITE_STROKE}22`}
					listening={false}
					perfectDrawEnabled={false}
				/>
			)}

			{emptySlots.map((idx) => {
				const off = computeSlotOffset(idx);
				return (
					<Group
						key={`empty-${idx}`}
						x={off.x}
						y={off.y}
						listening={!!onSlotClick}
						{...stopTap(() => onSlotClick?.(teamId))}
					>
						{/* 클릭 히트영역(투명 원) — + 선 사이 빈 공간도 잡도록 */}
						<Circle radius={EMPTY_SLOT_R} fill="rgba(0,0,0,0.001)" stroke={STROKE_DEFAULT} strokeWidth={2} perfectDrawEnabled={false} />
						<Line points={[-8, 0, 8, 0]} stroke={STROKE_DEFAULT} strokeWidth={2} listening={false} perfectDrawEnabled={false} />
						<Line points={[0, -8, 0, 8]} stroke={STROKE_DEFAULT} strokeWidth={2} listening={false} perfectDrawEnabled={false} />
					</Group>
				);
			})}

			{members.map((m) => {
				const off = computeSlotOffset(m.slot);
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
							forced={intentional && (team.forcedIds?.includes(m.playerId) ?? false)}
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
						forced={intentional && (team.forcedIds?.includes(m.playerId) ?? false)}
						onDragEnd={onMagnetDragEnd}
						onDragMove={onMagnetDragMove}
					/>
				);
			})}

			{/* CTA 버튼 — 4명=매칭확정(경기시작), 구성 중=고정배치 토글(1명 비활성·2명+ 활성, 누르면 현재 멤버 🔒 잠금/해제). */}
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
		</Group>
	);
});

export default TeamBackground;
