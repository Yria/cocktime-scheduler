import { memo } from "react";
import { Group, Rect, Text } from "react-konva";
import { useBoardStore } from "../../store/boardStore";
import {
	DETACH_ZONE_H,
	DETACH_ZONE_BG,
	DETACH_ZONE_STROKE,
	DETACH_ZONE_LABEL,
	DETACH_ZONE_HOT_BG,
	DETACH_ZONE_HOT_STROKE,
	DETACH_ZONE_HOT_LABEL,
} from "../../lib/board/constants";

/**
 * '팀에서 빼기' 드롭존 — 팀 소속(anchor/ghost) 자석을 드래그하는 동안에만 상단에 노출.
 * listening=false라 드래그 이벤트를 가로채지 않는다(드롭 판정은 좌표로). hot 여부는 store.detachHot.
 */
const DetachZone = memo(function DetachZone({ stageW }: { stageW: number }) {
	const hot = useBoardStore((s) => s.detachHot);
	const bg = hot ? DETACH_ZONE_HOT_BG : DETACH_ZONE_BG;
	const stroke = hot ? DETACH_ZONE_HOT_STROKE : DETACH_ZONE_STROKE;
	const label = hot ? DETACH_ZONE_HOT_LABEL : DETACH_ZONE_LABEL;
	return (
		<Group listening={false}>
			<Rect
				x={4}
				y={4}
				width={Math.max(0, stageW - 8)}
				height={DETACH_ZONE_H - 4}
				cornerRadius={14}
				fill={bg}
				stroke={stroke}
				strokeWidth={2}
				dash={[8, 6]}
				perfectDrawEnabled={false}
			/>
			<Text
				x={0}
				y={0}
				width={stageW}
				height={DETACH_ZONE_H}
				text={hot ? "여기 놓으면 팀에서 빠집니다" : "↑ 여기로 끌어 팀에서 빼기"}
				fontSize={14}
				fontStyle="bold"
				fontFamily="Inter, system-ui, sans-serif"
				fill={label}
				align="center"
				verticalAlign="middle"
				listening={false}
				perfectDrawEnabled={false}
			/>
		</Group>
	);
});

export default DetachZone;
