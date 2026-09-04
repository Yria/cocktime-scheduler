import type { AttendanceRow } from "../supabase/types";
import { isoToDateKST, todayKST } from "./calendar";

/**
 * 세션당 확정 게스트 상한(명). 서버 RPC(20260712010000_guest_confirm_cap 의 promote_next_waitlisted /
 * add_guest_attendance / set_session_capacity)의 상한과 반드시 동일하게 유지한다.
 */
export const GUEST_CONFIRM_CAP = 2;

/**
 * 대기자 1명의 표시 상태.
 *  - queue: 정원 자리를 기다리는 일반 대기. rank = 승격 자격이 있는 대기자 중 position 순번(1-base).
 *  - guestCap: 확정 게스트 상한(GUEST_CONFIRM_CAP)이 찬 동안 대기 중인 게스트. 회원이 취소해도 오르지
 *             못하고 확정 게스트가 빠져야 순서가 오므로 일반 대기열과 성격이 달라 번호 대신 별도 표기한다.
 */
export type WaitDisplay = { kind: "queue"; rank: number } | { kind: "guestCap" };

/**
 * 서버 승격 규칙(promote_next_waitlisted)과 동일한 자격 기준으로 대기자의 표시 상태를 계산한다.
 *
 * 승격은 "빈 자리 1칸 + 후보 자격"으로 결정된다:
 *   · 회원(invited_by=null)은 항상 승격 자격이 있다.
 *   · 게스트(invited_by≠null)는 확정 게스트가 상한 미만(gcount < CAP)일 때만 자격이 있다.
 *
 * 따라서 상한이 찬 동안 대기 게스트는 guestCap(번호 없음), 그 외에는 자격 있는 대기자끼리의 position
 * 순번(queue)으로 표기한다. 상한이 열려 있으면 회원·게스트가 한 대기열로 합쳐져 통합 순번이 된다.
 *
 * @param attendances 세션의 참석 행 전체(취소 제외). 정렬 여부 무관 — position 비교로 순번을 센다.
 * @param target 표시 상태를 구할 대기(waitlisted) 행.
 */
export function waitDisplay(
	attendances: AttendanceRow[],
	target: AttendanceRow,
	guestCap: number | null = GUEST_CONFIRM_CAP,
): WaitDisplay {
	const confirmedGuests = attendances.filter(
		(a) => a.status === "confirmed" && a.invited_by != null,
	).length;
	// guestCap null = 주말(무제한) → 게이트 항상 열림.
	const gateOpen = guestCap == null || confirmedGuests < guestCap;

	// 게스트인데 상한이 찼으면 일반 대기열과 분리 — 번호를 붙이지 않는다.
	if (target.invited_by != null && !gateOpen) return { kind: "guestCap" };

	// 자격 있는 대기자(회원 전부 + 게이트 열렸으면 게스트) 중 target 이하 position 개수 = 순번(자기 포함).
	const rank = attendances.filter(
		(a) =>
			a.status === "waitlisted" &&
			a.position <= target.position &&
			(a.invited_by == null || gateOpen),
	).length;
	return { kind: "queue", rank };
}

/**
 * 세션 일시로 게스트 확정 상한을 구한다 — 주말(KST 토/일)=null(무제한), 평일=GUEST_CONFIRM_CAP.
 * 서버 session_guest_cap(session_id) 와 동일 기준(둘을 반드시 일치시킬 것).
 */
export function guestCapForSession(scheduledAt: string | null): number | null {
	if (!scheduledAt) return GUEST_CONFIRM_CAP;
	const wd = new Date(scheduledAt).toLocaleDateString("en-US", {
		timeZone: "Asia/Seoul",
		weekday: "short",
	});
	return wd === "Sat" || wd === "Sun" ? null : GUEST_CONFIRM_CAP;
}

/** 참석 행이 운영진(admin)인가 — nested user_roles 기준. 정원(확정) 카운트 제외 판정용(서버 is_operator 미러). */
export function isOperatorAtt(a: AttendanceRow): boolean {
	return (a.member?.user_roles ?? []).some((r) => r.role === "admin");
}

/**
 * 신규회원 프리패스 유예 기간(일). 서버 session_newbie_grace(마이그레이션 20260903000000)의 `+ 14` 와
 * 반드시 동일하게 유지한다.
 */
