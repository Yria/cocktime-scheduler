import { OAUTH_AVAILABLE } from "../../lib/googleAuth";
import { isGuestId } from "../../lib/player";
import type { Gender, Player, PlayerSkills, SkillLevel } from "../../types";
import ModalSheet from "../common/ModalSheet";
import { PlayerAttributesForm } from "./PlayerAttributesForm";

interface EditModalProps {
	player: Player;
	editGender: Gender;
	editSkills: PlayerSkills;
	editSaving: boolean;
	editError: string;
	onClose: () => void;
	onSave: () => void;
	onChangeGender: (gender: Gender) => void;
	onChangeSkill: (skill: keyof PlayerSkills, level: SkillLevel) => void;
}

export function EditModal({
	player,
	editGender,
	editSkills,
	editSaving,
	editError,
	onClose,
	onSave,
	onChangeGender,
	onChangeSkill,
}: EditModalProps) {
	const isGuest = isGuestId(player.id);

	return (
		<ModalSheet
			position="bottom"
			onClose={onClose}
			title={
				<span className="flex items-center gap-2">
					{player.name}
					{isGuest && (
						<span
							className="text-xs font-semibold rounded px-1.5 py-0.5"
							style={{ color: "#ff9500", background: "rgba(255,149,0,0.1)" }}
						>
							게스트
						</span>
					)}
				</span>
			}
			className="flex flex-col max-h-[90dvh]"
		>
			<div className="no-sb overflow-y-auto px-5 pb-2">
				<PlayerAttributesForm
					gender={editGender}
					skills={editSkills}
					onChangeGender={onChangeGender}
					onChangeSkill={onChangeSkill}
				/>

				{editError && (
					<p className="text-sm text-red-400 mb-2">{editError}</p>
				)}
				{!isGuest && OAUTH_AVAILABLE && (
					<p className="text-xs text-gray-500 dark:text-gray-300">
						저장 시 구글 로그인 팝업이 뜰 수 있습니다
					</p>
				)}
				{isGuest && (
					<p className="text-xs" style={{ color: "#ff9500" }}>
						게스트는 세션 내에서만 유지됩니다
					</p>
				)}
			</div>

			<div
				className="flex gap-3 px-5 py-4"
				style={{ borderTop: "1px solid var(--border-light)" }}
			>
				<button
					type="button"
					onClick={onClose}
					className="btn-lq-secondary flex-1"
				>
					취소
				</button>
				<button
					type="button"
					onClick={onSave}
					disabled={editSaving}
					className="btn-lq-primary flex-1"
				>
					{editSaving ? "저장 중…" : "저장"}
				</button>
			</div>
		</ModalSheet>
	);
}
