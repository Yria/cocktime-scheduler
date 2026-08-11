import { describe, it, expect } from "vitest";
import { waitDisplay } from "./waitStatus";
import type { AttendanceRow } from "../supabase/types";

/** 최소 필드만 채운 참석 행 팩토리 — waitDisplay 는 status·position·invited_by 만 본다. */
function att(
	member_id: string,
	status: AttendanceRow["status"],
	position: number,
	invited_by: string | null = null,
): AttendanceRow {
	return {
		session_id: 1,
		member_id,
		status,
		position,
		carpool_role: "none",
		carpool_seats: null,
		late_minutes: 0,
		meal_joining: true,
		requested_at: "",
		confirmed_at: null,
		cancelled_at: null,
		updated_at: "",
		invited_by,
	};
}

const inviter = "host";
const guest = (id: string, status: AttendanceRow["status"], pos: number) =>
	att(id, status, pos, inviter);
const member = (id: string, status: AttendanceRow["status"], pos: number) =>
	att(id, status, pos, null);

describe("waitDisplay — 게스트 확정 상한(2) 게이트", () => {
	it("상한이 찬 상태(확정 게스트 2명): 대기 게스트는 guestCap, 대기 회원은 회원끼리 순번", () => {
		// 확정 게스트 2명 + 대기열 [게스트@1, 회원@2] — 사용자 예시 A 상태.
		const rows = [
			guest("g1", "confirmed", 10),
			guest("g2", "confirmed", 11),
			guest("gw", "waitlisted", 12),
			member("m", "waitlisted", 13),
		];
		expect(waitDisplay(rows, rows[2])).toEqual({ kind: "guestCap" });
		// 회원 순번은 막힌 게스트를 세지 않는다 → 앞에 게스트가 있어도 1번째.
		expect(waitDisplay(rows, rows[3])).toEqual({ kind: "queue", rank: 1 });
	});

	it("게이트가 열린 상태(확정 게스트 1명): 회원·게스트가 한 대기열로 합쳐져 통합 순번", () => {
		// 확정 게스트 1명 + 대기열 [회원@1, 게스트@2] — 사용자 예시 B(취소 후) 상태.
		const rows = [
			guest("g1", "confirmed", 10),
			member("m", "waitlisted", 11),
			guest("gw", "waitlisted", 12),
		];
		expect(waitDisplay(rows, rows[1])).toEqual({ kind: "queue", rank: 1 });
		expect(waitDisplay(rows, rows[2])).toEqual({ kind: "queue", rank: 2 });
	});

	it("상한이 차고 대기 게스트가 여럿이면 모두 guestCap(번호 없음)", () => {
		const rows = [
			guest("g1", "confirmed", 10),
			guest("g2", "confirmed", 11),
			guest("ga", "waitlisted", 12),
			guest("gb", "waitlisted", 13),
		];
		expect(waitDisplay(rows, rows[2])).toEqual({ kind: "guestCap" });
		expect(waitDisplay(rows, rows[3])).toEqual({ kind: "guestCap" });
	});

	it("게스트가 회원보다 앞서도, 상한이 차면 회원 순번은 게스트를 건너뛴다", () => {
		// 대기열 [게스트@1, 게스트@2, 회원@3] — 회원은 여전히 1번째.
		const rows = [
			guest("g1", "confirmed", 10),
			guest("g2", "confirmed", 11),
			guest("ga", "waitlisted", 12),
			guest("gb", "waitlisted", 13),
			member("m", "waitlisted", 14),
		];
		expect(waitDisplay(rows, rows[4])).toEqual({ kind: "queue", rank: 1 });
	});

	it("확정 게스트가 없으면 게이트가 열려 게스트도 일반 대기 순번", () => {
		const rows = [
			member("m1", "confirmed", 10),
			member("m2", "waitlisted", 11),
			guest("gw", "waitlisted", 12),
		];
		expect(waitDisplay(rows, rows[1])).toEqual({ kind: "queue", rank: 1 });
		expect(waitDisplay(rows, rows[2])).toEqual({ kind: "queue", rank: 2 });
	});
});
