import { useState } from "react";
import { DEFAULT_SKILLS } from "../lib/constants";
import { appActions } from "../store/appStore";
import type { Gender, Player, PlayerSkills } from "../types";

/**
 * 게스트 추가/삭제 상태와 모달 관리 훅
 */
export function useGuestManager(
	setSelected: React.Dispatch<React.SetStateAction<Set<string>>>,
	setSingleWomanIds: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
	const [showGuestModal, setShowGuestModal] = useState(false);
	const [guestName, setGuestName] = useState("");
	const [guestGender, setGuestGender] = useState<Gender>("M");
	const [guestSkills, setGuestSkills] = useState<PlayerSkills>({
		...DEFAULT_SKILLS,
	});

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
		appActions.setSetupGuests((prev) => [...prev, newGuest]);
		setSelected((prev) => new Set([...prev, id]));
		setShowGuestModal(false);
	}

	function removeGuest(id: string) {
		appActions.setSetupGuests((prev) => prev.filter((g) => g.id !== id));
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

	return {
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
	};
}
