interface Props {
	courtCount: number;
	onChange: (n: number) => void;
}

export function CourtCountSelector({ courtCount, onChange }: Props) {
	return (
		<div
			className="card-lq"
			style={{
				padding: "10px 16px",
				marginBottom: 12,
				display: "flex",
				alignItems: "center",
				gap: 14,
			}}
		>
			<p
				className="text-muted"
				style={{
					fontSize: 12,
					fontWeight: 600,
					textTransform: "uppercase",
					letterSpacing: "0.06em",
					whiteSpace: "nowrap",
					margin: 0,
				}}
			>
				코트 수
			</p>
			<div
				className="grid grid-cols-4 sm:grid-cols-8 bg-[rgba(241,245,249,1)] dark:bg-[rgba(255,255,255,0.08)]"
				role="group"
				aria-label="코트 수"
				style={{
					gap: 4,
					borderRadius: 10,
					padding: 4,
					flex: 1,
					minWidth: 0,
				}}
			>
				{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
					<button
						type="button"
						key={n}
						aria-pressed={courtCount === n}
						onClick={() => onChange(n)}
						className={
							courtCount === n
								? "bg-white dark:bg-[#2c2c2e] text-[#096cd1] dark:text-[#60a5fa]"
								: "bg-transparent text-[#55627a] dark:text-muted"
						}
						style={{
							minHeight: 44,
							padding: "8px 0",
							borderRadius: 7,
							fontSize: 14,
							fontWeight: 700,
							border: "none",
							cursor: "pointer",
							transition: "all 0.15s",
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
