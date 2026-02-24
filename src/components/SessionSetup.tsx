import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SKILLS } from "../lib/constants";
import {
	fetchSessionPlayerForConflictCheck,
	fetchSessionSettingsForConflictCheck,
	type ServerPlayerData,
	type ServerSessionSettings,
} from "../lib/supabase";
import type { Gender, Player, PlayerSkills, SessionSettings } from "../types";
import { EditModal } from "./setup/EditModal";
import { GuestModal } from "./setup/GuestModal";
import { PlayerConflictDialog } from "./setup/PlayerConflictDialog";
import { SessionConflictDialog } from "./setup/SessionConflictDialog";

interface Props {
	onStart: (selected: Player[], settings: SessionSettings) => void;
}

import { useAppStore } from "../store/appStore";
import { useSessionStore } from "../store/sessionStore";
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

	const sessionCourts = useSessionStore((s) => s.courts);
	const sessionWaiting = useSessionStore((s) => s.waiting);
	const sessionResting = useSessionStore((s) => s.resting);
	const sessionReservedGroups = useSessionStore((s) => s.reservedGroups);

	const guests = useAppStore((s) => s.setupGuests);
	const setGuests = useAppStore((s) => s.setSetupGuests);

	const isUpdating = !!sessionMeta;

	const players = useMemo(() => {
		if (allStorePlayers.length > 0) return allStorePlayers;
		if (!sessionMeta) return [];
		const guestIdSet = new Set(guests.map((g) => g.id));
		const playingPlayers = sessionCourts.flatMap((c) =>
			c.match ? [...c.match.teamA, ...c.match.teamB] : [],
		);
		const reservedPlayers = sessionReservedGroups.flatMap((g) => g.players);
		const playerMap = new Map<string, Player>();
		for (const sp of [
			...sessionWaiting,
			...sessionResting,
			...playingPlayers,
			...reservedPlayers,
		]) {
			if (!playerMap.has(sp.playerId) && !guestIdSet.has(sp.playerId)) {
				playerMap.set(sp.playerId, {
					id: sp.playerId,
					name: sp.name,
					gender: sp.gender,
					skills: sp.skills,
				});
			}
		}
		return Array.from(playerMap.values());
	}, [
		allStorePlayers,
		sessionMeta,
		guests,
		sessionCourts,
		sessionWaiting,
		sessionResting,
		sessionReservedGroups,
	]);

	const { nonRemovablePlayerIds, minCourtCount } = useMemo(() => {
		let nonRemovablePlayerIds = new Set<string>();
		const minCourtCount = 0;
		if (sessionMeta) {
			const playing = sessionCourts.flatMap((c) =>
				c.match ? [...c.match.teamA, ...c.match.teamB] : [],
			);
			nonRemovablePlayerIds = new Set(playing.map((p) => p.playerId));
		}
		return { nonRemovablePlayerIds, minCourtCount };
	}, [sessionMeta, sessionCourts]);
	const isSetupInitialized = useAppStore((s) => s.setupInitialized);
	const setSetupInitialized = useAppStore((s) => s.setSetupInitialized);
	const courtCount = useAppStore((s) => s.setupCourtCount);
	const setCourtCount = useAppStore((s) => s.setSetupCourtCount);
	const singleWomanIds = useAppStore((s) => s.setupSingleWomanIds);
	const setSingleWomanIds = useAppStore((s) => s.setSetupSingleWomanIds);
	const selected = useAppStore((s) => s.setupSelectedIds);
	const setSelected = useAppStore((s) => s.setSetupSelectedIds);

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

	// ── 충돌 감지 state ────────────────────────────────
	const [sessionConflict, setSessionConflict] =
		useState<ServerSessionSettings | null>(null);
	const [sessionConflictLocalSnapshot, setSessionConflictLocalSnapshot] =
		useState<{
			courtCount: number;
			playerIds: string[];
			singleWomanIds: string[];
		} | null>(null);
	const pendingStartRef = useRef<{
		selectedPlayers: Player[];
		settings: SessionSettings;
	} | null>(null);

	const [playerConflict, setPlayerConflict] = useState<{
		playerName: string;
		server: ServerPlayerData;
		localGender: Gender;
		localSkills: PlayerSkills;
	} | null>(null);
	const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);

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

	const doPlayerSave = useCallback(async () => {
		if (!editingPlayer) return;
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
	}, [editingPlayer, editGender, editSkills, updatePlayerAction]);

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

		// 세션 내 플레이어이면 서버 충돌 감지
		if (sessionMeta) {
			const { waiting, resting, courts } = useSessionStore.getState();
			const sessionPlayer = [
				...waiting,
				...resting,
				...courts.flatMap((c) =>
					c.match ? [...c.match.teamA, ...c.match.teamB] : [],
				),
			].find((p) => p.playerId === editingPlayer.id);

			if (sessionPlayer) {
				const serverData = await fetchSessionPlayerForConflictCheck(
					sessionPlayer.id,
				);
				if (serverData) {
					// 내가 저장하려는 값과 서버 현재값이 다르면 → 충돌
					const genderChanged = serverData.gender !== editGender;
					const skillsChanged =
						JSON.stringify(serverData.skills) !== JSON.stringify(editSkills);
					if (genderChanged || skillsChanged) {
						setPlayerConflict({
							playerName: editingPlayer.name,
							server: serverData,
							localGender: editGender,
							localSkills: { ...editSkills },
						});
						pendingSaveRef.current = doPlayerSave;
						return;
					}
				}
			}
		}

		await doPlayerSave();
	}

	async function handleStart() {
		const selectedPlayers = allPlayers.filter((p) => selected.has(p.id));
		const validSingleWomanIds = selectedPlayers
			.filter((p) => p.gender === "F" && singleWomanIds.has(p.id))
			.map((p) => p.id);
		const settings: SessionSettings = {
			courtCount,
			singleWomanIds: validSingleWomanIds,
		};

		// 기존 세션 업데이트인 경우: 내가 저장하려는 값 vs 서버 현재값 비교
		if (isUpdating && sessionMeta) {
			const serverState = await fetchSessionSettingsForConflictCheck(
				sessionMeta.sessionId,
			);
			if (serverState) {
				// 내가 저장하려는 courtCount vs 서버
				const courtDiff = settings.courtCount !== serverState.courtCount;

				// 내가 저장하려는 참가자 목록 vs 서버
				const myPlayerIds = new Set(selectedPlayers.map((p) => p.id));
				const serverPlayerIdSet = new Set(serverState.playerIds);
				const playerDiff =
					myPlayerIds.size !== serverPlayerIdSet.size ||
					[...myPlayerIds].some((id) => !serverPlayerIdSet.has(id)) ||
					[...serverPlayerIdSet].some((id) => !myPlayerIds.has(id));

				// 내가 저장하려는 혼복 싱글 여성 vs 서버
				const mySingleSet = new Set(settings.singleWomanIds);
				const serverSingleSet = new Set(serverState.singleWomanIds);
				const singleDiff =
					mySingleSet.size !== serverSingleSet.size ||
					[...mySingleSet].some((id) => !serverSingleSet.has(id)) ||
					[...serverSingleSet].some((id) => !mySingleSet.has(id));

				if (courtDiff || playerDiff || singleDiff) {
					setSessionConflict(serverState);
					setSessionConflictLocalSnapshot({
						courtCount: settings.courtCount,
						playerIds: [...myPlayerIds],
						singleWomanIds: settings.singleWomanIds,
					});
					pendingStartRef.current = { selectedPlayers, settings };
					return;
				}
			}
		}

		onStart(selectedPlayers, settings);
	}

	const selectedCount = allPlayers.filter((p) => selected.has(p.id)).length;
	const allFilteredSelected =
		[...filtered, ...filteredGuests].length > 0 &&
		[...filtered, ...filteredGuests].every((p) => selected.has(p.id));

	return (
		<div
			className="md:max-w-sm md:mx-auto bg-[#fafbff] dark:bg-[#0f172a]"
			style={{ minHeight: "100dvh" }}
		>
			{/* Header */}
			<div
				className="flex items-center px-4 bg-white dark:bg-[#1c1c1e] border-b border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]"
				style={{
					position: "sticky",
					top: 0,
					zIndex: 50,
					height: "calc(60px + env(safe-area-inset-top))",
					paddingTop: "env(safe-area-inset-top)",
				}}
			>
				<span
					className="font-bold tracking-tight text-[#0f1724] dark:text-white"
					style={{ fontSize: 17 }}
				>
					세션 설정
				</span>
			</div>

			<div
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
				{/* 하단 고정 바 높이만큼 스페이서 */}
			<div style={{ height: "calc(68px + max(12px, env(safe-area-inset-bottom)))" }} />
		</div>

			{/* Bottom CTA */}
			<div
				className="bg-white dark:bg-[#1c1c1e] border-t border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]"
				style={{
					position: "fixed",
					bottom: 0,
					left: "50%",
					transform: "translateX(-50%)",
					width: "100%",
					maxWidth: 384,
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

			{/* 세션 설정 충돌 다이얼로그 */}
			{sessionConflict && sessionConflictLocalSnapshot && (
				<SessionConflictDialog
					serverSettings={sessionConflict}
					localCourtCount={sessionConflictLocalSnapshot.courtCount}
					localPlayerIds={sessionConflictLocalSnapshot.playerIds}
					localSingleWomanIds={sessionConflictLocalSnapshot.singleWomanIds}
					allPlayers={allPlayers}
					onForceOverwrite={() => {
						setSessionConflict(null);
						setSessionConflictLocalSnapshot(null);
						if (pendingStartRef.current) {
							const { selectedPlayers, settings } = pendingStartRef.current;
							pendingStartRef.current = null;
							onStart(selectedPlayers, settings);
						}
					}}
					onCancel={() => {
						setSessionConflict(null);
						setSessionConflictLocalSnapshot(null);
						pendingStartRef.current = null;
					}}
				/>
			)}

			{/* 플레이어 편집 충돌 다이얼로그 */}
			{playerConflict && (
				<PlayerConflictDialog
					playerName={playerConflict.playerName}
					serverGender={playerConflict.server.gender}
					serverSkills={playerConflict.server.skills}
					localGender={playerConflict.localGender}
					localSkills={playerConflict.localSkills}
					onForceOverwrite={() => {
						setPlayerConflict(null);
						if (pendingSaveRef.current) {
							const save = pendingSaveRef.current;
							pendingSaveRef.current = null;
							save();
						}
					}}
					onCancel={() => {
						setPlayerConflict(null);
						pendingSaveRef.current = null;
						setEditingPlayer(null);
					}}
				/>
			)}
		</div>
	);
}
