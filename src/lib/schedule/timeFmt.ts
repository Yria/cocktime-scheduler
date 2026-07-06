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

// 24시간제 HH:mm — MatchCard·DebugMatchModal·SessionSelector 의 로컬 포맷터 대체용.
const hmFmt = new Intl.DateTimeFormat("ko-KR", {
	timeZone: "Asia/Seoul",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});

// "M/D" — ko-KR 은 "6. 25." 로 찍혀 en-US 로 고정(월/일 숫자 그대로, 패딩 없음).
const mdFmt = new Intl.DateTimeFormat("en-US", {
	timeZone: "Asia/Seoul",
	month: "numeric",
	day: "numeric",
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

/** "오후 8:00" 형태 시각만(KST). 늦참 도착시각 표기용. */
export function fmtClock(iso: string): string {
	return timeOnlyFmt.format(new Date(iso));
}

/** 24시간제 "19:05" (KST 고정 — 디바이스 타임존을 쓰던 로컬 구현들과 달리 fmt/fmtRange 와 일관) */
export function fmtHM(iso: string): string {
	return hmFmt.format(new Date(iso));
}

/** "6/25 19:05" (KST 고정 — SessionSelector.formatSessionLabel 대체) */
export function fmtMDHM(iso: string): string {
	return `${mdFmt.format(new Date(iso))} ${fmtHM(iso)}`;
}
