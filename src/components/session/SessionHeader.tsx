import { useNavigate } from "react-router-dom";

export interface SessionHeaderProps {
	onBack: () => void;
	onEndClick: () => void;
}

export default function SessionHeader({
	onBack,
	onEndClick,
}: SessionHeaderProps) {
	const navigate = useNavigate();

	return (
		<div
			className="flex items-center justify-between px-4 bg-white dark:bg-[#1c1c1e] border-b border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]"
			style={{
				position: "sticky",
				top: 0,
				zIndex: 50,
				height: "calc(60px + env(safe-area-inset-top))",
				paddingTop: "env(safe-area-inset-top)",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<button
					type="button"
					onClick={onBack}
					className="bg-[rgba(241,245,249,1)] dark:bg-[rgba(255,255,255,0.1)] text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
					style={{
						width: 32,
						height: 32,
						borderRadius: "50%",
						border: "none",
						cursor: "pointer",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 20,
						flexShrink: 0,
					}}
				>
					‹
				</button>
				<span
					className="font-bold tracking-tight text-[#0f1724] dark:text-white"
					style={{ fontSize: 18 }}
				>
					콕타임
				</span>
			</div>
			<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
				<button
					type="button"
					onClick={() => navigate("/logs")}
					className="text-[#64748b] dark:text-[rgba(235,235,245,0.5)]"
					style={{
						fontSize: 13,
						fontWeight: 500,
						background: "none",
						border: "none",
						padding: "5px 8px",
						cursor: "pointer",
					}}
				>
					로그
				</button>
				<button
					type="button"
					onClick={onEndClick}
					style={{
						fontSize: 13,
						fontWeight: 500,
						color: "#ef4444",
						background: "none",
						border: "none",
						padding: "5px 8px",
						cursor: "pointer",
					}}
				>
					세션 종료
				</button>
			</div>
		</div>
	);
}
