import { describe, it, expect } from "vitest";
import {
	waitDisplay,
	isNewbieAtt,
	splitConfirmedByCapacity,
	freepassSummary,
} from "./waitStatus";
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


// ── 신규회원 2주 프리패스 미러 ────────────────────────────────
// 서버 session_newbie_grace / join_session(마이그레이션 20260903000000)과 같은 판정을 하는지 본다.

/** 참석 행에 member 임베드를 얹는다(가입일·운영진 여부 판정용). */
function withMember(
	row: AttendanceRow,
	opts: {
		joinedYmd?: string | null;
		createdAt?: string | null;
		admin?: boolean;
		isGuest?: boolean;
	} = {},
): AttendanceRow {
	return {
		...row,
		member: {
			name: row.member_id,
			is_guest: opts.isGuest ?? false,
			gender: null,
			membership_started_at: opts.joinedYmd ?? null,
			created_at: opts.createdAt ?? null,
			user_roles: opts.admin ? [{ role: "admin" }] : [],
		},
	};
}

/** KST 19:00 회차 — 브라우저 TZ 와 무관하게 그 날짜로 판정돼야 한다. */
const kstSession = (ymd: string) => `${ymd}T19:00:00+09:00`;

describe("isNewbieAtt — 세션 날짜(KST) <= 가입일 + 14일", () => {
	it("가입 당일 회차는 신규", () => {
		const a = withMember(member("n", "confirmed", 1), { joinedYmd: "2026-09-01" });
		expect(isNewbieAtt(a, kstSession("2026-09-01"))).toBe(true);
	});

	it("가입 + 14일 회차까지 신규, + 15일부터는 아니다(경계)", () => {
		const a = withMember(member("n", "confirmed", 1), { joinedYmd: "2026-09-01" });
		expect(isNewbieAtt(a, kstSession("2026-09-15"))).toBe(true);
		expect(isNewbieAtt(a, kstSession("2026-09-16"))).toBe(false);
	});

	it("월을 넘겨도 달력 산술로 맞는다(9/25 가입 → 10/9 까지)", () => {
		const a = withMember(member("n", "confirmed", 1), { joinedYmd: "2026-09-25" });
		expect(isNewbieAtt(a, kstSession("2026-10-09"))).toBe(true);
		expect(isNewbieAtt(a, kstSession("2026-10-10"))).toBe(false);
	});

	it("membership_started_at 이 없으면 created_at 을 KST 달력 날짜로 환산해 쓴다", () => {
		// UTC 로는 8/31 이지만 KST 로는 9/1 인 순간 — KST 기준(9/1)으로 봐야 9/15 까지 신규다.
		const a = withMember(member("n", "confirmed", 1), {
			createdAt: "2026-08-31T16:30:00Z",
		});
		expect(isNewbieAtt(a, kstSession("2026-09-15"))).toBe(true);
		expect(isNewbieAtt(a, kstSession("2026-09-16"))).toBe(false);
	});

	it("membership_started_at 이 있으면 created_at 보다 우선한다(관리자 보정)", () => {
		const a = withMember(member("n", "confirmed", 1), {
			joinedYmd: "2026-06-01",
			createdAt: "2026-09-01T10:00:00+09:00",
		});
		expect(isNewbieAtt(a, kstSession("2026-09-10"))).toBe(false);
	});

	it("UTC 표기(+00:00) 응답도 KST 날짜로 판정한다 — KST 오전 회차", () => {
		// 서버가 주는 timestamptz 는 보통 UTC 표기다. 2026-09-15T22:00:00Z = KST 09/16 07:00.
		const a = withMember(member("n", "confirmed", 1), { joinedYmd: "2026-09-01" });
		expect(isNewbieAtt(a, "2026-09-15T22:00:00Z")).toBe(false); // KST 09/16 > 09/15
		expect(isNewbieAtt(a, "2026-09-14T22:00:00Z")).toBe(true); // KST 09/15 == 경계
	});

	it("가입일보다 앞선 회차는 신규가 아니다 — 가입일을 미래로 둔 회비 면제 회원 방어(하한)", () => {
		const a = withMember(member("ex", "confirmed", 1), { joinedYmd: "2099-01-01" });
		expect(isNewbieAtt(a, kstSession("2026-09-20"))).toBe(false);
		// 하한은 '가입 당일'까지 허용한다.
		const b = withMember(member("n", "confirmed", 1), { joinedYmd: "2026-09-20" });
		expect(isNewbieAtt(b, kstSession("2026-09-19"))).toBe(false);
		expect(isNewbieAtt(b, kstSession("2026-09-20"))).toBe(true);
	});

	it("게스트·일정 미정·가입일 없음은 신규가 아니다", () => {
		const g = withMember(guest("g", "confirmed", 1), {
			joinedYmd: "2026-09-01",
			isGuest: true,
		});
		expect(isNewbieAtt(g, kstSession("2026-09-02"))).toBe(false);

		const a = withMember(member("n", "confirmed", 1), { joinedYmd: "2026-09-01" });
		expect(isNewbieAtt(a, null)).toBe(false);

		const noJoin = withMember(member("x", "confirmed", 1));
		expect(isNewbieAtt(noJoin, kstSession("2026-09-02"))).toBe(false);
	});
});

