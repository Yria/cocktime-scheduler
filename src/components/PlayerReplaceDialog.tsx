import { useMemo } from "react";
import type { PairHistory, SessionPlayer } from "../types";
import ModalSheet from "./common/ModalSheet";
import PlayerBadge from "./shared/PlayerBadge";
import { skillScore } from "../lib/teamGenerator";

interface Props {
	selectedPlayer: SessionPlayer;
	currentTeam: SessionPlayer[]; // The team that contains the selected player
	opponentTeam: SessionPlayer[]; // The opposing team
	availablePlayers: SessionPlayer[];
	pairHistory: PairHistory;
	onReplace: (newPlayer: SessionPlayer) => void;
	onCancel: () => void;
}

export default function PlayerReplaceDialog({
	selectedPlayer,
	currentTeam,
	opponentTeam,
	availablePlayers,
	pairHistory,
	onReplace,
	onCancel,
}: Props) {
	// Calculate match history counts for each available player vs selected player
	const { maleGroups, femaleGroups } = useMemo(() => {
		const playersData = availablePlayers.map((player) => {
			const matchCount = pairHistory[selectedPlayer.id]?.has(player.id) ? 1 : 0;
			return { player, matchCount };
		});

		// Group by gender
		const males = playersData.filter((p) => p.player.gender === "M");
		const females = playersData.filter((p) => p.player.gender === "F");

		// Sort each group by: 1) match count (fewer first), 2) game count (fewer first)
		const sortFn = (a: typeof playersData[0], b: typeof playersData[0]) => {
			if (a.matchCount !== b.matchCount) return a.matchCount - b.matchCount;
			return a.player.gameCount - b.player.gameCount;
		};

		return {
			maleGroups: males.sort(sortFn),
			femaleGroups: females.sort(sortFn),
		};
	}, [availablePlayers, pairHistory, selectedPlayer.id]);

	const totalPlayers = maleGroups.length + femaleGroups.length;

	return (
		<ModalSheet position="bottom" onClose={onCancel}>
			{/* Header */}
			<div className="px-5 pt-5 pb-4 border-b border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]">
				<h3 className="font-bold text-gray-800 dark:text-white text-lg">
					선수 교체
				</h3>
				<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
					<span className="font-semibold text-gray-800 dark:text-white">{selectedPlayer.name}</span>을(를) 다른 선수로 교체
				</p>
			</div>

			{/* Current Team Display - CourtList style */}
			<div className="px-5 pt-4 pb-3">
				<div
					className="bg-white dark:bg-[#1c1c1e] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]"
					style={{
						borderRadius: 8,
						overflow: "hidden",
					}}
				>
					{/* Team info */}
					<div style={{ padding: "16px 20px" }}>
						{/* Current Team (Team A) */}
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
							<div
								style={{
									display: "flex",
									flexWrap: "wrap",
									gap: 6,
									flex: 1,
								}}
							>
								{currentTeam.map((player) => (
									<div
										key={player.id}
										style={{
											opacity: player.id === selectedPlayer.id ? 0.4 : 1,
											position: "relative",
										}}
									>
										<PlayerBadge
											name={player.name}
											gender={player.gender}
											skillScore={skillScore(player)}
										/>
										{player.id === selectedPlayer.id && (
											<div
												style={{
													position: "absolute",
													top: "50%",
													left: "50%",
													transform: "translate(-50%, -50%)",
													fontSize: 10,
													fontWeight: 700,
													color: "#ff3b30",
													background: "rgba(255,255,255,0.95)",
													borderRadius: 4,
													padding: "2px 6px",
													whiteSpace: "nowrap",
												}}
											>
												교체대상
											</div>
										)}
									</div>
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

						{/* Opponent Team (Team B) */}
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
							<div
								style={{
									display: "flex",
									flexWrap: "wrap",
									gap: 6,
									flex: 1,
								}}
							>
								{opponentTeam.map((player) => (
									<PlayerBadge
										key={player.id}
										name={player.name}
										gender={player.gender}
										skillScore={skillScore(player)}
									/>
								))}
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Available players - using PlayerBadge */}
			<div className="px-5 py-2 max-h-[40vh] overflow-y-auto">
				{totalPlayers === 0 ? (
					<div className="text-center py-8">
						<p className="text-gray-500 dark:text-gray-400">
							교체 가능한 선수가 없습니다
						</p>
					</div>
				) : (
					<div className="space-y-4">
						{/* Male players section */}
						{maleGroups.length > 0 && (
							<div>
								<div className="flex items-center gap-2 mb-3">
									<span
										style={{
											width: 10,
											height: 10,
											borderRadius: "50%",
											background: "#007aff",
											display: "inline-block",
										}}
									/>
									<h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
										남성 ({maleGroups.length})
									</h4>
								</div>
								<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
									{maleGroups.map(({ player, matchCount }) => (
										<button
											key={player.id}
											type="button"
											onClick={() => onReplace(player)}
											className="glass-item hover:bg-[rgba(0,0,0,0.02)] dark:hover:bg-[rgba(255,255,255,0.08)] transition-colors"
											style={{
												border: "none",
												background: "transparent",
												cursor: "pointer",
												padding: 0,
												position: "relative",
											}}
										>
											<div style={{ position: "relative" }}>
												<PlayerBadge
													name={player.name}
													gender={player.gender}
													skillScore={skillScore(player)}
												/>
												{matchCount > 0 && (
													<div
														style={{
															position: "absolute",
															top: -6,
															right: -6,
															fontSize: 9,
															fontWeight: 700,
															color: "#ff3b30",
															background: "#fff",
															borderRadius: "50%",
															width: 16,
															height: 16,
															display: "flex",
															alignItems: "center",
															justifyContent: "center",
															border: "1.5px solid #ff3b30",
														}}
													>
														{matchCount}
													</div>
												)}
											</div>
											<div
												style={{
													fontSize: 10,
													color: "#98a0ab",
													marginTop: 4,
													fontWeight: 500,
												}}
											>
												경기 {player.gameCount}회
											</div>
										</button>
									))}
								</div>
							</div>
						)}

						{/* Female players section */}
						{femaleGroups.length > 0 && (
							<div>
								<div className="flex items-center gap-2 mb-3">
									<span
										style={{
											width: 10,
											height: 10,
											borderRadius: "50%",
											background: "#ff2d55",
											display: "inline-block",
										}}
									/>
									<h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
										여성 ({femaleGroups.length})
									</h4>
								</div>
								<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
									{femaleGroups.map(({ player, matchCount }) => (
										<button
											key={player.id}
											type="button"
											onClick={() => onReplace(player)}
											className="glass-item hover:bg-[rgba(0,0,0,0.02)] dark:hover:bg-[rgba(255,255,255,0.08)] transition-colors"
											style={{
												border: "none",
												background: "transparent",
												cursor: "pointer",
												padding: 0,
												position: "relative",
											}}
										>
											<div style={{ position: "relative" }}>
												<PlayerBadge
													name={player.name}
													gender={player.gender}
													skillScore={skillScore(player)}
												/>
												{matchCount > 0 && (
													<div
														style={{
															position: "absolute",
															top: -6,
															right: -6,
															fontSize: 9,
															fontWeight: 700,
															color: "#ff3b30",
															background: "#fff",
															borderRadius: "50%",
															width: 16,
															height: 16,
															display: "flex",
															alignItems: "center",
															justifyContent: "center",
															border: "1.5px solid #ff3b30",
														}}
													>
														{matchCount}
													</div>
												)}
											</div>
											<div
												style={{
													fontSize: 10,
													color: "#98a0ab",
													marginTop: 4,
													fontWeight: 500,
												}}
											>
												경기 {player.gameCount}회
											</div>
										</button>
									))}
								</div>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Cancel button */}
			<div className="px-5 pb-5 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] pt-4">
				<button
					type="button"
					onClick={onCancel}
					className="btn-lq-ghost w-full py-3 text-sm"
				>
					취소
				</button>
			</div>
		</ModalSheet>
	);
}
