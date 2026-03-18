import { useCallback, useMemo, useState } from "react";
import type { GeneratedTeam, PairHistory, SessionPlayer } from "../../types";
import ModalSheet from "../common/ModalSheet";
import PlayerBadge from "../shared/PlayerBadge";
import { bestPairing, determineGameType, skillScore } from "../../lib/teamGenerator";

interface Props {
	waiting: SessionPlayer[];
	playingPlayers: SessionPlayer[];
	unavailableIds: Set<string>;
	pairHistory: PairHistory;
	singleWomanIds: string[];
	onConfirm: (team: GeneratedTeam) => void;
	onCancel: () => void;
}

type GenderFilter = "all" | "M" | "F";
type SortMode = "fit" | "gameCount" | "skill";
type StatusFilter = "all" | "waiting" | "playing";

const CHIP_STYLE_BASE = {
	fontSize: 11,
	fontWeight: 600 as const,
	borderRadius: 99,
	padding: "4px 10px",
	border: "none",
	cursor: "pointer",
	transition: "all 0.15s",
};

function chipStyle(active: boolean, color: string) {
	return {
		...CHIP_STYLE_BASE,
		background: active ? color : "rgba(0,0,0,0.04)",
		color: active ? "#fff" : "#8e8e93",
	};
}

export default function ManualMatchDialog({
	waiting,
	playingPlayers,
	unavailableIds,
	pairHistory,
	singleWomanIds,
	onConfirm,
	onCancel,
}: Props) {
	const [selected, setSelected] = useState<string[]>([]);
	const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
	const [sortMode, setSortMode] = useState<SortMode>("fit");
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

	const allPlayers = useMemo(() => {
		const seen = new Set<string>();
		const result: SessionPlayer[] = [];
		for (const p of [...waiting, ...playingPlayers]) {
			if (!seen.has(p.id)) {
				seen.add(p.id);
				result.push(p);
			}
		}
		return result;
	}, [waiting, playingPlayers]);

	const rankedPlayers = useMemo(() => {
		const selectedSet = new Set(selected);
		const selectedPlayers = allPlayers.filter((p) => selectedSet.has(p.id));

		const mapped = allPlayers.map((player) => {
			const isPlaying = unavailableIds.has(player.id);
			const isSelected = selectedSet.has(player.id);

			// fitness 계산 (fit 정렬용)
			let fitness = 0;
			if (selectedPlayers.length > 0 && !isSelected) {
				const avgSelectedScore =
					selectedPlayers.reduce((s, p) => s + skillScore(p), 0) / selectedPlayers.length;
				const balanceDiff = Math.abs(skillScore(player) - avgSelectedScore);
				fitness += balanceDiff * 5;

				const pairOverlap = selectedPlayers.reduce(
					(n, sp) => n + (pairHistory[sp.id]?.has(player.id) ? 1 : 0),
					0,
				);
				fitness += pairOverlap * 5;
			}
			fitness += player.gameCount * 1;
			if (isPlaying) fitness += 3;

			return { player, fitness, isPlaying, isSelected, score: skillScore(player) };
		});

		// 필터 적용
		const filtered = mapped.filter(({ player, isPlaying, isSelected }) => {
			// 선택된 선수는 항상 표시
			if (isSelected) return true;
			if (genderFilter !== "all" && player.gender !== genderFilter) return false;
			if (statusFilter === "waiting" && isPlaying) return false;
			if (statusFilter === "playing" && !isPlaying) return false;
			return true;
		});

		// 정렬 적용
		filtered.sort((a, b) => {
			// 선택된 선수 맨 위
			if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;

			switch (sortMode) {
				case "gameCount":
					return a.player.gameCount - b.player.gameCount;
				case "skill":
					return b.score - a.score; // 높은 스킬 먼저
				case "fit":
				default:
					return a.fitness - b.fitness;
			}
		});

		return filtered;
	}, [allPlayers, selected, unavailableIds, pairHistory, genderFilter, sortMode, statusFilter]);

	const togglePlayer = useCallback((playerId: string) => {
		setSelected((prev) => {
			if (prev.includes(playerId)) {
				return prev.filter((id) => id !== playerId);
			}
			if (prev.length >= 4) return prev;
			return [...prev, playerId];
		});
	}, []);

	// 4명 선택 시 자동 페어링 미리보기
	const previewTeam = useMemo((): GeneratedTeam | null => {
		if (selected.length !== 4) return null;

		const four = selected.map((id) => allPlayers.find((p) => p.id === id)!);
		if (four.some((p) => !p)) return null;

		const [teamA, teamB] = bestPairing(
			four as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
		);
		const gameType = determineGameType([...teamA, ...teamB], singleWomanIds);

		return {
			teamA,
			teamB,
			gameType,
			reason: "수동 매칭",
			strategy: "manual" as any,
			is_new: true,
		};
	}, [selected, allPlayers, singleWomanIds]);

	const handleConfirm = () => {
		if (previewTeam) onConfirm(previewTeam);
	};

	const selectedGenderCounts = useMemo(() => {
		const players = selected.map((id) => allPlayers.find((p) => p.id === id)).filter(Boolean);
		return {
			M: players.filter((p) => p!.gender === "M").length,
			F: players.filter((p) => p!.gender === "F").length,
		};
	}, [selected, allPlayers]);

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

			{/* Filters & Sort */}
			<div
				className="px-5 py-3 border-b border-[rgba(0,0,0,0.04)] dark:border-[rgba(255,255,255,0.06)]"
				style={{ display: "flex", flexDirection: "column", gap: 8 }}
			>
				{/* Row 1: Gender + Status */}
				<div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
					<button type="button" onClick={() => setGenderFilter("all")} style={chipStyle(genderFilter === "all", "#64748b")}>전체</button>
					<button type="button" onClick={() => setGenderFilter("M")} style={chipStyle(genderFilter === "M", "#007aff")}>남</button>
					<button type="button" onClick={() => setGenderFilter("F")} style={chipStyle(genderFilter === "F", "#ff2d55")}>여</button>

					<span style={{ width: 1, background: "rgba(0,0,0,0.08)", margin: "0 2px" }} />

					<button type="button" onClick={() => setStatusFilter("all")} style={chipStyle(statusFilter === "all", "#64748b")}>전체</button>
					<button type="button" onClick={() => setStatusFilter("waiting")} style={chipStyle(statusFilter === "waiting", "#0b84ff")}>대기</button>
					<button type="button" onClick={() => setStatusFilter("playing")} style={chipStyle(statusFilter === "playing", "#34c759")}>경기중</button>
				</div>

				{/* Row 2: Sort */}
				<div style={{ display: "flex", gap: 5, alignItems: "center" }}>
					<span style={{ fontSize: 11, color: "#98a0ab", fontWeight: 500, marginRight: 2 }}>정렬</span>
					<button type="button" onClick={() => setSortMode("fit")} style={chipStyle(sortMode === "fit", "#af52de")}>추천순</button>
					<button type="button" onClick={() => setSortMode("gameCount")} style={chipStyle(sortMode === "gameCount", "#ff9500")}>경기수</button>
					<button type="button" onClick={() => setSortMode("skill")} style={chipStyle(sortMode === "skill", "#007aff")}>실력순</button>
				</div>
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
								{previewTeam.teamA.map((p) => (
									<PlayerBadge
										key={p.id}
										name={p.name}
										gender={p.gender}
										skillScore={skillScore(p)}
									/>
								))}
							</div>
							<span style={{ fontSize: 10, fontWeight: 800, color: "#b0b8c1" }}>VS</span>
							<div style={{ display: "flex", gap: 4 }}>
								{previewTeam.teamB.map((p) => (
									<PlayerBadge
										key={p.id}
										name={p.name}
										gender={p.gender}
										skillScore={skillScore(p)}
									/>
								))}
							</div>
						</div>
						<div style={{ textAlign: "center", marginTop: 6, fontSize: 11, fontWeight: 600, color: "#8e8e93" }}>
							{previewTeam.gameType}
						</div>
					</div>
				</div>
			)}

			{/* Player list */}
			<div className="px-5 py-2 max-h-[40vh] overflow-y-auto">
				{rankedPlayers.length === 0 ? (
					<div style={{ textAlign: "center", padding: "24px 0", color: "#98a0ab", fontSize: 13 }}>
						조건에 맞는 선수가 없습니다
					</div>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
						{rankedPlayers.map(({ player, isPlaying, isSelected, score }) => (
							<button
								key={player.id}
								type="button"
								onClick={() => togglePlayer(player.id)}
								disabled={!isSelected && selected.length >= 4}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 10,
									padding: "8px 10px",
									borderRadius: 8,
									border: isSelected
										? "2px solid #0b84ff"
										: "2px solid transparent",
									background: isSelected
										? "rgba(11,132,255,0.06)"
										: "transparent",
									cursor: !isSelected && selected.length >= 4 ? "default" : "pointer",
									opacity: !isSelected && selected.length >= 4 ? 0.35 : 1,
									width: "100%",
									textAlign: "left",
									transition: "all 0.15s",
								}}
							>
								{/* 선택 순서 */}
								<span
									style={{
										width: 20,
										height: 20,
										borderRadius: "50%",
										border: isSelected ? "none" : "1.5px solid #d0d5dd",
										background: isSelected ? "#0b84ff" : "transparent",
										color: isSelected ? "#fff" : "transparent",
										fontSize: 11,
										fontWeight: 700,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										flexShrink: 0,
									}}
								>
									{isSelected ? selected.indexOf(player.id) + 1 : ""}
								</span>

								<PlayerBadge
									name={player.name}
									gender={player.gender}
									skillScore={skillScore(player)}
								/>

								{/* 스킬 스코어 */}
								<span
									style={{
										fontSize: 10,
										fontWeight: 600,
										color: "#b0b8c1",
										fontFamily: "monospace",
									}}
								>
									{score.toFixed(1)}
								</span>

								{/* 경기수 */}
								<span style={{ fontSize: 11, fontWeight: 500, color: "#98a0ab" }}>
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
