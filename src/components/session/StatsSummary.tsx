interface Props {
	totalCount: number;
	waitingCount: number;
	playingCount: number;
	restingCount: number;
}

export default function StatsSummary({
	totalCount,
	waitingCount,
	playingCount,
	restingCount,
}: Props) {
	return (
		<div
			className="flex-shrink-0 flex gap-3 overflow-x-auto no-sb"
			style={{
				background: "#ffffff",
				borderBottom: "0.5px solid rgba(0,0,0,0.06)",
				padding: "12px 16px",
			}}
		>
			<div
				style={{
					background: "#fff",
					border: "1px solid rgba(0,0,0,0.08)",
					borderRadius: 12,
					padding: "5px 12px",
					display: "flex",
					gap: 6,
					flexShrink: 0,
				}}
			>
				<span style={{ fontSize: 13, fontWeight: 500, color: "#0f1724" }}>
					전체
				</span>
				<span style={{ fontSize: 13, fontWeight: 700, color: "#0b84ff" }}>
					{totalCount}
				</span>
			</div>
			<div
				style={{
					background: "rgba(255,247,237,1)",
					borderRadius: 12,
					padding: "5px 12px",
					display: "flex",
					gap: 6,
					flexShrink: 0,
				}}
			>
				<span style={{ fontSize: 13, fontWeight: 500, color: "#9a3412" }}>
					대기
				</span>
				<span style={{ fontSize: 13, fontWeight: 700, color: "#9a3412" }}>
					{waitingCount}
				</span>
			</div>
			<div
				style={{
					background: "rgba(220,252,231,1)",
					borderRadius: 12,
					padding: "5px 12px",
					display: "flex",
					gap: 6,
					flexShrink: 0,
				}}
			>
				<span style={{ fontSize: 13, fontWeight: 500, color: "#166534" }}>
					경기중
				</span>
				<span style={{ fontSize: 13, fontWeight: 700, color: "#166534" }}>
					{playingCount}
				</span>
			</div>
			<div
				style={{
					background: "rgba(241,245,249,1)",
					borderRadius: 12,
					padding: "5px 12px",
					display: "flex",
					gap: 6,
					flexShrink: 0,
				}}
			>
				<span style={{ fontSize: 13, fontWeight: 500, color: "#64748b" }}>
					휴식
				</span>
				<span style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>
					{restingCount}
				</span>
			</div>
		</div>
	);
}
