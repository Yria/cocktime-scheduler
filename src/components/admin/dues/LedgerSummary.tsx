import { useMemo } from "react";
import { useDuesStore } from "../../../store/duesStore";
import { moneyClass, signed, won } from "./duesText";

// 회계 요약: 그 달 통장 수입/지출/남은 돈 + 최신 잔액. 통장 거래(현금 기준) 그대로.
export default function LedgerSummary() {
	const txns = useDuesStore((s) => s.bankTxns);
	const { income, expense, latestBalance } = useMemo(() => {
		let inc = 0;
		let exp = 0;
		let latest: { at: string; bal: number } | null = null;
		for (const t of txns) {
			if (t.direction === "in") inc += t.amount;
			else exp += t.amount;
			if (t.balanceAfter != null && (!latest || t.occurredAt > latest.at)) latest = { at: t.occurredAt, bal: t.balanceAfter };
		}
		return { income: inc, expense: exp, latestBalance: latest?.bal ?? null };
	}, [txns]);
	const net = income - expense;

	return (
		<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 14, padding: "14px 16px" }}>
			<div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
				<span className="text-muted" style={{ fontSize: 13 }}>수입</span>
				<span className="text-[#1c8a3b]" style={{ fontSize: 15, fontWeight: 800 }}>+{won(income)}</span>
			</div>
			<div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
				<span className="text-muted" style={{ fontSize: 13 }}>지출</span>
				<span className="text-[#d1362c]" style={{ fontSize: 15, fontWeight: 800 }}>−{won(expense)}</span>
			</div>
			<div className="flex items-center justify-between" style={{ borderTop: "1px solid rgba(100,116,139,0.2)", paddingTop: 8 }}>
				<span className="text-strong" style={{ fontSize: 14, fontWeight: 700 }}>이 달 남은 돈</span>
				<span className="flex flex-col items-end">
					<span className={moneyClass(net >= 0)} style={{ fontSize: 17, fontWeight: 800 }}>{signed(net)}</span>
					{latestBalance != null && <span className="text-faint" style={{ fontSize: 11 }}>통장 잔액 {won(latestBalance)}</span>}
				</span>
			</div>
		</div>
	);
}
