import { describe, expect, it } from "vitest";
import type { AdminMemberRow } from "../../../lib/supabase/adminMembers";
import type { CourtChargeRow, SessionAttendanceRow, SessionFeeRow } from "../../../lib/supabase/dues";
import { buildSessionSettle, courtPerHead, isDayCancelChargeable } from "./sessionSettle";

// 서버 `dues_generate_session_court` + `dues_court_targets`(20260818000000) 미러 검증.
// 이 테스트가 깨지면 화면의 '부과 누락' 판정이 서버와 갈렸다는 뜻이다.

const SCHEDULED = "2026-08-12T10:00:00Z"; // KST 8/12 19:00
const kst = (day: number, h: number, m = 0) =>
	new Date(Date.UTC(2026, 7, day, h - 9, m)).toISOString(); // KST 시각 → ISO

const member = (id: string, over: Partial<AdminMemberRow> = {}): AdminMemberRow => ({
	id,
	name: id,
	gender: null,
	birthYear: null,
	residence: null,
	skills: null,
	authUserId: null,
	isActive: true,
	isAdmin: false,
	isGuest: false,
	isHonorary: false,
	createdAt: SCHEDULED,
	...over,
});

const att = (memberId: string, status: string, over: Partial<SessionAttendanceRow> = {}): SessionAttendanceRow => ({
	memberId,
	status,
	confirmedAt: status === "confirmed" || status === "late_pool" ? kst(10, 12) : null,
	cancelledAt: null,
	...over,
});

/** 당일취소(부과 대상): 세션 당일 확정 → 3시간 뒤 취소. */
const dayCancel = (memberId: string): SessionAttendanceRow =>
	att(memberId, "cancelled", { confirmedAt: kst(12, 9), cancelledAt: kst(12, 12) });

/** 즉시 철회(grace): 세션 당일 확정 → 5초 뒤 취소. */
const graceCancel = (memberId: string): SessionAttendanceRow =>
	att(memberId, "cancelled", { confirmedAt: kst(12, 9), cancelledAt: kst(12, 9, 0) });

const session = (attendances: SessionAttendanceRow[], over: Partial<SessionFeeRow> = {}): SessionFeeRow => ({
	id: 1,
	title: null,
	status: "closed",
	scheduledAt: SCHEDULED,
	courtCount: 2,
	hours: 2,
	placeName: "TK배드민턴",
	courtFee: null,
	ruleCourtFee: null,
	attendeeIds: attendances.filter((a) => a.status === "confirmed" || a.status === "late_pool").map((a) => a.memberId),
	attendances,
	boardMemberIds: [], // 기본은 보드 추가분 없음. 필요한 테스트만 over 로 넘긴다.
	...over,
});

const charge = (id: number, memberId: string, over: Partial<CourtChargeRow> = {}): CourtChargeRow => ({
	id,
	memberId,
	sessionId: 1,
	sessionTitle: null,
	scheduledAt: SCHEDULED,
	amountDue: 6000,
	amountPaid: 0,
	status: "unpaid",
	payerHint: null,
	isDayCancel: false,
	voidedBy: null,
	...over,
});

const dict = (...ms: AdminMemberRow[]) => new Map(ms.map((m) => [m.id, m]));

describe("isDayCancelChargeable — 당일취소 술어 미러", () => {
	it("세션 당일 취소 + 확정 후 3시간 → 부과 대상", () => {
		expect(isDayCancelChargeable(dayCancel("a"), SCHEDULED)).toBe(true);
	});

	it("확정 후 5초 철회(grace 1시간 내) → 대상 아님 (김영주 2.7초 사고 회귀 방지)", () => {
		const a = att("a", "cancelled", { confirmedAt: kst(12, 9), cancelledAt: kst(12, 9) });
		expect(isDayCancelChargeable(a, SCHEDULED)).toBe(false);
	});

	it("정확히 1시간 → 대상(>= 경계 포함)", () => {
		const a = att("a", "cancelled", { confirmedAt: kst(12, 9), cancelledAt: kst(12, 10) });
		expect(isDayCancelChargeable(a, SCHEDULED)).toBe(true);
	});

	it("전날 취소(사전취소) → 대상 아님", () => {
		const a = att("a", "cancelled", { confirmedAt: kst(10, 12), cancelledAt: kst(11, 20) });
		expect(isDayCancelChargeable(a, SCHEDULED)).toBe(false);
	});

	it("확정 이력 없이 취소(대기 중 취소) → 대상 아님", () => {
		const a = att("a", "cancelled", { confirmedAt: null, cancelledAt: kst(12, 12) });
		expect(isDayCancelChargeable(a, SCHEDULED)).toBe(false);
	});

	it("KST 자정 경계: 세션 당일 23:30 취소는 대상, 다음날 00:10 은 아님", () => {
		expect(isDayCancelChargeable(att("a", "cancelled", { confirmedAt: kst(12, 20), cancelledAt: kst(12, 23, 30) }), SCHEDULED)).toBe(true);
		expect(isDayCancelChargeable(att("a", "cancelled", { confirmedAt: kst(12, 20), cancelledAt: kst(13, 0, 10) }), SCHEDULED)).toBe(false);
	});
});

