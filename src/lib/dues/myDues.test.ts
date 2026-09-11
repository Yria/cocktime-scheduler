import { describe, expect, it } from "vitest";
import { myDuesMonth, myDuesMonths, myDuesUnpaid } from "./myDues";
import type { AccountingData, BillingGroup } from "./types";

const ME = "me";
const GUEST = "guest";

const group = (
	id: string,
	kind: BillingGroup["kind"],
	occurred_on: string,
	label: string,
): BillingGroup => ({
	id,
	source_key: `${kind}:${id}`,
	kind,
	label,
	occurred_on,
	session_id: kind === "court" ? Number(id.replace(/\D/g, "")) || 1 : null,
	basis: {},
});

/**
 * 원본 3a 아트보드의 표본을 그대로 옮긴 fixture — 9월 부과 29,000원 중 23,000원을
 * 세 번에 나눠 냈고 9/8 대관비 6,000원이 남아 있다. 8월 부과와 대납 한 건을 섞어
 * 달 경계와 본인/대납 분리도 같은 fixture 로 확인한다.
 */
function fixture(): AccountingData {
	return {
		mode: {
			available: true,
			enabled: true,
			paused: false,
			revision: 1,
			epoch: "test",
		},
		groups: [
			group("sep", "monthly", "2026-09-01", "9월 회비"),
			group("aug", "monthly", "2026-08-01", "8월 회비"),
			group("8", "court", "2026-09-08", "2026-09-08 · TK배드민턴 · 19:00–22:00"),
			group("9", "court", "2026-09-09", "2026-09-09 · TK배드민턴 · 19:00–22:00"),
			group("11", "court", "2026-09-11", "2026-09-11 · TK배드민턴 · 19:00–22:00"),
			group("12", "court", "2026-09-12", "2026-09-12 · TK배드민턴 · 09:00–12:00"),
			group("meal", "manual", "2026-09-19", "9월 회식 · 2026-09-19"),
		],
		charges: [
			{
				id: "c-sep",
				legacy_id: null,
				group_id: "sep",
				member_id: ME,
				amount: 5000,
				state: "live",
				previous_id: null,
				payer_hint: null,
				issued_at: "2026-09-01T00:00:00+09:00",
			},
			{
				id: "c-aug",
				legacy_id: null,
				group_id: "aug",
				member_id: ME,
				amount: 5000,
				state: "live",
				previous_id: null,
				payer_hint: null,
				issued_at: "2026-08-01T00:00:00+09:00",
			},
			...["8", "9", "11", "12"].map((s) => ({
				id: `c-${s}`,
				legacy_id: null,
				group_id: s,
				member_id: ME,
				amount: 6000,
				state: "live" as const,
				previous_id: null,
				payer_hint: null,
				issued_at: `2026-09-${s.padStart(2, "0")}T00:00:00+09:00`,
			})),
			// 게스트 대납 — 본인 카드에 섞이면 안 된다.
			{
				id: "c-guest",
				legacy_id: null,
				group_id: "12",
				member_id: GUEST,
				amount: 8000,
				state: "live",
				previous_id: null,
				payer_hint: ME,
				issued_at: "2026-09-12T00:00:00+09:00",
			},
			// 취소된 부과는 부과 총액에서 빠진다.
			{
				id: "c-void",
				legacy_id: null,
				group_id: "meal",
				member_id: ME,
				amount: 20000,
				state: "cancelled",
				previous_id: null,
				payer_hint: null,
				issued_at: "2026-09-19T00:00:00+09:00",
			},
		],
		due: [
			{ id: "d-sep", charge_id: "c-sep", due_ym: "2026-09", remaining: 0 },
			{ id: "d-aug", charge_id: "c-aug", due_ym: "2026-08", remaining: 5000 },
			{ id: "d-8", charge_id: "c-8", due_ym: "2026-09", remaining: 6000 },
			{ id: "d-9", charge_id: "c-9", due_ym: "2026-09", remaining: 0 },
			{ id: "d-11", charge_id: "c-11", due_ym: "2026-09", remaining: 0 },
			{ id: "d-12", charge_id: "c-12", due_ym: "2026-09", remaining: 0 },
			{ id: "d-guest", charge_id: "c-guest", due_ym: "2026-09", remaining: 8000 },
		],
		positions: [],
		allocations: [
			{
				id: "a1",
				bank_tx_id: 1,
				owner_id: ME,
				charge_id: "c-sep",
				due_id: "d-sep",
				amount: 5000,
				reversed: 0,
				created_at: "2026-09-03T20:10:00+09:00",
			},
			{
				id: "a2",
				bank_tx_id: 2,
				owner_id: ME,
				charge_id: "c-9",
				due_id: "d-9",
				amount: 6000,
				reversed: 0,
				created_at: "2026-09-09T21:00:00+09:00",
			},
			{
				id: "a3",
				bank_tx_id: 3,
				owner_id: ME,
				charge_id: "c-11",
				due_id: "d-11",
				amount: 6000,
				reversed: 0,
				created_at: "2026-09-12T10:00:00+09:00",
			},
			{
				id: "a4",
				bank_tx_id: 3,
				owner_id: ME,
				charge_id: "c-12",
				due_id: "d-12",
				amount: 6000,
				reversed: 0,
				created_at: "2026-09-12T10:00:00+09:00",
			},
			// 전액 해제된 배분은 낸 돈도 납부 줄도 만들지 않는다.
			{
				id: "a5",
				bank_tx_id: 4,
				owner_id: ME,
				charge_id: "c-8",
				due_id: "d-8",
				amount: 6000,
				reversed: 6000,
				created_at: "2026-09-07T09:00:00+09:00",
			},
		],
		refunds: [{ out_tx_id: 9, in_tx_id: 8, owner_id: ME, amount: 8000 }],
		expenses: [],
		bank: [
			{
				id: 1,
				amount: 5000,
				direction: "in",
				occurred_at: "2026-09-03T20:10:00+09:00",
				name: null,
			},
			{
				id: 2,
				amount: 6000,
				direction: "in",
				occurred_at: "2026-09-09T21:00:00+09:00",
				name: null,
			},
			{
				id: 3,
				amount: 12000,
				direction: "in",
				occurred_at: "2026-09-12T10:00:00+09:00",
				name: null,
			},
			{
				id: 4,
				amount: 6000,
				direction: "in",
				occurred_at: "2026-09-07T09:00:00+09:00",
				name: null,
			},
			{
				id: 9,
				amount: 8000,
				direction: "out",
				occurred_at: "2026-09-25T14:00:00+09:00",
				name: null,
			},
		],
		members: [
			{
				id: ME,
				name: "나",
				guest: false,
				active: true,
				gender: null,
				birth_year: null,
			},
			{
				id: GUEST,
				name: "손님",
				guest: true,
				active: true,
				gender: null,
				birth_year: null,
			},
		],
		operations: [],
		drafts: [],
	};
}

