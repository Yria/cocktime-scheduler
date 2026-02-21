import type { MatchLogEntry } from "../../lib/supabase/api";
import type { Gender } from "../../types";

interface Participant {
	name: string;
	gender: Gender;
	game_count: number;
}

interface MatchSummaryProps {
	logs: MatchLogEntry[];
	participants: Participant[];
}

export default function MatchSummary({
	logs,
	participants,
}: MatchSummaryProps) {
	return (
		<div
			className="flex-shrink-0"
			style={{
				background: "#ffffff",
				borderBottom: "0.5px solid rgba(0,0,0,0.06)",
				padding: "12px 16px",
				display: "flex",
				flexDirection: "column",
				gap: 10,
			}}
		>
			{/* Match count */}
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<span style={{ fontSize: 12, color: "#98a0ab", fontWeight: 500 }}>
					총 경기
				</span>
				<span
					style={{
						fontSize: 13,
						fontWeight: 700,
						color: "#0b84ff",
						background: "rgba(11,132,255,0.08)",
						borderRadius: 6,
						padding: "2px 8px",
					}}
				>
					{logs.length}회
				</span>
			</div>

			{/* Participant list */}
			{participants.length > 0 && (
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					<span style={{ fontSize: 12, color: "#98a0ab", fontWeight: 500 }}>
						참가자 {participants.length}명
					</span>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
						{participants.map((p) => (
							<div
								key={p.name}
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 5,
									padding: "4px 8px 4px 10px",
									background: p.gender === "F" ? "#fee2e2" : "#e0f2fe",
									borderRadius: 14,
									fontSize: 13,
									color: p.gender === "F" ? "#991b1b" : "#075985",
									fontWeight: 600,
								}}
							>
								<span
									style={{
										width: 7,
										height: 7,
										borderRadius: "50%",
										background: p.gender === "F" ? "#ff2d55" : "#007aff",
										flexShrink: 0,
										display: "inline-block",
									}}
								/>
								{p.name}
								<span
									style={{
										marginLeft: 2,
										fontSize: 11,
										fontWeight: 700,
										color: p.gender === "F" ? "#be123c" : "#0369a1",
										background:
											p.gender === "F"
												? "rgba(190,18,60,0.1)"
												: "rgba(3,105,161,0.1)",
										borderRadius: 8,
										padding: "1px 5px",
									}}
								>
									{p.game_count}
								</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
