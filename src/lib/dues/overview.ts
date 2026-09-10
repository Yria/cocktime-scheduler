import { kstMonth, memberLabel } from "./summary";
import type { AccountingData, BillingGroup } from "./types";

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
