import { useEffect, useState } from "react";
import type { CashLedger } from "../../lib/dues/v2/types";
import {
	accountingError,
	readAccountingLedger,
} from "../../lib/supabase/accountingV2";
import { won } from "../admin/dues/duesText";

export default function CashLedgerView({
	ym,
	revision,
}: {
	ym: string;
	revision: number;
}) {
	const [shown, setShown] = useState<{
		ym: string;
		data?: CashLedger;
		error?: string;
	} | null>(null);
	useEffect(() => {
		let disposed = false;
		void readAccountingLedger(ym)
			.then((data) => {
				if (!disposed) setShown({ ym, data });
			})
			.catch((e) => {
				if (!disposed) setShown({ ym, error: accountingError(e) });
			});
		return () => {
			disposed = true;
		};
	}, [ym, revision]);
	if (!shown || shown.ym !== ym)
		return <p className="text-muted">장부를 불러오는 중…</p>;
	if (!shown.data)
		return (
			<p role="alert" className="text-red-600">
				{shown.error}
			</p>
		);
	const ledger = shown.data;
	return (
		<div className="flex flex-col gap-4">
			<section className="ac-card ac-ledger-summary">
				<h2 className="ac-caption">이달의 수입 − 지출</h2>
				<strong className="ac-number">
					{won(ledger.income - ledger.expense)}
				</strong>
				<div className="ac-ledger-totals">
					<div>
						<span>수입</span>
						<strong className="ac-number ac-in">{won(ledger.income)}</strong>
					</div>
					<div>
						<span>지출</span>
						<strong className="ac-number ac-out">{won(ledger.expense)}</strong>
					</div>
				</div>
			</section>
			<p className="ac-caption">
				실제 입출금 날짜를 기준으로 합산해요. 이전 달 입금을 납부에 사용해도
				수입에 중복 반영하지 않습니다.
			</p>
			<section className="ac-card">
				<h2 className="ac-caption">항목별 내역</h2>
				{ledger.lines.map((l, i) => (
					<div key={`${l.group_id}-${i}`} className="ac-ledger-row">
						<span>{l.label}</span>
						<div>
							{l.income > 0 && <span className="ac-in">+{won(l.income)}</span>}
							{l.expense > 0 && (
								<span className="ac-out">−{won(l.expense)}</span>
							)}
						</div>
					</div>
				))}
				{!ledger.lines.length && (
					<p className="ac-empty">이 달의 입출금 내역이 없습니다.</p>
				)}
			</section>
		</div>
	);
}
