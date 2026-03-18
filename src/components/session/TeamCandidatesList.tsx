import { memo, useState } from "react";
import type { Court, GeneratedTeam, PairHistory, SessionPlayer, TeamStrategy } from "../../types";
import PlayerReplaceDialog from "../PlayerReplaceDialog";
import ManualMatchDialog from "./ManualMatchDialog";
import TeamCandidateCard from "./TeamCandidateCard";

const STRATEGY_OPTIONS: { value: TeamStrategy | null; label: string }[] = [
	{ value: null, label: "전체" },
	{ value: "gameCountBalanced", label: "경기수 균등" },
	{ value: "coPlayerAvoidance", label: "동반자 회피" },
	{ value: "newCombination", label: "새 조합" },
	{ value: "mixedCountBalanced", label: "혼복 우선" },
	{ value: "skillBalanced", label: "실력 균형" },
	{ value: "randomShuffle", label: "랜덤" },
];

interface TeamCandidatesListProps {
	candidates: GeneratedTeam[];
	courts: Court[];
	waiting: SessionPlayer[];
	waitingCount: number;
	unavailableIds: Set<string>;
	pairHistory: PairHistory;
	playingPlayers?: SessionPlayer[];
	singleWomanIds: string[];
	strategyFilter: TeamStrategy | null;
	onStrategyChange: (strategy: TeamStrategy | null) => void;
	onAssign: (candidateIndex: number, courtId: number) => void;
	onQueue: (candidateIndex: number) => void;
	onAddManualToQueue: (team: GeneratedTeam) => void;
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
	playingPlayers = [],
	singleWomanIds,
	strategyFilter,
	onStrategyChange,
	onAssign,
	onQueue,
	onAddManualToQueue,
	onPlayerReplace,
	onRefresh,
}: TeamCandidatesListProps) {
	const [replacingPlayer, setReplacingPlayer] = useState<{ candidateIndex: number; player: SessionPlayer } | null>(null);
	const [showManualMatch, setShowManualMatch] = useState(false);

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
		const allPlayers = [...waiting, ...playingPlayers];
		const seen = new Set<string>();
		return allPlayers.filter((p) => {
			if (teamPlayerIds.has(p.id) || seen.has(p.id)) return false;
			seen.add(p.id);
			return true;
		});
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

	const handleManualConfirm = (team: GeneratedTeam) => {
		onAddManualToQueue(team);
		setShowManualMatch(false);
	};

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
						<button
							type="button"
							onClick={() => setShowManualMatch(true)}
							style={{
								fontSize: 11,
								fontWeight: 600,
								color: "#ff9500",
								background: "rgba(255,149,0,0.1)",
								borderRadius: 99,
								padding: "4px 10px",
								border: "none",
								cursor: "pointer",
							}}
						>
							수동매칭
						</button>
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

				{/* Strategy filter chips */}
				<div
					style={{
						padding: "0 16px 10px",
						display: "flex",
						gap: 5,
						overflowX: "auto",
						overflowY: "hidden",
						WebkitOverflowScrolling: "touch",
						flexWrap: "nowrap",
						touchAction: "pan-x",
					}}
					className="no-sb"
				>
					{STRATEGY_OPTIONS.map(({ value, label }) => {
						const active = strategyFilter === value;
						return (
							<button
								key={label}
								type="button"
								onClick={() => onStrategyChange(value)}
								style={{
									fontSize: 11,
									fontWeight: 600,
									padding: "5px 12px",
									borderRadius: 99,
									border: "none",
									cursor: "pointer",
									flexShrink: 0,
									transition: "all 0.15s",
									background: active ? "#0b84ff" : "rgba(0,0,0,0.04)",
									color: active ? "#fff" : "#8e8e93",
								}}
							>
								{label}
							</button>
						);
					})}
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
						unavailableIds={unavailableIds}
						onReplace={handleReplace}
						onCancel={() => setReplacingPlayer(null)}
					/>
				);
			})()}

			{showManualMatch && (
				<ManualMatchDialog
					waiting={waiting}
					playingPlayers={playingPlayers}
					unavailableIds={unavailableIds}
					pairHistory={pairHistory}
					singleWomanIds={singleWomanIds}
					onConfirm={handleManualConfirm}
					onCancel={() => setShowManualMatch(false)}
				/>
			)}
		</>
	);
});

export default TeamCandidatesList;
