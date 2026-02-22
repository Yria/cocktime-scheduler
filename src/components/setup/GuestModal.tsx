import { SKILL_LEVELS, SKILLS } from "../../lib/constants";
import type { Gender, PlayerSkills, SkillLevel } from "../../types";
import ModalSheet from "../common/ModalSheet";
import { SkillButton } from "./SkillButton";

interface GuestModalProps {
	guestName: string;
	guestGender: Gender;
	guestSkills: PlayerSkills;
	onClose: () => void;
	onAdd: () => void;
	onChangeName: (name: string) => void;
	onChangeGender: (gender: Gender) => void;
	onChangeSkill: (skill: keyof PlayerSkills, level: SkillLevel) => void;
}

export function GuestModal({
	guestName,
	guestGender,
	guestSkills,
	onClose,
	onAdd,
	onChangeName,
	onChangeGender,
	onChangeSkill,
}: GuestModalProps) {
	return (
		<ModalSheet position="bottom" onClose={onClose} className="flex flex-col max-h-[90dvh]">
			<div className="flex items-center justify-between px-5 pt-5 pb-3">
				<h3 className="font-bold text-gray-800 dark:text-white text-lg">
					게스트 추가
				</h3>
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
						이름
					</p>
					<input
						type="text"
						value={guestName}
						onChange={(e) => onChangeName(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && onAdd()}
						placeholder="게스트 이름 입력"
						// biome-ignore lint/a11y/noAutofocus: Intended UX
						autoFocus={true}
						className="w-full rounded-xl px-3.5 py-3 text-base text-gray-800 dark:text-white outline-none"
						style={{ background: "var(--mat-ultra-thin)" }}
					/>
				</div>

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
								className={`btn-toggle flex-1 py-2.5 ${guestGender === g ? "btn-toggle-active" : ""}`}
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
						스킬 <span className="font-normal normal-case">(기본값: 중)</span>
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
											active={guestSkills[skill] === level}
											onClick={() => onChangeSkill(skill, level)}
										/>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
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
					onClick={onAdd}
					disabled={!guestName.trim()}
					className="btn-lq-orange flex-1 py-3 text-sm"
				>
					추가
				</button>
			</div>
		</ModalSheet>
	);
}
