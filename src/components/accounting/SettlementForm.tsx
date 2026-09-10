import { useEffect, useRef, type ReactNode } from "react";
import type { BankTransaction } from "../../lib/dues/types";
import { amountInputProps } from "../../lib/dues/amountInput";
import { signed, won } from "../../lib/dues/duesText";

/** Shared presentation only. Operation state and saving belong to QuickSettlement. */
export function SettlementHeader({
	transaction,
	name,
	hint,
	balance,
	payerAction,
	options,
}: {
	transaction: BankTransaction;
	name: string;
	hint: ReactNode;
	balance?: number;
	payerAction?: ReactNode;
	options: ReactNode;
}) {
	return (
		<header className="ac-receipt-heading">
			<div className="ac-receipt-meta">
				<time dateTime={transaction.occurred_at}>
					{new Date(transaction.occurred_at).toLocaleString("ko-KR", {
						timeZone: "Asia/Seoul",
						month: "numeric",
						day: "numeric",
						hour: "2-digit",
						minute: "2-digit",
						hour12: false,
					})}
				</time>
				{options}
			</div>
			<div className="ac-receipt-identity">
				<div className="ac-receipt-payer">
					<strong>{name}</strong>
					{payerAction}
				</div>
				<strong
					className={`ac-number ac-receipt-amount ${transaction.direction === "in" ? "ac-in" : "ac-out"}`}
				>
					{transaction.direction === "in"
						? won(transaction.amount)
						: signed(-transaction.amount)}
				</strong>
			</div>
			<p className="ac-receipt-hint">{hint}</p>
			{balance !== undefined && balance !== transaction.amount && (
				<p className="ac-caption">정산할 잔액 {won(balance)}</p>
			)}
		</header>
	);
}

export function SettlementEditor({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const heading = useRef<HTMLDivElement>(null);
	useEffect(() => {
		heading.current?.focus();
	}, [title]);
	return (
		<div
			className="ac-receipt-editor"
			role="group"
			aria-label={`${title} 설정`}
		>
			<div className="ac-receipt-editor-heading" ref={heading} tabIndex={-1}>
				<strong>{title}</strong>
				<button
					type="button"
					className="ac-receipt-change"
					aria-label={`${title} 닫기`}
					onClick={onClose}
				>
					닫기
				</button>
			</div>
			{children}
		</div>
	);
}

export function SettlementField({
	label,
	children,
	input = false,
	stacked = false,
}: {
	label: string;
	children: ReactNode;
	input?: boolean;
	stacked?: boolean;
}) {
	const Tag = input ? "label" : "div";
	return (
		<Tag
			className={`ac-receipt-field${stacked ? " ac-receipt-field-stacked" : ""}`}
		>
			<span>{label}</span>
			{children}
		</Tag>
	);
}

export function SettlementAmount({
	value,
	onChange,
	label,
	max,
}: {
	value: string;
	onChange: (value: string) => void;
	label: string;
	max?: number;
}) {
	return (
		<span className="ac-receipt-money-input">
			<input
				type="number"
				aria-label={label}
				min="1"
				max={max}
				value={value}
				{...amountInputProps}
				onChange={(e) => onChange(e.target.value)}
			/>
			<span>원</span>
		</span>
	);
}

export function SettlementMemo({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<label className="ac-inline-memo">
			<span>메모</span>
			<input
				className="ac-input"
				aria-label="처리 사유"
				name="settlement-memo"
				autoComplete="off"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="필요한 경우 입력…"
			/>
		</label>
	);
}
