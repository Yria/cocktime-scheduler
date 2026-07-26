import type { AttendanceRow } from "../supabase/types";

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
 * 확정 참석을 base(정원 내)와 freepassOps(정원 초과=운영진 프리패스)로 나눈다.
 * position 오름차순 앞 capacity명이 base, 초과분이 프리패스. 서버 모델상 정원 초과 확정은 전부 운영진.
 * capacity 가 null(무제한)이거나 확정이 정원 이하면 프리패스 없음(freepassOps=[]).
 */
export function splitConfirmedByCapacity(
	attendances: AttendanceRow[],
	capacity: number | null,
): { base: AttendanceRow[]; freepassOps: AttendanceRow[] } {
	const confirmed = attendances
		.filter((a) => a.status === "confirmed")
		.sort((a, b) => a.position - b.position);
	if (capacity == null || confirmed.length <= capacity) {
		return { base: confirmed, freepassOps: [] };
	}
	return { base: confirmed.slice(0, capacity), freepassOps: confirmed.slice(capacity) };
}
