import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Gender, SessionPlayer } from "../../types";
import { disassemble, getChoseong } from "es-hangul";
import { skillScore } from "../../lib/teamSelection";
import FilterChip from "./FilterChip";

const SIZES_MAP = { sm: 68, md: 84 } as const;
import PlayerCard from "./PlayerCard";

export interface PlayerPickerItem {
	player: SessionPlayer;
	isPlaying: boolean;
	isSelected?: boolean;
	/** fit/fitness 정렬 기준 (낮을수록 우선) */
	rank?: number;
	/** skill 정렬 전용 기준 (낮을수록 우선, 높은 스킬 우선 시 -score 전달) */
	skillRank?: number;
	extraLabel?: string;
	/** fitness 점수 (낮을수록 좋음) — 적합도 퍼센테이지 계산용 */
	fitnessScore?: number;
	/** waitTime 정렬용 — ISO 문자열 */
	waitSince?: string;
}

export interface PlayerPickerMeta {
	isPlaying: boolean;
	isSelected: boolean;
	rank?: number;
	skillRank?: number;
	extraLabel?: string;
}

export interface PlayerPickerSortOption {
	value: string;
	label: string;
}

interface PlayerPickerListProps {
	players: PlayerPickerItem[];
	onSelect: (player: SessionPlayer) => void;

	// 검색
	showSearch?: boolean;
	searchThreshold?: number;

	// 필터
	showGenderFilter?: boolean;
	showStatusFilter?: boolean;

	// 정렬
	sortOptions?: PlayerPickerSortOption[];
	sortLabel?: string;

	// 스크롤 영역
	maxHeight?: string;

	photoSize?: "sm" | "md";

	// 커스텀 슬롯
	renderLeading?: (player: SessionPlayer, meta: PlayerPickerMeta) => ReactNode;
	isDisabled?: (player: SessionPlayer, meta: PlayerPickerMeta) => boolean;

	// 빈 상태
	emptyMessage?: string;
	noResultMessage?: string;
}

type GenderFilter = Gender | null;
type StatusFilter = "all" | "waiting" | "playing";

const DIVIDER = (
	<span
		key="divider"
		style={{ width: 1, background: "rgba(0,0,0,0.08)", margin: "0 2px", alignSelf: "stretch" }}
	/>
);

function matchesQuery(name: string, q: string): boolean {
	if (!q) return true;
	if (name.toLowerCase().includes(q)) return true;
	const decomposed = disassemble(q);
	const isAllChoseong = /^[ㄱ-ㅎ]+$/.test(decomposed);
	return isAllChoseong && getChoseong(name).includes(decomposed);
}

