import { useMemo } from "react";
import type { SessionPlayer } from "../types";
import { usePickerCandidates } from "../hooks/usePickerCandidates";
import ModalSheet from "./common/ModalSheet";
import MatchPreview, { type MatchPreviewPlayer } from "./shared/MatchPreview";
import PlayerPickerList, { type PlayerPickerItem, type PlayerPickerSortOption } from "./shared/PlayerPickerList";
import { skillScore } from "../lib/teamSelection";

interface Props {
	selectedPlayer: SessionPlayer;
	currentTeam: SessionPlayer[];
	opponentTeam: SessionPlayer[];
	onReplace: (newPlayer: SessionPlayer) => void;
	onCancel: () => void;
}

const SORT_OPTIONS: PlayerPickerSortOption[] = [
	{ value: "fit", label: "추천순" },
	{ value: "gameCount", label: "경기수" },
	{ value: "skill", label: "실력순" },
	{ value: "waitTime", label: "대기시간" },
];

const FILTER_SHOW_THRESHOLD = 0;

export default function PlayerReplaceDialog({
	selectedPlayer,
	currentTeam,
	opponentTeam,
	onReplace,
	onCancel,
}: Props) {
	// confirmed = 파트너 1명 + 상대 2명 (교체 대상인 selectedPlayer는 제외)
	const confirmedIds = useMemo(() => {
		const partner = currentTeam.find((p) => p.id !== selectedPlayer.id);
		const ids: string[] = [];
		if (partner) ids.push(partner.id);
		opponentTeam.forEach((p) => ids.push(p.id));
		return ids;
	}, [currentTeam, opponentTeam, selectedPlayer.id]);

	const rankedCandidates = usePickerCandidates(confirmedIds);

	// confirmed 선수 평균 스킬 (실력순 정렬 기준)
	const avgConfirmedSkill = useMemo(() => {
		const confirmed = confirmedIds
			.map((id) => currentTeam.find((p) => p.id === id) ?? opponentTeam.find((p) => p.id === id))
			.filter((p): p is SessionPlayer => p !== undefined);
		if (confirmed.length === 0) return 0;
		return confirmed.reduce((sum, p) => sum + skillScore(p), 0) / confirmed.length;
	}, [confirmedIds, currentTeam, opponentTeam]);

	const pickerPlayers = useMemo((): PlayerPickerItem[] =>
		rankedCandidates.map((item, index) => ({
			player: item.player,
			isPlaying: item.player.status === "playing",
			rank: index,
			skillRank: avgConfirmedSkill > 0 ? Math.abs(skillScore(item.player) - avgConfirmedSkill) : -skillScore(item.player),
			fitnessScore: item.score,
			waitSince: item.player.waitSince ?? undefined,
		})),
		[rankedCandidates, avgConfirmedSkill],
	);

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
					style={{ borderRadius: 8, overflow: "hidden", padding: "16px 20px" }}
				>
					<MatchPreview
						left={currentTeam.map((player): MatchPreviewPlayer => {
							const isTarget = player.id === selectedPlayer.id;
							return {
								id: player.id,
								name: player.name,
								gender: player.gender,
								skillScore: skillScore(player),
								opacity: isTarget ? 0.5 : 1,
								overlay: isTarget ? (
									<div style={{
										position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
										display: "flex", alignItems: "center", justifyContent: "center",
										fontSize: 20,
									}}>
										↻
									</div>
								) : undefined,
							};
						})}
						right={opponentTeam.map((player): MatchPreviewPlayer => ({
							id: player.id,
							name: player.name,
							gender: player.gender,
							skillScore: skillScore(player),
						}))}
						size="sm"
					/>
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
