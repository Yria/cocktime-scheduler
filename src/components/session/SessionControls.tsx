interface SessionControlsProps {
	onGenerate: () => void;
	canGenerate: boolean;
	onReserveClick: () => void;
	canReserve: boolean;
	waitingCount: number;
}

export default function SessionControls({
	onGenerate,
	canGenerate,
	onReserveClick,
	canReserve,
	waitingCount,
}: SessionControlsProps) {
	return (
		<div
			className="flex-shrink-0"
			style={{
				background: "#ffffff",
				borderTop: "0.5px solid rgba(0,0,0,0.08)",
				padding: "12px 16px",
				paddingBottom: "max(12px, env(safe-area-inset-bottom))",
				display: "flex",
				gap: 12,
			}}
		>
			{/* 예약 생성 */}
			<button
				type="button"
				onClick={onReserveClick}
				disabled={!canReserve}
				style={{
					flex: 1,
					background: canReserve
						? "rgba(241,245,249,1)"
						: "rgba(241,245,249,0.5)",
					color: canReserve ? "#0f1724" : "rgba(15,23,36,0.3)",
					borderRadius: 8,
					padding: "13px 6px",
					fontSize: 15,
					fontWeight: 600,
					border: "none",
					cursor: canReserve ? "pointer" : "not-allowed",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: 8,
				}}
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 20 20"
					fill="none"
					aria-hidden="true"
				>
					<rect
						x="3"
						y="4"
						width="14"
						height="13"
						rx="2"
						stroke="currentColor"
						strokeWidth="1.5"
						fill="none"
					/>
					<line
						x1="3"
						y1="8"
						x2="17"
						y2="8"
						stroke="currentColor"
						strokeWidth="1.5"
					/>
					<line
						x1="7"
						y1="2"
						x2="7"
						y2="6"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
					<line
						x1="13"
						y1="2"
						x2="13"
						y2="6"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
				</svg>
				예약 생성
			</button>

			{/* 팀 자동 생성 */}
			<button
				type="button"
				onClick={onGenerate}
				disabled={!canGenerate}
				style={{
					flex: 2,
					background: canGenerate ? "#0b84ff" : "rgba(11,132,255,0.4)",
					color: "#ffffff",
					borderRadius: 8,
					padding: "14px 6px",
					fontSize: 15,
					fontWeight: 600,
					border: "none",
					cursor: canGenerate ? "pointer" : "not-allowed",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: 8,
				}}
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 20 20"
					fill="none"
					aria-hidden="true"
				>
					<path
						d="M10 2.5L12 7.5H17L13 10.5L14.5 16L10 13L5.5 16L7 10.5L3 7.5H8L10 2.5Z"
						stroke="white"
						strokeWidth="1.5"
						strokeLinejoin="round"
						fill="none"
					/>
				</svg>
				팀 자동 생성
			</button>

			{!canGenerate && waitingCount < 4 && waitingCount > 0 && (
				<p
					style={{
						position: "absolute",
						bottom: "calc(100% + 4px)",
						left: "50%",
						transform: "translateX(-50%)",
						fontSize: 12,
						color: "#64748b",
						whiteSpace: "nowrap",
					}}
				>
					{4 - waitingCount}명 더 필요
				</p>
			)}
		</div>
	);
}
