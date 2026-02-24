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
			className="flex-shrink-0 flex gap-3 overflow-x-auto no-sb bg-white dark:bg-[#1c1c1e] border-b border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]"
			style={{ padding: "12px 16px" }}
		>
			<div
				className="bg-white dark:bg-[rgba(255,255,255,0.08)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]"
				style={{
					borderRadius: 12,
					padding: "5px 12px",
					display: "flex",
					gap: 6,
					flexShrink: 0,
				}}
			>
				<span className="text-[#0f1724] dark:text-white" style={{ fontSize: 13, fontWeight: 500 }}>
					전체
				</span>
				<span style={{ fontSize: 13, fontWeight: 700, color: "#0b84ff" }}>
					{totalCount}
				</span>
			</div>
			<div
				className="bg-[rgba(255,247,237,1)] dark:bg-[rgba(255,149,0,0.15)]"
				style={{
					borderRadius: 12,
					padding: "5px 12px",
					display: "flex",
					gap: 6,
					flexShrink: 0,
				}}
			>
				<span className="text-[#9a3412] dark:text-[#ff9f0a]" style={{ fontSize: 13, fontWeight: 500 }}>
					대기
				</span>
				<span className="text-[#9a3412] dark:text-[#ff9f0a]" style={{ fontSize: 13, fontWeight: 700 }}>
					{waitingCount}
				</span>
			</div>
			<div
				className="bg-[rgba(220,252,231,1)] dark:bg-[rgba(48,209,88,0.15)]"
				style={{
					borderRadius: 12,
					padding: "5px 12px",
					display: "flex",
					gap: 6,
					flexShrink: 0,
				}}
			>
				<span className="text-[#166534] dark:text-[#30d158]" style={{ fontSize: 13, fontWeight: 500 }}>
					경기중
				</span>
				<span className="text-[#166534] dark:text-[#30d158]" style={{ fontSize: 13, fontWeight: 700 }}>
					{playingCount}
				</span>
			</div>
			<div
				className="bg-[rgba(241,245,249,1)] dark:bg-[rgba(255,255,255,0.08)]"
				style={{
					borderRadius: 12,
					padding: "5px 12px",
					display: "flex",
					gap: 6,
					flexShrink: 0,
				}}
			>
				<span className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]" style={{ fontSize: 13, fontWeight: 500 }}>
					휴식
				</span>
				<span className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]" style={{ fontSize: 13, fontWeight: 700 }}>
					{restingCount}
				</span>
			</div>
		</div>
	);
}