describe("buildSessionSettle — 정액(6,000) 세션", () => {
	const members = dict(
		member("강민수"),
		member("이준호"),
		member("최서연"),
		member("운영진A", { isAdmin: true }),
		member("김철수"),
	);

	it("당일취소가 섞이면 부과 건수 > 참석 인원 — '참석×6,000' 불일치를 항목으로 분해한다", () => {
		const s = session([
			att("강민수", "confirmed"),
			att("이준호", "confirmed"),
			att("운영진A", "confirmed"),
			dayCancel("최서연"),
		]);
		const settle = buildSessionSettle(
			s,
			[
				charge(1, "강민수", { amountPaid: 6000, status: "paid" }),
				charge(2, "이준호"),
				charge(3, "최서연", { isDayCancel: true }),
			],
			members,
			6000,
			[{ direction: "out", amount: 80000 }],
		);

		expect(settle.mode).toBe("flat");
		expect(settle.perHead).toBe(6000);
		expect(settle.attendCount).toBe(3); // 참석 3명(운영진 포함)
		expect(settle.adminAttendCount).toBe(1);
		expect(settle.targetDayCancelCount).toBe(1);
		// 참석 3 × 6,000 = 18,000 이 아니라 → 운영진 1명 빠지고 당일취소 1명 붙어 3건 18,000
		expect(settle.targetCount).toBe(3);
		expect(settle.activeCount).toBe(3);
		expect(settle.dueSum).toBe(18000);
		expect(settle.received).toBe(6000);
		expect(settle.unpaidSum).toBe(12000);
		expect(settle.expense).toBe(80000);
		expect(settle.net).toBe(6000 - 80000);
		expect(settle.expectedNet).toBe(18000 - 80000);
		expect(settle.missing).toEqual([]);
		expect(settle.exempt.map((e) => [e.name, e.reason])).toEqual([["운영진A", "adminFlat"]]);
	});

	it("참석 확정인데 부과가 없으면 missing 으로 잡는다", () => {
		const s = session([att("강민수", "confirmed"), att("김철수", "confirmed")]);
		const settle = buildSessionSettle(s, [charge(1, "강민수")], members, 6000, []);
		expect(settle.missing.map((m) => m.name)).toEqual(["김철수"]);
		expect(settle.missing[0].targetReason).toBe("attending");
	});

	it("진행 중 미발행분은 누락이 아니라 종료 후 자동 부과 예정", () => {
		const s = session([att("강민수", "confirmed"), dayCancel("최서연")], { status: "active" });
		const settle = buildSessionSettle(s, [], members, 6000, []);
		expect(settle.missing).toEqual([]);
		expect(settle.pending.map((m) => [m.name, m.targetReason])).toEqual([
			["강민수", "attending"],
			["최서연", "dayCancel"],
		]);
		expect(settle.flaggedCount).toBe(0);
		expect(settle.rosterCounts.pending).toBe(2);
	});

	it("closed 세션이어도 발행 대기 초안에 있으면 실제 누락과 분리한다", () => {
		const s = session(
			[att("강민수", "confirmed"), dayCancel("최서연"), att("김철수", "waitlisted")],
			{ boardMemberIds: ["김철수"] },
		);
		const settle = buildSessionSettle(s, [], members, 6000, [], new Set(["강민수", "최서연", "김철수"]));
		expect(settle.missing).toEqual([]);
		expect(settle.pending.map((m) => [m.name, m.targetReason])).toEqual([
			["강민수", "attending"],
			["김철수", "boardAdded"],
			["최서연", "dayCancel"],
		]);
		expect(settle.flaggedCount).toBe(0);
	});

	it("8/30 #165 회귀: 대상 28·기발행 16·초안 16(4건 중복)은 발행대기 12, 확인 0", () => {
		const atts = Array.from({ length: 28 }, (_, i) => att(`p${i}`, "confirmed"));
		const charges = Array.from({ length: 16 }, (_, i) => charge(i + 1, `p${i}`));
		// 종료 때 생긴 초안 16명 중 p12~p15 네 명은 이후 입금 확인으로 즉석 발행된 상태.
		const draftIds = new Set(Array.from({ length: 16 }, (_, i) => `p${i + 12}`));
		const settle = buildSessionSettle(session(atts), charges, dict(), 6000, [], draftIds);
		expect(settle.targetCount).toBe(28);
		expect(settle.activeCount).toBe(16);
		expect(settle.pending).toHaveLength(12);
		expect(settle.missing).toEqual([]);
		expect(settle.flaggedCount).toBe(0);
	});

	it("부과삭제(void)된 사람은 missing 이 아니다 — 의도된 면제이므로 재부과를 유도하지 않는다", () => {
		const s = session([att("강민수", "confirmed"), dayCancel("최서연")]);
		const settle = buildSessionSettle(
			s,
			[charge(1, "강민수"), charge(2, "최서연", { isDayCancel: true, status: "void", voidedBy: "운영진A" })],
			members,
			6000,
			[],
		);
		expect(settle.missing).toEqual([]);
		expect(settle.dueSum).toBe(6000); // void 는 낼 돈에서 빠진다
		expect(settle.voidSum).toBe(6000);
		expect(settle.charged.find((c) => c.name === "최서연")?.voidedByName).toBe("운영진A");
	});

	it("grace 철회는 exempt 로 사유 노출(부과 대상도, 누락도 아니다)", () => {
		const s = session([att("강민수", "confirmed"), graceCancel("최서연")]);
		const settle = buildSessionSettle(s, [charge(1, "강민수")], members, 6000, []);
		expect(settle.missing).toEqual([]);
		expect(settle.exempt.map((e) => [e.name, e.reason])).toEqual([["최서연", "grace"]]);
	});

	it("게스트 대납은 대납자 이름을 명단에 붙인다", () => {
		const withGuest = dict(...[...members.values()], member("김하늘", { isGuest: true }), member("박지훈"));
		const s = session([att("김하늘", "confirmed")]);
		const settle = buildSessionSettle(s, [charge(1, "김하늘", { payerHint: "박지훈" })], withGuest, 6000, []);
		expect(settle.charged[0].payerName).toBe("박지훈");
	});

	it("비회원 입금은 순액에 더한다", () => {
		const s = session([att("강민수", "confirmed")]);
		const settle = buildSessionSettle(
			s,
			[charge(1, "강민수", { amountPaid: 6000, status: "paid" })],
			members,
			6000,
			[{ direction: "in", amount: 12000 }, { direction: "out", amount: 30000 }],
		);
		expect(settle.externalIn).toBe(12000);
		expect(settle.net).toBe(6000 + 12000 - 30000);
	});
});

