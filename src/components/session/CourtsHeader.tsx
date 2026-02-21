interface Props {
	courtsCount: number;
}

export default function CourtsHeader({ courtsCount }: Props) {
	return (
		<div
			style={{
				padding: "24px 16px 12px 16px",
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<svg
					width="20"
					height="20"
					viewBox="0 0 20 20"
					fill="none"
					aria-hidden="true"
				>
					<rect
						x="2.5"
						y="2.5"
						width="15"
						height="15"
						rx="2"
						stroke="#0f1724"
						strokeWidth="1.5"
						fill="none"
					/>
					<line
						x1="10"
						y1="2.5"
						x2="10"
						y2="17.5"
						stroke="#0f1724"
						strokeWidth="1.5"
					/>
					<line
						x1="2.5"
						y1="10"
						x2="17.5"
						y2="10"
						stroke="#0f1724"
						strokeWidth="1.5"
					/>
				</svg>
				<span style={{ fontSize: 16, fontWeight: 600, color: "#0f1724" }}>
					코트 현황
				</span>
			</div>
			<div
				style={{
					background: "rgba(241,245,249,1)",
					borderRadius: 99,
					padding: "2px 8px",
				}}
			>
				<span style={{ fontSize: 12, fontWeight: 600, color: "#0f1724" }}>
					{courtsCount} Courts
				</span>
			</div>
		</div>
	);
}
