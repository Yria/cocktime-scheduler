import { useMemo } from "react";
import type { PairHistory, SessionPlayer } from "../types";
import { rankReplaceCandidates } from "../lib/sessionUtils";
import ModalSheet from "./common/ModalSheet";
import PlayerBadge from "./shared/PlayerBadge";
import PlayerPickerList, { type PlayerPickerItem, type PlayerPickerSortOption } from "./shared/PlayerPickerList";
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

const SORT_OPTIONS: PlayerPickerSortOption[] = [
	{ value: "fitness", label: "적합도" },
	{ value: "waitTime", label: "대기시간" },
	{ value: "gameCount", label: "경기수" },
];

const FILTER_SHOW_THRESHOLD = 5;

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
	const pickerPlayers = useMemo((): PlayerPickerItem[] => {
		const ranked = rankReplaceCandidates(availablePlayers, selectedPlayer, currentTeam, opponentTeam, pairHistory, unavailableIds);
		// rank = fitness 오름차순 인덱스 (rankReplaceCandidates가 이미 정렬된 결과)
		return ranked.map((item, index) => ({
			player: item.player,
			isPlaying: item.isPlaying,
			rank: index,
			fitnessScore: item.fitness,
			waitSince: item.player.waitSince ?? undefined,
		}));
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
								{currentTeam.map((player) => {
									const isTarget = player.id === selectedPlayer.id;
									if (!isTarget) {
										return (
											<PlayerBadge
												key={player.id}
												name={player.name}
												gender={player.gender}
												skillScore={skillScore(player)}
											/>
										);
									}
									return (
										<div
											key={player.id}
											style={{
												display: "inline-flex",
												alignItems: "center",
												padding: "4px 10px",
												background: "linear-gradient(135deg, rgba(255,59,48,0.12), rgba(255,59,48,0.06))",
												border: "1.5px dashed rgba(255,59,48,0.4)",
												borderRadius: 14,
												gap: 4,
											}}
										>
											<span style={{ fontSize: 10 }}>↻</span>
											<span style={{
												fontSize: 13,
												fontWeight: 600,
												color: "#ff3b30",
												textDecoration: "line-through",
												textDecorationColor: "rgba(255,59,48,0.4)",
											}}>
												{player.name}
											</span>
										</div>
									);
								})}
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

			{/* 필터 + 선수 목록 */}
			<div className="px-5 py-2">
				<PlayerPickerList
					players={pickerPlayers}
					onSelect={onReplace}
					showSearch
					searchThreshold={FILTER_SHOW_THRESHOLD}
					showGenderFilter
					showStatusFilter={false}
					sortOptions={SORT_OPTIONS}
					maxHeight="35vh"
					emptyMessage="교체 가능한 선수가 없습니다"
					noResultMessage="검색 결과가 없습니다"
				/>
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
