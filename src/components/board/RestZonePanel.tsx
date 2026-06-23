import { memo } from "react";
import { Path, Rect, Text } from "react-konva";
import { restSlotOffset, restZoneHeight } from "../../lib/board/geometry";
import {
	REST_ZONE_BG,
	REST_ZONE_HOT_BG,
	REST_ZONE_HOT_LABEL,
	REST_ZONE_HOT_STROKE,
	REST_ZONE_LABEL,
	REST_ZONE_STROKE,
} from "../../lib/board/constants";
import PlayerMagnet from "./PlayerMagnet";

interface RestZonePanelProps {
	stageW: number;
	stageH: number;
	restingIds: string[];
	restFieldHot: boolean;
	onRestingDragEnd: (playerId: string, cx: number, cy: number) => void;
	onMagnetDragMove: (playerId: string, cx: number, cy: number) => void;
}

/**
 * 휴식 패널(펼침 상태) — stage 하단에 렌더. 호출자가 restZoneOpen일 때만 마운트하므로
 * 내부에서 restZoneOpen 가드는 두지 않는다. 자석을 끌어다 놓으면 휴식, 위로 빼면 복귀.
 */
const RestZonePanel = memo(function RestZonePanel({
	stageW,
	stageH,
	restingIds,
	restFieldHot,
	onRestingDragEnd,
	onMagnetDragMove,
}: RestZonePanelProps) {
	// 휴식 인원수에 따라 여러 줄로 확장(자동 재패킹). 0~1줄이면 기존 높이와 동일.
	const fieldH = restZoneHeight(restingIds.length, stageW, stageH);
	const fieldTop = stageH - fieldH;
	const midY = fieldTop + fieldH / 2;
	const empty = restingIds.length === 0;
	// 중앙 드롭 힌트는 빈 상태에서만(자석 있으면 헤더+자석). hot이면 액센트 문구.
	const showCenter = empty;
	const showIcon = showCenter;
	const centerText = restFieldHot ? "여기에 놓으면 휴식" : "끌어다 놓으면 휴식";
	const centerColor = restFieldHot ? REST_ZONE_HOT_LABEL : REST_ZONE_LABEL;
	return (
		<>
			<Rect
				x={0}
				y={fieldTop}
				width={stageW}
				height={fieldH}
				cornerRadius={[14, 14, 0, 0]}
				fill={restFieldHot ? REST_ZONE_HOT_BG : REST_ZONE_BG}
				stroke={restFieldHot ? REST_ZONE_HOT_STROKE : REST_ZONE_STROKE}
				strokeWidth={restFieldHot ? 2 : 1}
				dash={restFieldHot ? [9, 5] : undefined}
				listening={false}
				perfectDrawEnabled={false}
			/>
			{/* 빈 상태 점선 드롭 프레임 */}
			{empty && !restFieldHot && (
				<Rect
					x={12}
					y={fieldTop + 10}
					width={stageW - 24}
					height={fieldH - 20}
					cornerRadius={10}
					stroke={REST_ZONE_STROKE}
					strokeWidth={1.5}
					dash={[6, 5]}
					listening={false}
					perfectDrawEnabled={false}
				/>
			)}
			{/* 중앙 드롭 힌트 — 트레이 아이콘 + 문구 */}
			{showIcon && (
				<Path
					data="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3"
					x={stageW / 2 - 11}
					y={midY - 21}
					scaleX={0.9}
					scaleY={0.9}
					stroke={centerColor}
					strokeWidth={2}
					lineCap="round"
					lineJoin="round"
					listening={false}
					perfectDrawEnabled={false}
				/>
			)}
			{showCenter && (
				<Text
					x={0}
					y={showIcon ? midY + 5 : midY - 7}
					width={stageW}
					text={centerText}
					fontSize={11}
					fontStyle="bold"
					fontFamily="Inter, system-ui, sans-serif"
					fill={centerColor}
					align="center"
					listening={false}
					perfectDrawEnabled={false}
				/>
			)}
			{/* 휴식자 헤더(좌상단) */}
			{!empty && (
				<Text
					x={0}
					y={fieldTop + 8}
					width={stageW}
					offsetX={-14}
					text={`휴식 ${restingIds.length} · 위로 빼면 복귀`}
					fontSize={11}
					fontStyle="bold"
					fontFamily="Inter, system-ui, sans-serif"
					fill={restFieldHot ? REST_ZONE_HOT_LABEL : REST_ZONE_LABEL}
					align="left"
					listening={false}
					perfectDrawEnabled={false}
				/>
			)}
			{restingIds.map((id, i) => {
				const off = restSlotOffset(i, restingIds.length, stageW, stageH);
				return (
					<PlayerMagnet
						key={`rest-${id}`}
						playerId={id}
						offsetX={off.x}
						offsetY={off.y}
						resting
						onRestingDragEnd={onRestingDragEnd}
						onDragMove={onMagnetDragMove}
					/>
				);
			})}
		</>
	);
});

export default RestZonePanel;
