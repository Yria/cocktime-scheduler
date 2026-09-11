import { type ComponentProps, useEffect, useState } from "react";
import { won } from "../../lib/dues/duesText";
import { kstMonth } from "../../lib/dues/summary";
import type { CashLedger } from "../../lib/dues/types";
import { readAccountingBankBalances } from "../../lib/supabase/dues";
import CashLedgerView from "./CashLedgerView";
import TransactionLedger from "./TransactionLedger";

export default function AccountingLedger({
	onInbox,
	...props
}: ComponentProps<typeof TransactionLedger> & {
	onInbox: () => void;
}) {
	const { ym, data } = props;
	// 항목 줄은 통장 카드가 이미 조회한 것을 올려받는다 — 거래 내역의 필터 칩이
	// 같은 값을 쓰되 `dues_ledger` 를 두 번 부르지 않는다. 달이 바뀌면 새 조회가
	// 도착할 때까지 지난달 칩을 보여 주지 않으려고 ym 을 함께 들고 있는다.
	const [lines, setLines] = useState<{ ym: string; rows: CashLedger["lines"] }>({
		ym: "",
		rows: [],
	});
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
	// 통장 잔액 조회는 요약 카드의 '통장잔액' 한 줄에만 쓴다(거래별 잔액 표기는 폐기 —
	// 행 오른쪽 금액과 나란히 두 숫자가 경쟁했다).
	const rows =
		bank?.ym === ym && bank.revision === data.mode.revision ? bank.rows : [];
	const latest = rows[0];
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
				buckets={false}
				onLines={(rows) => setLines({ ym, rows })}
				closingBalance={
					latest?.balance_after != null
						? { amount: latest.balance_after, occurredAt: latest.occurred_at }
						: undefined
				}
			/>
			{bank?.ym === ym && bank.error && (
				<p className="ac-caption" role="status">
					통장 잔액을 불러오지 못했습니다. 화면을 새로고침해 주세요.
				</p>
			)}
			<TransactionLedger
				{...props}
				lines={lines.ym === ym ? lines.rows : []}
			/>
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
