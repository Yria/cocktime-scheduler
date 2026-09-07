import { useState } from "react";
import QuickSettlement from "./QuickSettlement";
import { ArrowRight, RotateCcw } from "lucide-react";
import { kstMonth, memberLabel } from "../../lib/dues/v2/summary";
import {
	purposeLabel,
	type AccountingData,
	type BankTransaction,
} from "../../lib/dues/v2/types";
import { won } from "../admin/dues/duesText";
import type { OperationDraft } from "./OperationDialog";

export default function TransactionCard({
	data,
	transaction: t,
	disabled,
	onDone,
	onPendingChange,
	onMonth,
}: {
	data: AccountingData;
	transaction: BankTransaction;
	disabled: boolean;
	onDone: () => Promise<void>;
	onPendingChange: (pending: boolean) => void;
	onMonth: (ym: string) => void;
}) {
	const positions = data.positions.filter((p) => p.bank_tx_id === t.id);
	const allocations = data.allocations.filter(
		(a) => a.bank_tx_id === t.id && a.amount > a.reversed,
	);
	const refund = data.refunds.find((r) => r.out_tx_id === t.id);
	const returned = data.refunds.filter((r) => r.in_tx_id === t.id);
	const expense = data.expenses.find((e) => e.bank_tx_id === t.id);
	const [draft, setDraft] = useState<OperationDraft | null>(() => {
		const pending = positions.find((p) =>
			["unassigned", "member_pending"].includes(p.purpose),
		);
		if (pending) return { type: "pay", positionId: pending.id };
		if (t.direction === "out" && !refund && !expense?.group_id)
			return { type: "expense", outTxId: t.id };
		return null;
	});
	const [saved, setSaved] = useState(false);
	const onAction = (next: OperationDraft) => {
		setSaved(false);
		setDraft(next);
	};

	const date = new Date(t.occurred_at).toLocaleDateString("ko-KR", {
		timeZone: "Asia/Seoul",
		month: "numeric",
		day: "numeric",
	});
	return (
		<section className="ac-card ac-transaction" aria-label={`거래 ${t.id}`}>
			<div className="ac-transaction-heading">
				<div className="ac-transaction-name">
					<span className="ac-caption">{date}</span>
					<strong>{t.name || `거래 #${t.id}`}</strong>
				</div>
				<strong
					className={`ac-transaction-amount ac-number ${t.direction === "in" ? "ac-in" : "ac-out"}`}
				>
					{t.direction === "in" ? "+" : "−"}
					{won(t.amount)}
				</strong>
			</div>
			{t.direction === "in" ? (
				<>
					{allocations.map((a) => (
						<div key={a.id} className="ac-allocation">
							<div>
								<span className="ac-badge is-green">납부</span>
								<span>
									{memberLabel(data, a.owner_id)}
									<small>
										{
											data.groups.find(
												(g) =>
													g.id ===
													data.charges.find((c) => c.id === a.charge_id)
														?.group_id,
											)?.label
										}{" "}
										· {won(a.amount - a.reversed)}
									</small>
								</span>
							</div>
							<button
								type="button"
								className="ac-link ac-muted-link"
								disabled={disabled}
								onClick={() =>
									onAction({
										type: "simple",
										command: {
											action: "reverse_payment",
											reason: "",
											allocation_id: a.id,
											amount: a.amount - a.reversed,
										},
									})
								}
							>
								연결 해제
							</button>
						</div>
					))}
					{returned.map((r) => (
						<p key={r.out_tx_id} className="ac-caption">
							<span className="ac-badge is-neutral">환불</span> {won(r.amount)}{" "}
							· 출금 #{r.out_tx_id}
						</p>
					))}
					{positions.map((p) => (
						<div key={p.id} className="ac-position">
							<div className="ac-position-heading">
								<span
									className={`ac-badge ${p.purpose === "unassigned" ? "is-amber" : "is-neutral"}`}
								>
									{purposeLabel[p.purpose]}
								</span>
								<strong className="ac-number">{won(p.amount)}</strong>
							</div>
							{(p.owner_id || p.group_id || p.available_ym) &&
								draft?.positionId !== p.id && (
									<p className="ac-caption">
										{p.purpose === "club"
											? data.groups.find((g) => g.id === p.group_id)?.label
											: memberLabel(data, p.owner_id)}
										{p.available_ym && ` · ${p.available_ym}부터 사용`}
									</p>
								)}
							<div className="ac-actions">
								<button
									type="button"
									className="ac-chip"
									disabled={disabled}
									onClick={() =>
										onAction({ type: "position", positionId: p.id })
									}
								>
									용도 지정
									<ArrowRight size={13} />
								</button>
								{["unassigned", "member_pending", "carry"].includes(
									p.purpose,
								) && (
									<>
										<button
											type="button"
											className="ac-chip is-blue"
											disabled={disabled}
											onClick={() =>
												onAction({ type: "pay", positionId: p.id })
											}
										>
											납부 연결
										</button>
										<button
											type="button"
											className="ac-chip"
											disabled={disabled}
											onClick={() =>
												onAction({
													type: "carry",
													memberId: p.owner_id ?? undefined,
													positionId: p.id,
												})
											}
										>
											이월
										</button>
									</>
								)}
							</div>
						</div>
					))}
				</>
			) : (
				<>
					<div className="ac-actions">
						{refund ? (
							<>
								<span className="ac-badge is-green">환불 완료</span>
								<button
									type="button"
									className="ac-chip"
									onClick={() => {
										const source = data.bank.find(
											(b) => b.id === refund.in_tx_id,
										);
										if (source) onMonth(kstMonth(source.occurred_at));
									}}
								>
									원입금 월 보기
									<ArrowRight size={13} />
								</button>
								<button
									type="button"
									className="ac-link ac-muted-link"
									disabled={disabled}
									onClick={() =>
										onAction({
											type: "simple",
											command: {
												action: "reverse_refund",
												reason: "",
												out_tx_id: t.id,
											},
										})
									}
								>
									환불 연결 해제
								</button>
							</>
						) : (
							<>
								<button
									type="button"
									className="ac-chip"
									aria-label="지출 항목 지정"
									disabled={disabled}
									onClick={() => onAction({ type: "expense", outTxId: t.id })}
								>
									{data.groups.find((g) => g.id === expense?.group_id)?.label ??
										"지출 항목 지정"}
									<ArrowRight size={13} />
								</button>
								<button
									type="button"
									className="ac-chip is-blue"
									disabled={disabled || !!expense?.group_id}
									onClick={() => onAction({ type: "refund", outTxId: t.id })}
								>
									<RotateCcw size={14} />
									환불 연결
								</button>
							</>
						)}
					</div>
				</>
			)}
			{draft && (
				<QuickSettlement
					key={JSON.stringify(draft)}
					data={data}
					draft={draft}
					bankId={t.id}
					disabled={disabled}
					onPendingChange={onPendingChange}
					onDone={onDone}
					onClose={(success) => {
						setDraft(null);
						if (success) setSaved(true);
					}}
				/>
			)}
			{saved && (
				<p className="ac-saved" role="status">
					선택한 내역을 반영했습니다.
				</p>
			)}
		</section>
	);
}
