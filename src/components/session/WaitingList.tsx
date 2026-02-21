import type { SessionPlayer } from "../../types";

interface WaitingListProps {
	waiting: SessionPlayer[];
	onToggleResting: (playerId: string) => void;
	onToggleForceMixed: (playerId: string) => void;
}

export default function WaitingList({
	waiting,
	onToggleResting,
	onToggleForceMixed,
}: WaitingListProps) {
	return (
		<div>
			{/* Section header */}
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
						<circle cx="7" cy="6" r="2.5" stroke="#0f1724" strokeWidth="1.5" />
						<circle cx="13" cy="6" r="2.5" stroke="#0f1724" strokeWidth="1.5" />
						<path
							d="M2 17c0-3 2.2-4.5 5-4.5h6c2.8 0 5 1.5 5 4.5"
							stroke="#0f1724"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
					<span style={{ fontSize: 16, fontWeight: 600, color: "#0f1724" }}>
						대기 명단
					</span>
				</div>
				<span
					style={{
						fontSize: 12,
						fontWeight: 600,
						color: "#9a3412",
						background: "rgba(255,247,237,1)",
						borderRadius: 99,
						padding: "2px 8px",
					}}
				>
					{waiting.length}명
				</span>
			</div>

			{/* Player chips */}
			{waiting.length === 0 ? (
				<p style={{ padding: "0 16px 16px", fontSize: 14, color: "#98a0ab" }}>
					대기 중인 선수가 없습니다
				</p>
			) : (
				<div
					style={{
						padding: "0 16px 16px",
						display: "flex",
						flexWrap: "wrap",
						gap: 8,
					}}
				>
					{waiting.map((p) => (
						<div
							key={p.id}
							style={{
								display: "flex",
								alignItems: "center",
								background: p.forceMixed ? "rgba(255,45,85,0.06)" : "#ffffff",
								border: p.forceMixed
									? "1px solid rgba(255,45,85,0.3)"
									: "1px solid rgba(0,0,0,0.08)",
								borderRadius: 12,
								overflow: "hidden",
							}}
						>
							{/* 이름 + 게임수: 누르면 휴식 전환 */}
							<button
								type="button"
								onClick={() => onToggleResting(p.id)}
								style={{
									padding: "8px 10px",
									fontSize: 14,
									fontWeight: 500,
									color: "#0f1724",
									cursor: "pointer",
									background: "none",
									border: "none",
									display: "flex",
									alignItems: "center",
									gap: 4,
								}}
							>
								{p.gender === "F" ? "🔴" : "🔵"} {p.name}
								{p.gameCount > 0 && (
									<span style={{ fontSize: 11, opacity: 0.35, marginLeft: 2 }}>
										{p.gameCount}
									</span>
								)}
							</button>

							{/* 혼복 우선배치 토글 버튼 */}
							<button
								type="button"
								onClick={() => onToggleForceMixed(p.id)}
								title={p.forceMixed ? "혼복 우선배치 해제" : "혼복 우선배치 지정"}
								style={{
									padding: "8px 8px 8px 4px",
									fontSize: 12,
									cursor: "pointer",
									background: "none",
									border: "none",
									color: p.forceMixed ? "#ff2d55" : "#c0c8d0",
									fontWeight: 700,
									lineHeight: 1,
								}}
							>
								{p.forceMixed ? "★" : "☆"}
							</button>
						</div>
					))}
				</div>
			)}

			{waiting.length > 0 && waiting.length < 4 && (
				<p
					style={{
						padding: "0 16px 12px",
						fontSize: 12,
						fontWeight: 500,
						color: "#ef4444",
					}}
				>
					{4 - waiting.length}명 더 필요
				</p>
			)}
		</div>
	);
}