describe("buildSessionSettle — 엔빵 세션", () => {
	const members = dict(member("A"), member("B"), member("C"), member("운영진A", { isAdmin: true }));

	it("총액÷대상수 10원 절상 + 운영진 포함 + 당일취소도 분모·부과 포함", () => {
		const s = session(
			[att("A", "confirmed"), att("B", "confirmed"), att("운영진A", "confirmed"), dayCancel("C")],
			{ courtFee: 100000 },
		);
		// 분모 = 참석 3 + 당일취소 1 = 4 → 100000/4 = 25000 (절상해도 25000)
		const settle = buildSessionSettle(
			s,
			[
				charge(1, "A", { amountDue: 25000 }),
				charge(2, "B", { amountDue: 25000 }),
				charge(3, "운영진A", { amountDue: 25000 }),
				charge(4, "C", { amountDue: 25000, isDayCancel: true }),
			],
			members,
			6000,
			[],
		);
		expect(settle.mode).toBe("split");
		expect(settle.total).toBe(100000);
		expect(settle.attendCount).toBe(3);
		expect(settle.targetDayCancelCount).toBe(1); // C — 엔빵에서도 부과 대상
		expect(settle.targetCount).toBe(4);
		expect(settle.perHead).toBe(25000);
		expect(settle.missing).toEqual([]); // 운영진·당일취소 모두 엔빵 대상 — 부과가 있어야 정상
		expect(settle.exempt).toEqual([]); // 엔빵 당일취소 면제는 더 이상 없다
		expect(settle.dueSum).toBe(100000); // 인당 × 분모 = 총액과 정확히 일치
	});

	it("10원 절상: 나누어떨어지지 않으면 올린다(총액보다 조금 더 걷힌다)", () => {
		const s = session([att("A", "confirmed"), att("B", "confirmed"), att("C", "confirmed")], { courtFee: 100000 });
		const settle = buildSessionSettle(s, [], members, 6000, []);
		expect(settle.perHead).toBe(33340); // 100000/3 = 33333.3 → 절상 33340 (종전 버림은 33330)
	});

	it("정액 근처 스냅: 정액 이상 +200원 미만은 정액으로, 정액보다 싸면 계산값 그대로", () => {
		// 117,000 ÷ 19 = 6157.9 → 절상 6160 → 정액(6000)+200 미만이라 6000 으로 스냅
		const many = Array.from({ length: 19 }, (_, i) => att(`P${i}`, "confirmed"));
		const snapped = buildSessionSettle(session(many, { courtFee: 117000 }), [], dict(), 6000, []);
		expect(snapped.perHead).toBe(6000);
		// 6,300 은 스냅 구간(6000~6199) 밖 → 그대로
		const outside = buildSessionSettle(
			session(Array.from({ length: 10 }, (_, i) => att(`Q${i}`, "confirmed")), { courtFee: 63000 }),
			[], dict(), 6000, [],
		);
		expect(outside.perHead).toBe(6300);
		// 정액보다 싸게 나오면 올리지 않는다(한방향)
		const cheap = buildSessionSettle(
			session(Array.from({ length: 10 }, (_, i) => att(`R${i}`, "confirmed")), { courtFee: 58500 }),
			[], dict(), 6000, [],
		);
		expect(cheap.perHead).toBe(5850);
	});

	// 실제 사고(세션 237, 손형일): 정원 만석이라 대기였는데 현장에서 보드에 넣어 9경기를 뛰었다.
	// 명단만 보면 부과 대상이 아니어서 코트를 쓴 사람이 한 푼도 안 냈다.
	it("보드에 수동 추가된 대기자도 부과 대상·분모에 들어간다", () => {
		const s = session(
			[att("A", "confirmed"), att("B", "confirmed"), att("C", "waitlisted")],
			{ courtFee: 90000, boardMemberIds: ["A", "B", "C"] },
		);
		const settle = buildSessionSettle(s, [], members, 6000, []);
		expect(settle.attendCount).toBe(2); // 명단상 확정은 2명
		expect(settle.boardAddedCount).toBe(1); // C 는 보드로 들어옴
		expect(settle.targetCount).toBe(3);
		expect(settle.perHead).toBe(30000); // 90,000 ÷ 3 — 분모에도 들어간다
		expect(settle.missing.map((m) => m.name)).toEqual(["A", "B", "C"]);
		expect(settle.exempt).toEqual([]); // 대기 사유로 면제되지 않는다
	});

	it("보드에서 뺀 확정자는 그대로 부과 대상이다(교집합이 아니라 합집합)", () => {
		const s = session(
			[att("A", "confirmed"), att("B", "confirmed")],
			{ courtFee: 90000, boardMemberIds: ["A"] }, // B 는 보드에 없다
		);
		const settle = buildSessionSettle(s, [], members, 6000, []);
		expect(settle.targetCount).toBe(2);
		expect(settle.boardAddedCount).toBe(0);
		expect(settle.perHead).toBe(45000);
	});

	it("참석행이 아예 없는데 보드에만 있는 회원도 대상이다(현장 직접 추가)", () => {
		const s = session([att("A", "confirmed")], { courtFee: 90000, boardMemberIds: ["A", "C"] });
		const settle = buildSessionSettle(s, [], members, 6000, []);
		expect(settle.boardAddedCount).toBe(1);
		expect(settle.targetCount).toBe(2);
		expect(settle.missing.map((m) => m.name)).toEqual(["A", "C"]);
	});

	it("당일취소인데 보드에 올라가 실제로 뛰었으면 당일취소로 세지 않는다", () => {
		const s = session([att("A", "confirmed"), dayCancel("C")], { courtFee: 90000, boardMemberIds: ["A", "C"] });
		const settle = buildSessionSettle(s, [], members, 6000, []);
		expect(settle.targetDayCancelCount).toBe(0); // 참여자로 본다 — 당일취소 딱지를 붙이지 않는다
		expect(settle.boardAddedCount).toBe(1); // 대신 '보드 추가분'으로 계상된다(이중 계상 없음)
		expect(settle.targetCount).toBe(2); // 항등식: 참석 1 + 당일취소 0 + 보드추가 1 = 2
	});

	it("정액 세션의 보드 추가분도 대상이다(운영진은 여전히 면제)", () => {
		const s = session(
			[att("A", "confirmed"), att("C", "waitlisted"), att("운영진A", "waitlisted")],
			{ boardMemberIds: ["A", "C", "운영진A"] },
		);
		const settle = buildSessionSettle(s, [], members, 6000, []);
		expect(settle.mode).toBe("flat");
		expect(settle.boardAddedCount).toBe(1); // C 만(운영진A 는 면제)
		expect(settle.targetCount).toBe(2);
		expect(settle.exempt.map((e) => [e.name, e.reason])).toEqual([["운영진A", "adminFlat"]]);
	});

	it("반복 규칙의 기본 총액을 물려받은 회차도 엔빵으로 판정한다(세션 총액 null)", () => {
		const s = session([att("A", "confirmed"), att("B", "confirmed")], { courtFee: null, ruleCourtFee: 90000 });
		const settle = buildSessionSettle(s, [], members, 6000, []);
		expect(settle.mode).toBe("split");
		expect(settle.perHead).toBe(45000);
		expect(settle.missing.map((m) => m.name)).toEqual(["A", "B"]); // 전원 부과 누락
	});

	it("세션 총액이 규칙 총액을 덮어쓴다", () => {
		const s = session([att("A", "confirmed")], { courtFee: 50000, ruleCourtFee: 90000 });
		expect(buildSessionSettle(s, [], members, 6000, []).perHead).toBe(50000);
	});

	it("엔빵→정액 전환 잔재(운영진 고아 부과)는 extra 로 표시한다", () => {
		const s = session([att("A", "confirmed"), att("운영진A", "confirmed")]); // 총액 없음 = 정액
		const settle = buildSessionSettle(s, [charge(1, "A"), charge(2, "운영진A")], members, 6000, []);
		expect(settle.extra.map((c) => [c.name, c.extraReason])).toEqual([["운영진A", "adminFlat"]]);
	});

	it("참석 기록이 아예 없는 부과(선납 후 세션 이탈)는 noAttendance 로 표시한다", () => {
		const s = session([att("A", "confirmed")]);
		const settle = buildSessionSettle(s, [charge(1, "A"), charge(2, "B", { amountPaid: 6000, status: "paid" })], members, 6000, []);
		expect(settle.extra.map((c) => [c.name, c.extraReason])).toEqual([["B", "noAttendance"]]);
		expect(settle.received).toBe(6000);
	});

	it("참석 0명이면 인당 0(서버 head=0 가드 대응) — 나눗셈 폭주 없음", () => {
		const s = session([], { courtFee: 100000 });
		const settle = buildSessionSettle(s, [], members, 6000, []);
		expect(settle.perHead).toBe(0);
		expect(settle.missing).toEqual([]);
	});
});

