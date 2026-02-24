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
					marginBottom: 2,
				}}
			>
				혼복 허용 여성
			</p>
			<p className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]" style={{ fontSize: 12, marginBottom: 12 }}>
				남3여1 구성에서 1인 배치 허용
			</p>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
				{selectedFemales.map((p) => {
					const isOn = singleWomanIds.has(p.id);
					return (
						<button
							type="button"
							key={p.id}
							onClick={() => onToggle(p.id)}
							className={
								isOn
									? "text-[#0f1724] dark:text-white bg-[rgba(255,149,0,0.07)] dark:bg-[rgba(255,149,0,0.18)]"
									: "text-[#0f1724] dark:text-[rgba(235,235,245,0.9)] bg-[rgba(255,255,255,0.72)] dark:bg-[rgba(255,255,255,0.1)]"
							}
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
								...(isOn
									? {
											borderColor: "rgba(255,149,0,0.35)",
											boxShadow: "0 2px 8px rgba(255,149,0,0.1)",
										}
									: {
											backdropFilter: "blur(12px)",
											WebkitBackdropFilter: "blur(12px)",
											borderColor: "rgba(0,0,0,0.06)",
											boxShadow:
												"0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
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
					);
				})}
			</div>
		</div>
	);
}
