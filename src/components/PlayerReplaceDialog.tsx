import { useMemo } from "react";
import type { PairHistory, SessionPlayer } from "../types";
import ModalSheet from "./common/ModalSheet";

interface Props {
	selectedPlayer: SessionPlayer;
	availablePlayers: SessionPlayer[];
	pairHistory: PairHistory;
	onReplace: (newPlayer: SessionPlayer) => void;
	onCancel: () => void;
}

export default function PlayerReplaceDialog({
	selectedPlayer,
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

			{/* Available players grid */}
			<div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
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
								<div className="grid grid-cols-2 gap-2">
									{maleGroups.map(({ player, matchCount }) => (
										<button
											key={player.id}
											type="button"
											onClick={() => onReplace(player)}
											className="glass-item rounded-xl p-3 text-center hover:bg-[rgba(0,0,0,0.02)] dark:hover:bg-[rgba(255,255,255,0.08)] transition-colors relative"
										>
											<p className="font-bold text-gray-800 dark:text-white text-sm mb-1">
												{player.name}
											</p>
											<p className="text-xs text-gray-500 dark:text-gray-400">
												경기 {player.gameCount}회
											</p>
											{matchCount > 0 && (
												<div className="absolute top-2 right-2">
													<span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 font-semibold">
														{matchCount}
													</span>
												</div>
											)}
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
								<div className="grid grid-cols-2 gap-2">
									{femaleGroups.map(({ player, matchCount }) => (
										<button
											key={player.id}
											type="button"
											onClick={() => onReplace(player)}
											className="glass-item rounded-xl p-3 text-center hover:bg-[rgba(0,0,0,0.02)] dark:hover:bg-[rgba(255,255,255,0.08)] transition-colors relative"
										>
											<p className="font-bold text-gray-800 dark:text-white text-sm mb-1">
												{player.name}
											</p>
											<p className="text-xs text-gray-500 dark:text-gray-400">
												경기 {player.gameCount}회
											</p>
											{matchCount > 0 && (
												<div className="absolute top-2 right-2">
													<span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 font-semibold">
														{matchCount}
													</span>
												</div>
											)}
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
