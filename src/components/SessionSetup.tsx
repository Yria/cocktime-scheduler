import { useMemo, useState } from "react";
import { OAUTH_AVAILABLE, requestAccessToken } from "../lib/googleAuth";
import { updatePlayer, updatePlayerWithToken } from "../lib/sheetsApi";
import type { Gender, Player, PlayerSkills, SessionSettings } from "../types";
import { EditModal } from "./setup/EditModal";
import { GuestModal } from "./setup/GuestModal";
import { PlayerRow } from "./setup/PlayerRow";
import { DEFAULT_SKILLS } from "./setup/SkillButton";

interface Props {
	players: Player[];
	savedNames: Set<string> | null;
	scriptUrl: string;
	isUpdating?: boolean;
	initialCourtCount?: number;
	initialSingleWomanIds?: string[];
	onUpdatePlayer: (player: Player) => void;
	onStart: (selected: Player[], settings: SessionSettings) => void;
}

type GenderFilter = "all" | "M" | "F";

const GENDER_FILTER_LABELS: Record<GenderFilter, string> = {
	all: "전체",
	M: "남자",
	F: "여자",
};

const devSelectedNames = import.meta.env.VITE_DEV_SELECTED
	? new Set(
			(import.meta.env.VITE_DEV_SELECTED as string)
				.split(",")
				.map((n) => n.trim()),
		)
	: null;

