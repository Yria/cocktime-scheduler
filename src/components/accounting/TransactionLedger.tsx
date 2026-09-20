import { ChevronDown, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtMDSlash, won } from "../../lib/dues/duesText";
import { shortGroupLabel } from "../../lib/dues/labelShorten";
import { nameMatches } from "../../lib/dues/matching";
import { sortLedgerBuckets } from "../../lib/dues/overview";
import { transactionNeedsSettlement } from "../../lib/dues/quickSettlement";
import { kstMonth, memberLabel } from "../../lib/dues/summary";
import type {
	AccountingData,
	BankTransaction,
	CashLedger,
} from "../../lib/dues/types";
import TransactionCard from "./TransactionCard";

/**
 * 무엇에 쓰였는지("회식", "2099-01 이월" …)를 문장으로 만든다. **화면에는 쓰지 않는다** —
 * 행을 누르면 펼쳐지는 상세가 같은 내용을 그대로 보여 주므로(실측 확인) 접힌 줄에 또
 * 두면 날짜가 설명에 묻힌다. 이 문장은 검색 대상으로만 쓰인다: 목록에 안 보이는 항목명
 * 으로도 찾을 수 있어야 하고("회식" 검색이 그 거래를 집어낸다), 쪼개진 정산의 금액도
 * 검색어가 될 수 있어야 해서 금액을 붙인 원문을 유지한다.
 */