export default function PlayerPickerList({
	players,
	onSelect,
	showSearch = false,
	searchThreshold = 5,
	showGenderFilter = true,
	showStatusFilter = false,
	sortOptions,
	sortLabel,
	maxHeight = "35vh",
	photoSize = "md",
	renderLeading,
	isDisabled,
	emptyMessage = "선수가 없습니다",
	noResultMessage = "검색 결과가 없습니다",
}: PlayerPickerListProps) {
	const [query, setQuery] = useState("");
	const [genderFilter, setGenderFilter] = useState<GenderFilter>(null);
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [sortBy, setSortBy] = useState<string>(sortOptions?.[0]?.value ?? "");

	const hasEnoughForFilters = players.length >= searchThreshold;
	const showSearchBar = showSearch && hasEnoughForFilters;
	const showFilters = hasEnoughForFilters && (showGenderFilter || showStatusFilter || (sortOptions && sortOptions.length > 0));

	const filteredPlayers = useMemo(() => {
		const q = query.trim().toLowerCase();
		return players.filter(({ player, isPlaying, isSelected }) => {
			// 선택된 선수는 항상 표시
			if (isSelected) return true;
			if (!matchesQuery(player.name, q)) return false;
			if (genderFilter && player.gender !== genderFilter) return false;
			if (showStatusFilter) {
				if (statusFilter === "waiting" && isPlaying) return false;
				if (statusFilter === "playing" && !isPlaying) return false;
			}
			return true;
		});
	}, [players, query, genderFilter, statusFilter, showStatusFilter]);

	const sortedPlayers = useMemo(() => {
		const sorted = [...filteredPlayers].sort((a, b) => {
			// 선택된 선수 항상 맨 위
			if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;

			if (!sortOptions || sortOptions.length === 0 || !sortBy) return 0;

			if (sortBy === "gameCount") return a.player.gameCount - b.player.gameCount;
			if (sortBy === "skill") {
				// skillRank 우선, 없으면 gameCount fallback
				const aRank = a.skillRank ?? a.player.gameCount;
				const bRank = b.skillRank ?? b.player.gameCount;
				return aRank - bRank;
			}
			if (sortBy === "waitTime") {
				// 경기중 선수를 하단으로
				if (a.isPlaying !== b.isPlaying) return a.isPlaying ? 1 : -1;
				// waitSince가 빠를수록(오래 기다릴수록) 우선
				const aWait = a.waitSince ? new Date(a.waitSince).getTime() : Date.now();
				const bWait = b.waitSince ? new Date(b.waitSince).getTime() : Date.now();
				return aWait - bWait;
			}
			// 기본(첫 번째 옵션 또는 "fitness"/"fit"/"추천순"): rank 기준 (외부에서 정렬된 순서 유지)
			const aRank = a.rank ?? 0;
			const bRank = b.rank ?? 0;
			return aRank - bRank;
		});
		return sorted;
	}, [filteredPlayers, sortBy, sortOptions]);

	// 적합도 퍼센테이지 계산용 min/max
	const fitnessRange = useMemo(() => {
		const scores = sortedPlayers.map((p) => p.fitnessScore).filter((s): s is number => s !== undefined);
		if (scores.length === 0) return null;
		const min = Math.min(...scores);
		const max = Math.max(...scores);
		return { min, max };
	}, [sortedPlayers]);

	const hasActiveQuery = query.trim().length > 0 || genderFilter !== null || statusFilter !== "all";
	const isEmpty = players.length === 0;
	const isNoResult = !isEmpty && sortedPlayers.length === 0;

	return (
		<div>
			{/* 검색바 */}
			{showSearchBar && (
				<div style={{ marginBottom: 8 }}>
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="이름 검색..."
						className="bg-[rgba(0,0,0,0.04)] dark:bg-[rgba(255,255,255,0.06)] text-[#0f1724] dark:text-white placeholder:text-[#8e8e93]"
						style={{
							width: "100%",
							padding: "8px 12px",
							borderRadius: 8,
							border: "none",
							fontSize: 13,
							outline: "none",
							boxSizing: "border-box",
						}}
					/>
				</div>
			)}

			{/* 필터 칩 영역 */}
			{showFilters && (
				<div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
					{/* 성별 + 상태 행 */}
					{(showGenderFilter || showStatusFilter) && (
						<div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
							{showGenderFilter && (
								<>
									<FilterChip label="전체" active={genderFilter === null} onClick={() => setGenderFilter(null)} />
									<FilterChip label="남" active={genderFilter === "M"} activeColor="#007aff" onClick={() => setGenderFilter("M")} />
									<FilterChip label="여" active={genderFilter === "F"} activeColor="#ff2d55" onClick={() => setGenderFilter("F")} />
								</>
							)}

							{showGenderFilter && showStatusFilter && DIVIDER}

							{showStatusFilter && (
								<>
									<FilterChip label="전체" active={statusFilter === "all"} activeColor="#64748b" onClick={() => setStatusFilter("all")} />
									<FilterChip label="대기" active={statusFilter === "waiting"} activeColor="#0b84ff" onClick={() => setStatusFilter("waiting")} />
									<FilterChip label="경기중" active={statusFilter === "playing"} activeColor="#34c759" onClick={() => setStatusFilter("playing")} />
								</>
							)}
						</div>
					)}

					{/* 정렬 행 */}
					{sortOptions && sortOptions.length > 0 && (
						<div style={{ display: "flex", gap: 5, alignItems: "center" }}>
							{sortLabel && (
								<span style={{ fontSize: 11, color: "#98a0ab", fontWeight: 500, marginRight: 2 }}>
									{sortLabel}
								</span>
							)}
							{sortOptions.map(({ value, label }) => (
								<FilterChip
									key={value}
									label={label}
									active={sortBy === value}
									activeColor="#af52de"
									onClick={() => setSortBy(value)}
								/>
							))}
						</div>
					)}
				</div>
			)}

			{/* 선수 목록 */}
			<div style={{ maxHeight, overflowY: "auto" }}>
				{isEmpty || isNoResult ? (
					<div style={{ textAlign: "center", padding: "24px 0", color: "#98a0ab", fontSize: 13 }}>
						{isEmpty
							? emptyMessage
							: hasActiveQuery
								? noResultMessage
								: emptyMessage}
					</div>
				) : (
					<div style={{
						display: "grid",
						gridTemplateColumns: `repeat(auto-fill, minmax(${SIZES_MAP[photoSize]}px, 1fr))`,
						gap: 6,
						justifyItems: "center",
					}}>
						{sortedPlayers.map(({ player, isPlaying, isSelected, rank, skillRank, extraLabel, fitnessScore, waitSince }) => {
							const meta: PlayerPickerMeta = {
								isPlaying,
								isSelected: isSelected ?? false,
								rank,
								skillRank,
								extraLabel,
							};

							// 정렬 기준별 뱃지 값
							let sortLabel: ReactNode = null;
							if (sortBy === "fit" || (!sortBy && sortOptions && sortOptions.length > 0)) {
								if (fitnessScore !== undefined && fitnessRange) {
									const { min, max } = fitnessRange;
									const pct = max === min ? 100 : Math.round(((max - fitnessScore) / (max - min)) * 100);
									const color = pct >= 80 ? "#34c759" : pct >= 50 ? "#ff9500" : "#ff3b30";
									sortLabel = <span style={{ color }}>{pct}%</span>;
								}
							} else if (sortBy === "gameCount") {
								sortLabel = <span style={{ color: "#ff9500" }}>{player.gameCount}회</span>;
							} else if (sortBy === "skill") {
								sortLabel = <span style={{ color: "#007aff" }}>{skillScore(player).toFixed(1)}</span>;
							} else if (sortBy === "waitTime") {
								if (isPlaying) {
									sortLabel = <span style={{ color: "#8e8e93" }}>경기중</span>;
								} else if (waitSince) {
									const elapsed = Math.floor((Date.now() - new Date(waitSince).getTime()) / 60000);
									sortLabel = <span style={{ color: "#ff9500" }}>{elapsed < 1 ? "방금" : `${elapsed}분`}</span>;
								}
							}

							return (
								<div key={player.id} style={{
									position: "relative",
									opacity: isPlaying ? 0.45 : 1,
									filter: isPlaying ? "grayscale(0.5)" : "none",
									transition: "opacity 0.15s",
								}}>
									<PlayerCard
										name={player.name}
										gender={player.gender}
										skillScore={skillScore(player)}
										size={photoSize}
										selected={isSelected}
										disabled={isDisabled?.(player, meta)}
										onClick={() => onSelect(player)}
									/>
									{renderLeading?.(player, meta)}
									{sortLabel && (
										<div style={{
											position: "absolute", top: 2, left: 0, right: 0,
											textAlign: "center",
											fontSize: 11, fontWeight: 800,
											lineHeight: "18px",
										}}>
											<span style={{
												background: "rgba(0,0,0,0.7)",
												borderRadius: 6,
												padding: "2px 6px",
												backdropFilter: "blur(4px)",
											}}>
												{sortLabel}
											</span>
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
