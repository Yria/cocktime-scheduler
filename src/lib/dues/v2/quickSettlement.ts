import { kstMonth } from "./summary";
import type { AccountingData } from "./types";

export function payableDues(
	data: AccountingData,
	memberId: string,
	ym: string,
) {
	return data.due
		.filter(
			(d) =>
				d.remaining > 0 &&
				data.charges.some(
					(c) =>
						c.id === d.charge_id &&
						c.state === "live" &&
						c.member_id === memberId,
				),
		)
		.sort(
			(a, b) =>
				Number(b.due_ym === ym) - Number(a.due_ym === ym) ||
				a.due_ym.localeCompare(b.due_ym) ||
				a.id.localeCompare(b.id),
		);
}
export function refundLines(
	data: AccountingData,
	bankId: number,
	amount: number,
) {
	let remaining = amount;
	const lines = data.positions
		.filter((p) => p.bank_tx_id === bankId && p.purpose !== "club")
		.map((p) => {
			const used = Math.min(remaining, p.amount);
			remaining -= used;
			return { position_id: p.id, amount: used };
		})
		.filter((p) => p.amount > 0);
	if (remaining > 0 || !lines.length)
		throw new Error("이 출금액만큼 환불할 수 있는 입금을 선택하세요");
	return lines;
}
export function transactionNeedsSettlement(data: AccountingData, id: number) {
	const tx = data.bank.find((b) => b.id === id);
	if (!tx) return false;
	if (tx.direction === "out")
		return (
			!data.refunds.some((r) => r.out_tx_id === id) &&
			!data.expenses.some((e) => e.bank_tx_id === id && e.group_id)
		);
	return data.positions.some(
		(p) =>
			p.bank_tx_id === id &&
			p.amount > 0 &&
			["unassigned", "member_pending", "refund_pending"].includes(p.purpose),
	);
}
export function quickGroups(data: AccountingData, ym: string, query: string) {
	return data.groups
		.filter(
			(g) =>
				!query ||
				g.label.replaceAll(" ", "").includes(query.replaceAll(" ", "")),
		)
		.sort(
			(a, b) =>
				Number(b.occurred_on.startsWith(ym)) -
					Number(a.occurred_on.startsWith(ym)) ||
				b.occurred_on.localeCompare(a.occurred_on),
		);
}
export const transactionMonth = (data: AccountingData, bankId: number) =>
	kstMonth(data.bank.find((t) => t.id === bankId)!.occurred_at);