describe("splitConfirmedByCapacity — 초과분을 사유별로 분류", () => {
	const S = kstSession("2026-09-05");
	const OLD = "2026-01-01"; // 기존 회원
	const NEW = "2026-09-01"; // 9/5 회차 기준 신규

	it("정원 이하면 초과분이 없다", () => {
		const rows = [
			withMember(member("m1", "confirmed", 1), { joinedYmd: OLD }),
			withMember(member("m2", "confirmed", 2), { joinedYmd: NEW }),
		];
		const r = splitConfirmedByCapacity(rows, 2, S);
		expect(r.base).toHaveLength(2);
		expect(r.over).toEqual([]);
		expect(r.freepassNewbies).toEqual([]);
		expect(freepassSummary(r)).toBe("");
	});

	it("position 순 앞 capacity명이 base, 초과분은 운영진/신규로 갈린다", () => {
		const rows = [
			withMember(member("m1", "confirmed", 1), { joinedYmd: OLD }),
			withMember(member("m2", "confirmed", 2), { joinedYmd: OLD }),
			withMember(member("op", "confirmed", 3), { joinedYmd: OLD, admin: true }),
			withMember(member("nb", "confirmed", 4), { joinedYmd: NEW }),
		];
		const r = splitConfirmedByCapacity(rows, 2, S);
		expect(r.base.map((a) => a.member_id)).toEqual(["m1", "m2"]);
		expect(r.over.map((a) => a.member_id)).toEqual(["op", "nb"]);
		expect(r.freepassOps.map((a) => a.member_id)).toEqual(["op"]);
		expect(r.freepassNewbies.map((a) => a.member_id)).toEqual(["nb"]);
		expect(freepassSummary(r)).toBe("운영진 1 · 신규 1");
	});

	it("운영진이면서 신규인 사람은 운영진으로만 분류한다(두 목록 배타)", () => {
		const rows = [
			withMember(member("m1", "confirmed", 1), { joinedYmd: OLD }),
			withMember(member("both", "confirmed", 2), { joinedYmd: NEW, admin: true }),
		];
		const r = splitConfirmedByCapacity(rows, 1, S);
		expect(r.freepassOps.map((a) => a.member_id)).toEqual(["both"]);
		expect(r.freepassNewbies).toEqual([]);
		expect(freepassSummary(r)).toBe("운영진 1명");
	});

	it("정원 무제한(capacity=null)이면 전원 base", () => {
		const rows = [withMember(member("nb", "confirmed", 1), { joinedYmd: NEW })];
		const r = splitConfirmedByCapacity(rows, null, S);
		expect(r.base).toHaveLength(1);
		expect(r.over).toEqual([]);
	});

	it("사유가 분류되지 않은 초과 행은 '기타 N' 으로 남는다(인원 합 보존 · '정원 외' 와 겹치지 않게)", () => {
		const rows = [
			withMember(member("m1", "confirmed", 1), { joinedYmd: OLD }),
			withMember(member("m2", "confirmed", 2), { joinedYmd: OLD }),
		];
		const r = splitConfirmedByCapacity(rows, 1, S);
		expect(r.over.map((a) => a.member_id)).toEqual(["m2"]);
		// 섹션 제목이 "… · 정원 외" 로 조립되므로 여기서 '정원 외' 를 쓰면 문구가 중복된다.
		expect(freepassSummary(r)).toBe("기타 1명");
	});

	it("운영진 초과 + 미분류가 섞이면 둘 다 적힌다", () => {
		const rows = [
			withMember(member("m1", "confirmed", 1), { joinedYmd: OLD }),
			withMember(member("op", "confirmed", 2), { joinedYmd: OLD, admin: true }),
			withMember(member("m2", "confirmed", 3), { joinedYmd: OLD }),
		];
		const r = splitConfirmedByCapacity(rows, 1, S);
		expect(freepassSummary(r)).toBe("운영진 1 · 기타 1");
	});

	it("일정 미정(scheduledAt=null)이면 신규 분류를 하지 않는다", () => {
		const rows = [
			withMember(member("m1", "confirmed", 1), { joinedYmd: OLD }),
			withMember(member("nb", "confirmed", 2), { joinedYmd: NEW }),
		];
		const r = splitConfirmedByCapacity(rows, 1, null);
		expect(r.over.map((a) => a.member_id)).toEqual(["nb"]);
		expect(r.freepassNewbies).toEqual([]);
	});
});
