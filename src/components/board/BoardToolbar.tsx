import { memo, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import ModalSheet from "../common/ModalSheet";
import { useSessionStore } from "../../store/sessionStore";
import { TOOLBAR_H } from "../../lib/board/constants";

export { TOOLBAR_H };

const iconBtn = (color: string): React.CSSProperties => ({
	display: "inline-flex",
	alignItems: "center",
	gap: 4,
	padding: "6px 8px",
	borderRadius: 8,
	border: "none",
	background: "transparent",
	color,
	fontSize: 13,
	fontWeight: 500,
	cursor: "pointer",
});

const BoardToolbar = memo(function BoardToolbar() {
	const navigate = useNavigate();
	const handleEndSession = useSessionStore((s) => s.handleEndSession);
	const [confirmEnd, setConfirmEnd] = useState(false);

	const onConfirmEnd = useCallback(() => {
		setConfirmEnd(false);
		handleEndSession(() => navigate("/"));
	}, [handleEndSession, navigate]);

	return (
		<>
			<div
				className="lq-header"
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					height: `calc(${TOOLBAR_H}px + env(safe-area-inset-top))`,
					display: "flex",
					alignItems: "center",
					padding: "env(safe-area-inset-top) 8px 0",
					zIndex: 10,
				}}
			>
				<button
					type="button"
					onClick={() => navigate("/setup")}
					aria-label="세션 설정"
					style={iconBtn("var(--text-secondary)")}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
					<span>설정</span>
				</button>

				<div style={{ flex: 1 }} />

				<button
					type="button"
					onClick={() => navigate("/logs")}
					aria-label="로그"
					style={iconBtn("var(--text-secondary)")}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
						<polyline points="14 2 14 8 20 8" />
						<line x1="8" y1="13" x2="16" y2="13" />
						<line x1="8" y1="17" x2="13" y2="17" />
					</svg>
					<span>로그</span>
				</button>

				<button
					type="button"
					onClick={() => setConfirmEnd(true)}
					aria-label="세션 종료"
					style={iconBtn("var(--ios-red)")}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
						<polyline points="16 17 21 12 16 7" />
						<line x1="21" y1="12" x2="9" y2="12" />
					</svg>
					<span>종료</span>
				</button>
			</div>

			{confirmEnd && (
				<ModalSheet position="center" className="p-6" onClose={() => setConfirmEnd(false)}>
					<h3 className="font-bold text-gray-800 dark:text-white text-lg mb-1.5">
						세션 종료
					</h3>
					<p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
						진행 중인 세션을 종료합니다. 모든 참가자의 세션이 종료됩니다.
					</p>
					<div className="flex gap-3">
						<button
							type="button"
							onClick={() => setConfirmEnd(false)}
							className="btn-lq-secondary flex-1 py-3 text-sm"
						>
							취소
						</button>
						<button
							type="button"
							onClick={onConfirmEnd}
							className="btn-lq-red flex-1 py-3 text-sm"
						>
							종료
						</button>
					</div>
				</ModalSheet>
			)}
		</>
	);
});

export default BoardToolbar;
