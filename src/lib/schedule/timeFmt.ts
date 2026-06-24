/**
 * 일정(세션) 시간 표기 포맷 — 일정 카드·참가자 모달이 공유한다(KST 고정).
 */

const dtFmt = new Intl.DateTimeFormat("ko-KR", {
	timeZone: "Asia/Seoul",
	month: "long",
	day: "numeric",
	weekday: "short",
	hour: "numeric",
	minute: "2-digit",
});

const timeOnlyFmt = new Intl.DateTimeFormat("ko-KR", {
	timeZone: "Asia/Seoul",
	hour: "numeric",
	minute: "2-digit",
});

export function fmt(iso: string | null): string {
	return iso ? dtFmt.format(new Date(iso)) : "시간 미정";
}

/** "시작 ~ 종료" (종료 없으면 시작만). 예) "6월 25일 (수) 오후 7:00 ~ 오후 10:00" */
export function fmtRange(start: string | null, end: string | null): string {
	const base = fmt(start);
	if (!start || !end) return base;
	return `${base} ~ ${timeOnlyFmt.format(new Date(end))}`;
}
