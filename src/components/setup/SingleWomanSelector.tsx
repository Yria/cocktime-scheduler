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
							padding: "6px 12px",
							borderRadius: 99,
							fontSize: 14,
							fontWeight: 500,
							border: "none",
							cursor: "pointer",
							transition: "all 0.15s",
							...(singleWomanIds.has(p.id)
								? {
										background: "rgba(255,45,135,0.1)",
										color: "#e8207a",
										boxShadow: "0 2px 8px rgba(255,45,135,0.15)",
									}
								: {
										background: "rgba(241,245,249,1)",
										color: "#64748b",
									}),
						}}
					>
						{singleWomanIds.has(p.id) ? "🔴" : "○"} {p.name}
					</button>
				))}
			</div>
		</div>
	);
}
