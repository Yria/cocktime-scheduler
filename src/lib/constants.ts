import type { PlayerSkills, SkillLevel } from "../types";

export const SKILLS: (keyof PlayerSkills)[] = [
	"클리어",
	"스매시",
	"로테이션",
	"드랍",
	"헤어핀",
	"드라이브",
	"백핸드",
];
export const SKILL_LEVELS: SkillLevel[] = ["O", "V", "X"];
export const SKILL_LEVEL_LABEL: Record<SkillLevel, string> = {
	O: "상",
	V: "중",
	X: "하",
};
export const DEFAULT_SKILLS: PlayerSkills = {
	클리어: "V",
	스매시: "V",
	로테이션: "V",
	드랍: "V",
	헤어핀: "V",
	드라이브: "V",
	백핸드: "V",
};