function describeTransaction(data: AccountingData, tx: BankTransaction) {
	const groups = new Set<string>();
	const notes: { text: string; amount?: number }[] = [];
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
			notes.push({
				text: `환불 → ${refund.owner_id ? memberLabel(data, refund.owner_id) : source?.name || `입금 #${refund.in_tx_id}`}`,
			});
		} else {
			const expense = data.expenses.find((e) => e.bank_tx_id === tx.id);
			if (expense?.group_id) notes.push({ text: groupName(expense.group_id) });
		}
	} else {
		for (const a of data.allocations.filter(
			(a) => a.bank_tx_id === tx.id && a.amount > a.reversed,
		)) {
			const charge = data.charges.find((c) => c.id === a.charge_id);
			notes.push({
				text: `${groupName(charge?.group_id ?? null)} 납부`,
				amount: a.amount - a.reversed,
			});
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
			notes.push({ text: label, amount: p.amount });
		}
		if (refunds.length)
			notes.push({
				text: "환불 완료",
				amount: refunds.reduce((sum, r) => sum + r.amount, 0),
			});
	}
	return {
		searchText:
			notes
				.map(({ text, amount }) =>
					shortGroupLabel(amount != null ? `${text} ${won(amount)}` : text),
				)
				.join(" · ") || "미정산",
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
	filter,
	onFilter,
	lines = [],
}: {
	data: AccountingData;
	ym: string;
	disabled: boolean;
	settling: boolean;
	onDone: () => Promise<void>;
	onPendingChange: (pending: boolean) => void;
	/** 상태·항목 버튼이 공유하는 필터. 부모가 선택 값을 유지한다. */
	filter: string;
	onFilter: (key: string) => void;
	/** 그 달의 항목별 수지. 이 목록을 좁히는 필터 줄로 그린다(SPEC §3.3). */
	lines?: CashLedger["lines"];
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
					`${r.tx.name ?? ""} ${r.searchText} ${fmtMDSlash(r.tx.occurred_at)} ${r.tx.occurred_at.slice(0, 10)}`,
					query,
				) ||
					String(r.tx.id) === query.trim()),
		)
		.sort((a, b) => (sort === "amount" ? b.tx.amount - a.tx.amount : 0));
	const number = (n: number) => n.toLocaleString("ko-KR");
	const selectedGroup = data.groups.find((g) => g.id === filter);
	// 상태와 항목 필터는 같은 흐름에 놓고, 항목은 종류별 날짜순을 유지한다.
	const buckets = useMemo(
		() => sortLedgerBuckets(lines, data.groups),
		[lines, data.groups],
	);
	const selectedBucket = buckets.find((line) => line.group_id === filter);
	const ungroupedBuckets = buckets.filter((line) => !line.group_id);
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
					className="ac-ledger-filters ac-filter-chips"
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
					{selectedGroup && !selectedBucket && (
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
					{buckets
						.filter((line) => line.group_id)
						.map((line) => {
							const picked = filter === line.group_id;
							const money = `수입 ${won(line.income)} · 지출 ${won(line.expense)}`;
							return (
								<button
									key={line.group_id}
									type="button"
									className="ac-chip ac-bucket-chip"
									aria-pressed={picked}
									aria-label={`${line.label} ${money}${picked ? " 필터 해제" : " 거래 보기"}`}
									title={`${line.label} · ${money}`}
									disabled={settling}
									onClick={() => {
										onFilter(picked ? "all" : (line.group_id as string));
										setExpanded(null);
									}}
								>
									{shortGroupLabel(line.label)}
								</button>
							);
						})}
				</div>
				{selectedBucket && (
					<p className="ac-caption" aria-label="선택 항목 수지">
						{shortGroupLabel(selectedBucket.label)} · 수입{" "}
						{won(selectedBucket.income)} · 지출 {won(selectedBucket.expense)}
					</p>
				)}
				{ungroupedBuckets.length > 0 && (
					<div
						className="ac-ledger-unassigned-totals"
						role="group"
						aria-label="기타 항목 수지"
					>
						{ungroupedBuckets.map((line, index) => (
							<span key={`${line.label}-${index}`}>
								{shortGroupLabel(line.label)} · 수입 {won(line.income)} · 지출{" "}
								{won(line.expense)}
							</span>
						))}
					</div>
				)}
				<div>
					{shown.map(({ tx, pending }) => (
						<div key={tx.id} className="ac-ledger-transaction">
							<div
								className="ac-ledger-transaction-row"
								role="group"
								aria-label={`거래 ${tx.id} 요약`}
							>
								<div className="ac-ledger-transaction-body">
									<strong>{tx.name || `거래 #${tx.id}`}</strong>
									{/* 항목 설명은 펼친 상세가 책임진다 — 접힌 줄에 같은 문구를
									    또 두면 날짜가 설명에 묻힌다. '미정산'만 남기는 이유:
									    펼침 화면은 이 상태를 문구가 아니라 '항목을 선택하세요'
									    UI 로 대체하므로, 목록에서 판단이 남은 건을 세로로 훑을
									    신호가 여기뿐이다(미정산 필터가 가리키는 그 신호). */}
									<div className={`ac-row-note ${pending ? "is-pending" : ""}`}>
										{fmtMDSlash(tx.occurred_at)}
										{pending ? " · 미정산" : ""}
									</div>
								</div>
								<span
									className={`ac-number ac-ledger-transaction-amount ${tx.direction === "in" ? "ac-ledger-income" : ""}`}
								>
									{tx.direction === "in" ? "+" : "−"}
									{number(tx.amount)}
								</span>
								{/* 글자 버튼이 금액 오른쪽에 서면 그 폭만큼 금액 레일이 밀려
								    행마다 끝이 어긋나 보인다. 홈의 행 끝 관용구인 셰브런
								    아이콘만 남기고, 접근명은 aria-label 이 계속 책임진다. */}
								<button
									type="button"
									className="ac-ledger-transaction-toggle"
									disabled={settling}
									aria-label={`거래 ${tx.id} 상세`}
									aria-expanded={expanded === tx.id}
									aria-controls={`ledger-detail-${tx.id}`}
									onClick={() => setExpanded(expanded === tx.id ? null : tx.id)}
								>
									<ChevronDown size={18} aria-hidden="true" />
								</button>
							</div>
							{expanded === tx.id && (
								<div id={`ledger-detail-${tx.id}`} className="ac-ledger-detail">
									<TransactionCard
										data={data}
										transaction={tx}
										disabled={disabled}
										origin="회계"
										onDone={onDone}
										onPendingChange={onPendingChange}
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
