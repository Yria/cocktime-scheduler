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
			style={{
				background: "#ffffff",
				borderRadius: 12,
				border: "1px solid rgba(0,0,0,0.06)",
				padding: 16,
				marginBottom: 12,
			}}
		>
			<p
				style={{
					fontSize: 11,
					fontWeight: 600,
					color: "#64748b",
					textTransform: "uppercase",
					letterSpacing: "0.06em",
					marginBottom: 12,
				}}
			>
				코트 수
			</p>
			<div
				style={{
					display: "flex",
					gap: 4,
					background: "rgba(241,245,249,1)",
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
						style={{
							flex: 1,
							padding: "8px 0",
							borderRadius: 7,
							fontSize: 14,
							fontWeight: 700,
							border: "none",
							cursor: n < minCourtCount ? "not-allowed" : "pointer",
							transition: "all 0.15s",
							background: courtCount === n ? "#ffffff" : "transparent",
							color: courtCount === n ? "#0b84ff" : "#98a0ab",
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
