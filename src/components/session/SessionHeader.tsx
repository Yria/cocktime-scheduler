export interface SessionHeaderProps {
	onBack: () => void;
	onEndClick: () => void;
}

export default function SessionHeader({
	onBack,
	onEndClick,
}: SessionHeaderProps) {
	return (
		<div
			className="flex-shrink-0 flex items-center justify-between px-4"
			style={{
				height: 60,
				background: "#ffffff",
				borderBottom: "0.5px solid rgba(0,0,0,0.08)",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<button
					type="button"
					onClick={onBack}
					style={{
						width: 32,
						height: 32,
						borderRadius: "50%",
						background: "rgba(241,245,249,1)",
						border: "none",
						cursor: "pointer",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 20,
						color: "#64748b",
						flexShrink: 0,
					}}
				>
					‹
				</button>
				<span
					className="font-bold tracking-tight"
					style={{ fontSize: 18, color: "#0f1724" }}
				>
					콕타임
				</span>
			</div>
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
	);
}
