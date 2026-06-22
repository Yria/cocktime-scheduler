import type { RecurringScheduleRow } from "../supabase/types";

/** 0=일 .. 6=토 (postgres dow / JS getDay 와 동일) */
export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 주차 프리셋 */
export const ORDINAL_PRESETS = {
	every: [1, 2, 3, 4, 5],
	odd: [1, 3, 5],
	even: [2, 4],
} as const;

export function weekdayName(dow: number): string {
	return WEEKDAY_LABELS[dow] ?? "?";
}

/** "19:00:00" | "19:00" → "19:00" (앞 두 토막만) */
export function formatTime(t: string): string {
	const [h = "0", m = "0"] = t.split(":");
	return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

/** 주차 패턴 라벨: 매주 / 홀수주 / 짝수주 / "1·3주" / "마지막주" 등 */
export function weekOrdinalsLabel(
	ordinals: number[],
	includeLast: boolean,
): string {
	const sorted = [...new Set(ordinals)].sort((a, b) => a - b);
	const isEvery = [1, 2, 3, 4, 5].every((n) => sorted.includes(n));
	const parts: string[] = [];
	if (isEvery && !includeLast) {
		return "매주";
	}
	if (!isEvery && sorted.length > 0) {
		// 홀수주/짝수주 특수 표기
		if (sorted.join() === "1,3,5") parts.push("홀수주");
		else if (sorted.join() === "2,4") parts.push("짝수주");
		else parts.push(`${sorted.join("·")}주`);
	}
	if (includeLast) parts.push("마지막주");
	return parts.length > 0 ? parts.join(" + ") : "매주";
}

/** 규칙 한 줄 요약: "매주 수 19:00~22:00 · 행복체육관 · 20명 · 카풀" */
export function ruleSummary(
	rule: RecurringScheduleRow,
	placeName: string | null,
): string {
	const time = rule.end_time
		? `${formatTime(rule.start_time)}~${formatTime(rule.end_time)}`
		: formatTime(rule.start_time);
	const when = `${weekOrdinalsLabel(rule.week_ordinals, rule.include_last)} ${weekdayName(rule.day_of_week)} ${time}`;
	const bits = [when];
	if (placeName) bits.push(placeName);
	bits.push(rule.capacity != null ? `${rule.capacity}명` : "인원 무제한");
	if (rule.carpool_enabled) bits.push("카풀");
	return bits.join(" · ");
}
