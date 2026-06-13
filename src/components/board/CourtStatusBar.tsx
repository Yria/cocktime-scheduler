import { memo } from "react";
import { useSessionStore } from "../../store/sessionStore";
import { COURT_BAR_H } from "../../lib/board/constants";

export default memo(function CourtStatusBar() {
	const courts = useSessionStore((s) => s.courts);

	return (
		<div
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
				gap: 12,
				padding: "0 12px",
				paddingBottom: "env(safe-area-inset-bottom, 0px)",
				zIndex: 10,
			}}
		>
			<span style={{ color: "var(--text-tertiary)", fontSize: 10, fontWeight: 500 }}>
				코트 현황:
			</span>
			{courts.map((court) => {
				const empty = !court.match;
				const dotColor = empty ? "var(--ios-green)" : "var(--ios-orange)";
				const label = empty
					? `${court.id}번 · 비어있음`
					: `${court.id}번 · 경기중`;
				return (
					<span key={court.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
						<span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, display: "inline-block" }} />
						<span style={{ color: empty ? "var(--text-secondary)" : dotColor, fontSize: 10, fontWeight: 500 }}>{label}</span>
					</span>
				);
			})}
		</div>
	);
});
