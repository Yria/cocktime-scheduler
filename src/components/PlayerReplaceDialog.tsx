import { useMemo } from "react";
import type { PairHistory, SessionPlayer } from "../types";
import ModalSheet from "./common/ModalSheet";
import PlayerBadge from "./shared/PlayerBadge";
import { skillScore } from "../lib/teamGenerator";

interface Props {
	selectedPlayer: SessionPlayer;
	currentTeam: SessionPlayer[];
	opponentTeam: SessionPlayer[];
	availablePlayers: SessionPlayer[];
	pairHistory: PairHistory;
	unavailableIds: Set<string>;
	onReplace: (newPlayer: SessionPlayer) => void;
	onCancel: () => void;
}

export default function PlayerReplaceDialog({
	selectedPlayer,
	currentTeam,
	opponentTeam,
	availablePlayers,
	pairHistory,
	unavailableIds,
	onReplace,
	onCancel,
}: Props) {
	const rankedPlayers = useMemo(() => {
		// 교체 대상의 파트너 (같은 팀의 다른 사람)
		const partner = currentTeam.find((p) => p.id !== selectedPlayer.id);
		const replacedScore = skillScore(selectedPlayer);
		const partnerScore = partner ? skillScore(partner) : replacedScore;
		const opponentAvgScore =
			opponentTeam.reduce((sum, p) => sum + skillScore(p), 0) / opponentTeam.length;

		// 전체 팀 밸런스 목표: (partner + replacement) ≈ opponentTotal
		const opponentTotal = opponentTeam.reduce((sum, p) => sum + skillScore(p), 0);

		return availablePlayers
			.map((player) => {
				const score = skillScore(player);
				const isPlaying = unavailableIds.has(player.id);

				// 1. 스킬 적합도: 교체 후 팀 합이 상대 팀 합에 가까울수록 좋음
				const teamTotal = partnerScore + score;
				const balanceDiff = Math.abs(teamTotal - opponentTotal);

				// 2. 페어 히스토리: 파트너와 같이 한 적 없을수록 좋음
				const partnerPairCount = partner && pairHistory[partner.id]?.has(player.id) ? 1 : 0;
				const opponentPairCount = opponentTeam.reduce(
					(n, op) => n + (pairHistory[op.id]?.has(player.id) ? 1 : 0),
					0,
				);

				// 3. 경기수: 적을수록 우선
				const gameCount = player.gameCount;

				// 종합 점수 (낮을수록 좋음)
				// 밸런스 차이 * 10 + 페어 중복 * 5 + 경기수 * 1 + 경기중 패널티 * 3
				const fitness =
					balanceDiff * 10 +
					partnerPairCount * 5 +
					opponentPairCount * 2 +
					gameCount * 1 +
					(isPlaying ? 3 : 0);

				return { player, fitness, isPlaying, balanceDiff };
			})
			.sort((a, b) => a.fitness - b.fitness);
	}, [availablePlayers, selectedPlayer, currentTeam, opponentTeam, pairHistory, unavailableIds]);

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

			{/* Current Team Display */}
			<div className="px-5 pt-4 pb-3">
				<div
					className="bg-white dark:bg-[#1c1c1e] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]"
					style={{ borderRadius: 8, overflow: "hidden" }}
				>
					<div style={{ padding: "16px 20px" }}>
						{/* Current Team (Team A) */}
						<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
							<span
								className="text-[#0f1724] dark:text-white"
								style={{ fontSize: 14, fontWeight: 600, width: 32, flexShrink: 0 }}
							>
								팀 A
							</span>
							<div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1 }}>
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
						<div style={{ display: "flex", alignItems: "center", margin: "12px 0" }}>
							<div className="bg-[rgba(0,0,0,0.08)] dark:bg-[rgba(255,255,255,0.1)]" style={{ flex: 1, height: 1 }} />
							<span
								className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
								style={{ fontSize: 12, fontWeight: 700, padding: "0 8px" }}
							>
								VS
							</span>
							<div className="bg-[rgba(0,0,0,0.08)] dark:bg-[rgba(255,255,255,0.1)]" style={{ flex: 1, height: 1 }} />
						</div>

						{/* Opponent Team (Team B) */}
						<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
							<span
								className="text-[#0f1724] dark:text-white"
								style={{ fontSize: 14, fontWeight: 600, width: 32, flexShrink: 0 }}
							>
								팀 B
							</span>
							<div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1 }}>
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

			{/* Available players — sorted by fitness */}
			<div className="px-5 py-2 max-h-[40vh] overflow-y-auto">
				{rankedPlayers.length === 0 ? (
					<div className="text-center py-8">
						<p className="text-gray-500 dark:text-gray-400">
							교체 가능한 선수가 없습니다
						</p>
					</div>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						{rankedPlayers.map(({ player, isPlaying }) => (
							<button
								key={player.id}
								type="button"
								onClick={() => onReplace(player)}
								className="hover:bg-[rgba(0,0,0,0.03)] dark:hover:bg-[rgba(255,255,255,0.06)] transition-colors"
								style={{
									display: "flex",
									alignItems: "center",
									gap: 10,
									padding: "8px 10px",
									borderRadius: 8,
									border: "none",
									background: "transparent",
									cursor: "pointer",
									width: "100%",
									textAlign: "left",
								}}
							>
								<PlayerBadge
									name={player.name}
									gender={player.gender}
									skillScore={skillScore(player)}
								/>

								{/* 경기수 */}
								<span
									style={{
										fontSize: 11,
										fontWeight: 500,
										color: "#98a0ab",
									}}
								>
									{player.gameCount}회
								</span>

								<span style={{ flex: 1 }} />

								{/* 상태 표시 */}
								{isPlaying ? (
									<span
										style={{
											fontSize: 10,
											fontWeight: 600,
											color: "#34c759",
											background: "rgba(52,199,89,0.1)",
											borderRadius: 4,
											padding: "2px 7px",
										}}
									>
										경기중
									</span>
								) : (
									<span
										style={{
											fontSize: 10,
											fontWeight: 600,
											color: "#0b84ff",
											background: "rgba(11,132,255,0.1)",
											borderRadius: 4,
											padding: "2px 7px",
										}}
									>
										대기
									</span>
								)}
							</button>
						))}
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
