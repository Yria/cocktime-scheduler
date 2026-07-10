/**
 * "정원 외 늦참 풀"(late_pool) 경계 계산 — 경기 후반 2/3 지점 이후 도착.
 *
 * 기준: 절대 시각이 아니라 세션 길이의 2/3 지점. 예) 18:00~21:00(3h) 세션이면 2/3 = +2h = 20:00("8시").
 * 도착시각(scheduled_at + 늦참 오프셋)이 이 지점 이상이면 정원 외 풀로 접수한다.
 * 서버(마이그레이션 20260708010000 set_late_minutes)도 v_start + (v_end - v_start)*2/3 로 동일 판정한다.
 * 오프셋 산술이 아니라 절대 타임스탬프 비교라 30분 반올림과 무관하게 일치한다.
 */

const POOL_FRACTION = 2 / 3;

/** 2/3 경계 시각 epoch(ms). 종료시각이 없으면 null(경계 계산 불가 → 풀 비활성). */
export function latePoolCutoffMs(
	scheduledAtIso: string | null,
	endsAtIso: string | null,
): number | null {
	if (!scheduledAtIso || !endsAtIso) return null;
	const start = new Date(scheduledAtIso).getTime();
	const end = new Date(endsAtIso).getTime();
	if (!(end > start)) return null;
	return start + (end - start) * POOL_FRACTION;
}

/** 주어진 늦참 오프셋(분)이 정원 외 풀(2/3 지점 이후 도착)인가. */
export function isLatePoolArrival(
	scheduledAtIso: string | null,
	endsAtIso: string | null,
	minutes: number,
): boolean {
	const cutoff = latePoolCutoffMs(scheduledAtIso, endsAtIso);
	if (cutoff == null || !scheduledAtIso) return false;
	const arrival = new Date(scheduledAtIso).getTime() + minutes * 60000;
	return arrival >= cutoff;
}

/**
 * 슬라이더에서 풀존이 시작되는 오프셋(분, 30분 단위 올림). 도착이 처음으로 2/3 지점 이상이 되는 최소 오프셋.
 * null 반환 = 계산 불가(시작/종료시각 없음). 슬라이더 값은 항상 30분 배수라 isLatePoolArrival 판정과 일치한다.
 */
export function poolStartMinutes(
	scheduledAtIso: string | null,
	endsAtIso: string | null,
): number | null {
	const cutoff = latePoolCutoffMs(scheduledAtIso, endsAtIso);
	if (cutoff == null || !scheduledAtIso) return null;
	const offsetMin = (cutoff - new Date(scheduledAtIso).getTime()) / 60000;
	return Math.ceil(offsetMin / 30) * 30;
}