export const NEWBIE_GRACE_DAYS = 14;

/**
 * 가입일 소스 → KST 달력 가입일 "YYYY-MM-DD". 서버와 같은 정의:
 * `coalesce(membership_started_at, created_at at time zone 'Asia/Seoul')`. 둘 다 없으면 null.
 */
export function joinDateKST(
	membershipStartedAt?: string | null,
	createdAt?: string | null,
): string | null {
	if (membershipStartedAt) return membershipStartedAt;
	return createdAt ? isoToDateKST(createdAt) : null;
}

/**
 * 가입일 → 신규 유예 **마지막 날**(KST "YYYY-MM-DD", 이 날짜의 회차까지 프리패스).
 * 순수 달력 산술 — UTC Date 로 일수만 더하므로 시간대가 끼어들 여지가 없다. 형식이 깨지면 null.
 */
export function newbieGraceEndKST(joinYmd: string): string | null {
	const [y, m, d] = joinYmd.split("-").map(Number);
	if (!y || !m || !d) return null;
	return new Date(Date.UTC(y, m - 1, d + NEWBIE_GRACE_DAYS))
		.toISOString()
		.slice(0, 10);
}

/**
 * 지금(KST) 신규 유예 기간 중인가 — 메인 안내 다이얼로그처럼 '사람' 단위 판정에 쓴다.
 * 회차 단위 자격(어느 회차에 프리패스가 붙는가)은 isNewbieAtt 를 쓸 것.
 *
 * 하한(가입일 <= 오늘)도 본다 — 서버 session_newbie_grace 와 같은 이유다: 회비 면제 회원을
 * membership_started_at 을 미래로 두어 처리하는 관행이 있어, 상한만 보면 그 회원에게 영구히 뜬다.
 */
export function isNewbieNowKST(
	membershipStartedAt?: string | null,
	createdAt?: string | null,
): boolean {
	const join = joinDateKST(membershipStartedAt, createdAt);
	const end = join ? newbieGraceEndKST(join) : null;
	if (!join || !end) return false;
	const today = todayKST();
	return today >= join && today <= end;
}

/**
 * 참석 행이 이 회차에서 '신규 2주 유예' 대상인가 — 서버 session_newbie_grace(session_id, member_id) 미러.
 *
 * 판정: 가입일 <= 세션 날짜(KST) <= 가입일 + NEWBIE_GRACE_DAYS.
 *   · 기산을 '지금'이 아니라 '세션 날짜'로 잡기 때문에 같은 회차의 판정은 시간이 지나도 변하지 않는다.
 *   · 하한(가입일 <=)은 membership_started_at 을 미래로 둔 회비 면제 회원의 영구 프리패스를 막는다.
 *   · 게스트(invited_by 있음 / is_guest), 일정 미정(scheduled_at null), 가입일 정보 없음은 false.
 */
export function isNewbieAtt(
	a: AttendanceRow,
	scheduledAt: string | null,
): boolean {
	if (!scheduledAt) return false;
	if (a.invited_by != null || a.member?.is_guest) return false;
	const joinYmd = joinDateKST(
		a.member?.membership_started_at,
		a.member?.created_at,
	);
	const graceEnd = joinYmd ? newbieGraceEndKST(joinYmd) : null;
	if (!joinYmd || !graceEnd) return false;
	const sessionYmd = isoToDateKST(scheduledAt);
	return sessionYmd >= joinYmd && sessionYmd <= graceEnd;
}

/**
 * 대기 포인트 잔액 상한 = 우선참여권 1장의 값. 서버 wait_point_max() / wait_ticket_cost()
 * (마이그레이션 20260904000000)와 반드시 동일하게 유지한다.
 */
export const POINT_MAX = 7;
export const TICKET_COST = 7;

/**
 * 한 회차에서 우선참여권으로 확정될 수 있는 최대 인원. 서버 wait_ticket_session_cap() 와
 * 반드시 동일하게 유지한다. 게스트 상한(GUEST_CONFIRM_CAP)과 같은 '회차당' 단위다.
 */
export const TICKET_SESSION_CAP = 2;

