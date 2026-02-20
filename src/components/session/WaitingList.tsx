import type { GameCountHistory, Player } from "../../types";

interface WaitingListProps {
	waiting: Player[];
	gameCountHistory: GameCountHistory;
	onToggleResting: (playerId: string) => void;
}

function formatPlayer(player: Player) {
	return `${player.gender === "F" ? "🔴" : "🔵"} ${player.name}`;
}

export default function WaitingList({
	waiting,
	gameCountHistory,
	onToggleResting,
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
						<button
							key={p.id}
							type="button"
							onClick={() => onToggleResting(p.id)}
							style={{
								background: "#ffffff",
								border: "1px solid rgba(0,0,0,0.08)",
								borderRadius: 12,
								padding: "8px 12px",
								fontSize: 14,
								fontWeight: 500,
								color: "#0f1724",
								cursor: "pointer",
								display: "flex",
								alignItems: "center",
								gap: 4,
							}}
						>
							{formatPlayer(p)}
							{(gameCountHistory[p.id] ?? 0) > 0 && (
								<span style={{ fontSize: 11, opacity: 0.35, marginLeft: 2 }}>
									{gameCountHistory[p.id]}
								</span>
							)}
						</button>
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
