import { useCallback, useMemo, useState } from "react";
import type { GeneratedTeam, SessionPlayer } from "../../types";
import ModalSheet from "../common/ModalSheet";
import PlayerBadge from "../shared/PlayerBadge";
import PlayerPickerList from "../shared/PlayerPickerList";
import type { PlayerPickerMeta } from "../shared/PlayerPickerList";
import { skillScore, pairPlayers } from "../../lib/teamSelection";
import { usePickerCandidates } from "../../hooks/usePickerCandidates";
import { useAppStore } from "../../store/appStore";
import { useSessionStore } from "../../store/sessionStore";

interface Props {
	onConfirm: (team: GeneratedTeam) => void;
	onCancel: () => void;
}

const SORT_OPTIONS = [
	{ value: "fit", label: "추천순" },
	{ value: "gameCount", label: "경기수" },
	{ value: "skill", label: "실력순" },
];

export default function ManualMatchDialog({ onConfirm, onCancel }: Props) {
	const [selected, setSelected] = useState<string[]>([]);
	const singleWomanIds = useAppStore((s) => s.sessionMeta?.singleWomanIds) ?? EMPTY_SINGLE_WOMAN_IDS;
	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);
	const courts = useSessionStore((s) => s.courts);

	// 경기중 선수 ID 집합 (unavailable 표시용)
	const unavailableIds = useMemo(() => {
		const ids = new Set<string>();
		for (const court of courts) {
			if (court.match) {
				court.match.teamA.forEach((id) => ids.add(id));
				court.match.teamB.forEach((id) => ids.add(id));
			}
		}
		return ids;
	}, [courts]);

	// usePickerCandidates: 선택한 선수 기준 추천 순위 계산
	const rankedCandidates = usePickerCandidates(selected);

	// 순위 맵 (id → score) — pickerPlayers 생성에 사용
	const scoreMap = useMemo(
		() => new Map(rankedCandidates.map((c) => [c.player.id, c.score])),
		[rankedCandidates],
	);

	// 풀에 표시할 전체 선수: 이미 선택된 선수 + 추천 후보
	// 선택된 선수는 rankedCandidates에서 제외되어 있으므로 sessionPlayers에서 별도 조회
	const selectedPlayers = useMemo(
		() =>
			selected
				.map((id) => sessionPlayers.get(id))
				.filter((p): p is SessionPlayer => p !== undefined),
		[selected, sessionPlayers],
	);

	const allDisplayPlayers = useMemo(() => {
		const seen = new Set(selected);
		const result: SessionPlayer[] = [...selectedPlayers];
		for (const { player } of rankedCandidates) {
			if (!seen.has(player.id)) {
				seen.add(player.id);
				result.push(player);
			}
		}
		return result;
	}, [selectedPlayers, rankedCandidates, selected]);

	const pickerPlayers = useMemo(() => {
		const selectedSet = new Set(selected);
		return allDisplayPlayers.map((player) => {
			const isPlaying = unavailableIds.has(player.id);
			const isSelected = selectedSet.has(player.id);
			const score = skillScore(player);
			const rank = isSelected ? -1 : (scoreMap.get(player.id) ?? Infinity);

			return {
				player,
				isPlaying,
				isSelected,
				rank,
				skillRank: -score,
				extraLabel: score.toFixed(1),
			};
		});
	}, [allDisplayPlayers, selected, unavailableIds, scoreMap]);

	const togglePlayer = useCallback((player: SessionPlayer) => {
		setSelected((prev) => {
			if (prev.includes(player.id)) {
				return prev.filter((id) => id !== player.id);
			}
			if (prev.length >= 4) return prev;
			return [...prev, player.id];
		});
	}, []);

	// 4명 선택 시 자동 페어링 미리보기
	const previewTeam = useMemo((): GeneratedTeam | null => {
		if (selected.length !== 4) return null;
		const four = selected
			.map((id) => sessionPlayers.get(id))
			.filter((p): p is SessionPlayer => p !== undefined);
		if (four.length !== 4) return null;

		const fourTuple = four as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer];
		return pairPlayers(fourTuple, singleWomanIds);
	}, [selected, sessionPlayers, singleWomanIds]);

	const handleConfirm = () => {
		if (previewTeam) onConfirm(previewTeam);
	};

	const selectedGenderCounts = useMemo(() => {
		return {
			M: selectedPlayers.filter((p) => p.gender === "M").length,
			F: selectedPlayers.filter((p) => p.gender === "F").length,
		};
	}, [selectedPlayers]);

	return (
		<ModalSheet position="bottom" onClose={onCancel}>
			{/* Header */}
			<div className="px-5 pt-5 pb-3 border-b border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]">
				<h3 className="font-bold text-gray-800 dark:text-white text-lg">
					수동 매칭
				</h3>
				<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
					4명을 선택하면 자동으로 최적 팀을 구성합니다
					{selected.length > 0 && (
						<span style={{ marginLeft: 8, fontWeight: 600, color: "#0b84ff" }}>
							남{selectedGenderCounts.M} 여{selectedGenderCounts.F}
						</span>
					)}
				</p>
			</div>

			{/* Preview (4명 선택 시) */}
			{previewTeam && (
				<div className="px-5 pt-3 pb-1">
					<div
						className="bg-white dark:bg-[#1c1c1e] border border-[rgba(0,122,255,0.2)] dark:border-[rgba(0,122,255,0.3)]"
						style={{ borderRadius: 8, padding: "12px 16px" }}
					>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
							<div style={{ display: "flex", gap: 4 }}>
								{previewTeam.teamA.map((id) => {
									const p = sessionPlayers.get(id);
									if (!p) return null;
									return (
										<PlayerBadge
											key={p.id}
											name={p.name}
											gender={p.gender}
											skillScore={skillScore(p)}
										/>
									);
								})}
							</div>
							<span style={{ fontSize: 10, fontWeight: 800, color: "#b0b8c1" }}>VS</span>
							<div style={{ display: "flex", gap: 4 }}>
								{previewTeam.teamB.map((id) => {
									const p = sessionPlayers.get(id);
									if (!p) return null;
									return (
										<PlayerBadge
											key={p.id}
											name={p.name}
											gender={p.gender}
											skillScore={skillScore(p)}
										/>
									);
								})}
							</div>
						</div>
						<div style={{ textAlign: "center", marginTop: 6, fontSize: 11, fontWeight: 600, color: "#8e8e93" }}>
							{previewTeam.gameType}
						</div>
					</div>
				</div>
			)}

			{/* Filters + Player list */}
			<div className="px-5 py-3">
				<PlayerPickerList
					players={pickerPlayers}
					onSelect={togglePlayer}
					searchThreshold={0}
					showGenderFilter
					showStatusFilter
					sortOptions={SORT_OPTIONS}
					sortLabel="정렬"
					maxHeight="40vh"
					renderLeading={(player: SessionPlayer, meta: PlayerPickerMeta) => (
						<span
							style={{
								width: 20,
								height: 20,
								borderRadius: "50%",
								border: meta.isSelected ? "none" : "1.5px solid #d0d5dd",
								background: meta.isSelected ? "#0b84ff" : "transparent",
								color: meta.isSelected ? "#fff" : "transparent",
								fontSize: 11,
								fontWeight: 700,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								flexShrink: 0,
							}}
						>
							{meta.isSelected ? selected.indexOf(player.id) + 1 : ""}
						</span>
					)}
					renderAfterBadge={(_player: SessionPlayer, meta: PlayerPickerMeta) => (
						<span style={{ fontSize: 10, fontWeight: 600, color: "#b0b8c1", fontFamily: "monospace" }}>
							{meta.extraLabel}
						</span>
					)}
					getButtonStyle={(_player: SessionPlayer, meta: PlayerPickerMeta) => ({
						border: meta.isSelected ? "2px solid #0b84ff" : "2px solid transparent",
						background: meta.isSelected ? "rgba(11,132,255,0.06)" : "transparent",
						cursor: !meta.isSelected && selected.length >= 4 ? "default" : "pointer",
						opacity: !meta.isSelected && selected.length >= 4 ? 0.35 : 1,
						transition: "all 0.15s",
					})}
					isDisabled={(_player: SessionPlayer, meta: PlayerPickerMeta) =>
						!meta.isSelected && selected.length >= 4
					}
					emptyMessage="조건에 맞는 선수가 없습니다"
					noResultMessage="조건에 맞는 선수가 없습니다"
				/>
			</div>

			{/* Footer buttons */}
			<div
				className="px-5 pb-5 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] pt-4"
				style={{ display: "flex", gap: 8 }}
			>
				<button
					type="button"
					onClick={onCancel}
					className="btn-lq-ghost py-3 text-sm"
					style={{ flex: 1 }}
				>
					취소
				</button>
				<button
					type="button"
					onClick={handleConfirm}
					disabled={selected.length !== 4}
					style={{
						flex: 2,
						padding: "12px",
						borderRadius: 8,
						fontSize: 14,
						fontWeight: 600,
						border: "none",
						cursor: selected.length === 4 ? "pointer" : "not-allowed",
						background: selected.length === 4 ? "#0b84ff" : "rgba(11,132,255,0.2)",
						color: "#fff",
						opacity: selected.length === 4 ? 1 : 0.5,
						transition: "all 0.15s",
					}}
				>
					{selected.length === 4
						? "대기열 추가"
						: `${selected.length}/4 선택`}
				</button>
			</div>
		</ModalSheet>
	);
}

const EMPTY_SINGLE_WOMAN_IDS: string[] = [];
