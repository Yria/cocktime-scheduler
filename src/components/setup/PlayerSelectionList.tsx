import type { Player } from "../../types";
import { PlayerRow } from "./PlayerRow";

export type GenderFilter = "all" | "M" | "F";

const GENDER_FILTER_LABELS: Record<GenderFilter, string> = {
	all: "전체",
	M: "남자",
	F: "여자",
};

interface Props {
	allPlayersLength: number;
	selectedCount: number;
	guestCount: number;
	allFilteredSelected: boolean;
	search: string;
	setSearch: (s: string) => void;
	genderFilter: GenderFilter;
	setGenderFilter: (g: GenderFilter) => void;
	filtered: Player[];
	filteredGuests: Player[];
	selected: Set<string>;
	nonRemovablePlayerIds?: Set<string>;
	toggleAll: () => void;
	openGuestModal: () => void;
	togglePlayer: (id: string) => void;
	openEdit: (e: React.MouseEvent, p: Player) => void;
	removeGuest: (id: string) => void;
}

export function PlayerSelectionList({
	allPlayersLength,
	selectedCount,
	guestCount,
	allFilteredSelected,
	search,
	setSearch,
	genderFilter,
	setGenderFilter,
	filtered,
	filteredGuests,
	selected,
	nonRemovablePlayerIds,
	toggleAll,
	openGuestModal,
	togglePlayer,
	openEdit,
	removeGuest,
}: Props) {
	return (
		<div
			className="bg-white dark:bg-[#1c1c1e] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]"
			style={{
				borderRadius: 12,
				overflow: "hidden",
				marginBottom: 16,
			}}
		>
			<div style={{ padding: "14px 16px 10px" }}>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						marginBottom: 10,
					}}
				>
					<p className="text-[#64748b] dark:text-[rgba(235,235,245,0.5)]" style={{ fontSize: 12, fontWeight: 600 }}>
						참석자 <span style={{ color: "#0b84ff" }}>{selectedCount}</span> /{" "}
						{allPlayersLength}명
						{guestCount > 0 && (
							<span
								style={{ color: "#ff9500", fontWeight: 500, marginLeft: 6 }}
							>
								(게스트 {guestCount})
							</span>
						)}
					</p>
					<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
						<button
							type="button"
							onClick={toggleAll}
							style={{
								fontSize: 13,
								fontWeight: 600,
								color: "#0b84ff",
								background: "none",
								border: "none",
								cursor: "pointer",
							}}
						>
							{allFilteredSelected ? "전체해제" : "전체선택"}
						</button>
						<button
							type="button"
							onClick={openGuestModal}
							style={{
								fontSize: 12,
								fontWeight: 600,
								color: "#ff9500",
								background: "rgba(255,149,0,0.08)",
								border: "1px solid rgba(255,149,0,0.2)",
								borderRadius: 6,
								padding: "4px 10px",
								cursor: "pointer",
							}}
						>
							+ 게스트
						</button>
					</div>
				</div>

				<input
					type="text"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					onFocus={() => setSearch("")}
					placeholder="이름 검색…"
					className="bg-[rgba(241,245,249,1)] dark:bg-[rgba(255,255,255,0.08)] text-[#0f1724] dark:text-white placeholder:text-[#94a3b8] dark:placeholder:text-[rgba(235,235,245,0.4)]"
					style={{
						width: "100%",
						border: "none",
						borderRadius: 10,
						padding: "10px 14px",
						fontSize: 15,
						outline: "none",
						marginBottom: 8,
						boxSizing: "border-box",
					}}
				/>

				<div style={{ display: "flex", gap: 6 }}>
					{(["all", "M", "F"] as GenderFilter[]).map((g) => (
						<button
							type="button"
							key={g}
							onClick={() => setGenderFilter(g)}
							className={
								genderFilter === g
									? "bg-[#0b84ff] text-white"
									: "bg-[rgba(241,245,249,1)] dark:bg-[rgba(255,255,255,0.08)] text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
							}
							style={{
								padding: "5px 12px",
								borderRadius: 8,
								fontSize: 13,
								fontWeight: 500,
								border: "none",
								cursor: "pointer",
								transition: "all 0.15s",
							}}
						>
							{GENDER_FILTER_LABELS[g]}
						</button>
					))}
				</div>
			</div>

			<div className="border-t border-[rgba(0,0,0,0.04)] dark:border-[rgba(255,255,255,0.06)]">
				{filtered.map((player) => (
					<PlayerRow
						key={player.id}
						player={player}
						selected={selected.has(player.id)}
						disabled={nonRemovablePlayerIds?.has(player.id)}
						onToggle={() => togglePlayer(player.id)}
						onEdit={(e) => openEdit(e, player)}
					/>
				))}
				{filteredGuests.map((guest) => (
					<PlayerRow
						key={guest.id}
						player={guest}
						selected={selected.has(guest.id)}
						disabled={nonRemovablePlayerIds?.has(guest.id)}
						isGuest
						onToggle={() => togglePlayer(guest.id)}
						onEdit={(e) => openEdit(e, guest)}
						onRemove={() => removeGuest(guest.id)}
					/>
				))}
			</div>
		</div>
	);
}
