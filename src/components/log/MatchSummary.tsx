import type { MatchLogEntry } from "../../lib/supabase/api";
import type { Gender, PlayerSkills } from "../../types";
import PlayerBadge from "../shared/PlayerBadge";

interface Participant {
	name: string;
	gender: Gender;
	game_count: number;
	skills: PlayerSkills;
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
			className="flex-shrink-0 bg-white dark:bg-[#1c1c1e] border-b border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]"
			style={{
				padding: "12px 16px",
				display: "flex",
				flexDirection: "column",
				gap: 10,
			}}
		>
			{/* Match count */}
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<span className="text-faint" style={{ fontSize: 12, fontWeight: 500 }}>
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
					<span className="text-faint" style={{ fontSize: 12, fontWeight: 500 }}>
						참가자 {participants.length}명
					</span>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
						{participants.map((p) => (
							<PlayerBadge
								key={p.name}
								name={p.name}
								gender={p.gender}
								count={p.game_count}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
