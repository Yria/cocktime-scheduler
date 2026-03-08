import { memo } from "react";
import type { GeneratedTeam, SessionPlayer } from "../../types";
import PlayerBadge from "../shared/PlayerBadge";
import { skillScore } from "../../lib/teamGenerator";

const GAME_TYPE_COLOR: Record<string, { bg: string; text: string }> = {
	혼복: { bg: "rgba(175,82,222,0.1)", text: "#af52de" },
	남복: { bg: "rgba(0,122,255,0.1)", text: "#007aff" },
	여복: { bg: "rgba(255,45,85,0.1)", text: "#ff2d55" },
	혼합: { bg: "rgba(255,149,0,0.1)", text: "#ff9500" },
};

interface TeamCandidateCardProps {
	team: GeneratedTeam;
	index: number;
	emptyCourtId: number | null;
	onAssign: (index: number, courtId: number) => void;
	onPlayerClick: (index: number, player: SessionPlayer, e: React.MouseEvent) => void;
}

const TeamCandidateCard = memo(function TeamCandidateCard({
	team,
	index,
	emptyCourtId,
	onAssign,
	onPlayerClick,
}: TeamCandidateCardProps) {
	const gameTypeStyle = GAME_TYPE_COLOR[team.gameType];

	const renderPlayer = (player: SessionPlayer) => (
		<div
			key={player.id}
			onClick={(e) => onPlayerClick(index, player, e)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onPlayerClick(index, player, e as any);
				}
			}}
			role="button"
			tabIndex={0}
			style={{ cursor: "pointer" }}
		>
			<PlayerBadge
				name={player.name}
				gender={player.gender}
				skillScore={skillScore(player)}
			/>
		</div>
	);

	return (
		<div>
			<div
				style={{
					borderRadius: 8,
					border: "1px solid rgba(0,122,255,0.2)",
					overflow: "hidden",
				}}
			>
				{/* Team info row */}
				<div style={{ padding: "8px 12px" }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							marginBottom: 6,
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
							<span
								className="text-[#0f1724] dark:text-white"
								style={{ fontSize: 13, fontWeight: 600 }}
							>
								팀 {index + 1}
							</span>
							{team.reason && (
								<span
									className="text-[#6b7280] dark:text-[rgba(235,235,245,0.5)]"
									style={{ fontSize: 10, fontWeight: 500 }}
								>
									{team.reason}
								</span>
							)}
						</div>
						<span
							style={{
								fontSize: 10,
								fontWeight: 600,
								color: gameTypeStyle.text,
								background: gameTypeStyle.bg,
								borderRadius: 3,
								padding: "1px 6px",
							}}
						>
							{team.gameType}
						</span>
					</div>

					{/* Teams in one row */}
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
						<div style={{ display: "flex", gap: 3 }}>
							{team.teamA.map(renderPlayer)}
						</div>

						<span
							style={{
								fontSize: 8,
								fontWeight: 700,
								color: "var(--text-secondary)",
								background: "var(--mat-ultra-thin)",
								borderRadius: 99,
								padding: "1px 5px",
								flexShrink: 0,
								margin: "0 6px",
							}}
						>
							VS
						</span>

						<div style={{ display: "flex", gap: 3 }}>
							{team.teamB.map(renderPlayer)}
						</div>
					</div>
				</div>

				{/* Assign button */}
				{emptyCourtId != null && (
					<div
						style={{
							padding: "0 12px 8px 12px",
							borderTop: "1px solid rgba(0,0,0,0.06)",
							paddingTop: 8,
						}}
					>
						<button
							type="button"
							onClick={() => onAssign(index, emptyCourtId)}
							style={{
								width: "100%",
								padding: "6px 10px",
								borderRadius: 5,
								fontSize: 11,
								fontWeight: 600,
								border: "none",
								cursor: "pointer",
								background: "#34c759",
								color: "#fff",
							}}
						>
							배정
						</button>
					</div>
				)}
			</div>
		</div>
	);
});

export default TeamCandidateCard;
