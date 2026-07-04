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
			className="card-lq"
			style={{
				padding: "10px 16px",
				marginBottom: 12,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
				<p
					className="text-muted"
					style={{
						fontSize: 11,
						fontWeight: 600,
						textTransform: "uppercase",
						letterSpacing: "0.06em",
						margin: 0,
						whiteSpace: "nowrap",
					}}
				>
					남복 편성 허용 여성
				</p>
				{selectedFemales.map((p) => {
					const isOn = singleWomanIds.has(p.id);
					return (
						<button
							type="button"
							key={p.id}
							onClick={() => onToggle(p.id)}
							className={
								isOn
									? "text-strong bg-[rgba(255,149,0,0.07)] dark:bg-[rgba(255,149,0,0.18)]"
									: "text-[#0f1724] dark:text-[rgba(235,235,245,0.9)] bg-[rgba(255,255,255,0.72)] dark:bg-[rgba(255,255,255,0.1)]"
							}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								padding: "4px 10px",
								borderRadius: 12,
								fontSize: 13,
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
