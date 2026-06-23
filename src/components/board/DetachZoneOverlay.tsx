import { memo } from "react";
import { useBoardStore } from "../../store/boardStore";
import {
	TOOLBAR_H,
	DETACH_ZONE_BG,
	DETACH_ZONE_STROKE,
	DETACH_ZONE_LABEL,
	DETACH_ZONE_HOT_BG,
	DETACH_ZONE_HOT_STROKE,
	DETACH_ZONE_HOT_LABEL,
} from "../../lib/board/constants";

/**
 * '팀에서 빼기' 드롭존 — 네비(헤더) 영역 위에 DOM 오버레이로 표시한다. 팀 소속(anchor/ghost) 자석을
 * 드래그하는 동안에만(showDetach) 노출. Konva 캔버스가 네비 아래라 자석을 네비 안으로 직접 끌 수 없으므로,
 * 드롭 판정은 보드 최상단 strip(isInDetachZone)이 담당하고 이 오버레이는 "위로 끌면 해제" 시각 표시만 한다.
 * pointerEvents:none — 입력을 가로채지 않는다. hot 여부는 store.detachHot(자석이 detach strip에 들어옴).
 */
const DetachZoneOverlay = memo(function DetachZoneOverlay() {
	const hot = useBoardStore((s) => s.detachHot);
	return (
		<div
			style={{
				position: "absolute",
				top: "calc(env(safe-area-inset-top) + 4px)",
				left: 4,
				right: 4,
				height: `${TOOLBAR_H - 8}px`,
				zIndex: 30, // 네비(z10)·보기전용 오버레이(z25) 위
				pointerEvents: "none",
				borderRadius: 14,
				border: `2px dashed ${hot ? DETACH_ZONE_HOT_STROKE : DETACH_ZONE_STROKE}`,
				background: hot ? DETACH_ZONE_HOT_BG : DETACH_ZONE_BG,
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
					color: hot ? DETACH_ZONE_HOT_LABEL : DETACH_ZONE_LABEL,
				}}
			>
				{hot ? "여기 놓으면 팀에서 빠집니다" : "↑ 여기로 끌어 팀에서 빼기"}
			</span>
		</div>
	);
});

export default DetachZoneOverlay;
