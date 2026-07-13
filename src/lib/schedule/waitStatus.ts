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
): WaitDisplay {
	const confirmedGuests = attendances.filter(
		(a) => a.status === "confirmed" && a.invited_by != null,
	).length;
	const gateOpen = confirmedGuests < GUEST_CONFIRM_CAP;

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