describe("myDuesMonth — 원본 3a 카드의 숫자", () => {
	const m = myDuesMonth(fixture(), ME, "2026-09");

	it("낸 돈 + 남은 금액 = 부과 (같은 카드가 서로를 부정하지 않는다)", () => {
		expect(m.charged).toBe(29000);
		expect(m.paid).toBe(23000);
		expect(m.remaining).toBe(6000);
		expect(m.paid + m.remaining).toBe(m.charged);
		expect(Math.round(m.ratio * 100)).toBe(79);
	});

	it("종류별 줄은 회비 → 대관비 순이고 회차는 몇 회 냈는지 센다", () => {
		expect(m.lines.map((l) => [l.label, l.paid, l.note])).toEqual([
			["9월 회비", 5000, "9/3 (목) 납부"],
			["회차 대관비", 18000, "4회차 중 3회차 납부"],
		]);
	});

	it("납부 내역은 입금 1건이 한 줄이고 최근이 위다", () => {
		expect(m.payments.map((p) => [p.date, p.targets, p.amount])).toEqual([
			["9/12 (토)", "9/11 · 9/12 대관비 2회차", 12000],
			["9/9 (수)", "9/9 대관비", 6000],
			["9/3 (목)", "9월 회비", 5000],
		]);
		expect(m.payments.reduce((s, p) => s + p.amount, 0)).toBe(m.paid);
	});

	it("미납은 발생일 순이고 요일까지 말한다", () => {
		expect(m.unpaid).toEqual([
			{
				key: "c-8",
				label: "9/8 (화) 대관비",
				amount: 6000,
				occurredOn: "2026-09-08",
				dueYm: "2026-09",
			},
		]);
	});

	it("대납은 본인 금액과 분리한다", () => {
		expect(m.proxy).toEqual({ charged: 8000, remaining: 8000, names: ["손님"] });
	});

	it("그 달에 나간 환불만 보인다", () => {
		expect(m.refunds).toEqual([
			{ key: "refund:9:8", date: "9/25 (금)", amount: 8000 },
		]);
		expect(myDuesMonth(fixture(), ME, "2026-08").refunds).toEqual([]);
	});

	it("다른 달 부과는 섞이지 않는다", () => {
		const aug = myDuesMonth(fixture(), ME, "2026-08");
		expect([aug.charged, aug.paid, aug.remaining]).toEqual([5000, 0, 5000]);
		expect(aug.lines.map((l) => l.note)).toEqual(["미납"]);
		expect(aug.empty).toBe(false);
	});

	it("부과도 납부도 없는 달은 빈 달이다", () => {
		expect(myDuesMonth(fixture(), ME, "2026-07").empty).toBe(true);
	});
});

describe("달을 넘는 집계", () => {
	it("myDuesUnpaid 는 납기 도래한 미납을 달 경계 없이 모은다", () => {
		expect(
			myDuesUnpaid(fixture(), ME, "2026-09").map((i) => [i.label, i.amount]),
		).toEqual([
			["8월 회비", 5000],
			["9/8 (화) 대관비", 6000],
		]);
	});

	it("납기가 아직 오지 않은 달은 세지 않는다", () => {
		expect(myDuesUnpaid(fixture(), ME, "2026-08").map((i) => i.label)).toEqual([
			"8월 회비",
		]);
	});

	it("납기를 이월한 미납은 그 달 카드에 남지만 지금 낼 돈은 아니다", () => {
		const f = fixture();
		// 9/8 대관비의 남은 6,000원을 2099-01 로 이월한 상황.
		f.due = f.due.map((d) =>
			d.charge_id === "c-8" ? { ...d, due_ym: "2099-01" } : d,
		);
		const m = myDuesMonth(f, ME, "2026-09");
		expect([m.charged, m.paid, m.remaining]).toEqual([29000, 23000, 6000]);
		expect(m.unpaid[0].dueYm).toBe("2099-01");
		expect(myDuesUnpaid(f, ME, "2026-09").map((i) => i.label)).toEqual([
			"8월 회비",
		]);
	});

	it("myDuesMonths 는 본인·대납 부과가 있는 달만 준다", () => {
		expect(myDuesMonths(fixture(), ME)).toEqual([
			"2026-08",
			"2026-09",
		]);
	});
});
