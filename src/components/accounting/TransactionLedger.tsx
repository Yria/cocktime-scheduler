import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { transactionNeedsSettlement } from "../../lib/dues/v2/quickSettlement";
import { kstMonth, memberLabel } from "../../lib/dues/v2/summary";
import { shortGroupLabel } from "../../lib/dues/v2/labelShorten";
import type { AccountingData, BankTransaction } from "../../lib/dues/v2/types";
import { fmtMDSlash, won } from "../admin/dues/duesText";
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
		note: notes.map(shortGroupLabel).join(" · ") || "미정산",
		groups,
		refund: refunds.length > 0,
		pending: transactionNeedsSettlement(data, tx.id),
	};
}

// 통장 대사가 본업인 목록. 금액·잔액을 고정 폭 레일에 담아 자릿수를 세로로 겹친다
// (전에는 행마다 열 폭이 달라 tabular-nums 가 무력했고, 2차 조회로 늦게 오는 잔액이
// 첫 페인트 후 전체를 재배치했다).
export default function TransactionLedger({
	data,
	ym,
	disabled,
	settling,
	onDone,
	onPendingChange,
	onMonth,
	filter,
	onFilter,
	balances,
}: {
	data: AccountingData;
	ym: string;
	disabled: boolean;
	settling: boolean;
	onDone: () => Promise<void>;
	onPendingChange: (pending: boolean) => void;
	onMonth: (ym: string) => void;
	/** 항목별 내역과 공유하는 필터. 부모가 소유해 두 블록이 같은 값을 본다. */
	filter: string;
	onFilter: (key: string) => void;
	balances: Map<number, number | null>;
}) {
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<"date" | "amount">("date");
	const [expanded, setExpanded] = useState<number | null>(null);
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
	const matchesFilter = (r: (typeof rows)[number], key: string) =>
		key === "all" ||
		(key === "pending" && r.pending) ||
		key === r.tx.direction ||
		(key === "refund" && r.refund) ||
		r.groups.has(key);
	const filters = [
		{ key: "all", label: "전체" },
		{ key: "in", label: "입금" },
		{ key: "out", label: "출금" },
		{ key: "pending", label: "미정산" },
		{ key: "refund", label: "환불" },
	];
	const shown = rows
		.filter(
			(r) =>
				matchesFilter(r, filter) &&
				(nameMatches(
					`${r.tx.name ?? ""} ${r.note} ${fmtMDSlash(r.tx.occurred_at)} ${r.tx.occurred_at.slice(0, 10)}`,
					query,
				) ||
					String(r.tx.id) === query.trim()),
		)
		.sort((a, b) => (sort === "amount" ? b.tx.amount - a.tx.amount : 0));
	const number = (n: number) => n.toLocaleString("ko-KR");
	const selectedGroup = data.groups.find((g) => g.id === filter);
	return (
		<section
			className="ac-sheet ac-transaction-ledger"
			aria-label="전체 거래 내역"
		>
			<div className="ac-sheet-head">
				<h2>거래 내역</h2>
				<span>{shown.length}건 · 원</span>
			</div>
			<div className="ac-ledger-transactions-body">
				<div className="ac-search ac-ledger-search">
					<Search size={15} aria-hidden="true" />
					<input
						aria-label="전체 거래 검색"
						placeholder="이름·항목·날짜"
						value={query}
						disabled={settling}
						onChange={(e) => {
							setQuery(e.target.value);
							setExpanded(null);
						}}
					/>
					{!!query && (
						<button
							type="button"
							className="ac-search-clear"
							aria-label="거래 검색어 지우기"
							disabled={settling}
							onClick={() => setQuery("")}
						>
							<X size={16} aria-hidden="true" />
						</button>
					)}
					<select
						aria-label="거래 정렬"
						value={sort}
						disabled={settling}
						onChange={(e) => setSort(e.target.value as "date" | "amount")}
					>
						<option value="date">날짜순</option>
						<option value="amount">금액순</option>
					</select>
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
							className="ac-chip"
							aria-pressed={filter === f.key}
							disabled={settling}
							onClick={() => {
								onFilter(f.key);
								setExpanded(null);
							}}
						>
							{f.label}
						</button>
					))}
					{selectedGroup && (
						<button
							type="button"
							className="ac-chip"
							aria-pressed="true"
							aria-label={`${selectedGroup.label} 필터 해제`}
							disabled={settling}
							onClick={() => onFilter("all")}
						>
							{shortGroupLabel(selectedGroup.label)}{" "}
							<X size={12} aria-hidden="true" />
						</button>
					)}
				</div>
				<div>
					{shown.map(({ tx, note, pending }) => (
						<div key={tx.id} className="ac-ledger-transaction">
							<div
								className="ac-ledger-transaction-row"
								role="group"
								aria-label={`거래 ${tx.id} 요약`}
							>
								<div className="ac-ledger-transaction-body">
									<strong>{tx.name || `거래 #${tx.id}`}</strong>
									<div className={`ac-row-note ${pending ? "is-pending" : ""}`}>
										{fmtMDSlash(tx.occurred_at)} ·{" "}
										{pending && note !== "미정산" && !note.includes("미정산")
											? `미정산 · ${note}`
											: note}
									</div>
								</div>
								<span
									className={`ac-number ac-ledger-transaction-amount ${tx.direction === "in" ? "ac-ledger-income" : ""}`}
								>
									{tx.direction === "in" ? "+" : "−"}
									{number(tx.amount)}
								</span>
								<button
									type="button"
									className="ac-ledger-transaction-toggle"
									disabled={settling}
									aria-label={`거래 ${tx.id} 상세`}
									aria-expanded={expanded === tx.id}
									aria-controls={`ledger-detail-${tx.id}`}
									onClick={() => setExpanded(expanded === tx.id ? null : tx.id)}
								>
									{expanded === tx.id ? "닫기" : "상세 보기"}
								</button>
							</div>
							{expanded === tx.id && (
								<div id={`ledger-detail-${tx.id}`} className="ac-ledger-detail">
									{balances.get(tx.id) != null && (
										<p className="ac-caption">
											거래 후 잔액 {won(balances.get(tx.id)!)}
										</p>
									)}
									<TransactionCard
										data={data}
										transaction={tx}
										disabled={disabled}
										origin="회계"
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
							{rows.length ? (
								<>
									조건에 맞는 거래가 없습니다.{" "}
									<button
										type="button"
										className="ac-link"
										onClick={() => {
											onFilter("all");
											setQuery("");
										}}
									>
										조건 지우기
									</button>
								</>
							) : (
								"이 달의 거래가 없습니다."
							)}
						</p>
					)}
				</div>
			</div>
		</section>
	);
}
