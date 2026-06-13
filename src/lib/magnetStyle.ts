/**
 * magnetStyle.ts
 *
 * "자석" 아바타 디자인의 단일 출처(single source of truth).
 * canvas(보드 PlayerMagnet)와 DOM(공통 PlayerCard)은 렌더링 기술이 달라
 * 같은 컴포넌트를 공유할 수 없으므로, 디자인 토큰만 이 파일 하나로 통일한다.
 *
 *  - 성별 링 색 / 사진 없을 때 배경(light) / 이니셜 잉크
 *  - 스킬 아크 색 + 트랙
 *  - 사진(안쪽 원) 반지름 비율, 링 두께
 *  - 스킬 점수 → 아크 각도 변환
 */
import type { Gender } from "../types";

// 성별 링(테두리) — vivid
export const MAGNET_GENDER_RING_M = "#007aff";
export const MAGNET_GENDER_RING_F = "#ff2d55";
// 사진 없을 때 배경 — light
export const MAGNET_GENDER_BG_M = "#7dd3fc";
export const MAGNET_GENDER_BG_F = "#fca5a5";
// 이니셜 글자색
export const MAGNET_GENDER_INK_M = "#075985";
export const MAGNET_GENDER_INK_F = "#991b1b";

// 스킬 아크 — 트랙은 밝은/어두운 배경 양쪽에서 보이도록 중립 회색
export const MAGNET_SKILL_FG = "#34D399";
export const MAGNET_SKILL_TRACK = "rgba(100,116,139,0.35)";

/** 스킬 아크(가장 바깥 radial 그래프) 두께 / 전체 지름. 사진 = 지름 − 2×(이 밴드). */
export const MAGNET_SKILL_ARC_RATIO = 0.06;
/** 성별 링 두께(px) — 사진 바깥 가장자리 안쪽에 그린다(아크 밴드를 잠식하지 않음). */
export const MAGNET_GENDER_RING_W = 2.5;

export function magnetGenderRing(gender: Gender | string): string {
	return gender === "F" ? MAGNET_GENDER_RING_F : MAGNET_GENDER_RING_M;
}
export function magnetGenderBg(gender: Gender | string): string {
	return gender === "F" ? MAGNET_GENDER_BG_F : MAGNET_GENDER_BG_M;
}
export function magnetGenderInk(gender: Gender | string): string {
	return gender === "F" ? MAGNET_GENDER_INK_F : MAGNET_GENDER_INK_M;
}
/** 스킬 점수(1.0~3.0) → 아크 각도(0~360deg). 점수 없으면 0. */
export function magnetSkillAngle(skillScore?: number): number {
	if (skillScore == null) return 0;
	return Math.max(0, Math.min(360, ((skillScore - 1.0) / 2.0) * 360));
}
