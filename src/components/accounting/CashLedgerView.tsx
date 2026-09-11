import { useEffect, useRef, useState } from "react";
import { fmtMDSlash } from "../../lib/dues/duesText";
import { shortGroupLabel } from "../../lib/dues/labelShorten";
import type { CashLedger } from "../../lib/dues/types";
import { accountingError, readAccountingLedger } from "../../lib/supabase/dues";

export default function CashLedgerView({
	ym,
	revision,
	buckets = true,
	onLines,
	closingBalance,
}: {
	ym: string;
	revision: number;
	/**
	 * 항목별 수지 시트를 이 카드 아래 붙일지. 운영진 회계 탭은 같은 항목을 거래 내역
	 * 안의 필터 칩으로 쓰므로 끈다(`false`). 거래 목록이 없는 회원 화면은 이 시트가
	 * 항목별 합계를 보는 **유일한** 자리라 켠 채로 둔다.
	 */
	buckets?: boolean;
	/**
	 * 조회한 항목 줄을 부모로 올린다 — 운영진 화면의 필터 칩이 같은 값을 쓰되
	 * `dues_ledger` 를 두 번 부르지 않기 위한 경로다(무료 플랜 호출 예산).
	 */
	onLines?: (lines: CashLedger["lines"]) => void;
	closingBalance?: { amount: number; occurredAt: string };
}) {
	const [shown, setShown] = useState<{
		ym: string;
		data?: CashLedger;
		error?: string;
	} | null>(null);
	// 최신 콜백을 ref 로 들고 있는다 — 부모가 인라인 함수를 넘겨도 조회 effect 가
	// 매 렌더 다시 돌지 않는다(같은 달을 두 번 조회하는 사고를 막는다).
	const onLinesRef = useRef(onLines);
	useEffect(() => {
		onLinesRef.current = onLines;
	});
	useEffect(() => {
		let disposed = false;
		void readAccountingLedger(ym)
			.then((data) => {
				if (disposed) return;
				setShown({ ym, data });
				onLinesRef.current?.(data.lines);
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
				{/* 읽는 순서 = 계산 순서. 들어온 돈·나간 돈을 먼저 보이고, 그 차액을
				    아래에 크게, 마지막에 통장에 실제로 남은 잔액을 놓는다. */}
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
				<div className="ac-row ac-ledger-net">
					<span className="ac-row-body">
						<strong>수입 − 지출</strong>
					</span>
					<strong className="ac-amount">
						{net > 0 ? "+" : net < 0 ? "−" : ""}
						{number(Math.abs(net))}
					</strong>
				</div>
				{closingBalance && (
					<div className="ac-row">
						<span className="ac-row-body">
							<strong>통장잔액</strong>
							<span className="ac-row-note">
								{fmtMDSlash(closingBalance.occurredAt)} 기준
							</span>
						</span>
						<strong className="ac-amount">
							{number(closingBalance.amount)}
						</strong>
					</div>
				)}
			</section>
			{buckets && (
			<section className="ac-sheet ac-ledger-buckets" aria-label="항목별 내역">
				<div className="ac-sheet-head">
					<h2>항목별 수지</h2>
					<span>수입 / 지출 (원)</span>
				</div>
				<div className="ac-ledger-bucket-rows">
					{ledger.lines.map((line, index) => (
						<div
							className="ac-row ac-cash-columns"
							key={`${line.group_id}-${index}`}
						>
							<span className="ac-row-body">
								<strong>{shortGroupLabel(line.label)}</strong>
							</span>
							<strong
								className={`ac-amount ${line.income ? "ac-ledger-income" : ""}`}
							>
								{line.income ? number(line.income) : "—"}
							</strong>
							<strong className="ac-amount-2">
								{line.expense ? `−${number(line.expense)}` : "—"}
							</strong>
						</div>
					))}
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
			)}
		</div>
	);
}
