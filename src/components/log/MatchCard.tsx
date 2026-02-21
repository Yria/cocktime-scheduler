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
			style={{
				background: "#ffffff",
				borderRadius: 8,
				border: "1px solid rgba(0,0,0,0.06)",
				overflow: "hidden",
			}}
		>
			{/* Header row */}
			<div
				style={{
					background: "rgba(241,245,249,1)",
					padding: "12px 16px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<span style={{ fontSize: 14, fontWeight: 600, color: "#0f1724" }}>
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
				<span style={{ fontSize: 12, color: "#98a0ab", fontWeight: 500 }}>
					{formatTime(log.startedAt)}
					{log.endedAt ? ` → ${formatTime(log.endedAt)}` : ""}
				</span>
			</div>

			{/* Teams */}
			<div style={{ padding: "16px 28px" }}>
				{/* Team A */}
				<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
					<span
						style={{
							fontSize: 14,
							fontWeight: 600,
							color: "#0f1724",
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
					<div
						style={{
							flex: 1,
							height: 1,
							background: "rgba(0,0,0,0.08)",
						}}
					/>
					<span
						style={{
							fontSize: 12,
							fontWeight: 700,
							color: "#98a0ab",
							padding: "0 8px",
						}}
					>
						VS
					</span>
					<div
						style={{
							flex: 1,
							height: 1,
							background: "rgba(0,0,0,0.08)",
						}}
					/>
				</div>

				{/* Team B */}
				<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
					<span
						style={{
							fontSize: 14,
							fontWeight: 600,
							color: "#0f1724",
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
