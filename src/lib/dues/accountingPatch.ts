import type { AccountingData, OperationResult } from "./types";

function mergeRows<T>(
	rows: T[],
	changes: Record<string, T | null> | undefined,
	key: (row: T) => string | number,
): T[] {
	if (!changes || !Object.keys(changes).length) return rows;
	const remaining = new Map(Object.entries(changes));
	const result: T[] = [];
	for (const row of rows) {
		const id = String(key(row));
		if (!remaining.has(id)) result.push(row);
		else {
			const replacement = remaining.get(id);
			if (replacement) result.push(replacement);
			remaining.delete(id);
		}
	}
	for (const row of remaining.values()) if (row) result.push(row);
	return result;
}

/** A delta can only advance the snapshot it was committed against. */
export function applyAccountingPatch(
	data: AccountingData,
	result: OperationResult,
): AccountingData | null {
	const patch = result.patch;
	if (!patch || patch.version !== 1 || patch.epoch !== data.mode.epoch)
		return null;
	// A mode poll/read may already have included this operation (including retries).
	if (data.mode.revision >= result.revision) return data;
	if (
		data.mode.revision !== patch.base_revision ||
		result.revision !== patch.base_revision + 1
	)
		return null;
	const t = patch.tables;
	const summary = { ...result };
	delete summary.patch;
	return {
		...data,
		mode: { ...data.mode, revision: result.revision },
		groups: mergeRows(data.groups, t.groups, (r) => r.id),
		charges: mergeRows(data.charges, t.charges, (r) => r.id),
		due: mergeRows(data.due, t.due, (r) => r.id),
		positions: t.positions
			? mergeRows(data.positions, t.positions, (r) => r.id).filter(
					(r) => r.amount > 0,
				)
			: data.positions,
		allocations: mergeRows(data.allocations, t.allocations, (r) => r.id),
		refunds: mergeRows(data.refunds, t.refunds, (r) => r.out_tx_id),
		expenses: mergeRows(data.expenses, t.expenses, (r) => r.bank_tx_id),
		drafts: mergeRows(data.drafts, t.drafts, (r) => r.source_key),
		prepayments: patch.prepayments ?? data.prepayments,
		operations: [
			{ ...patch.operation, result: summary },
			...data.operations.filter((op) => op.id !== patch.operation.id),
		].slice(0, 100),
	};
}
