import { kstMonth, memberLabel } from "./summary";
import type { AccountingData, BillingGroup, CashLedger } from "./types";

export function billingProgress(
	data: AccountingData,
	groups: BillingGroup[],
	ym: string,
) {
	const groupIds = new Set(groups.map((g) => g.id));
	const rows = data.charges
		.filter((c) => c.state === "live" && groupIds.has(c.group_id))
		.map((charge) => {
			const due = data.due.filter(
				(d) => d.charge_id === charge.id && d.remaining > 0,
			);
			const payments = data.allocations.filter(
				(a) => a.charge_id === charge.id && a.amount > a.reversed,
			);
			const remaining = due.reduce((sum, d) => sum + d.remaining, 0);
			const later = due
				.filter((d) => d.due_ym > ym)
				.reduce((sum, d) => sum + d.remaining, 0);
			return {
				charge,
				due,
				payments,
				remaining,
				later,
				paid: payments.reduce((sum, a) => sum + a.amount - a.reversed, 0),
			};
		})
		.sort(
			(a, b) =>
				Number(b.remaining > 0) - Number(a.remaining > 0) ||
				memberLabel(data, a.charge.member_id).localeCompare(
					memberLabel(data, b.charge.member_id),
					"ko",
				),
		);
	return {
		rows,
		total: rows.reduce((sum, r) => sum + r.charge.amount, 0),
		paid: rows.reduce((sum, r) => sum + r.paid, 0),
		remaining: rows.reduce((sum, r) => sum + r.remaining, 0),
		later: rows.reduce((sum, r) => sum + r.later, 0),
		paidCount: rows.filter((r) => r.remaining === 0).length,
	};
}

export function overviewBalances(data: AccountingData, ym: string) {
	const charges = new Map(
		data.charges.filter((c) => c.state === "live").map((c) => [c.id, c]),
	);
	const groups = new Map(data.groups.map((g) => [g.id, g]));
	const members = new Map<
		string,
		{
			id: string;
			amount: number;
			lines: { label: string; ym: string; amount: number }[];
		}
	>();
	let futureDue = 0;
	for (const d of data.due) {
		const c = charges.get(d.charge_id);
		if (!c || d.remaining <= 0) continue;
		const g = groups.get(c.group_id);
		if (d.due_ym > ym) {
			// 다음 달에 새로 발생할 부과는 이번 달에서 이월한 미납에 넣지 않는다.
			if (g && g.occurred_on.slice(0, 7) <= ym) futureDue += d.remaining;
			continue;
		}
		const row = members.get(c.member_id) ?? {
			id: c.member_id,
			amount: 0,
			lines: [],
		};
		row.amount += d.remaining;
		row.lines.push({
			label: g?.label ?? "부과",
			ym: d.due_ym,
			amount: d.remaining,
		});
		members.set(c.member_id, row);
	}
	const unpaid = [...members.values()].sort(
		(a, b) =>
			b.amount - a.amount ||
			memberLabel(data, a.id).localeCompare(memberLabel(data, b.id), "ko"),
	);
	const bank = new Map(data.bank.map((t) => [t.id, t]));
	const carry = data.positions.filter((p) => {
		const tx = bank.get(p.bank_tx_id);
		return (
			p.purpose === "carry" &&
			p.amount > 0 &&
			tx &&
			kstMonth(tx.occurred_at) <= ym
		);
	});
	return {
		unpaid,
		outstanding: unpaid.reduce((sum, m) => sum + m.amount, 0),
		futureDue,
		carry,
		carryCash: carry.reduce((sum, p) => sum + p.amount, 0),
	};
}

/**
 * 회계 탭의 항목 칩 순서 — **종류 묶음 + 날짜순**이다.
 * 대관비(회차 날짜) → 회비(월) → 수동 묶음(발생일) → 묶음 없는 합성 항목
 * (환불·환불 원입금·미분류·이월 입금 …). 같은 종류가 붙어 있어야 찾는 종류로 바로
 * 스크롤할 수 있다. 금액 순으로 세우면 날짜가 흩어져 '8/16 대관비'를 눈으로 좇을 수
 * 없다(가로 스크롤이라 화면 밖 항목은 아예 보이지 않는다).
 *
 * 서버(`dues_ledger`)는 라벨 문자열순으로만 준다 — 종류·발생일은 `dues_groups` 에
 * 있으므로 정렬은 클라이언트 몫이다.
 */
const BUCKET_KIND_RANK: Record<BillingGroup["kind"], number> = {
	court: 0,
	monthly: 1,
	manual: 2,
};

export function sortLedgerBuckets(
	lines: CashLedger["lines"],
	groups: BillingGroup[],
): CashLedger["lines"] {
	const byId = new Map(groups.map((g) => [g.id, g]));
	const of = (line: CashLedger["lines"][number]) =>
		line.group_id ? byId.get(line.group_id) : undefined;
	return [...lines].sort((a, b) => {
		const ga = of(a);
		const gb = of(b);
		return (
			(ga ? BUCKET_KIND_RANK[ga.kind] : 3) -
				(gb ? BUCKET_KIND_RANK[gb.kind] : 3) ||
			(ga?.occurred_on ?? "").localeCompare(gb?.occurred_on ?? "") ||
			a.label.localeCompare(b.label)
		);
	});
}
