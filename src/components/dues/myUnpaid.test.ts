import { describe, expect, it } from "vitest";
import type { ChargeStatus, MyChargeRow } from "../../lib/supabase/dues";
import { chargeLabel, selectUnpaid, unpaidSum } from "./myUnpaid";

// 미납 판정은 내 회비 탭 + 진입 알림(UnpaidDuesAlert)이 공유하는 단일 소스.
// 오탐(안 낼 돈을 미납으로) 은 회원에게 모달로 들이대는 문구라 특히 위험 → 상태·이월 경계를 고정한다.

const base: MyChargeRow = {
	id: 1,
	kind: "monthly_fee",
	amountDue: 5000,
	amountPaid: 0,
	status: "unpaid",
	periodYm: "2026-08",
	deferredTo: null,
	sessionId: null,
	sessionTitle: null,
	scheduledAt: null,
	isProxy: false,
	label: null,
};
const fee = (o: Partial<MyChargeRow> = {}): MyChargeRow => ({ ...base, ...o });
/** 수동 부과(회식·공동구매) — 묶음 축이 batch_key 라 월/세션이 없고 이름을 행이 들고 있다. */
const manual = (o: Partial<MyChargeRow> = {}): MyChargeRow =>
	fee({ kind: "manual", amountDue: 26000, periodYm: null, label: "8/22 정모 회식", ...o });
const court = (o: Partial<MyChargeRow> = {}): MyChargeRow =>
	fee({
		kind: "court_fee",
		amountDue: 7500,
		periodYm: null,
		sessionId: 12,
		scheduledAt: "2026-07-12T10:00:00Z",
		...o,
	});

describe("selectUnpaid — 회원 관점 미납", () => {
	it("unpaid·partial 만 미납. paid/overpaid/waived/void(부과삭제) 는 빠진다", () => {
		const statuses: ChargeStatus[] = [
			"unpaid",
			"partial",
			"paid",
			"overpaid",
			"waived",
			"void",
		];
		const rows = statuses.map((s, i) => fee({ id: i + 1, status: s }));
		expect(selectUnpaid(rows, "2026-08").map((c) => c.status)).toEqual([
			"unpaid",
			"partial",
		]);
	});

	it("회비: 이번 달 이하만. 다음 달 부과는 아직 미납으로 보지 않는다", () => {
		const rows = [
			fee({ id: 7, periodYm: "2026-07" }),
			fee({ id: 8, periodYm: "2026-08" }),
			fee({ id: 9, periodYm: "2026-09" }),
		];
		expect(selectUnpaid(rows, "2026-08").map((c) => c.id)).toEqual([7, 8]);
	});

	it("회비 이월: 실효 월은 deferredTo — 미래로 이월된 건 숨고, 이월돼 들어온 건은 보인다", () => {
		const rows = [
			fee({ id: 21, periodYm: "2026-08", deferredTo: "2026-09" }), // 9월로 나감
			fee({ id: 22, periodYm: "2026-07", deferredTo: "2026-08" }), // 8월로 들어옴
		];
		expect(selectUnpaid(rows, "2026-08").map((c) => c.id)).toEqual([22]);
	});

	it("대관비는 월 무관 전부(과거 세션도 미납이면 뜬다)", () => {
		const rows = [
			court({ id: 31, scheduledAt: "2026-06-01T10:00:00Z" }),
			court({ id: 32 }),
		];
		expect(selectUnpaid(rows, "2026-08").map((c) => c.id)).toEqual([31, 32]);
	});

	it("게스트 대납분(isProxy)도 낼 사람은 나 → 포함", () => {
		expect(selectUnpaid([court({ id: 41, isProxy: true })], "2026-08")).toHaveLength(1);
	});

	it("수동 부과(회식·공동구매)도 월 무관 전부 — 회비처럼 이월 판정에 걸리지 않는다", () => {
		const rows = [manual({ id: 51 }), manual({ id: 52, label: "8월 콕 공구" })];
		expect(selectUnpaid(rows, "2026-08").map((c) => c.id)).toEqual([51, 52]);
		// 기준 월을 과거로 내려도 그대로 뜬다(발생일 기준이 아니라 '아직 안 낸 돈'이라서).
		expect(selectUnpaid(rows, "2026-07")).toHaveLength(2);
	});

	it("수동 부과도 완납·면제는 빠진다", () => {
		expect(selectUnpaid([manual({ status: "paid" }), manual({ status: "waived" })], "2026-08")).toEqual([]);
	});
});

describe("unpaidSum — 남은 금액만", () => {
	it("부분납은 잔액만 더한다", () => {
		const rows = [fee({ status: "partial", amountDue: 5000, amountPaid: 3000 }), court()];
		expect(unpaidSum(rows)).toBe(2000 + 7500);
	});

	it("초과납(amountPaid > amountDue)이 섞여도 음수로 깎이지 않는다", () => {
		expect(unpaidSum([fee({ amountDue: 5000, amountPaid: 9000 }), court()])).toBe(7500);
	});
});

describe("chargeLabel", () => {
	it("회비는 '8월 회비'(0패딩 없음)", () => {
		expect(chargeLabel(fee({ periodYm: "2026-08" }))).toBe("8월 회비");
	});

	it("대관비는 세션 날짜(KST) 기준 — 앱 공용 fmtMD 포맷", () => {
		expect(chargeLabel(court())).toBe("7. 12. 대관비");
	});

	it("대납분은 꼬리표가 붙는다", () => {
		expect(chargeLabel(court({ isProxy: true }))).toContain("(게스트 대납)");
	});

	it("세션 날짜가 없으면 제목, 그것도 없으면 '세션'", () => {
		expect(chargeLabel(court({ scheduledAt: null, sessionTitle: "번개" }))).toBe("번개 대관비");
		expect(chargeLabel(court({ scheduledAt: null, sessionTitle: null }))).toBe("세션 대관비");
	});

	it("수동 부과는 만들 때 붙인 이름을 그대로 쓴다(대관비 문구로 새지 않는다)", () => {
		expect(chargeLabel(manual())).toBe("8/22 정모 회식");
		expect(chargeLabel(manual({ isProxy: true }))).toBe("8/22 정모 회식 (게스트 대납)");
		expect(chargeLabel(manual({ label: null }))).toBe("기타 부과");
	});
});
