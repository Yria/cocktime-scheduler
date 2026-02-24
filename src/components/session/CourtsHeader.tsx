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
				<div
					style={{
						width: 28,
						height: 28,
						borderRadius: 8,
						background: "rgba(52,199,89,0.1)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						flexShrink: 0,
					}}
				>
					<svg
						width="16"
						height="16"
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
							stroke="#34c759"
							strokeWidth="1.5"
							fill="none"
						/>
						<line
							x1="10"
							y1="2.5"
							x2="10"
							y2="17.5"
							stroke="#34c759"
							strokeWidth="1.5"
						/>
						<line
							x1="2.5"
							y1="10"
							x2="17.5"
							y2="10"
							stroke="#34c759"
							strokeWidth="1.5"
						/>
					</svg>
				</div>
				<span className="text-[#0f1724] dark:text-white" style={{ fontSize: 16, fontWeight: 600 }}>
					코트 현황
				</span>
			</div>
			<div
				className="bg-[rgba(241,245,249,1)] dark:bg-[rgba(255,255,255,0.08)]"
				style={{
					borderRadius: 99,
					padding: "2px 8px",
				}}
			>
				<span className="text-[#0f1724] dark:text-white" style={{ fontSize: 12, fontWeight: 600 }}>
					{courtsCount} Courts
				</span>
			</div>
		</div>
	);
}
