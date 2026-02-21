import type { Player } from "../../types";

interface Props {
	selectedFemales: Player[];
	singleWomanIds: Set<string>;
	onToggle: (id: string) => void;
}

export function SingleWomanSelector({
	selectedFemales,
	singleWomanIds,
	onToggle,
}: Props) {
	if (selectedFemales.length === 0) return null;

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
					marginBottom: 2,
				}}
			>
				혼복 허용 여성
			</p>
			<p style={{ fontSize: 12, color: "#98a0ab", marginBottom: 12 }}>
				남3여1 구성에서 1인 배치 허용
			</p>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
				{selectedFemales.map((p) => (
					<button
						type="button"
						key={p.id}
						onClick={() => onToggle(p.id)}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							padding: "6px 12px",
							borderRadius: 14,
							fontSize: 14,
							fontWeight: 500,
							border: "1px solid",
							cursor: "pointer",
							transition: "all 0.15s",
							...(singleWomanIds.has(p.id)
								? {
										background: "rgba(255,149,0,0.07)",
										borderColor: "rgba(255,149,0,0.35)",
										color: "#0f1724",
										boxShadow: "0 2px 8px rgba(255,149,0,0.1)",
									}
								: {
										background: "rgba(255,255,255,0.72)",
										backdropFilter: "blur(12px)",
										WebkitBackdropFilter: "blur(12px)",
										borderColor: "rgba(0,0,0,0.06)",
										boxShadow:
											"0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
										color: "#0f1724",
									}),
						}}
					>
						<span
							style={{
								width: 7,
								height: 7,
								borderRadius: "50%",
								background: "#ff2d55",
								flexShrink: 0,
								display: "inline-block",
							}}
						/>
						{p.name}
					</button>
				))}
			</div>
		</div>
	);
}
