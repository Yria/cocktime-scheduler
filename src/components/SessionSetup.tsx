import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	fetchSessionSettingsForConflictCheck,
	type ServerSessionSettings,
} from "../lib/supabase";
import { diffSessionSettings } from "../lib/session/conflict";
import type { Player, SessionSettings } from "../types";
import { EditModal } from "./setup/EditModal";
import { GuestModal } from "./setup/GuestModal";
import { PlayerConflictDialog } from "./setup/PlayerConflictDialog";
import { SessionConflictDialog } from "./setup/SessionConflictDialog";

interface Props {
	onStart: (selected: Player[], settings: SessionSettings) => void;
}

import { useAppStore } from "../store/appStore";
import { useSetupPlayers } from "../hooks/useSetupPlayers";
import { useGuestManager } from "../hooks/useGuestManager";
import { usePlayerEditor } from "../hooks/usePlayerEditor";
import { CourtCountSelector } from "./setup/CourtCountSelector";
import {
	PlayerSelectionList,
} from "./setup/PlayerSelectionList";
import { SingleWomanSelector } from "./setup/SingleWomanSelector";

export default function SessionSetup({ onStart }: Props) {
	const navigate = useNavigate();
	const guests = useAppStore((s) => s.setupGuests);

	const [courtCount, setCourtCount] = useState(2);
	const [singleWomanIds, setSingleWomanIds] = useState<Set<string>>(new Set());

	const {
		allPlayers,
		isUpdating,
		nonRemovablePlayerIds,
		selected,
		setSelected,
		search,
		setSearch,
		genderFilter,
		setGenderFilter,
		filtered,
		filteredGuests,
		selectedCount,
		togglePlayer,
		toggleAll,
		sessionMeta,
	} = useSetupPlayers(guests);

	// 진행 중인 세션이 있으면 보드로, 없으면 홈으로 복귀 (보드 ↔ 세션 설정 왕복)
	const handleBack = () => navigate(sessionMeta ? "/session" : "/");

	// 초기 코트수/혼복싱글 복원 (세션 업데이트 모드)
	const [initialized, setInitialized] = useState(false);
	if (!initialized && sessionMeta && allPlayers.length > 0) {
		setCourtCount(sessionMeta.courtCount);
		setSingleWomanIds(new Set(sessionMeta.singleWomanIds));
		setInitialized(true);
	}

	const {
		showGuestModal,
		setShowGuestModal,
		guestName,
		setGuestName,
		guestGender,
		setGuestGender,
		guestSkills,
		setGuestSkills,
		openGuestModal,
		addGuest,
		removeGuest,
	} = useGuestManager(setSelected, setSingleWomanIds);

	const {
		editingPlayer,
		setEditingPlayer,
		editGender,
		setEditGender,
		editSkills,
		setEditSkills,
		editSaving,
		editError,
		openEdit,
		handleSave,
		playerConflict,
		resolvePlayerConflict,
		cancelPlayerConflict,
	} = usePlayerEditor(sessionMeta);

	// ── 세션 설정 충돌 감지 ────────────────────────────────
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

	function toggleSingleWoman(id: string) {
		setSingleWomanIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	const selectedFemales = allPlayers.filter(
		(p) => p.gender === "F" && selected.has(p.id),
	);

	async function handleStart() {
		const selectedPlayers = allPlayers.filter((p) => selected.has(p.id));

		const validSingleWomanIds = selectedPlayers
			.filter((p) => p.gender === "F" && singleWomanIds.has(p.id))
			.map((p) => p.id);
		const settings: SessionSettings = {
			courtCount,
			singleWomanIds: validSingleWomanIds,
		};

		if (isUpdating && sessionMeta) {
			const serverState = await fetchSessionSettingsForConflictCheck(
				sessionMeta.sessionId,
			);
			if (serverState) {
				const localSnapshot = {
					courtCount: settings.courtCount,
					playerIds: selectedPlayers.map((p) => p.id),
					singleWomanIds: settings.singleWomanIds,
				};
				if (diffSessionSettings(localSnapshot, serverState).any) {
					setSessionConflict(serverState);
					setSessionConflictLocalSnapshot(localSnapshot);
					pendingStartRef.current = { selectedPlayers, settings };
					return;
				}
			}
		}

		onStart(selectedPlayers, settings);
	}

	return (
		<div
			className="md:max-w-sm md:mx-auto bg-[#fafbff] dark:bg-[#0f172a]"
			style={{ minHeight: "100dvh", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
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
				<button
					type="button"
					onClick={handleBack}
					aria-label="뒤로"
					className="-ml-2 mr-1 p-2 text-[#0b84ff] flex items-center"
				>
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<polyline points="15 18 9 12 15 6" />
					</svg>
				</button>
				<span
					className="font-bold tracking-tight text-[#0f1724] dark:text-white"
					style={{ fontSize: 17 }}
				>
					세션 설정
				</span>
			</div>

			<div style={{ padding: "16px 16px 0" }}>
				<CourtCountSelector
					courtCount={courtCount}

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
				{/* 하단 floating 바 높이 스페이서 */}
				<div style={{ height: "72px" }} />
			</div>

			{/* Bottom CTA */}
			<div
				style={{
					position: "fixed",
					bottom: 0,
					left: "50%",
					transform: "translateX(-50%)",
					width: "var(--glass-bar-width)",
					padding: "10px 16px",
					background: "var(--lq-floating-bg)",
					backdropFilter: "blur(20px) saturate(180%)",
					WebkitBackdropFilter: "blur(20px) saturate(180%)",
					border: "1px solid var(--lq-floating-border)",
					borderRadius: 20,
					boxShadow: "var(--lq-floating-shadow)",
					zIndex: 50,
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
					onForceOverwrite={resolvePlayerConflict}
					onCancel={cancelPlayerConflict}
				/>
			)}
		</div>
	);
}
