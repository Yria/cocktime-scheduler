import type { AccountingData, BillingGroup } from "./types";

export const memberLabel = (data: AccountingData, id: string | null) => {
	const m = data.members.find((x) => x.id === id);
	return m
		? `${m.name}${m.guest ? " · 게스트" : ""}${data.members.filter((x) => x.name === m.name).length > 1 ? ` · ${m.birth_year ?? "출생연도 미등록"} · ${m.gender ?? "성별 미등록"} · ${m.id.slice(-6)}` : ""}`
		: "미지정";
};

export function kstMonth(iso: string): string {
	return new Date(new Date(iso).getTime() + 9 * 3600000)
		.toISOString()
		.slice(0, 7);
}
export function groupSummary(data: AccountingData, group: BillingGroup) {
	const charges = data.charges.filter((c) => c.group_id === group.id);
	const live = new Set(
		charges.filter((c) => c.state === "live").map((c) => c.id),
	);
	const ids = new Set(charges.map((c) => c.id));
	const paid = data.allocations
		.filter((a) => ids.has(a.charge_id))
		.reduce((s, a) => s + a.amount - a.reversed, 0);
	const outstanding = data.due
		.filter((d) => live.has(d.charge_id))
		.reduce((s, d) => s + d.remaining, 0);
	const direct = data.positions
		.filter((p) => p.group_id === group.id && p.purpose === "club")
		.reduce((s, p) => s + p.amount, 0);
	const expenses = new Set(
		data.expenses
			.filter(
				(e) =>
					e.group_id === group.id &&
					!data.refunds.some((r) => r.out_tx_id === e.bank_tx_id),
			)
			.map((e) => e.bank_tx_id),
	);
	const spent = data.bank
		.filter((t) => expenses.has(t.id))
		.reduce((s, t) => s + t.amount, 0);
	return {
		charges,
		paid,
		outstanding,
		direct,
		spent,
		net: paid + direct - spent,
	};
}

export function memberSummary(
	data: AccountingData,
	memberId: string,
	ym: string,
) {
	const own = new Set(
		data.charges
			.filter((c) => c.state === "live" && c.member_id === memberId)
			.map((c) => c.id),
	);
	const proxy = new Set(
		data.charges
			.filter(
				(c) =>
					c.state === "live" &&
					c.member_id !== memberId &&
					c.payer_hint === memberId,
			)
			.map((c) => c.id),
	);
	const due = data.due.filter((d) => own.has(d.charge_id) && d.due_ym <= ym);
	const outstanding = due.reduce((s, d) => s + d.remaining, 0);
	const availableCarry = data.positions
		.filter(
			(p) =>
				p.owner_id === memberId &&
				p.purpose === "carry" &&
				p.available_ym! <= ym,
		)
		.reduce((s, p) => s + p.amount, 0);
	return {
		outstanding,
		availableCarry,
		toPay: Math.max(0, outstanding - availableCarry),
		proxyDue: data.due
			.filter((d) => proxy.has(d.charge_id) && d.due_ym <= ym)
			.reduce((s, d) => s + d.remaining, 0),
		futureDue: data.due
			.filter((d) => own.has(d.charge_id) && d.due_ym > ym)
			.reduce((s, d) => s + d.remaining, 0),
		futureCash: data.positions
			.filter(
				(p) =>
					p.owner_id === memberId &&
					p.purpose === "carry" &&
					p.available_ym! > ym,
			)
			.reduce((s, p) => s + p.amount, 0),
		pending: data.positions
			.filter((p) => p.owner_id === memberId && p.purpose === "member_pending")
			.reduce((s, p) => s + p.amount, 0),
		refundPending: data.positions
			.filter((p) => p.owner_id === memberId && p.purpose === "refund_pending")
			.reduce((s, p) => s + p.amount, 0),
	};
}
