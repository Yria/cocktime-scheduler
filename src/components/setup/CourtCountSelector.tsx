interface Props {
	courtCount: number;
	minCourtCount?: number;
	onChange: (n: number) => void;
}

export function CourtCountSelector({
	courtCount,
	minCourtCount = 0,
	onChange,
}: Props) {
	return (
		<div
			className="bg-white dark:bg-[#1c1c1e] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]"
			style={{
				borderRadius: 12,
				padding: 16,
				marginBottom: 12,
			}}
		>
			<p
				className="text-[#64748b] dark:text-[rgba(235,235,245,0.5)]"
				style={{
					fontSize: 11,
					fontWeight: 600,
					textTransform: "uppercase",
					letterSpacing: "0.06em",
					marginBottom: 12,
				}}
			>
				코트 수
			</p>
			<div
				className="bg-[rgba(241,245,249,1)] dark:bg-[rgba(255,255,255,0.08)]"
				style={{
					display: "flex",
					gap: 4,
					borderRadius: 10,
					padding: 4,
				}}
			>
				{[1, 2, 3, 4, 5, 6].map((n) => (
					<button
						type="button"
						key={n}
						onClick={() => onChange(n)}
						disabled={n < minCourtCount}
						className={
							courtCount === n
								? "bg-white dark:bg-[#2c2c2e] text-[#0b84ff]"
								: "bg-transparent text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
						}
						style={{
							flex: 1,
							padding: "8px 0",
							borderRadius: 7,
							fontSize: 14,
							fontWeight: 700,
							border: "none",
							cursor: n < minCourtCount ? "not-allowed" : "pointer",
							transition: "all 0.15s",
							opacity: n < minCourtCount ? 0.3 : 1,
							boxShadow:
								courtCount === n ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
						}}
					>
						{n}
					</button>
				))}
			</div>
		</div>
	);
}