/**
 * 정원 초과 확정(프리패스) 인원 요약 문구 — 사유별로 끊어 보여준다.
 * "운영진 2명" / "신규 1명" / "운영진 2 · 신규 1 · 우선참여 1". 초과분이 없으면 빈 문자열.
 *
 * 사유가 분류되지 않은 초과 행이 남으면 "기타 N" 으로 덧붙여 인원 합이 항상 맞게 한다. 세 경로를
 * 모두 세고 있으므로 지금은 도달하지 않지만, 네 번째 예외가 생겼을 때 인원이 조용히 사라지지 않게
 * 남겨 둔다.
 * 여기서 "정원 외"라는 말은 쓰지 않는다 — 호출부가 제목에 "· 정원 외"를 덧붙이므로 문구가 겹친다.
 */
export function freepassSummary(split: {
	over: AttendanceRow[];
	freepassOps: AttendanceRow[];
	freepassNewbies: AttendanceRow[];
	freepassTickets: AttendanceRow[];
}): string {
	const parts: string[] = [];
	if (split.freepassOps.length > 0) parts.push(`운영진 ${split.freepassOps.length}`);
	if (split.freepassNewbies.length > 0)
		parts.push(`신규 ${split.freepassNewbies.length}`);
	if (split.freepassTickets.length > 0)
		parts.push(`우선참여 ${split.freepassTickets.length}`);
	const rest =
		split.over.length -
		split.freepassOps.length -
		split.freepassNewbies.length -
		split.freepassTickets.length;
	if (rest > 0) parts.push(`기타 ${rest}`);
	if (parts.length === 0) return "";
	return parts.length === 1 ? `${parts[0]}명` : parts.join(" · ");
}

/**
 * 확정 참석을 정원 안(base)과 정원 외(over)로 나누고, 정원 외를 사유별로 분류한다.
 *
 * 세 프리패스의 성격이 서버에서 갈리므로 여기서도 다르게 센다(마이그레이션 20260903010000·20260904000000):
 *   · freepassNewbies — 신규회원 2주 프리패스. **정원을 소비하지 않는 자리**로 행에 기록돼 있다
 *     (`capacity_exempt` + `exempt_reason='newbie'`). 파생이 아니라 기록이라 취소·정원 변경에도
 *     자리 성격이 흔들리지 않는다.
 *   · freepassTickets — 우선참여권(대기 포인트 7점). 신규와 같은 정원 외 자리이고 사유만 다르다
 *     (`exempt_reason='ticket'`). 사유를 안 보면 화면에 '신규'로 거짓 표기된다.
 *   · freepassOps     — 운영진 프리패스. 종전대로 정원 카운트에 들어가므로, 정원을 소비하는 확정
 *     (counted) 중 position 순 capacity 번째 뒤가 곧 운영진 초과분이다.
 *
 * `counted` = 정원을 소비하는 확정 인원 = 서버 confirmed_count 와 같은 값. "확정 N/정원 M" 의 N.
 * capacity 가 null(무제한)이면 정원 초과라는 개념이 없어 운영진 초과분도 없다.
 *
 * exempt_reason 이 null 인 정원 외 행(20260904000000 이전에 만들어진 레거시)은 신규로 센다 —
 * 그 시점의 정원 외 경로가 신규 프리패스뿐이었으므로 사실과 일치한다.
 */
export function splitConfirmedByCapacity(
	attendances: AttendanceRow[],
	capacity: number | null,
): {
	counted: AttendanceRow[];
	base: AttendanceRow[];
	over: AttendanceRow[];
	freepassOps: AttendanceRow[];
	freepassNewbies: AttendanceRow[];
	freepassTickets: AttendanceRow[];
} {
	const byPos = (a: AttendanceRow, b: AttendanceRow) => a.position - b.position;
	const confirmed = attendances
		.filter((a) => a.status === "confirmed")
		.sort(byPos);
	const exempt = confirmed.filter((a) => a.capacity_exempt);
	const freepassTickets = exempt.filter((a) => a.exempt_reason === "ticket");
	const freepassNewbies = exempt.filter((a) => a.exempt_reason !== "ticket");
	const counted = confirmed.filter((a) => !a.capacity_exempt);
	const base = capacity == null ? counted : counted.slice(0, capacity);
	const freepassOps = capacity == null ? [] : counted.slice(capacity);
	return {
		counted,
		base,
		over: [...freepassOps, ...exempt].sort(byPos),
		freepassOps,
		freepassNewbies,
		freepassTickets,
	};
}