describe("buildSessionSettle — 안 걷는 회차(총액 0 이하)", () => {
	const members = dict(member("A"), member("B"), member("운영진A", { isAdmin: true }));

	// 세션 228(2026-08-22 정모) 사고 회귀: 총액 0 을 정액으로 읽어 18명에게 6,000원이 부과됐다.
	// 서버는 20260823000000 에서 0 이하를 무부과로 갈랐다 — 미러가 따라가지 않으면 화면이
	// 참석자 전원을 '부과 누락'으로 오탐한다.
	it("총액 0 이면 정액이 아니라 무부과 — 참석자를 부과 누락으로 오탐하지 않는다", () => {
		const s = session(
			[att("A", "confirmed"), att("B", "confirmed"), att("운영진A", "confirmed")],
			{ courtFee: 0 },
		);
		const settle = buildSessionSettle(s, [], members, 6000, []);
		expect(settle.mode).toBe("none");
		expect(settle.perHead).toBe(0);
		expect(settle.total).toBeNull();
		expect(settle.targetCount).toBe(0);
		expect(settle.missing).toEqual([]); // ← 오탐 회귀 방지의 핵심
		expect(settle.dueSum).toBe(0);
	});

	it("참석자는 '안 걷는 회차'로 면제 명단에 뜬다(운영진도 같은 사유)", () => {
		const s = session([att("A", "confirmed"), att("운영진A", "confirmed")], { courtFee: 0 });
		const settle = buildSessionSettle(s, [], members, 6000, []);
		expect(settle.exempt.map((e) => [e.name, e.reason])).toEqual([
			["A", "noCourtFee"],
			["운영진A", "noCourtFee"],
		]);
	});

	it("사전취소·대기는 종전 사유를 유지한다(무부과가 다른 사유를 덮지 않는다)", () => {
		const s = session(
			[att("A", "confirmed"), graceCancel("B"), att("운영진A", "waitlisted")],
			{ courtFee: 0 },
		);
		const settle = buildSessionSettle(s, [], members, 6000, []);
		// grace 는 조용한 사유라 명단에 남고, 대기는 노출하지 않는다(종전 규칙 그대로).
		// 정렬은 사유 → 이름 순(exemptSorted) 이라 grace 가 noCourtFee 보다 앞이다.
		expect(settle.exempt.map((e) => [e.name, e.reason])).toEqual([
			["B", "grace"],
			["A", "noCourtFee"],
		]);
		expect(settle.graceCount).toBe(1);
	});

	it("무부과 회차에 남은 부과는 잔재(stale)로 세운다 — 정리 대상임을 화면이 말한다", () => {
		const s = session([att("A", "confirmed"), att("B", "confirmed")], { courtFee: 0 });
		const settle = buildSessionSettle(s, [charge(1, "A"), charge(2, "B")], members, 6000, []);
		expect(settle.extra.map((c) => [c.name, c.extraReason])).toEqual([
			["A", "noCourtFee"],
			["B", "noCourtFee"],
		]);
		expect(settle.liveExtraCount).toBe(2);
		expect(settle.roster.filter((r) => r.kind === "stale").map((r) => r.name)).toEqual(["A", "B"]);
	});

	it("음수 총액도 무부과 — 오타가 정액으로 조용히 흘러가지 않는다", () => {
		const s = session([att("A", "confirmed")], { courtFee: -6000 });
		expect(buildSessionSettle(s, [], members, 6000, []).mode).toBe("none");
	});

	it("규칙 총액 0 을 물려받은 회차도 무부과(세션 총액 null)", () => {
		const s = session([att("A", "confirmed")], { courtFee: null, ruleCourtFee: 0 });
		expect(buildSessionSettle(s, [], members, 6000, []).mode).toBe("none");
	});

	it("총액 미입력(null)은 종전 그대로 정액 — 0 과 갈린다", () => {
		const s = session([att("A", "confirmed")], { courtFee: null, ruleCourtFee: null });
		const settle = buildSessionSettle(s, [], members, 6000, []);
		expect(settle.mode).toBe("flat");
		expect(settle.perHead).toBe(6000);
		expect(settle.missing.map((m) => m.name)).toEqual(["A"]);
	});
});

