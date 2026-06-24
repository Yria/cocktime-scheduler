import { memo } from "react";
import { useBoardStore } from "../../store/boardStore";
import {
	COURT_BAR_H,
	REST_ZONE_BG,
	REST_ZONE_STROKE,
	REST_ZONE_LABEL,
	REST_ZONE_HOT_BG,
	REST_ZONE_HOT_STROKE,
	REST_ZONE_HOT_LABEL,
} from "../../lib/board/constants";

/**
 * '휴식하기' 드롭존 — 바텀 바(RestBar) 영역 위에 DOM 오버레이로 표시한다(상단 DetachZoneOverlay의 하단 대칭).
 * 휴식 가능(restable) 자석을 드래그하는 동안에만(showRest) 노출. Konva 캔버스가 바텀 바 위라 자석을 바 안으로
 * 직접 끌 수 없으므로, 드롭 판정은 칠판 하단 경계 너머(isInRestField)가 담당하고 이 오버레이는 "아래로 끌면 휴식"
 * 시각 표시만 한다. pointerEvents:none — 입력을 가로채지 않는다. hot 여부는 store.restFieldHot.
 */
const RestDropOverlay = memo(function RestDropOverlay() {
	const hot = useBoardStore((s) => s.restFieldHot);
	return (
		<div
			style={{
				position: "absolute",
				bottom: "calc(env(safe-area-inset-bottom, 0px) + 4px)",
				left: 4,
				right: 4,
				height: `${COURT_BAR_H - 8}px`,
				zIndex: 30, // 바텀 바(z10) 위
				pointerEvents: "none",
				borderRadius: 14,
				border: `2px dashed ${hot ? REST_ZONE_HOT_STROKE : REST_ZONE_STROKE}`,
				background: hot ? REST_ZONE_HOT_BG : REST_ZONE_BG,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				transition: "background 0.12s, border-color 0.12s",
			}}
		>
			<span
				style={{
					fontSize: 13,
					fontWeight: 700,
					color: hot ? REST_ZONE_HOT_LABEL : REST_ZONE_LABEL,
				}}
			>
				{hot ? "여기 놓으면 휴식합니다" : "↓ 여기로 끌어 휴식하기"}
			</span>
		</div>
	);
});

export default RestDropOverlay;
