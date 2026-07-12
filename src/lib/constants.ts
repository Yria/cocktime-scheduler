import type { PlayerSkills } from "../types";

// 실력 등급 범위 (1~10, 10이 가장 강함). 구 6종 스킬(O/V/X) 모델을 단일 등급으로 대체.
export const MIN_GRADE = 1;
export const MAX_GRADE = 10;
/** 신규 선수/게스트 기본 등급(중간값). */
export const DEFAULT_GRADE = 5;

export const DEFAULT_SKILLS: PlayerSkills = { grade: DEFAULT_GRADE };
