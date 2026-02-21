import { useEffect, useMemo, useState } from "react";
import type { Gender, Player, PlayerSkills, SessionSettings } from "../types";
import { EditModal } from "./setup/EditModal";
import { GuestModal } from "./setup/GuestModal";
import { DEFAULT_SKILLS } from "./setup/SkillButton";

interface Props {
	onStart: (selected: Player[], settings: SessionSettings) => void;
}

import { useAppStore } from "../store/appStore";
import { CourtCountSelector } from "./setup/CourtCountSelector";
import {
	type GenderFilter,
	PlayerSelectionList,
} from "./setup/PlayerSelectionList";
import { SingleWomanSelector } from "./setup/SingleWomanSelector";

const devSelectedNames = import.meta.env.VITE_DEV_SELECTED
	? new Set(
			(import.meta.env.VITE_DEV_SELECTED as string)
				.split(",")
				.map((n) => n.trim()),
		)
	: null;

export default function SessionSetup({ onStart }: Props) {
	const allStorePlayers = useAppStore((s) => s.allPlayers);
	const savedNames = useAppStore((s) => s.savedNames);
	const sessionMeta = useAppStore((s) => s.sessionMeta);
	const updatePlayerAction = useAppStore((s) => s.updatePlayerAction);

	const isUpdating = !!sessionMeta;

	const players = useMemo(() => {
		if (allStorePlayers.length > 0) return allStorePlayers;
		if (!sessionMeta) return [];
		const { waiting, resting, courts, reservedGroups } =
			sessionMeta.initialState;
		const playingPlayers = courts.flatMap((c) =>
			c.match ? [...c.match.teamA, ...c.match.teamB] : [],
		);
		const reservedPlayers = reservedGroups.flatMap((g) => g.players);
		const playerMap = new Map<string, Player>();
		for (const sp of [
			...waiting,
			...resting,
			...playingPlayers,
			...reservedPlayers,
		]) {
			if (!playerMap.has(sp.playerId)) {
				playerMap.set(sp.playerId, {
					id: sp.playerId,
					name: sp.name,
					gender: sp.gender,
					skills: sp.skills,
				});
			}
		}
		return Array.from(playerMap.values());
	}, [allStorePlayers, sessionMeta]);

	const { nonRemovablePlayerIds, minCourtCount } = useMemo(() => {
		let nonRemovablePlayerIds = new Set<string>();
		let minCourtCount = 0;
		if (sessionMeta) {
			const { courts } = sessionMeta.initialState;
			const playing = courts.flatMap((c) =>
				c.match ? [...c.match.teamA, ...c.match.teamB] : [],
			);
			nonRemovablePlayerIds = new Set(playing.map((p) => p.playerId));
			// 코트 수: 줄이기 불가, 늘리기만 가능
			minCourtCount = sessionMeta.courtCount;
		}
		return { nonRemovablePlayerIds, minCourtCount };
	}, [sessionMeta]);
	const isSetupInitialized = useAppStore((s) => s.setupInitialized);
	const setSetupInitialized = useAppStore((s) => s.setSetupInitialized);
	const courtCount = useAppStore((s) => s.setupCourtCount);
	const setCourtCount = useAppStore((s) => s.setSetupCourtCount);
	const singleWomanIds = useAppStore((s) => s.setupSingleWomanIds);
	const setSingleWomanIds = useAppStore((s) => s.setSetupSingleWomanIds);
	const selected = useAppStore((s) => s.setupSelectedIds);
	const setSelected = useAppStore((s) => s.setSetupSelectedIds);
	const guests = useAppStore((s) => s.setupGuests);
	const setGuests = useAppStore((s) => s.setSetupGuests);

	const [search, setSearch] = useState("");
	const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");

	useEffect(() => {
		if (!isSetupInitialized && players.length > 0) {
			const namesToSelect = savedNames ?? devSelectedNames;
			const initialSelected = namesToSelect
				? new Set(
						players.filter((p) => namesToSelect.has(p.name)).map((p) => p.id),
					)
				: new Set(players.map((p) => p.id));
			setSelected(initialSelected);
			setSetupInitialized(true);
		}
	}, [
		isSetupInitialized,
		players,
		savedNames,
		setSelected,
		setSetupInitialized,
	]);

	// Guest state
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
		if (nonRemovablePlayerIds?.has(id)) return;
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
			if (allSelected) {
				allFilteredPlayers.forEach((p) => {
					if (!nonRemovablePlayerIds?.has(p.id)) {
						next.delete(p.id);
					}
				});
			} else {
				allFilteredPlayers.forEach((p) => next.add(p.id));
			}
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
			await updatePlayerAction({
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
				<CourtCountSelector
					courtCount={courtCount}
					minCourtCount={minCourtCount}
					onChange={setCourtCount}
				/>

				<SingleWomanSelector
					selectedFemales={selectedFemales}
					singleWomanIds={singleWomanIds}
					onToggle={toggleSingleWoman}
				/>

				<PlayerSelectionList
					allPlayersLength={allPlayers.length}
					selectedCount={selectedCount}
					guestCount={guests.length}
					allFilteredSelected={allFilteredSelected}
					search={search}
					setSearch={setSearch}
					genderFilter={genderFilter}
					setGenderFilter={setGenderFilter}
					filtered={filtered}
					filteredGuests={filteredGuests}
					selected={selected}
					nonRemovablePlayerIds={nonRemovablePlayerIds}
					toggleAll={toggleAll}
					openGuestModal={openGuestModal}
					togglePlayer={togglePlayer}
					openEdit={openEdit}
					removeGuest={removeGuest}
				/>
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