describe("courtPerHead — 서버 dues_court_per_head 미러", () => {
	// 정산함 '신규 세션' 칩 금액이 이 값을 쓴다. 정액을 하드코딩하면 엔빵 회차에 틀린 금액을
	// 제안하고, 그걸 확정하면 서버가 재발행해 둔 부과를 덮는다(세션 147 사고, 20260823090000).
	it("총액 미입력이면 정액", () => {
		expect(courtPerHead(session([att("A", "confirmed")]), 6000)).toBe(6000);
	});

	it("총액이 있으면 엔빵 — 분모는 운영진 포함(회원 정보 불필요)", () => {
		const s = session(
			[att("A", "confirmed"), att("B", "confirmed"), att("운영진A", "confirmed")],
			{ courtFee: 45000 },
		);
		// 45,000 ÷ 3 = 15,000 (운영진도 분모에 든다)
		expect(courtPerHead(s, 6000)).toBe(15000);
	});

	it("실제 사고 재현: 45,000 ÷ 9명 = 5,000 (정액 6,000 이 아니다)", () => {
		const nine = Array.from({ length: 9 }, (_, i) => att(`p${i}`, "confirmed"));
		expect(courtPerHead(session(nine, { courtFee: 45000 }), 6000)).toBe(5000);
	});

	it("당일취소·보드 추가분도 분모에 든다(서버 대상 술어와 동일)", () => {
		const s = session([att("A", "confirmed"), dayCancel("B")], { courtFee: 40000, boardMemberIds: ["C"] });
		expect(courtPerHead(s, 6000)).toBe(13340); // 40,000 ÷ 3 = 13,333.3 → 10원 절상
	});

	it("총액 0 이하면 null — 안 걷는 회차라 칩을 감춘다", () => {
		expect(courtPerHead(session([att("A", "confirmed")], { courtFee: 0 }), 6000)).toBeNull();
		expect(courtPerHead(session([att("A", "confirmed")], { courtFee: -5000 }), 6000)).toBeNull();
	});

	it("대상 0명이면 null(나눗셈 폭주 없음)", () => {
		expect(courtPerHead(session([], { courtFee: 45000 }), 6000)).toBeNull();
	});

	it("정액 근처 스냅도 같이 적용된다(한방향)", () => {
		// 117,000 ÷ 19 = 6,157.9 → 절상 6,160 → 정액 +200 미만이라 6,000
		const nineteen = Array.from({ length: 19 }, (_, i) => att(`p${i}`, "confirmed"));
		expect(courtPerHead(session(nineteen, { courtFee: 117000 }), 6000)).toBe(6000);
	});
});

