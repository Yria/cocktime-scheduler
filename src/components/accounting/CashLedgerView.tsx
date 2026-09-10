import { useEffect, useState } from "react";
import type { CashLedger } from "../../lib/dues/types";
import {
	accountingError,
	readAccountingLedger,
} from "../../lib/supabase/dues";
import { shortGroupLabel } from "../../lib/dues/labelShorten";
import { fmtMDSlash } from "../../lib/dues/duesText";

export default function CashLedgerView({
	ym,
	revision,
	onPickGroup,
	closingBalance,
}: {
	ym: string;
	revision: number;
	/** 항목 행을 누르면 아래 거래 목록을 그 항목으로 좁힌다(막다른 골목 해소). */
	onPickGroup?: (groupId: string | null, label: string) => void;
	closingBalance?: { amount: number; occurredAt: string };
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
	// 로딩 중에도 높이를 유지한다 — 한 줄 텍스트로 줄었다가 돌아오면 아래 목록이
	// 위로 점프하고 읽던 위치를 잃었다.
	if (!shown || shown.ym !== ym)
		return (
			<div className="ac-sheet" aria-busy="true">
				<div className="ac-sheet-head">
					<h2>이달의 수입 − 지출</h2>
					<span>불러오는 중…</span>
				</div>
				<div className="ac-row">
					<span className="ac-row-gutter" aria-hidden="true" />
					<span className="ac-row-body">
						<span className="ac-row-note">장부를 확인하고 있습니다.</span>
					</span>
				</div>
			</div>
		);
	if (!shown.data)
		return (
			<p role="alert" className="ac-notice is-stop">
				{shown.error}
			</p>
		);
	const ledger = shown.data;
	const net = ledger.income - ledger.expense;
	const number = (n: number) => n.toLocaleString("ko-KR");
	return (
		<div className="ac-cash-layout">
			<section className="ac-card ac-ledger-summary" aria-label="이달의 수지">
				<div className="ac-sheet-head">
					<h2>{Number(ym.slice(5))}월 통장</h2>
					<span>단위: 원</span>
				</div>
				<div className="ac-row ac-ledger-net">
					<span className="ac-row-body">
						<strong>수입 − 지출</strong>
						{closingBalance && (
							<span className="ac-row-note">
								{fmtMDSlash(closingBalance.occurredAt)} 잔액{" "}
								{number(closingBalance.amount)}
							</span>
						)}
					</span>
					<strong className="ac-amount">
						{net > 0 ? "+" : net < 0 ? "−" : ""}
						{number(Math.abs(net))}
					</strong>
				</div>
				<div className="ac-row">
					<span className="ac-row-body">
						<strong>수입</strong>
					</span>
					<strong className="ac-amount ac-ledger-income">
						{number(ledger.income)}
					</strong>
				</div>
				<div className="ac-row">
					<span className="ac-row-body">
						<strong>지출</strong>
					</span>
					<strong className="ac-amount">−{number(ledger.expense)}</strong>
				</div>
			</section>
			<section className="ac-sheet ac-ledger-buckets" aria-label="항목별 내역">
				<div className="ac-sheet-head">
					<h2>항목별 수지</h2>
					<span>수입 / 지출 (원)</span>
				</div>
				<div className="ac-ledger-bucket-rows">
					{ledger.lines.map((line, index) => {
						const label = shortGroupLabel(line.label);
						const body = (
							<>
								<span className="ac-row-body">
									<strong>{label}</strong>
								</span>
								<strong
									className={`ac-amount ${line.income ? "ac-ledger-income" : ""}`}
								>
									{line.income ? number(line.income) : "—"}
								</strong>
								<strong className="ac-amount-2">
									{line.expense ? `−${number(line.expense)}` : "—"}
								</strong>
							</>
						);
						return onPickGroup ? (
							<button
								key={`${line.group_id}-${index}`}
								type="button"
								className="ac-row ac-cash-columns ac-ledger-item"
								aria-label={`${line.label} 거래 보기`}
								onClick={() => onPickGroup(line.group_id, line.label)}
							>
								{body}
							</button>
						) : (
							<div
								className="ac-row ac-cash-columns"
								key={`${line.group_id}-${index}`}
							>
								{body}
							</div>
						);
					})}
					{ledger.lines.length > 0 ? (
						<div className="ac-row ac-cash-columns ac-total">
							<span className="ac-row-body">
								<strong>합계</strong>
							</span>
							<strong className="ac-amount ac-ledger-income">
								{number(ledger.income)}
							</strong>
							<strong className="ac-amount-2">−{number(ledger.expense)}</strong>
						</div>
					) : (
						<p className="ac-empty">이 달의 입출금 내역이 없습니다.</p>
					)}
				</div>
			</section>
		</div>
	);
}
