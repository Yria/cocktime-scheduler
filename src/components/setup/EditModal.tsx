import { SKILL_LEVELS, SKILLS } from "../../lib/constants";
import { OAUTH_AVAILABLE } from "../../lib/googleAuth";
import type { Gender, Player, PlayerSkills, SkillLevel } from "../../types";
import ModalSheet from "../common/ModalSheet";
import { SkillButton } from "./SkillButton";

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
	const isGuest = player.id.startsWith("guest-");

	return (
		<ModalSheet position="bottom" onClose={onClose} className="flex flex-col max-h-[90dvh]">
			<div className="flex items-center justify-between px-5 pt-5 pb-3">
				<div className="flex items-center gap-2">
					<h3 className="font-bold text-gray-800 dark:text-white text-lg">
						{player.name}
					</h3>
					{isGuest && (
						<span
							className="text-xs font-semibold rounded px-1.5 py-0.5"
							style={{ color: "#ff9500", background: "rgba(255,149,0,0.1)" }}
						>
							게스트
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={onClose}
					className="btn-icon-close"
				>
					✕
				</button>
			</div>

			<div className="no-sb overflow-y-auto px-5 pb-2">
				<div className="mb-4">
					<p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide mb-2">
						성별
					</p>
					<div className="flex gap-2">
						{(["M", "F"] as Gender[]).map((g) => (
							<button
								type="button"
								key={g}
								onClick={() => onChangeGender(g)}
								className={`btn-toggle flex-1 py-2.5 ${editGender === g ? "btn-toggle-active" : ""}`}
							>
								<span
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 5,
									}}
								>
									<span
										style={{
											width: 7,
											height: 7,
											borderRadius: "50%",
											background: g === "M" ? "#007aff" : "#ff2d55",
											display: "inline-block",
											flexShrink: 0,
										}}
									/>
									{g === "M" ? "남" : "여"}
								</span>
							</button>
						))}
					</div>
				</div>

				<div className="mb-2">
					<p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide mb-2">
						스킬
					</p>
					<div className="flex flex-col gap-2">
						{SKILLS.map((skill) => (
							<div key={skill} className="flex items-center gap-3">
								<span className="text-sm text-gray-500 dark:text-gray-300 w-[60px] shrink-0">
									{skill}
								</span>
								<div className="flex gap-1.5 flex-1">
									{SKILL_LEVELS.map((level) => (
										<SkillButton
											key={level}
											level={level}
											active={editSkills[skill] === level}
											onClick={() => onChangeSkill(skill, level)}
										/>
									))}
								</div>
							</div>
						))}
					</div>
				</div>

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
					className="btn-lq-secondary flex-1 py-3 text-sm"
				>
					취소
				</button>
				<button
					type="button"
					onClick={onSave}
					disabled={editSaving}
					className="btn-lq-primary flex-1 py-3 text-sm"
				>
					{editSaving ? "저장 중…" : "저장"}
				</button>
			</div>
		</ModalSheet>
	);
}
