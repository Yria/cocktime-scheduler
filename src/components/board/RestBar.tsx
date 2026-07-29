import { memo } from "react";
import { useSessionStore } from "../../store/sessionStore";
import { useBoardStore } from "../../store/boardStore";
import { COURT_BAR_H } from "../../lib/board/constants";

/**
 * 하단 휴식 바 — 이 바 영역이 곧 휴식 드롭존(칠판 밴드 없음). 표시 전용이라 탭 동작은 없다.
 *  - 대기 자석을 칠판 하단 경계 너머 이 바까지 끌어내리면 휴식(드롭 감지는 isInRestField: 논리 y ≥ viewH)
 *  - 휴식 자석(휴식 딱지)을 같은 바로 다시 끌어내리면 복귀 — 진입·해제가 같은 존의 대칭 토글
 *  - 드래그가 이 영역으로 들어오면 액티베이트(hot) 강조
 *
 * 2026-07: 탭하면 위로 펼쳐지던 휴식 패널(RestZonePanel)은 폐지했다. 휴식자가 보드에서 사라지면
 * 운영진이 "버그로 없어졌다"고 오인해 게스트를 중복 추가하는 사고가 있었다 → 휴식자는 딱지를 달고
 * 제자리에 남고, 이 바는 얇은 드롭존 + 인원 표시만 한다.
 */
export default memo(function RestBar() {
	const restingIds = useSessionStore((s) => s.restingIds);
	const restFieldHot = useBoardStore((s) => s.restFieldHot);
	const restCount = restingIds.length;
	// 드래그 중인 자석이 휴식자면 이 존은 '복귀', 아니면 '휴식'. (restable=편집자의 free/anchor 자석)
	const dragPlayerId = useBoardStore((s) => (s.dragInfo?.restable ? s.dragInfo.playerId : null));
	const draggingResting = useSessionStore(
		(s) => dragPlayerId != null && s.restingIds.includes(dragPlayerId),
	);
	// 드롭존 오버레이(RestDropOverlay)가 이 바 위에 점선 박스+문구로 뜨는 동안엔 바 내용이 겹쳐 보이므로 숨긴다
	// (상단 BoardToolbar의 detach 처리와 대칭).
	const dragging = dragPlayerId != null;

	const bg = restFieldHot ? "rgba(56,189,248,0.22)" : undefined;
	// 드래그 중에는 위에 뜬 RestDropOverlay 점선 박스가 hot 피드백을 전담하므로 바 자체의 top border hot은 끈다.
	const borderTop = dragging || !restFieldHot ? "1px solid transparent" : "1px solid #38BDF8";
	const color = restFieldHot ? "#7DD3FC" : "var(--text-secondary)";
	const label = restFieldHot
		? draggingResting
			? "여기에 놓으면 복귀"
			: "여기에 놓으면 휴식"
		: restCount > 0
			? `휴식 ${restCount}`
			: "휴식";

	return (
		<div
			aria-label={restCount > 0 ? `휴식 ${restCount}명` : "휴식 드롭존"}
			title="자석을 이 아래로 끌어다 놓으면 휴식 · 휴식 자석을 다시 놓으면 복귀"
			className="lq-bar"
			style={{
				position: "absolute",
				left: 0,
				right: 0,
				bottom: 0,
				height: `calc(${COURT_BAR_H}px + env(safe-area-inset-bottom, 0px))`,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				gap: 6,
				padding: "0 12px",
				paddingBottom: "env(safe-area-inset-bottom, 0px)",
				border: "none",
				borderTop,
				background: bg,
				color,
				fontSize: 11,
				fontWeight: 600,
				transition: "background 120ms ease, color 120ms ease",
				zIndex: 10,
			}}
		>
			<span style={{ opacity: dragging ? 0 : 1 }}>{label}</span>
		</div>
	);
});