export default function SessionSetup({
	players,
	savedNames,
	scriptUrl,
	isUpdating,
	initialCourtCount,
	initialSingleWomanIds,
	onUpdatePlayer,
	onStart,
}: Props) {
	const [courtCount, setCourtCount] = useState(initialCourtCount ?? 2);
	const [singleWomanIds, setSingleWomanIds] = useState<Set<string>>(
		() => new Set(initialSingleWomanIds ?? []),
	);
	const [selected, setSelected] = useState<Set<string>>(() => {
		const namesToSelect = savedNames ?? devSelectedNames;
		if (namesToSelect) {
			return new Set(
				players.filter((p) => namesToSelect.has(p.name)).map((p) => p.id),
			);
		}
		return new Set(players.map((p) => p.id));
	});
	const [search, setSearch] = useState("");
	const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");

	// Guest state
	const [guests, setGuests] = useState<Player[]>([]);
	const [showGuestModal, setShowGuestModal] = useState(false);
	const [guestName, setGuestName] = useState("");
	const [guestGender, setGuestGender] = useState<Gender>("M");
	const [guestSkills, setGuestSkills] = useState<PlayerSkills>({
		...DEFAULT_SKILLS,
	});

	// Edit state
	const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
	const [editGender, setEditGender] = useState<Gender>("M");
	const [editSkills, setEditSkills] = useState<PlayerSkills>(
		{} as PlayerSkills,
	);
	const [editSaving, setEditSaving] = useState(false);
	const [editError, setEditError] = useState("");

	const filtered = useMemo(() => {
		return players.filter((p) => {
			const matchName = p.name.includes(search);
			const matchGender = genderFilter === "all" || p.gender === genderFilter;
			return matchName && matchGender;
		});
	}, [players, search, genderFilter]);

	const filteredGuests = useMemo(() => {
		return guests.filter((p) => {
			const matchName = p.name.includes(search);
			const matchGender = genderFilter === "all" || p.gender === genderFilter;
			return matchName && matchGender;
		});
	}, [guests, search, genderFilter]);

	const allPlayers = useMemo(() => [...players, ...guests], [players, guests]);

	const selectedFemales = useMemo(
		() => allPlayers.filter((p) => p.gender === "F" && selected.has(p.id)),
		[allPlayers, selected],
	);

	function togglePlayer(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function toggleAll() {
		const allFilteredPlayers = [...filtered, ...filteredGuests];
		const allSelected = allFilteredPlayers.every((p) => selected.has(p.id));
		setSelected((prev) => {
			const next = new Set(prev);
			if (allSelected) allFilteredPlayers.forEach((p) => next.delete(p.id));
			else allFilteredPlayers.forEach((p) => next.add(p.id));
			return next;
		});
	}

	function toggleSingleWoman(id: string) {
		setSingleWomanIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function openGuestModal() {
		setGuestName("");
		setGuestGender("M");
		setGuestSkills({ ...DEFAULT_SKILLS });
		setShowGuestModal(true);
	}

	function addGuest() {
		const name = guestName.trim();
		if (!name) return;
		const id = `guest-${Date.now()}`;
		const newGuest: Player = {
			id,
			name,
			gender: guestGender,
			skills: { ...guestSkills },
		};
		setGuests((prev) => [...prev, newGuest]);
		setSelected((prev) => new Set([...prev, id]));
		setShowGuestModal(false);
	}

	function removeGuest(id: string) {
		setGuests((prev) => prev.filter((g) => g.id !== id));
		setSelected((prev) => {
			const next = new Set(prev);
			next.delete(id);
			return next;
		});
		setSingleWomanIds((prev) => {
			const next = new Set(prev);
			next.delete(id);
			return next;
		});
	}

	function openEdit(e: React.MouseEvent, player: Player) {
		e.stopPropagation();
		setEditingPlayer(player);
		setEditGender(player.gender);
		setEditSkills({ ...player.skills });
		setEditError("");
	}

	async function handleSave() {
		if (!editingPlayer) return;
		if (editingPlayer.id.startsWith("guest-")) {
			setGuests((prev) =>
				prev.map((g) =>
					g.id === editingPlayer.id
						? { ...g, gender: editGender, skills: { ...editSkills } }
						: g,
				),
			);
			setEditingPlayer(null);
			return;
		}
		setEditSaving(true);
		setEditError("");
		try {
			if (OAUTH_AVAILABLE) {
				const token = await requestAccessToken();
				await updatePlayerWithToken(
					token,
					editingPlayer.name,
					editGender,
					editSkills,
				);
			} else if (scriptUrl) {
				await updatePlayer(
					scriptUrl,
					editingPlayer.name,
					editGender,
					editSkills,
				);
			} else {
				throw new Error(
					"저장 방법이 설정되지 않았습니다 (OAuth Client ID 또는 Script URL 필요)",
				);
			}
			onUpdatePlayer({
				...editingPlayer,
				gender: editGender,
				skills: editSkills,
			});
			setEditingPlayer(null);
		} catch (e) {
			setEditError(e instanceof Error ? e.message : "저장 실패");
		} finally {
			setEditSaving(false);
		}
	}

	function handleStart() {
		const selectedPlayers = allPlayers.filter((p) => selected.has(p.id));
		const validSingleWomanIds = selectedPlayers
			.filter((p) => p.gender === "F" && singleWomanIds.has(p.id))
			.map((p) => p.id);
		onStart(selectedPlayers, {
			courtCount,
			singleWomanIds: validSingleWomanIds,
		});
	}

	const selectedCount = allPlayers.filter((p) => selected.has(p.id)).length;
	const allFilteredSelected =
		[...filtered, ...filteredGuests].length > 0 &&
		[...filtered, ...filteredGuests].every((p) => selected.has(p.id));

	return (
		<div
			className="h-[100dvh] overflow-hidden flex flex-col md:max-w-sm md:mx-auto"
			style={{ background: "#fafbff" }}
		>
			{/* Header */}
			<div
				className="flex-shrink-0 flex items-center px-4"
				style={{
					height: 60,
					background: "#ffffff",
					borderBottom: "0.5px solid rgba(0,0,0,0.08)",
				}}
			>
				<span
					className="font-bold tracking-tight"
					style={{ fontSize: 17, color: "#0f1724" }}
				>
					세션 설정
				</span>
			</div>

			<div
				className="flex-1 min-h-0 overflow-y-auto no-sb"
				style={{ padding: "16px 16px 0" }}
			>
				{/* Court count */}
				<div
					style={{
						background: "#ffffff",
						borderRadius: 12,
						border: "1px solid rgba(0,0,0,0.06)",
						padding: 16,
						marginBottom: 12,
					}}
				>
					<p
						style={{
							fontSize: 11,
							fontWeight: 600,
							color: "#64748b",
							textTransform: "uppercase",
							letterSpacing: "0.06em",
							marginBottom: 12,
						}}
					>
						코트 수
					</p>
					<div
						style={{
							display: "flex",
							gap: 4,
							background: "rgba(241,245,249,1)",
							borderRadius: 10,
							padding: 4,
						}}
					>
						{[1, 2, 3, 4, 5, 6].map((n) => (
							<button
								type="button"
								key={n}
								onClick={() => setCourtCount(n)}
								style={{
									flex: 1,
									padding: "8px 0",
									borderRadius: 7,
									fontSize: 14,
									fontWeight: 700,
									border: "none",
									cursor: "pointer",
									transition: "all 0.15s",
									background: courtCount === n ? "#ffffff" : "transparent",
									color: courtCount === n ? "#0b84ff" : "#98a0ab",
									boxShadow:
										courtCount === n ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
								}}
							>
								{n}
							</button>
						))}
					</div>
				</div>

				{/* Single woman */}
				{selectedFemales.length > 0 && (
					<div
						style={{
							background: "#ffffff",
							borderRadius: 12,
							border: "1px solid rgba(0,0,0,0.06)",
							padding: 16,
							marginBottom: 12,
						}}
					>
						<p
							style={{
								fontSize: 11,
								fontWeight: 600,
								color: "#64748b",
								textTransform: "uppercase",
								letterSpacing: "0.06em",
								marginBottom: 2,
							}}
						>
							혼복 허용 여성
						</p>
						<p style={{ fontSize: 12, color: "#98a0ab", marginBottom: 12 }}>
							남3여1 구성에서 1인 배치 허용
						</p>
						<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
							{selectedFemales.map((p) => (
								<button
									type="button"
									key={p.id}
									onClick={() => toggleSingleWoman(p.id)}
									style={{
										padding: "6px 12px",
										borderRadius: 99,
										fontSize: 14,
										fontWeight: 500,
										border: "none",
										cursor: "pointer",
										transition: "all 0.15s",
										...(singleWomanIds.has(p.id)
											? {
													background: "rgba(255,45,135,0.1)",
													color: "#e8207a",
													boxShadow: "0 2px 8px rgba(255,45,135,0.15)",
												}
											: {
													background: "rgba(241,245,249,1)",
													color: "#64748b",
												}),
									}}
								>
									{singleWomanIds.has(p.id) ? "🔴" : "○"} {p.name}
								</button>
							))}
						</div>
					</div>
				)}

				{/* Player list */}
				<div
					style={{
						background: "#ffffff",
						borderRadius: 12,
						border: "1px solid rgba(0,0,0,0.06)",
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
							<p style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>
								참석자 <span style={{ color: "#0b84ff" }}>{selectedCount}</span>{" "}
								/ {allPlayers.length}명
								{guests.length > 0 && (
									<span
										style={{ color: "#ff9500", fontWeight: 500, marginLeft: 6 }}
									>
										(게스트 {guests.length})
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
							style={{
								width: "100%",
								background: "rgba(241,245,249,1)",
								border: "none",
								borderRadius: 10,
								padding: "10px 14px",
								fontSize: 15,
								color: "#0f1724",
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
									style={{
										padding: "5px 12px",
										borderRadius: 8,
										fontSize: 13,
										fontWeight: 500,
										border: "none",
										cursor: "pointer",
										background:
											genderFilter === g ? "#0b84ff" : "rgba(241,245,249,1)",
										color: genderFilter === g ? "#fff" : "#64748b",
										transition: "all 0.15s",
									}}
								>
									{GENDER_FILTER_LABELS[g]}
								</button>
							))}
						</div>
					</div>

					<div style={{ borderTop: "1px solid rgba(0,0,0,0.04)" }}>
						{filtered.map((player) => (
							<PlayerRow
								key={player.id}
								player={player}
								selected={selected.has(player.id)}
								onToggle={() => togglePlayer(player.id)}
								onEdit={(e) => openEdit(e, player)}
							/>
						))}
						{filteredGuests.map((guest) => (
							<PlayerRow
								key={guest.id}
								player={guest}
								selected={selected.has(guest.id)}
								isGuest
								onToggle={() => togglePlayer(guest.id)}
								onEdit={(e) => openEdit(e, guest)}
								onRemove={() => removeGuest(guest.id)}
							/>
						))}
					</div>
				</div>
			</div>

			{/* Bottom CTA */}
			<div
				className="flex-shrink-0"
				style={{
					background: "#ffffff",
					borderTop: "0.5px solid rgba(0,0,0,0.08)",
					padding: "12px 16px",
					paddingBottom: "max(12px, env(safe-area-inset-bottom))",
				}}
			>
				<button
					type="button"
					onClick={handleStart}
					disabled={selectedCount < 4}
					style={{
						width: "100%",
						padding: "16px",
						borderRadius: 12,
						fontSize: 17,
						fontWeight: 600,
						color: "#fff",
						background:
							selectedCount >= 4 ? "#0b84ff" : "rgba(11,132,255,0.35)",
						border: "none",
						cursor: selectedCount >= 4 ? "pointer" : "not-allowed",
						boxShadow:
							selectedCount >= 4 ? "0 4px 16px rgba(11,132,255,0.25)" : "none",
					}}
				>
					{isUpdating ? "세션 업데이트" : "세션 시작"} ({selectedCount}명)
				</button>
			</div>

			{showGuestModal && (
				<GuestModal
					guestName={guestName}
					guestGender={guestGender}
					guestSkills={guestSkills}
					onClose={() => setShowGuestModal(false)}
					onAdd={addGuest}
					onChangeName={setGuestName}
					onChangeGender={setGuestGender}
					onChangeSkill={(skill, level) =>
						setGuestSkills((prev) => ({ ...prev, [skill]: level }))
					}
				/>
			)}

			{editingPlayer && (
				<EditModal
					player={editingPlayer}
					editGender={editGender}
					editSkills={editSkills}
					editSaving={editSaving}
					editError={editError}
					scriptUrl={scriptUrl}
					onClose={() => setEditingPlayer(null)}
					onSave={handleSave}
					onChangeGender={setEditGender}
					onChangeSkill={(skill, level) =>
						setEditSkills((prev) => ({ ...prev, [skill]: level }))
					}
				/>
			)}
		</div>
	);
}
