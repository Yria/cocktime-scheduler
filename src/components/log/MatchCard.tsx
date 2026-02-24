import type { MatchLogEntry } from "../../lib/supabase/api";
import type { GameType } from "../../types";
import SharedPlayerBadge from "../shared/PlayerBadge";

const GAME_TYPE_CONFIG: Record<GameType, { bg: string; color: string }> = {
	혼복: { bg: "#fce7f3", color: "#9d174d" },
	남복: { bg: "#dbeafe", color: "#1e40af" },
	여복: { bg: "#fee2e2", color: "#991b1b" },
	혼합: { bg: "#f3e8ff", color: "#6b21a8" },
};

function formatTime(iso: string): string {
	const d = new Date(iso);
	const h = d.getHours().toString().padStart(2, "0");
	const m = d.getMinutes().toString().padStart(2, "0");
	return `${h}:${m}`;
}

export default function MatchCard({
	log,
	index,
}: {
	log: MatchLogEntry;
	index: number;
}) {
	const typeConfig = GAME_TYPE_CONFIG[log.gameType];
	return (
		<div
			className="bg-white dark:bg-[#1c1c1e] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]"
			style={{
				borderRadius: 8,
				overflow: "hidden",
			}}
		>
			{/* Header row */}
			<div
				className="bg-[rgba(241,245,249,1)] dark:bg-[rgba(255,255,255,0.06)]"
				style={{
					padding: "12px 16px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<span className="text-[#0f1724] dark:text-white" style={{ fontSize: 14, fontWeight: 600 }}>
						#{index} · {log.courtId}번 코트
					</span>
					<span
						style={{
							fontSize: 12,
							fontWeight: 600,
							background: typeConfig.bg,
							color: typeConfig.color,
							borderRadius: 4,
							padding: "2px 8px",
						}}
					>
						{log.gameType}
					</span>
				</div>
				<span className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]" style={{ fontSize: 12, fontWeight: 500 }}>
					{formatTime(log.startedAt)}
					{log.endedAt ? ` → ${formatTime(log.endedAt)}` : ""}
				</span>
			</div>

			{/* Teams */}
			<div style={{ padding: "16px 28px" }}>
				{/* Team A */}
				<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
					<span
						className="text-[#0f1724] dark:text-white"
						style={{
							fontSize: 14,
							fontWeight: 600,
							width: 32,
							flexShrink: 0,
						}}
					>
						팀 A
					</span>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1 }}>
						{log.teamA.map((p) => (
							<SharedPlayerBadge key={p.name} name={p.name} gender={p.gender} />
						))}
					</div>
				</div>

				{/* VS divider */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						margin: "12px 0",
					}}
				>
					<div className="bg-[rgba(0,0,0,0.08)] dark:bg-[rgba(255,255,255,0.1)]" style={{ flex: 1, height: 1 }} />
					<span
						className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
						style={{
							fontSize: 12,
							fontWeight: 700,
							padding: "0 8px",
						}}
					>
						VS
					</span>
					<div className="bg-[rgba(0,0,0,0.08)] dark:bg-[rgba(255,255,255,0.1)]" style={{ flex: 1, height: 1 }} />
				</div>

				{/* Team B */}
				<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
					<span
						className="text-[#0f1724] dark:text-white"
						style={{
							fontSize: 14,
							fontWeight: 600,
							width: 32,
							flexShrink: 0,
						}}
					>
						팀 B
					</span>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1 }}>
						{log.teamB.map((p) => (
							<SharedPlayerBadge key={p.name} name={p.name} gender={p.gender} />
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