// 시트는 두 항등식을 그대로 화면에 쓴다. 닫히지 않으면 "숫자가 안 맞는다"는 원래 문제로 되돌아가므로
// 어떤 조합에서도 닫히는지 검사한다.
//   ① 정액: 참석 − 운영진 + 당일취소 + 보드추가 = 부과 대상  /  엔빵: 참석 + 당일취소 + 보드추가 = 부과 대상
//   ② 부과 대상 − 누락 − 발행대기 − 부과삭제 + 대상아닌부과 = 실제 부과 건수
function expectIdentities(settle: ReturnType<typeof buildSessionSettle>) {
	const bridge =
		settle.mode === "none"
			? 0 // 안 걷는 회차: 참석했든 아니든 부과 대상이 0
			: (settle.mode === "split" ? settle.attendCount : settle.attendCount - settle.adminAttendCount) +
				settle.targetDayCancelCount +
				settle.boardAddedCount;
	expect(bridge).toBe(settle.targetCount);
	expect(settle.targetCount - settle.missing.length - settle.pending.length - settle.deadOnTargetCount + settle.liveExtraCount).toBe(settle.activeCount);
}

describe("buildSessionSettle — 항등식이 닫힌다", () => {
	const members = dict(
		member("A"),
		member("B"),
		member("C"),
		member("D"),
		member("게스트", { isGuest: true }),
		member("운영진A", { isAdmin: true }),
		member("운영진B", { isAdmin: true }),
	);

	it("정액 · 운영진 + 당일취소 + grace + 누락 + void + 잔재가 모두 섞인 최악 케이스", () => {
		const s = session([
			att("A", "confirmed"),
			att("B", "late_pool"),
			att("게스트", "confirmed"),
			att("운영진A", "confirmed"),
			att("운영진B", "confirmed"),
			dayCancel("C"),
			graceCancel("D"),
			att("없는사람", "waitlisted"),
		]);
		const settle = buildSessionSettle(
			s,
			[
				charge(1, "A", { amountPaid: 6000, status: "paid" }),
				charge(2, "게스트", { payerHint: "B" }),
				charge(3, "C", { isDayCancel: true, status: "void", voidedBy: "운영진A" }),
				charge(4, "D", { amountPaid: 6000, status: "paid" }), // grace 인데 이미 낸 잔재
				charge(5, "운영진A"), // 정액 운영진 고아
				// B 는 부과 누락
			],
			members,
			6000,
			[{ direction: "out", amount: 60000 }],
		);
		expect(settle.attendCount).toBe(5);
		expect(settle.adminAttendCount).toBe(2);
		expect(settle.targetDayCancelCount).toBe(1); // C
		expect(settle.targetCount).toBe(4); // A·B·게스트·C
		expect(settle.missing.map((m) => m.name)).toEqual(["B"]);
		expect(settle.deadOnTargetCount).toBe(1); // C void
		expect(settle.liveExtraCount).toBe(2); // D(grace) · 운영진A
		expect(settle.activeCount).toBe(4); // 4 − 1 − 1 + 2
		expectIdentities(settle);
		expect(settle.dueSum).toBe(24000); // A·게스트·D·운영진A
		expect(settle.received).toBe(12000);
		expect(settle.net).toBe(12000 - 60000);
	});

	it("엔빵 · 당일취소 + 누락이 섞여도 닫힌다", () => {
		// 분모 = 참석 3 + 당일취소 1 = 4 → 99,000 ÷ 4 = 24,750. 당일취소 C 도 부과 대상이므로 누락에 잡힌다.
		const s = session([att("A", "confirmed"), att("B", "confirmed"), att("운영진A", "confirmed"), dayCancel("C")], { courtFee: 99000 });
		const settle = buildSessionSettle(s, [charge(1, "A", { amountDue: 24750 })], members, 6000, []);
		expect(settle.perHead).toBe(24750);
		expect(settle.targetCount).toBe(4);
		expect(settle.missing.map((m) => m.name)).toEqual(["B", "C", "운영진A"]);
		expectIdentities(settle);
	});

	it("부과·참석이 완전히 일치하면 확인 대상이 0이다(정상 세션은 조용해야 한다)", () => {
		const s = session([att("A", "confirmed"), att("B", "confirmed")]);
		const settle = buildSessionSettle(s, [charge(1, "A"), charge(2, "B")], members, 6000, []);
		expect([settle.missing.length, settle.extra.length]).toEqual([0, 0]);
		expectIdentities(settle);
	});
});

