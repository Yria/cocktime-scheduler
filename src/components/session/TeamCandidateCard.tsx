import { memo } from "react";
import type { GeneratedTeam, SessionPlayer } from "../../types";
import { skillScore } from "../../lib/teamSelection";
import MatchPreview, { type MatchPreviewPlayer } from "../shared/MatchPreview";

const GAME_TYPE_COLOR: Record<string, { bg: string; text: string }> = {
	혼복: { bg: "rgba(175,82,222,0.1)", text: "#af52de" },
	남복: { bg: "rgba(0,122,255,0.1)", text: "#007aff" },
	여복: { bg: "rgba(255,45,85,0.1)", text: "#ff2d55" },
	혼합: { bg: "rgba(255,149,0,0.1)", text: "#ff9500" },
};

interface TeamCandidateCardProps {
	team: GeneratedTeam;
	index: number;
	displayNumber: number;
	reasons: string[];
	emptyCourtId: number | null;
	unavailableIds: Set<string>;
	sessionPlayers: Map<string, SessionPlayer>;
	onAssign: (index: number, courtId: number) => void;
	onQueue: (index: number) => void;
	onPlayerClick: (index: number, player: SessionPlayer, e: React.MouseEvent | React.KeyboardEvent) => void;
}

const TeamCandidateCard = memo(function TeamCandidateCard({
	team,
	index,
	displayNumber,
	reasons,
	emptyCourtId,
	unavailableIds,
	sessionPlayers,
	onAssign,
	onQueue,
	onPlayerClick,
}: TeamCandidateCardProps) {
	const gameTypeStyle = GAME_TYPE_COLOR[team.gameType];
	const allIds = [...team.teamA, ...team.teamB];
	const hasUnavailable = allIds.some((id) => unavailableIds.has(id));

	const toSlot = (id: string): MatchPreviewPlayer | null => {
		const player = sessionPlayers.get(id);
		if (!player) return null;
		return {
			id: player.id,
			name: player.name,
			gender: player.gender,
			skillScore: skillScore(player),
			disabled: unavailableIds.has(player.id),
			onClick: (e) => onPlayerClick(index, player, e),
		};
	};

	return (
		<div>
			<div
				style={{
					borderRadius: 8,
					border: hasUnavailable
						? "1px solid rgba(142,142,147,0.2)"
						: "1px solid rgba(0,122,255,0.2)",
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
						<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
							<span
								className="text-[#0f1724] dark:text-white"
								style={{ fontSize: 13, fontWeight: 600 }}
							>
								팀 {displayNumber}
							</span>
							{reasons.map((r) => (
								<span
									key={r}
									className="text-[#6b7280] dark:text-[rgba(235,235,245,0.5)]"
									style={{
										fontSize: 9,
										fontWeight: 600,
										background: "rgba(142,142,147,0.1)",
										borderRadius: 3,
										padding: "1px 5px",
									}}
								>
									{r}
								</span>
							))}
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
							{hasUnavailable && (
								<span
									style={{
										fontSize: 9,
										fontWeight: 600,
										color: "#8e8e93",
										background: "rgba(142,142,147,0.1)",
										borderRadius: 3,
										padding: "1px 5px",
									}}
								>
									경기중 포함
								</span>
							)}
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
					</div>

					{/* Teams in one row */}
					<MatchPreview
						left={team.teamA.map(toSlot)}
						right={team.teamB.map(toSlot)}
						size="sm"
					/>
				</div>

				{/* Assign / Queue buttons */}
				<div
					style={{
						padding: "0 12px 8px 12px",
						borderTop: "1px solid rgba(0,0,0,0.06)",
						paddingTop: 8,
					}}
				>
					{!hasUnavailable && emptyCourtId != null ? (
						<div style={{ display: "flex", gap: 6 }}>
							<button
								type="button"
								onClick={() => onAssign(index, emptyCourtId)}
								style={{
									flex: 1,
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
							<button
								type="button"
								onClick={() => onQueue(index)}
								style={{
									flex: 1,
									padding: "6px 10px",
									borderRadius: 5,
									fontSize: 11,
									fontWeight: 600,
									border: "none",
									cursor: "pointer",
									background: "#ff9500",
									color: "#fff",
								}}
							>
								대기열 추가
							</button>
						</div>
					) : (
						<button
							type="button"
							onClick={() => onQueue(index)}
							style={{
								width: "100%",
								padding: "6px 10px",
								borderRadius: 5,
								fontSize: 11,
								fontWeight: 600,
								border: "none",
								cursor: "pointer",
								background: "#ff9500",
								color: "#fff",
							}}
						>
							대기열 추가
						</button>
					)}
				</div>
			</div>
		</div>
	);
});

export default TeamCandidateCard;
