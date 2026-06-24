import { memo } from "react";
import { useSessionStore } from "../../store/sessionStore";
import { useBoardStore } from "../../store/boardStore";
import { COURT_BAR_H } from "../../lib/board/constants";

/**
 * 하단 휴식 바 — 이 바 영역이 곧 휴식 드롭존(칠판 밴드 없음).
 *  - 보드 자석을 칠판 하단 경계 너머 이 바까지 끌어내리면 휴식(드롭 감지는 isInRestField: 논리 y ≥ viewH)
 *  - 드래그가 이 영역으로 들어오면 액티베이트(hot) 강조
 *  - 바를 탭하면 휴식 패널이 위로 열림 → 위로 빼면 복귀
 *
 * 미니멀 구성: "휴식 N" + chevron 1개. chevron path는 세로 중앙(y9~15) 대칭이라
 * 펼침/접힘 토글 시 글리프가 위아래로 튀지 않는다.
 */
export default memo(function RestBar() {
	const restingIds = useSessionStore((s) => s.restingIds);
	const restZoneOpen = useBoardStore((s) => s.restZoneOpen);
	const restFieldHot = useBoardStore((s) => s.restFieldHot);
	const toggleRestZone = useBoardStore((s) => s.toggleRestZone);
	const restCount = restingIds.length;
	// 휴식 가능 자석 드래그 중(접힘)에는 이 바 위에 RestDropOverlay(점선 박스+문구)가 뜬다 → 그 hot 반투명 사이로
	// 바 내용(휴식 N·chevron)이 비쳐 보이므로 드래그 동안 숨긴다(상단 BoardToolbar의 detach 처리와 대칭).
	const dragging = useBoardStore((s) => (s.dragInfo?.restable ?? false) && !s.restZoneOpen);

	// 우선순위: hot(드래그 진입) > open(펼침) > 기본
	const bg = restFieldHot ? "rgba(56,189,248,0.22)" : restZoneOpen ? "#334155" : undefined;
	// 드래그 중(접힘)에는 위에 뜬 RestDropOverlay 점선 박스가 hot 피드백을 전담하므로 바 자체의 top border hot은 끈다.
	const borderTop = dragging
		? "1px solid transparent"
		: restFieldHot
			? "1px solid #38BDF8"
			: restZoneOpen
				? "1px solid #94A3B8"
				: "1px solid transparent";
	const color = restFieldHot ? "#7DD3FC" : restZoneOpen ? "#fff" : "var(--text-secondary)";
	const label = restFieldHot ? "여기에 놓기" : restCount > 0 ? `휴식 ${restCount}` : "휴식";

	return (
		<button
			type="button"
			onClick={toggleRestZone}
			aria-label={restZoneOpen ? "휴식 패널 닫기" : "휴식 패널 열기"}
			title="자석을 이 아래로 끌어다 놓으면 휴식 · 탭하면 휴식자 보기"
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
				cursor: "pointer",
				transition: "background 120ms ease, color 120ms ease",
				zIndex: 10,
			}}
		>
			<span style={{ opacity: dragging ? 0 : 1 }}>{label}</span>
			{/* 펼침/접힘 화살표 — y9~15 세로 중앙 대칭이라 토글 시 세로로 안 튐 */}
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.4"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{ display: "block", opacity: dragging ? 0 : 0.9 }}
			>
				<path d={restZoneOpen ? "M6 9l6 6 6-6" : "M18 15l-6-6-6 6"} />
			</svg>
		</button>
	);
});
