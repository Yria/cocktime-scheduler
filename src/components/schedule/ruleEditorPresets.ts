import { ORDINAL_PRESETS } from "../../lib/schedule/recurrence";

/** 0=일 .. 6=토 → 주말(토/일) 여부. 카풀 기본값(주말 on) 판정용. */
export function isWeekend(dow: number): boolean {
	return dow === 0 || dow === 6;
}

export type PresetKey = "every" | "odd" | "even" | "custom";

export const PRESET_CHIPS: { key: PresetKey; label: string }[] = [
	{ key: "every", label: "매주" },
	{ key: "odd", label: "홀수주" },
	{ key: "even", label: "짝수주" },
	{ key: "custom", label: "직접선택" },
];

/** 정렬된 ordinals 배열이 어떤 프리셋과 일치하는지 (마지막주 미포함 가정) */
export function matchPreset(ordinals: number[], includeLast: boolean): PresetKey {
	if (includeLast) return "custom";
	const key = [...ordinals].sort((a, b) => a - b).join(",");
	if (key === ORDINAL_PRESETS.every.join(",")) return "every";
	if (key === ORDINAL_PRESETS.odd.join(",")) return "odd";
	if (key === ORDINAL_PRESETS.even.join(",")) return "even";
	return "custom";
}
