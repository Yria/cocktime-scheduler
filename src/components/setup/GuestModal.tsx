import type { Gender, PlayerSkills, SkillLevel } from "../../types";
import { SKILLS, SKILL_LEVELS, SkillButton } from "./SkillButton";

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
		<div className="fixed inset-0 lq-overlay flex items-end justify-center z-50 px-4 pb-6">
			<div className="lq-sheet w-full max-w-sm rounded-3xl overflow-hidden flex flex-col max-h-[90dvh]">
				<div className="flex items-center justify-between px-5 pt-5 pb-3">
					<h3 className="font-bold text-gray-800 dark:text-white text-lg">
						게스트 추가
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="w-8 h-8 rounded-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-300"
						style={{ background: "var(--mat-ultra-thin)" }}
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
									className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all"
									style={{
										background: guestGender === g ? "#0b84ff" : "var(--mat-ultra-thin)",
										color: guestGender === g ? "#fff" : "var(--text-secondary)",
									}}
								>
									{g === "M" ? "🔵 남" : "🔴 여"}
								</button>
							))}
						</div>
					</div>

					<div className="mb-2">
						<p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide mb-2">
							스킬{" "}
							<span className="font-normal normal-case">(기본값: 중)</span>
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
						className="flex-1 py-3 rounded-xl text-sm font-semibold text-gray-500 dark:text-gray-300"
						style={{ background: "var(--mat-ultra-thin)" }}
					>
						취소
					</button>
					<button
						type="button"
						onClick={onAdd}
						disabled={!guestName.trim()}
						className="flex-1 py-3 rounded-xl text-sm font-bold text-white"
						style={{
							background: guestName.trim()
								? "linear-gradient(175deg,#ffaa40 0%,#ff8c00 100%)"
								: "rgba(255,140,0,0.3)",
							boxShadow: guestName.trim() ? "0 4px 14px rgba(255,140,0,0.3)" : "none",
							cursor: guestName.trim() ? "pointer" : "not-allowed",
						}}
					>
						추가
					</button>
				</div>
			</div>
		</div>
	);
}