// 화면은 부과 있는 사람·누락·정상 면제를 한 목록(roster)에 세우고 우측에 사유를 적는다.
describe("buildSessionSettle — 통합 명단(roster)", () => {
	const members = dict(
		member("완납"),
		member("미납"),
		member("당일취소"),
		member("누락"),
		member("잔재"),
		member("고아"),
		member("운영진A", { isAdmin: true }),
		member("즉시철회"),
	);

	const settle = buildSessionSettle(
		session([
			att("완납", "confirmed"),
			att("미납", "confirmed"),
			att("누락", "confirmed"),
			att("운영진A", "confirmed"),
			dayCancel("당일취소"),
			graceCancel("즉시철회"),
			att("잔재", "cancelled", { confirmedAt: kst(3, 9), cancelledAt: kst(8, 15) }), // 사전취소인데 완납
		]),
		[
			charge(1, "완납", { amountPaid: 6000, status: "paid" }),
			charge(2, "미납"),
			charge(3, "당일취소", { isDayCancel: true }),
			charge(4, "잔재", { amountPaid: 6000, status: "paid" }),
			charge(5, "고아", { amountPaid: 6000, status: "paid" }), // 참석 기록 없음
		],
		members,
		6000,
		[],
	);

	it("부과 있는 사람 + 누락 + 정상 면제를 모두 담는다(빠지는 사람 없음)", () => {
		expect(settle.roster.map((r) => r.name).sort()).toEqual(
			["고아", "누락", "당일취소", "미납", "완납", "운영진A", "잔재", "즉시철회"].sort(),
		);
		// charged(5) + missing(1) + pending(0) + exempt(운영진A·즉시철회 2) = 8
		expect(settle.roster.length).toBe(settle.charged.length + settle.missing.length + settle.pending.length + settle.exempt.length);
	});

	it("이름 가나다순으로 정렬한다(사람을 이름으로 찾는 게 명단의 용도)", () => {
		expect(settle.roster.map((r) => r.name)).toEqual([
			"고아", "누락", "당일취소", "미납", "완납", "운영진A", "잔재", "즉시철회",
		]);
	});

	it("한 사람이 두 줄로 나오지 않는다 — grace·운영진 등이 부과 행까지 가진 경우 포함", () => {
		const names = settle.roster.map((r) => r.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it("사전취소·대기한 운영진은 '운영진 면제'로 올라오지 않는다(오지도 않은 사람이 면제로 보임 방지)", () => {
		const ms = dict(member("가회원"), member("운영진A", { isAdmin: true }), member("운영진B", { isAdmin: true }));
		const s = buildSessionSettle(
			session([
				att("가회원", "confirmed"),
				att("운영진A", "confirmed"), // 왔음 → 면제로 노출
				att("운영진B", "cancelled", { confirmedAt: kst(3, 9), cancelledAt: kst(8, 15) }), // 사전취소 → 미노출
			]),
			[charge(1, "가회원")],
			ms,
			6000,
			[],
		);
		expect(s.exempt.map((e) => [e.name, e.reason])).toEqual([["운영진A", "adminFlat"]]);
		expect(s.adminAttendCount).toBe(1);
		expect(s.roster.map((r) => r.name)).toEqual(["가회원", "운영진A"]);
		expectIdentities(s);
	});

	it("헤더 카운트는 서로 겹치지 않는다 — 합 + 확인필요 = 명단 수", () => {
		const { paid, unpaid, dead, none, pending } = settle.rosterCounts;
		expect(paid + unpaid + dead + none + pending + settle.flaggedCount).toBe(settle.roster.length);
		// '잔재'는 완납이지만 확인필요라 완납에서 빠지고, '누락'은 부과없음에서 빠진다.
		expect({ paid, unpaid, dead, none, pending, flagged: settle.flaggedCount }).toEqual({
			paid: 2, // 완납 · 고아(완납이고 확인 대상 아님) — '잔재'는 flagged 로 빠짐
			unpaid: 2, // 미납 · 당일취소(미납 상태)
			dead: 0,
			none: 2, // 운영진A · 즉시철회 — '누락'은 flagged 로 빠짐
			pending: 0,
			flagged: 2, // 누락 + 잔재
		});
	});

	it("확인 필요 건수는 카드 ⚠배지와 같은 값이고 고아 부과는 포함하지 않는다", () => {
		expect(settle.flaggedCount).toBe(settle.missing.length + settle.staleCharges.length);
		expect(settle.orphanCharges.length).toBe(1); // '고아' 는 명단에 있지만 확인 대상 아님
	});

	it("부과 없는 행은 charge=null 이고 사유를 들고 있다(우측 사유 렌더용)", () => {
		const byName = new Map(settle.roster.map((r) => [r.name, r]));
		expect(byName.get("누락")!.charge).toBeNull();
		expect(byName.get("누락")!.reason).toBeNull(); // 문구가 엔빵/정액에 따라 갈려 화면에서 결정
		expect(byName.get("누락")!.targetReason).toBe("attending");
		expect(byName.get("운영진A")!.charge).toBeNull();
		expect(byName.get("운영진A")!.reason).toBe("adminFlat");
		expect(byName.get("즉시철회")!.reason).toBe("grace");
		expect(byName.get("잔재")!.reason).toBe("preCancel");
		expect(byName.get("잔재")!.charge?.amountPaid).toBe(6000);
		expect(byName.get("완납")!.reason).toBeNull();
	});

	it("void 된 당일취소는 stale 이 아니라 charged 로 남는다(이미 처리된 건은 확인 대상 아님)", () => {
		const s2 = buildSessionSettle(
			session([att("완납", "confirmed"), graceCancel("즉시철회")]),
			[charge(1, "완납"), charge(2, "즉시철회", { isDayCancel: true, status: "void", voidedBy: "운영진A" })],
			members,
			6000,
			[],
		);
		const row = s2.roster.find((r) => r.name === "즉시철회" && r.charge != null)!;
		expect(row.kind).toBe("charged");
		expect(s2.roster.filter((r) => r.kind === "stale")).toEqual([]);
	});
});

// 배지가 늑대소년이 되지 않게: '확인 필요'는 아직 손대야 할 것만.
describe("buildSessionSettle — 확인 대상 좁히기", () => {
	const members = dict(member("A"), member("차성민"), member("김재완"), member("옛회원"));

	it("이미 부과삭제(void)한 grace 잔재는 확인 대상이 아니다 (7/25 #200 실측)", () => {
		const s = session([att("A", "confirmed"), graceCancel("차성민"), graceCancel("김재완")]);
		const settle = buildSessionSettle(
			s,
			[
				charge(1, "A", { amountPaid: 6000, status: "paid" }),
				charge(2, "차성민", { status: "void", voidedBy: "A" }),
				charge(3, "김재완", { status: "void", voidedBy: "A" }),
			],
			members,
			6000,
			[],
		);
		expect(settle.extra.length).toBe(2); // 규칙상 대상은 아니고
		expect(settle.staleCharges).toEqual([]); // 이미 처리됐으니 다시 묻지 않는다
		expect(settle.missing).toEqual([]);
		expectIdentities(settle);
	});

	it("참석 기록이 없는 부과는 orphan 으로 빼서 확인 대상에서 제외한다 (7/5 #166 실측)", () => {
		const s = session([att("A", "confirmed")]);
		const settle = buildSessionSettle(
			s,
			[charge(1, "A"), charge(2, "옛회원", { amountPaid: 6000, status: "paid" })],
			members,
			6000,
			[],
		);
		expect(settle.orphanCharges.map((c) => c.name)).toEqual(["옛회원"]);
		expect(settle.staleCharges).toEqual([]);
		expectIdentities(settle);
	});

	it("살아 있고 참석 기록도 있는 위반만 확인 대상 — 사전취소 완납 건", () => {
		const s = session([att("A", "confirmed"), att("차성민", "cancelled", { confirmedAt: kst(3, 9), cancelledAt: kst(8, 15) })]);
		const settle = buildSessionSettle(
			s,
			[charge(1, "A"), charge(2, "차성민", { amountPaid: 6000, status: "paid" })],
			members,
			6000,
			[],
		);
		expect(settle.staleCharges.map((c) => [c.name, c.extraReason])).toEqual([["차성민", "preCancel"]]);
	});
});

// 프로덕션 실측(2026-08) 회귀 — '참석 × 6,000'이 통장과 어긋난 실제 두 세션.
describe("buildSessionSettle — 실측 회귀(에이트민턴 8/9·8/2)", () => {
	it("8/9 #106: 참석 23명인데 낼 돈 156,000 — 운영진 −1, 당일취소 +3, 사전취소 잔재 +1", () => {
		const members = new Map<string, AdminMemberRow>();
		const atts: SessionAttendanceRow[] = [];
		const charges = [];
		// 참석 22명(비운영진) + 운영진 1명
		for (let i = 0; i < 22; i++) {
			members.set(`p${i}`, member(`p${i}`));
			atts.push(att(`p${i}`, "confirmed"));
			charges.push(charge(100 + i, `p${i}`, { amountPaid: 6000, status: "paid" }));
		}
		members.set("운영진", member("운영진", { isAdmin: true }));
		atts.push(att("운영진", "confirmed"));
		// 당일취소 부과대상 3명
		for (let i = 0; i < 3; i++) {
			members.set(`dc${i}`, member(`dc${i}`));
			atts.push(dayCancel(`dc${i}`));
			charges.push(charge(200 + i, `dc${i}`, { isDayCancel: true, amountPaid: 6000, status: "paid" }));
		}
		// grace 철회 1명(미부과)
		members.set("즉시철회", member("즉시철회"));
		atts.push(graceCancel("즉시철회"));
		// 심상욱: 8/8 사전취소인데 선납 완료 → 자동정리(amount_paid=0 게이트)가 못 지운 잔재
		members.set("심상욱", member("심상욱"));
		atts.push(att("심상욱", "cancelled", { confirmedAt: kst(3, 9), cancelledAt: kst(8, 15) }));
		charges.push(charge(300, "심상욱", { amountPaid: 6000, status: "paid" }));

		const settle = buildSessionSettle(session(atts), charges, members, 6000, [{ direction: "out", amount: 195000 }]);
		expect(settle.attendCount).toBe(23);
		expect(settle.adminAttendCount).toBe(1);
		expect(settle.targetDayCancelCount).toBe(3);
		expect(settle.targetCount).toBe(25);
		expect(settle.missing).toEqual([]);
		expect(settle.liveExtraCount).toBe(1);
		expect(settle.staleCharges.map((c) => c.name)).toEqual(["심상욱"]);
		expect(settle.activeCount).toBe(26);
		expectIdentities(settle);
		// 여기가 핵심: 참석 23 × 6,000 = 138,000 ≠ 낼 돈 156,000 (차이 +18,000)
		expect(settle.attendCount * 6000).toBe(138000);
		expect(settle.dueSum).toBe(156000);
		expect(settle.received).toBe(156000);
		expect(settle.expense).toBe(195000);
		expect(settle.net).toBe(-39000);
		expect(settle.extra.map((c) => [c.name, c.extraReason])).toEqual([["심상욱", "preCancel"]]);
		expect(settle.exempt.map((e) => [e.name, e.reason])).toEqual([
			["운영진", "adminFlat"],
			["즉시철회", "grace"],
		]);
	});
});
