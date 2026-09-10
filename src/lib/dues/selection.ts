import { nameMatches, normalizeDepositName } from "./matching";
import type { AccountingData } from "./types";

// Reuse deposit-name cleanup and Korean initial search, but never fold different IDs.
export function matchingMembers(data: AccountingData, query: string) {
	const q = normalizeDepositName(query);
	return data.members.filter(
		(m) => nameMatches(m.name, query) || (!!q && nameMatches(m.name, q)),
	);
}

export function receiptHistory(data: AccountingData) {
	return data.bank
		.filter((t) => t.direction === "in")
		.map((t) => {
			const positions = data.positions.filter((p) => p.bank_tx_id === t.id);
			const payments = data.allocations.filter((a) => a.bank_tx_id === t.id);
			const refunds = data.refunds.filter((r) => r.in_tx_id === t.id);
			// The sender owns a proxy payment, not the member charged for it.
			const owners = [
				...new Set(
					[...positions, ...payments, ...refunds].flatMap((x) =>
						x.owner_id ? [x.owner_id] : [],
					),
				),
			];
			return {
				...t,
				owners,
				used: payments.reduce((s, a) => s + a.amount - a.reversed, 0),
				refunded: refunds.reduce((s, r) => s + r.amount, 0),
				club: positions
					.filter((p) => p.purpose === "club")
					.reduce((s, p) => s + p.amount, 0),
				available: positions
					.filter((p) => p.purpose !== "club")
					.reduce((s, p) => s + p.amount, 0),
			};
		})
		.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id - a.id);
}

export interface SessionChoice {
	id: number;
	title: string | null;
	scheduled_at: string;
	ends_at: string | null;
	place: string | null;
}
export function sessionChoiceLabels(
	sessions: SessionChoice[],
): Map<number, string> {
	const date = (iso: string) =>
		new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10);
	const time = (iso: string) =>
		new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(11, 16);
	const key = (s: SessionChoice) => `${date(s.scheduled_at)}|${s.place ?? ""}`;
	return new Map(
		sessions.map((s) => {
			const peers = sessions.filter((p) => key(p) === key(s));
			let label = `${date(s.scheduled_at)} · ${s.place || s.title || "장소 미정"}`;
			if (peers.length > 1) {
				label += ` · ${time(s.scheduled_at)}${s.ends_at ? `–${time(s.ends_at)}` : ""}`;
				const simultaneous = peers.filter(
					(p) =>
						time(p.scheduled_at) === time(s.scheduled_at) &&
						p.ends_at === s.ends_at,
				);
				if (simultaneous.length > 1) {
					if (s.title) label += ` · ${s.title}`;
					if (simultaneous.filter((p) => p.title === s.title).length > 1)
						label += ` · #${s.id}`;
				}
			}
			return [s.id, label];
		}),
	);
}
