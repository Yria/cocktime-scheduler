import { useState } from "react";
import {
	fetchSessionPlayerForConflictCheck,
	type ServerPlayerData,
} from "../lib/supabase";
import { isGuestId } from "../lib/player";
import { appActions } from "../store/appStore";
import { useSessionStore } from "../store/sessionStore";
import type { Gender, Player, PlayerSkills } from "../types";
import type { SessionMeta } from "../store/appStore";

/**
 * 플레이어 편집 (성별/스킬 수정) 및 서버 충돌 감지 훅
 */
export function usePlayerEditor(sessionMeta: SessionMeta | null) {
	const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
	const [editGender, setEditGender] = useState<Gender>("M");
	const [editSkills, setEditSkills] = useState<PlayerSkills>(
		{} as PlayerSkills,
	);
	const [editSaving, setEditSaving] = useState(false);
	const [editError, setEditError] = useState("");

	// 충돌 감지
	const [playerConflict, setPlayerConflict] = useState<{
		playerName: string;
		server: ServerPlayerData;
		localGender: Gender;
		localSkills: PlayerSkills;
	} | null>(null);

	function openEdit(e: React.MouseEvent, player: Player) {
		e.stopPropagation();
		setEditingPlayer(player);
		setEditGender(player.gender);
		setEditSkills({ ...player.skills });
		setEditError("");
	}

	async function doPlayerSave() {
		if (!editingPlayer) return;
		setEditSaving(true);
		setEditError("");
		try {
			await appActions.updatePlayer({
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

	async function handleSave() {
		if (!editingPlayer) return;
		if (isGuestId(editingPlayer.id)) {
			appActions.setSetupGuests((prev) =>
				prev.map((g) =>
					g.id === editingPlayer.id
						? { ...g, gender: editGender, skills: { ...editSkills } }
						: g,
				),
			);
			setEditingPlayer(null);
			return;
		}

		if (sessionMeta) {
			const { sessionPlayers } = useSessionStore.getState();
			const sessionPlayer = [...sessionPlayers.values()]
				.find((p) => p.playerId === editingPlayer.id);

			if (sessionPlayer) {
				const serverData = await fetchSessionPlayerForConflictCheck(
					sessionPlayer.id,
				);
				if (serverData) {
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
						return;
					}
				}
			}
		}

		await doPlayerSave();
	}

	function resolvePlayerConflict() {
		setPlayerConflict(null);
		doPlayerSave();
	}

	function cancelPlayerConflict() {
		setPlayerConflict(null);
		setEditingPlayer(null);
	}

	return {
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
	};
}
