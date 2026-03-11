import { memo, useState } from "react";
import type { Court, GeneratedTeam, PairHistory, SessionPlayer } from "../../types";
import PlayerReplaceDialog from "../PlayerReplaceDialog";
import TeamCandidateCard from "./TeamCandidateCard";

interface TeamCandidatesListProps {
	candidates: GeneratedTeam[];
	courts: Court[];
	waiting: SessionPlayer[];
	waitingCount: number;
	unavailableIds: Set<string>;
	pairHistory: PairHistory;
	onAssign: (candidateIndex: number, courtId: number) => void;
	onQueue: (candidateIndex: number) => void;
	onPlayerReplace: (candidateIndex: number, oldPlayer: SessionPlayer, newPlayer: SessionPlayer) => void;
	onRefresh: () => void;
}

const TeamCandidatesList = memo(function TeamCandidatesList({
	candidates,
	courts,
	waiting,
	waitingCount,
	unavailableIds,
	pairHistory,
	onAssign,
	onQueue,
	onPlayerReplace,
	onRefresh,
}: TeamCandidatesListProps) {
	const [replacingPlayer, setReplacingPlayer] = useState<{ candidateIndex: number; player: SessionPlayer } | null>(null);

	const handlePlayerClick = (candidateIndex: number, player: SessionPlayer, e: React.MouseEvent) => {
		e.stopPropagation();
		setReplacingPlayer({ candidateIndex, player });
	};

	const handleReplace = (newPlayer: SessionPlayer) => {
		if (replacingPlayer) {
			onPlayerReplace(replacingPlayer.candidateIndex, replacingPlayer.player, newPlayer);
			setReplacingPlayer(null);
		}
	};

	const getAvailablePlayers = (candidateIndex: number): SessionPlayer[] => {
		const team = candidates[candidateIndex];
		const teamPlayerIds = new Set([
			...team.teamA.map((p) => p.id),
			...team.teamB.map((p) => p.id),
		]);
		return waiting.filter((p) => !teamPlayerIds.has(p.id));
	};

	const getPlayerTeams = (candidateIndex: number, player: SessionPlayer) => {
		const team = candidates[candidateIndex];
		const isInTeamA = team.teamA.some((p) => p.id === player.id);

		return {
			currentTeam: isInTeamA ? team.teamA : team.teamB,
			opponentTeam: isInTeamA ? team.teamB : team.teamA,
		};
	};

	const getEmptyCourt = (): number | null => {
		const empty = courts.find((c) => !c.match);
		return empty ? empty.id : null;
	};

	const emptyCourtId = getEmptyCourt();


	return (
		<>
			<div>
				{/* Section header */}
				<div
					style={{
						padding: "16px 16px 10px 16px",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<div
							style={{
								width: 24,
								height: 24,
								borderRadius: 6,
								background: "rgba(11,132,255,0.1)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								flexShrink: 0,
							}}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 20 20"
								fill="none"
								aria-hidden="true"
							>
								<path
									d="M10 2.5L12 7.5H17L13 10.5L14.5 16L10 13L5.5 16L7 10.5L3 7.5H8L10 2.5Z"
									stroke="#0b84ff"
									strokeWidth="1.5"
									strokeLinejoin="round"
									fill="none"
								/>
							</svg>
						</div>
						<span className="text-[#0f1724] dark:text-white" style={{ fontSize: 15, fontWeight: 600 }}>
							팀 매칭
						</span>
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
						<span
							style={{
								fontSize: 11,
								fontWeight: 600,
								color: "#0b84ff",
								background: "rgba(11,132,255,0.1)",
								borderRadius: 99,
								padding: "2px 7px",
							}}
						>
							{candidates.length}팀
						</span>
						<button
							type="button"
							onClick={onRefresh}
							style={{
								width: 24,
								height: 24,
								borderRadius: 6,
								background: "rgba(11,132,255,0.1)",
								border: "none",
								cursor: "pointer",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								padding: 0,
								flexShrink: 0,
							}}
							title="팀 매칭 새로고침"
						>
							<svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
								<path
									d="M3.5 10a6.5 6.5 0 0 1 11.25-4.5M16.5 10a6.5 6.5 0 0 1-11.25 4.5"
									stroke="#0b84ff"
									strokeWidth="1.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
								<path
									d="M14.5 2v3.5H11M5.5 18v-3.5H9"
									stroke="#0b84ff"
									strokeWidth="1.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
						</button>
					</div>
				</div>

				{candidates.length > 0 ? (
					<div
						style={{
							padding: "0 16px",
							display: "flex",
							flexDirection: "column",
							gap: 6,
						}}
					>
						{candidates.map((team, index) => (
							<TeamCandidateCard
								key={index}
								team={team}
								index={index}
								emptyCourtId={emptyCourtId}
								unavailableIds={unavailableIds}
								onAssign={onAssign}
								onQueue={onQueue}
								onPlayerClick={handlePlayerClick}
							/>
						))}
					</div>
				) : waitingCount > 0 && waitingCount < 4 ? (
					<p
						style={{
							margin: "0 16px 12px",
							padding: "6px 11px",
							fontSize: 12,
							fontWeight: 600,
							color: "#ff3b30",
							background: "rgba(255,59,48,0.07)",
							borderRadius: 10,
						}}
					>
						{4 - waitingCount}명 더 필요
					</p>
				) : null}
			</div>

			{replacingPlayer && (() => {
				const { currentTeam, opponentTeam } = getPlayerTeams(
					replacingPlayer.candidateIndex,
					replacingPlayer.player
				);
				return (
					<PlayerReplaceDialog
						selectedPlayer={replacingPlayer.player}
						currentTeam={currentTeam}
						opponentTeam={opponentTeam}
						availablePlayers={getAvailablePlayers(replacingPlayer.candidateIndex)}
						pairHistory={pairHistory}
						onReplace={handleReplace}
						onCancel={() => setReplacingPlayer(null)}
					/>
				);
			})()}
		</>
	);
});

export default TeamCandidatesList;
