import { memo, useCallback, useEffect, useState } from "react";
import { Group, Rect, Text, Circle, Line } from "react-konva";
import type Konva from "konva";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { computeSlotOffset, emptySlotIndices } from "../../lib/board/geometry";
import { isSelfDrag, stopTap } from "../../lib/board/konvaEvents";
import {
	confirmRank,
	findReservation,
	isTeamStartable,
	nextUpConfirmedTeamId,
	teamMembers,
	wouldDissolveByPlaying,
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
	TEAM_RESERVED_BG,
	TEAM_RESERVED_STROKE,
	TEAM_CONFIRMED_BG,
	TEAM_CONFIRMED_STROKE,
	TEXT_SECONDARY,
	STROKE_DEFAULT,
	CTA_START_COLOR,
	CTA_QUEUE_COLOR,
	CTA_DISABLED_COLOR,
	CTA_PLAY_COLOR,
	CTA_PLAY_FLASH,
	CTA_UNCONFIRM_COLOR,
	HILITE_STROKE,
} from "../../lib/board/constants";
import PlayerMagnet from "./PlayerMagnet";

/** 확정취소(✕) 미니 버튼 폭 — 경기시작 버튼 좌측에 배치, 나머지가 메인 버튼. */
const UNCONFIRM_W = 28;
const UNCONFIRM_GAP = 6;

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

	// ── 경기시작 버튼 반짝임 — "다음 경기"(가장 먼저 확정 + 시작 가능) 팀이고 코트가 비었을 때만.
	// 훅은 아래 조기 return보다 앞이어야 하므로 team 부재를 허용해 판정한다. 550ms 토글(setInterval)이라
	// Konva 레이어 redraw는 초당 2회뿐(연속 애니메이션 아님 — 모바일 배터리/프레임 영향 최소).
	const blinkActive =
		team != null &&
		team.confirmedMs != null &&
		hasEmptyCourt &&
		isEditor &&
		nextUpConfirmedTeamId(drafts, reservations, magnets, playingIds) === teamId;
	const [flash, setFlash] = useState(false);
	useEffect(() => {
		if (!blinkActive) {
			setFlash(false);
			return;
		}
		const t = window.setInterval(() => setFlash((f) => !f), 550);
		return () => window.clearInterval(t);
	}, [blinkActive]);

	if (!team) return null;
	// I2 렌더 게이팅 — 경기중이 된 anchor로 해체될 팀은 그 프레임에 즉시 안 그린다(healPlayingAnchors가
	// 상태를 정제하는 1프레임 뒤가 아니라 렌더 시점 playingIds로 판정 → '코트+유령 팀' 동시노출 0프레임).
	// heal과 동일한 wouldDissolveByPlaying 규칙을 공유하므로 렌더/상태가 어긋나 깜빡이지 않는다.
	if (wouldDissolveByPlaying(team, reservations, playingIds)) return null;

	const members = teamMembers(teamId, drafts, reservations);
	const count = members.length;
	const startable = isTeamStartable(teamId, drafts, reservations, magnets, playingIds);
	const isFull = count === 4;
	// 매칭확정 가능 = 4명이고 시작 가능(isTeamStartable). 예약(ghost)이 끼어도 그 선수가 자유(경기 끝남)면
	// startable=true → 매칭확정. 예약자가 아직 경기중이면 startable=false → 우선배치 모드(시작 버튼 대신 그룹 지정).
	const canStart = isFull && startable;
	// 3단계 흐름: [매칭확정](canStart·미확정) → [경기시작](확정됨) → [경기완료](코트 카드).
	// 확정 표시는 지금 시작 가능한 팀에만 유효 — 동기화 레이스로 confirmedMs만 남은 스테일은 무시(렌더 게이팅).
	const confirmed = canStart && team.confirmedMs != null;
	const rank = confirmed ? confirmRank(teamId, drafts) : null;
	// 우선배치(그룹 지정) 상태 — "우선배치"로 지정한 멤버(forcedIds) 중 현재 멤버(anchor+ghost)에 남은 것 ≥2.
	// 순수 그룹 표시일 뿐 추천/밸런스 점수엔 영향 없음(핀 배지 시각 표시 + 라벨 전용).
	const intentional = members.filter((m) => team.forcedIds?.includes(m.playerId)).length >= 2;
	// CTA: 확정됨=경기시작(빈 코트 필요) / 매칭확정(코트 불필요 — 대기열 등록) /
	//   그 외(구성 중 OR 4명이지만 예약자 경기중)=우선배치 토글(1명 비활성, 2명+ 활성).
	const ctaEnabled = confirmed
		? isEditor && hasEmptyCourt
		: canStart
			? isEditor
			: isEditor && count >= 2;

	// 박스 스타일: 확정=딥블루(대기열) / 시작 가능=초록 / 4명이지만 예약자 경기중=보라 / 구성 중=회색
	const style = confirmed
		? { fill: TEAM_CONFIRMED_BG, stroke: TEAM_CONFIRMED_STROKE }
		: startable
			? { fill: TEAM_READY_BG, stroke: TEAM_READY_STROKE }
			: isFull
				? { fill: TEAM_RESERVED_BG, stroke: TEAM_RESERVED_STROKE }
				: { fill: TEAM_FORMING_BG, stroke: TEAM_FORMING_STROKE };

	const baseLabel = !isFull
		? `팀 구성 중 · ${count}/4`
		: confirmed
			? `매칭확정 ${rank ?? "?"}번째`
			: canStart
				? "팀 완성 · 4/4"
				: "4/4 · 예약 포함(경기중)";
	// 생성자(누가 이 그룹을 만들었는지 — 마지막으로 멤버를 넣은 편집자) 표시. 레거시 팀(createdBy 없음)은 생략.
	const labelText = team.createdBy ? `${baseLabel} · by ${team.createdBy}` : baseLabel;
	const labelColor = confirmed
		? TEAM_CONFIRMED_STROKE
		: startable
			? TEAM_READY_STROKE
			: isFull
				? TEAM_RESERVED_STROKE
				: TEXT_SECONDARY;

	// 라벨: 확정됨=경기시작(코트 없으면 대기 안내), 매칭확정 가능=매칭확정, 그 외=우선배치 토글.
	const ctaLabel = confirmed
		? hasEmptyCourt
			? "경기시작"
			: "코트 대기"
		: canStart
			? "매칭확정"
			: intentional
				? "우선배치 해제"
				: "우선배치";
	// 경기시작=주황(코트 카드로 전이, 반짝일 땐 밝은 주황) / 매칭확정=초록 / 우선배치 지정됨=인디고 / 우선배치=파랑 / 비활성=회색
	const ctaColor = !ctaEnabled
		? CTA_DISABLED_COLOR
		: confirmed
			? blinkActive && flash
				? CTA_PLAY_FLASH
				: CTA_PLAY_COLOR
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

	// 확정됨=경기시작(코트 배치), 매칭확정 가능=확정(대기열 등록), 그 외=우선배치 토글.
	const handleCta = () => {
		if (!ctaEnabled) return;
		if (confirmed) void useBoardStore.getState().startMatch(teamId);
		else if (canStart) useBoardStore.getState().confirmTeam(teamId);
		else useBoardStore.getState().toggleForced(teamId);
	};

	// 확정취소(✕) — 확정된 팀에만, CTA 좌측 미니 버튼(편집자만). 메인 버튼은 그만큼 오른쪽에서 시작.
	const showUnconfirm = confirmed && isEditor;
	const ctaMainX = showUnconfirm ? UNCONFIRM_W + UNCONFIRM_GAP : 0;
	const ctaMainW = TEAM_W - TEAM_PAD * 2 - ctaMainX;

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
				wrap="none"
				ellipsis={true}
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

			{/* 확정취소(✕) — 확정된 팀의 CTA 좌측 미니 버튼(편집자만). 누르면 확정 해제(순번 반납). */}
			{showUnconfirm && (
				<Group x={-halfW + TEAM_PAD} y={ctaY} {...stopTap(() => useBoardStore.getState().unconfirmTeam(teamId))}>
					<Rect
						width={UNCONFIRM_W}
						height={TEAM_CTA_H}
						cornerRadius={8}
						fill={CTA_UNCONFIRM_COLOR}
						perfectDrawEnabled={false}
					/>
					<Line
						points={[UNCONFIRM_W / 2 - 5, TEAM_CTA_H / 2 - 5, UNCONFIRM_W / 2 + 5, TEAM_CTA_H / 2 + 5]}
						stroke="#CBD5E1"
						strokeWidth={2}
						lineCap="round"
						listening={false}
						perfectDrawEnabled={false}
					/>
					<Line
						points={[UNCONFIRM_W / 2 + 5, TEAM_CTA_H / 2 - 5, UNCONFIRM_W / 2 - 5, TEAM_CTA_H / 2 + 5]}
						stroke="#CBD5E1"
						strokeWidth={2}
						lineCap="round"
						listening={false}
						perfectDrawEnabled={false}
					/>
				</Group>
			)}

			{/* CTA 버튼 — 확정됨=경기시작(다음 경기 팀은 반짝임), 4명=매칭확정, 구성 중=우선배치 토글. */}
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
					x={-halfW + TEAM_PAD + ctaMainX}
					y={0}
					width={ctaMainW}
					height={TEAM_CTA_H}
					cornerRadius={8}
					fill={ctaColor}
					stroke={blinkActive && flash ? "#FDE68A" : undefined}
					strokeWidth={blinkActive && flash ? 2 : 0}
					shadowColor={CTA_PLAY_FLASH}
					shadowBlur={14}
					shadowEnabled={blinkActive && flash && !dragging}
					perfectDrawEnabled={false}
				/>
				<Text
					x={-halfW + TEAM_PAD + ctaMainX}
					y={0}
					width={ctaMainW}
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
