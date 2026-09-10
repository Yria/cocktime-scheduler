import { useEffect, useState, type ComponentProps } from "react";
import { readAccountingBankBalances } from "../../lib/supabase/dues";
import { kstMonth } from "../../lib/dues/summary";
import { won } from "../../lib/dues/duesText";
import CashLedgerView from "./CashLedgerView";
import TransactionLedger from "./TransactionLedger";

export default function AccountingLedger({
	onInbox,
	...props
}: Omit<ComponentProps<typeof TransactionLedger>, "balances"> & {
	onInbox: () => void;
}) {
	const { ym, data, onFilter } = props;
	const [bank, setBank] = useState<{
		ym: string;
		revision: number;
		rows: Awaited<ReturnType<typeof readAccountingBankBalances>>;
		error?: boolean;
	} | null>(null);
	useEffect(() => {
		let disposed = false;
		void readAccountingBankBalances(ym)
			.then((rows) => {
				if (!disposed) setBank({ ym, revision: data.mode.revision, rows });
			})
			.catch(() => {
				if (!disposed)
					setBank({ ym, revision: data.mode.revision, rows: [], error: true });
			});
		return () => {
			disposed = true;
		};
	}, [ym, data.mode.revision]);
	// Summary and transaction details share the one existing bank-balance read.
	const rows =
		bank?.ym === ym && bank.revision === data.mode.revision ? bank.rows : [];
	const latest = rows[0];
	const balances = new Map(rows.map((tx) => [tx.id, tx.balance_after]));
	const unassigned = data.positions.filter(
		(p) =>
			p.purpose === "unassigned" &&
			data.bank.some(
				(tx) => tx.id === p.bank_tx_id && kstMonth(tx.occurred_at) === ym,
			),
	);
	return (
		<div className="ac-ledger-page">
			<CashLedgerView
				ym={ym}
				revision={data.mode.revision}
				closingBalance={
					latest?.balance_after != null
						? { amount: latest.balance_after, occurredAt: latest.occurred_at }
						: undefined
				}
				onPickGroup={(id) => onFilter(id ?? "all")}
			/>
			{bank?.ym === ym && bank.error && (
				<p className="ac-caption" role="status">
					통장 잔액을 불러오지 못했습니다. 화면을 새로고침해 주세요.
				</p>
			)}
			<TransactionLedger {...props} balances={balances} />
			{unassigned.length > 0 && (
				<div className="ac-undo-block">
					<strong>
						미분류 {new Set(unassigned.map((p) => p.bank_tx_id)).size}건 ·{" "}
						{won(unassigned.reduce((sum, p) => sum + p.amount, 0))}
					</strong>
					<div>아직 용도를 정하지 않은 입금 잔액입니다.</div>
					<button
						type="button"
						className="ac-link"
						disabled={props.settling}
						onClick={onInbox}
					>
						정산함에서 처리 ›
					</button>
				</div>
			)}
		</div>
	);
}
