import { useMemo } from "react";
import type { PairHistory, SessionPlayer } from "../types";
import ModalSheet from "./common/ModalSheet";
import PlayerBadge from "./shared/PlayerBadge";
import PlayerGenderGroup from "./shared/PlayerGenderGroup";
import { skillScore } from "../lib/teamGenerator";

interface Props {
	selectedPlayer: SessionPlayer;
	currentTeam: SessionPlayer[];
	opponentTeam: SessionPlayer[];
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
	const { maleGroups, femaleGroups } = useMemo(() => {
		const playersData = availablePlayers.map((player) => {
			const matchCount = pairHistory[selectedPlayer.id]?.has(player.id) ? 1 : 0;
			return { player, matchCount };
		});

		const males = playersData.filter((p) => p.player.gender === "M");
		const females = playersData.filter((p) => p.player.gender === "F");

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

			{/* Available players */}
			<div className="px-5 py-2 max-h-[40vh] overflow-y-auto">
				{totalPlayers === 0 ? (
					<div className="text-center py-8">
						<p className="text-gray-500 dark:text-gray-400">
							교체 가능한 선수가 없습니다
						</p>
					</div>
				) : (
					<div className="space-y-4">
						<PlayerGenderGroup
							label="남성"
							dotColor="#007aff"
							players={maleGroups}
							onReplace={onReplace}
						/>
						<PlayerGenderGroup
							label="여성"
							dotColor="#ff2d55"
							players={femaleGroups}
							onReplace={onReplace}
						/>
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
