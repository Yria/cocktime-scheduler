import { ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { transactionNeedsSettlement } from "../../lib/dues/v2/quickSettlement";
import { kstMonth, memberLabel } from "../../lib/dues/v2/summary";
import type { AccountingData, BankTransaction } from "../../lib/dues/v2/types";
import { fetchBankTransactions } from "../../lib/supabase/dues";
import { fmtMD, won } from "../admin/dues/duesText";
import { nameMatches } from "../admin/dues/matching";
import TransactionCard from "./TransactionCard";

function describeTransaction(data: AccountingData, tx: BankTransaction) {
	const groups = new Set<string>();
	const notes: string[] = [];
	const groupName = (id: string | null) => {
		if (id) groups.add(id);
		return data.groups.find((g) => g.id === id)?.label ?? "미분류";
	};
	const refunds = data.refunds.filter(
		(r) => r.out_tx_id === tx.id || r.in_tx_id === tx.id,
	);
	if (tx.direction === "out") {
		const refund = refunds[0];
		if (refund) {
			const source = data.bank.find((t) => t.id === refund.in_tx_id);
			notes.push(
				`환불 → ${refund.owner_id ? memberLabel(data, refund.owner_id) : source?.name || `입금 #${refund.in_tx_id}`}`,
			);
		} else {
			const expense = data.expenses.find((e) => e.bank_tx_id === tx.id);
			if (expense?.group_id) notes.push(groupName(expense.group_id));
		}
	} else {
		for (const a of data.allocations.filter(
			(a) => a.bank_tx_id === tx.id && a.amount > a.reversed,
		)) {
			const charge = data.charges.find((c) => c.id === a.charge_id);
			notes.push(
				`${groupName(charge?.group_id ?? null)} 납부 ${won(a.amount - a.reversed)}`,
			);
		}
		for (const p of data.positions.filter(
			(p) => p.bank_tx_id === tx.id && p.amount > 0,
		)) {
			const label =
				p.purpose === "club"
					? groupName(p.group_id)
					: p.purpose === "carry"
						? `${p.available_ym} 이월`
						: p.purpose === "refund_pending"
							? "환불 대기"
							: "미정산";
			notes.push(`${label} ${won(p.amount)}`);
		}
		if (refunds.length)
			notes.push(
				`환불 완료 ${won(refunds.reduce((sum, r) => sum + r.amount, 0))}`,
			);
	}
	return {
		note: notes.join(" · ") || "미정산",
		groups,
		refund: refunds.length > 0,
		pending: transactionNeedsSettlement(data, tx.id),
	};
}

// 기존 LedgerTxnList의 두 줄 목록. 분류·취소는 현재 회계 데이터와 처리 경로를 사용한다.
export default function TransactionLedger({
	data,
	ym,
	disabled,
	settling,
	onDone,
	onPendingChange,
	onMonth,
}: {
	data: AccountingData;
	ym: string;
	disabled: boolean;
	settling: boolean;
	onDone: () => Promise<void>;
	onPendingChange: (pending: boolean) => void;
	onMonth: (ym: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState("all");
	const [expanded, setExpanded] = useState<number | null>(null);
	const [balances, setBalances] = useState<Map<number, number | null>>(
		new Map(),
	);
	useEffect(() => {
		let disposed = false;
		// 통장 원본의 잔액만 사용한다. 이전 분류·매칭 상태는 사용하지 않는다.
		void fetchBankTransactions(ym).then((rows) => {
			if (!disposed)
				setBalances(new Map(rows.map((t) => [t.id, t.balanceAfter])));
		});
		return () => {
			disposed = true;
		};
	}, [ym, data.mode.revision]);
	const rows = useMemo(
		() =>
			data.bank
				.filter((t) => kstMonth(t.occurred_at) === ym)
				.sort(
					(a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id - a.id,
				)
				.map((tx) => ({ tx, ...describeTransaction(data, tx) })),
		[data, ym],
	);
	const usedGroups = new Set(rows.flatMap((r) => [...r.groups]));
	const filters = [
		{ key: "all", label: "전체" },
		{ key: "pending", label: "미정산" },
		{ key: "in", label: "입금" },
		{ key: "out", label: "출금" },
		{ key: "refund", label: "환불" },
		...data.groups
			.filter((g) => usedGroups.has(g.id))
			.map((g) => ({ key: g.id, label: g.label })),
	];
	const shown = rows.filter(
		(r) =>
			(filter === "all" ||
				(filter === "pending" && r.pending) ||
				filter === r.tx.direction ||
				(filter === "refund" && r.refund) ||
				r.groups.has(filter)) &&
			(nameMatches(`${r.tx.name ?? ""} ${r.note}`, query) ||
				String(r.tx.id) === query.trim()),
	);
	return (
		<section className="ac-transaction-ledger" aria-label="전체 거래 내역">
			<div className="ac-section-heading ac-ledger-list-heading">
				<h2>
					거래 내역 <span className="ac-count">{rows.length}</span>
				</h2>
				<span className="ac-caption">통장 잔액 대사</span>
			</div>
			<div className="ac-search ac-ledger-search">
				<Search size={15} aria-hidden="true" />
				<input
					aria-label="전체 거래 검색"
					placeholder="이름·처리내역 검색"
					value={query}
					disabled={settling}
					onChange={(e) => {
						setQuery(e.target.value);
						setExpanded(null);
					}}
				/>
			</div>
			<div
				className="ac-ledger-filters"
				role="group"
				aria-label="거래 내역 필터"
			>
				{filters.map((f) => (
					<button
						key={f.key}
						type="button"
						aria-pressed={filter === f.key}
						disabled={settling}
						onClick={() => {
							setFilter(f.key);
							setExpanded(null);
						}}
					>
						{f.label}
					</button>
				))}
			</div>
			{shown.map(({ tx, note, pending }) => (
				<div key={tx.id} className="ac-ledger-transaction">
					<button
						type="button"
						className="ac-ledger-transaction-toggle"
						disabled={settling}
						aria-label={`거래 ${tx.id} 상세`}
						aria-expanded={expanded === tx.id}
						aria-controls={`ledger-detail-${tx.id}`}
						onClick={() => setExpanded(expanded === tx.id ? null : tx.id)}
					>
						<span className="ac-ledger-date">{fmtMD(tx.occurred_at)}</span>
						<strong className="ac-ledger-name">
							{tx.name || `거래 #${tx.id}`}
						</strong>
						<strong
							className={`ac-number ${tx.direction === "in" ? "ac-in" : "ac-out"}`}
						>
							{tx.direction === "in" ? "+" : "−"}
							{won(tx.amount)}
						</strong>
						<span className="ac-ledger-note">
							{pending && note !== "미정산" && !note.includes("미정산")
								? `미정산 · ${note}`
								: note}
						</span>
						<span className="ac-ledger-balance ac-number">
							{balances.get(tx.id) != null &&
								`잔액 ${won(balances.get(tx.id)!)}`}
							<ChevronDown size={13} aria-hidden="true" />
						</span>
					</button>
					{expanded === tx.id && (
						<div id={`ledger-detail-${tx.id}`} className="ac-ledger-detail">
							<TransactionCard
								data={data}
								transaction={tx}
								disabled={disabled}
								onDone={onDone}
								onPendingChange={onPendingChange}
								onMonth={onMonth}
							/>
						</div>
					)}
				</div>
			))}
			{!shown.length && (
				<p className="ac-empty">
					{rows.length
						? "조건에 맞는 거래가 없습니다."
						: "이 달의 거래가 없습니다."}
				</p>
			)}
		</section>
	);
}
