// 달력/날짜 헬퍼. KST(Asia/Seoul, 고정 +09:00, DST 없음) 기준으로 브라우저 시간대와 무관하게 동작.

const KST = "Asia/Seoul";
const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: KST }); // YYYY-MM-DD
const timeFmt = new Intl.DateTimeFormat("en-GB", {
	timeZone: KST,
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

/** 오늘(KST) "YYYY-MM-DD" */
export function todayKST(): string {
	return ymdFmt.format(new Date());
}

/** ISO 순간 → KST 달력 날짜 "YYYY-MM-DD" */
export function isoToDateKST(iso: string): string {
	return ymdFmt.format(new Date(iso));
}

/** ISO 순간 → KST 시각 "HH:MM" */
export function isoToTimeKST(iso: string): string {
	return timeFmt.format(new Date(iso));
}

/** KST 벽시계(date "YYYY-MM-DD" + time "HH:MM") → ISO 순간 (브라우저 TZ 무관) */
export function kstWallClockToISO(date: string, time: string): string {
	return new Date(`${date}T${time}:00+09:00`).toISOString();
}

/**
 * KST 종료 시각 ISO. 종료가 시작보다 이르거나 같으면(자정 넘김) 다음날로 본다.
 * (DB recurring_valid_occurrences 의 occ_ends_at CASE 와 동일 규칙)
 */
export function kstEndWallClockToISO(
	date: string,
	startTime: string,
	endTime: string,
): string {
	const startISO = kstWallClockToISO(date, startTime);
	const sameDayISO = kstWallClockToISO(date, endTime);
	if (Date.parse(sameDayISO) > Date.parse(startISO)) return sameDayISO;
	const [y, m, d] = date.split("-").map(Number);
	const next = new Date(Date.UTC(y, m - 1, d + 1));
	const nd = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
	return kstWallClockToISO(nd, endTime);
}

export interface GridCell {
	date: string; // YYYY-MM-DD
	day: number; // 1..31
	inMonth: boolean;
}

/** 월 달력 6주(42칸) 그리드. 일요일 시작. UTC 산술로 DST 영향 제거. */
export function monthGrid(year: number, month: number): GridCell[] {
	const first = new Date(Date.UTC(year, month, 1));
	const startDow = first.getUTCDay(); // 0=일
	const cells: GridCell[] = [];
	for (let i = 0; i < 42; i++) {
		const d = new Date(Date.UTC(year, month, 1 - startDow + i));
		cells.push({
			date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
			day: d.getUTCDate(),
			inMonth: d.getUTCMonth() === month,
		});
	}
	return cells;
}

/** 표시 월의 달력 전체(6주)를 덮는 조회 범위 [from, to] ISO */
export function monthRangeISO(
	year: number,
	month: number,
): { from: string; to: string } {
	const grid = monthGrid(year, month);
	return {
		from: kstWallClockToISO(grid[0].date, "00:00"),
		to: kstWallClockToISO(grid[41].date, "23:59"),
	};
}

/** 이전/다음 달 (year, month 0-based) */
export function shiftMonth(
	year: number,
	month: number,
	delta: number,
): { year: number; month: number } {
	const d = new Date(Date.UTC(year, month + delta, 1));
	return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

/** "YYYY-MM-DD" → 요일 인덱스(0=일) */
export function dateStrDow(date: string): number {
	const [y, m, d] = date.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
