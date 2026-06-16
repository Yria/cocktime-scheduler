import type { ReactNode } from "react";
import { SKILL_LEVELS, SKILLS } from "../../lib/constants";
import type { Gender, PlayerSkills, SkillLevel } from "../../types";
import GenderDot from "../shared/GenderDot";
import { SkillButton } from "./SkillButton";

interface PlayerAttributesFormProps {
	gender: Gender;
	skills: PlayerSkills;
	onChangeGender: (gender: Gender) => void;
	onChangeSkill: (skill: keyof PlayerSkills, level: SkillLevel) => void;
	/** "스킬" 헤더 옆 보조 문구(예: 게스트의 "(기본값: 중)"). */
	skillHint?: ReactNode;
}

/** 성별 토글 + 스킬 그리드 — EditModal/GuestModal 공용 표현 컴포넌트. */
export function PlayerAttributesForm({
	gender,
	skills,
	onChangeGender,
	onChangeSkill,
	skillHint,
}: PlayerAttributesFormProps) {
	return (
		<>
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
							className={`btn-toggle flex-1 py-2.5 ${gender === g ? "btn-toggle-active" : ""}`}
						>
							<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
								<GenderDot gender={g} size={7} />
								{g === "M" ? "남" : "여"}
							</span>
						</button>
					))}
				</div>
			</div>

			<div className="mb-2">
				<p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide mb-2">
					스킬{skillHint}
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
										active={skills[skill] === level}
										onClick={() => onChangeSkill(skill, level)}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</>
	);
}
