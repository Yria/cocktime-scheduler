import { kstMonth } from "./summary";
import type { AccountingData } from "./types";
import { matchingMembers } from "./selection";

// Suggestions are never saved until the user confirms. Namesakes stay unselected.
export function suggestedReceiptPayer(data: AccountingData, bankId: number) {
	const tx = data.bank.find((t) => t.id === bankId);
	if (!tx?.name?.trim()) return "";
	const matches = matchingMembers(data, tx.name);
	return matches.length === 1 ? matches[0].id : "";
}

export function suggestedReceiptDue(
	data: AccountingData,
	bankId: number,
	owner: string,
) {
	const tx = data.bank.find((t) => t.id === bankId);
	if (!tx || !owner) return {};
	const ym = kstMonth(tx.occurred_at);
	const candidates = payableDues(data, owner, ym).filter(
		(d) => d.due_ym === ym && d.remaining === tx.amount,
	);
	// A date written in a bank description (0906) can distinguish equal court fees.
	const date = tx.name?.match(/(?:^|\D)(0[1-9]|1[0-2])([0-2]\d|3[01])(?:\D|$)/);
	const dated = date
		? candidates.filter((d) => {
				const charge = data.charges.find((c) => c.id === d.charge_id);
				return data.groups.some(
					(g) =>
						g.id === charge?.group_id &&
						g.occurred_on === `${ym.slice(0, 4)}-${date[1]}-${date[2]}`,
				);
			})
		: candidates;
	return dated.length === 1
		? { [dated[0].id]: String(dated[0].remaining) }
		: {};
}

// An unused receipt can be matched again as a whole. Once any of its money has
// been paid or refunded, its original sender remains fixed (including reversals).
export function canChooseReceiptPayer(data: AccountingData, bankId: number) {
	const tx = data.bank.find((t) => t.id === bankId);
	const positions = data.positions.filter(
		(p) => p.bank_tx_id === bankId && p.amount > 0,
	);
	return (
		!!tx &&
		tx.direction === "in" &&
		positions.length > 0 &&
		positions.every((p) =>
			["unassigned", "member_pending"].includes(p.purpose),
		) &&
		positions.reduce((sum, p) => sum + p.amount, 0) === tx.amount &&
		!data.allocations.some((a) => a.bank_tx_id === bankId) &&
		!data.refunds.some((r) => r.in_tx_id === bankId)
	);
}

export function payableDues(
	data: AccountingData,
	memberId: string,
	ym: string,
) {
	const charges = new Set(
		data.charges
			.filter((c) => c.state === "live" && c.member_id === memberId)
			.map((c) => c.id),
	);
	return data.due
		.filter((d) => d.remaining > 0 && charges.has(d.charge_id))
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
