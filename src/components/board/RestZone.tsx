import { memo } from "react";
import { Group, Rect, Text } from "react-konva";
import { useBoardStore } from "../../store/boardStore";
import {
	REST_FIELD_H,
	REST_ZONE_BG,
	REST_ZONE_STROKE,
	REST_ZONE_LABEL,
	REST_ZONE_HOT_BG,
	REST_ZONE_HOT_STROKE,
	REST_ZONE_HOT_LABEL,
} from "../../lib/board/constants";

/**
 * '휴식하기' 드롭존 — 휴식 가능한 자석(편집자의 free/anchor 대기 자석)을 드래그하는 동안에만
 * 하단에 노출(상단 '팀에서 빼기' DetachZone 과 대칭). listening=false라 드래그 이벤트를 가로채지 않는다
 * (드롭 판정은 좌표로: isInRestField). hot 여부는 store.restFieldHot.
 *
 * 밴드 높이는 닫힘 상태 캐치존(REST_FIELD_H)과 동일 — 보이는 영역 == 드롭 판정 영역.
 * 좌표는 논리(viewW×viewH) 기준이라 줌(축소)에도 항상 보이는 영역 하단에 정확히 붙는다.
 */
const RestZone = memo(function RestZone({ viewW, viewH }: { viewW: number; viewH: number }) {
	const hot = useBoardStore((s) => s.restFieldHot);
	const top = viewH - REST_FIELD_H;
	const bg = hot ? REST_ZONE_HOT_BG : REST_ZONE_BG;
	const stroke = hot ? REST_ZONE_HOT_STROKE : REST_ZONE_STROKE;
	const label = hot ? REST_ZONE_HOT_LABEL : REST_ZONE_LABEL;
	return (
		<Group listening={false}>
			<Rect
				x={4}
				y={top + 4}
				width={Math.max(0, viewW - 8)}
				height={REST_FIELD_H - 4}
				cornerRadius={14}
				fill={bg}
				stroke={stroke}
				strokeWidth={2}
				dash={[8, 6]}
				perfectDrawEnabled={false}
			/>
			<Text
				x={0}
				y={top}
				width={viewW}
				height={REST_FIELD_H}
				text={hot ? "여기 놓으면 휴식합니다" : "↓ 여기로 끌어 휴식하기"}
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

export default RestZone;
