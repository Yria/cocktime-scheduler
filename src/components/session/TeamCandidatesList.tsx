import { memo, useState } from "react";
import type { Court, GeneratedTeam, PairHistory, SessionPlayer } from "../../types";
import PlayerBadge from "../shared/PlayerBadge";
import PlayerReplaceDialog from "../PlayerReplaceDialog";
import { skillScore } from "../../lib/teamGenerator";

interface TeamCandidatesListProps {
	candidates: GeneratedTeam[];
	courts: Court[];
	waiting: SessionPlayer[];
	pairHistory: PairHistory;
	reservedPlayerIds: Set<string>;
	onReserveOrAssign: (candidateIndex: number, courtId: number) => void;
	onPlayerReplace: (candidateIndex: number, oldPlayer: SessionPlayer, newPlayer: SessionPlayer) => void;
	onRefresh: () => void;
}

const GAME_TYPE_COLOR: Record<string, { bg: string; text: string }> = {
	혼복: { bg: "rgba(175,82,222,0.1)", text: "#af52de" },
	남복: { bg: "rgba(0,122,255,0.1)", text: "#007aff" },
	여복: { bg: "rgba(255,45,85,0.1)", text: "#ff2d55" },
	혼합: { bg: "rgba(255,149,0,0.1)", text: "#ff9500" },
};

const TeamCandidatesList = memo(function TeamCandidatesList({
	candidates,
	courts,
	waiting,
	pairHistory,
	reservedPlayerIds,
	onReserveOrAssign,
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
		return waiting.filter((p) => !teamPlayerIds.has(p.id) && !reservedPlayerIds.has(p.id));
	};

	const getPlayerTeams = (candidateIndex: number, player: SessionPlayer) => {
		const team = candidates[candidateIndex];
		const isInTeamA = team.teamA.some((p) => p.id === player.id);

		return {
			currentTeam: isInTeamA ? team.teamA : team.teamB,
			opponentTeam: isInTeamA ? team.teamB : team.teamA,
		};
	};

	// 코트별 상태: 빈 코트 → 배정 가능, 게임중+예약없음 → 예약 가능
	const assignableCourts = courts.filter((c) => !c.match);
	const reservableCourts = courts.filter((c) => c.match && !c.reserved);

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

				{candidates.length > 0 && (
					<div
						style={{
							padding: "0 16px",
							display: "flex",
							flexDirection: "column",
							gap: 6,
						}}
					>
						{candidates.map((team, index) => {
							const gameTypeStyle = GAME_TYPE_COLOR[team.gameType];

							return (
								<div
									key={index}
									style={{
										borderRadius: 8,
										border: "1px solid rgba(0,122,255,0.2)",
										overflow: "hidden",
									}}
								>
									{/* Team info row */}
									<div
										style={{
											padding: "8px 12px",
										}}
									>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												justifyContent: "space-between",
												marginBottom: 6,
											}}
										>
											<span
												className="text-[#0f1724] dark:text-white"
												style={{
													fontSize: 13,
													fontWeight: 600,
												}}
											>
												팀 {index + 1}
											</span>
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
											{/* Team A */}
											<div style={{ display: "flex", gap: 3 }}>
												{team.teamA.map((p) => (
													<div
														key={p.id}
														onClick={(e) => handlePlayerClick(index, p, e)}
														onKeyDown={(e) => {
															if (e.key === 'Enter' || e.key === ' ') {
																e.preventDefault();
																handlePlayerClick(index, p, e as any);
															}
														}}
														role="button"
														tabIndex={0}
														style={{
															cursor: "pointer",
														}}
													>
														<PlayerBadge
															name={p.name}
															gender={p.gender}
															skillScore={skillScore(p)}
														/>
													</div>
												))}
											</div>

											{/* VS */}
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

											{/* Team B */}
											<div style={{ display: "flex", gap: 3 }}>
												{team.teamB.map((p) => (
													<div
														key={p.id}
														onClick={(e) => handlePlayerClick(index, p, e)}
														onKeyDown={(e) => {
															if (e.key === 'Enter' || e.key === ' ') {
																e.preventDefault();
																handlePlayerClick(index, p, e as any);
															}
														}}
														role="button"
														tabIndex={0}
														style={{
															cursor: "pointer",
														}}
													>
														<PlayerBadge
															name={p.name}
															gender={p.gender}
															skillScore={skillScore(p)}
														/>
													</div>
												))}
											</div>
										</div>
									</div>

									{/* Inline court buttons */}
									{(assignableCourts.length > 0 || reservableCourts.length > 0) && (
										<div
											style={{
												padding: "0 12px 8px 12px",
												borderTop: "1px solid rgba(0,0,0,0.06)",
												paddingTop: 8,
											}}
										>
											<div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
												{assignableCourts.map((court) => (
													<button
														key={`assign-${court.id}`}
														type="button"
														onClick={() => onReserveOrAssign(index, court.id)}
														style={{
															flex: "1 0 auto",
															minWidth: "55px",
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
														{court.id}번 배정
													</button>
												))}
												{reservableCourts.map((court) => (
													<button
														key={`reserve-${court.id}`}
														type="button"
														onClick={() => onReserveOrAssign(index, court.id)}
														style={{
															flex: "1 0 auto",
															minWidth: "55px",
															padding: "6px 10px",
															borderRadius: 5,
															fontSize: 11,
															fontWeight: 600,
															border: "none",
															cursor: "pointer",
															background: "#0b84ff",
															color: "#fff",
														}}
													>
														{court.id}번 예약
													</button>
												))}
											</div>
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
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
