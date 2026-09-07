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
		<div className="flex flex-col gap-3">
			<p className="text-sm text-muted">
				실제 입출금 날짜를 기준으로 합산합니다. 이전 달 입금을 이번 달 납부에
				사용해도 새 수입을 만들지 않습니다.
			</p>
			<div className="grid grid-cols-3 gap-2 rounded-xl bg-black/5 dark:bg-white/5 p-3 text-sm">
				<span>
					수입
					<br />
					<strong>{won(ledger.income)}</strong>
				</span>
				<span>
					지출
					<br />
					<strong>{won(ledger.expense)}</strong>
				</span>
				<span>
					순액
					<br />
					<strong>{won(ledger.income - ledger.expense)}</strong>
				</span>
			</div>
			{ledger.lines.map((l, i) => (
				<div
					key={`${l.group_id}-${i}`}
					className="flex justify-between gap-3 border-b border-black/10 dark:border-white/10 py-2 text-sm"
				>
					<span>{l.label}</span>
					<span className="text-right">
						{l.income > 0 && (
							<span className="text-green-700 dark:text-green-400">
								+{won(l.income)}
							</span>
						)}
						{l.income > 0 && l.expense > 0 && " / "}
						{l.expense > 0 && (
							<span className="text-red-600">−{won(l.expense)}</span>
						)}
					</span>
				</div>
			))}
		</div>
	);
}
