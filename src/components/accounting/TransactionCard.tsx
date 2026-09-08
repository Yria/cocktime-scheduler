import { useState } from "react";
import QuickSettlement from "./QuickSettlement";
import { ArrowRight, Check, RotateCcw } from "lucide-react";
import { kstMonth, memberLabel } from "../../lib/dues/v2/summary";
import {
	purposeLabel,
	type AccountingData,
	type BankTransaction,
} from "../../lib/dues/v2/types";
import { signed, won } from "../admin/dues/duesText";
import { directionMark, type RowTone } from "./rowGlyph";
import type { OperationDraft } from "./OperationDialog";

export default function TransactionCard({
	data,
	transaction: t,
	disabled,
	onDone,
	onPendingChange,
	onMonth,
	origin = "정산함",
	onSettled,
}: {
	data: AccountingData;
	transaction: BankTransaction;
	disabled: boolean;
	onDone: () => Promise<void>;
	onPendingChange: (pending: boolean) => void;
	onMonth: (ym: string) => void;
	/** 감사 로그에 남길 처리 위치. 회계 탭에서 한 처리가 '정산함'으로 기록되던 것을 구분한다. */
	origin?: string;
	/** 확정 성공 요약 — 부모가 '처리한 N건' 목록에 쌓는다(카드가 사라져도 확인이 남는다). */
	onSettled?: (text: string) => void;
}) {
	const positions = data.positions.filter((p) => p.bank_tx_id === t.id);
	const allocations = data.allocations.filter(
		(a) => a.bank_tx_id === t.id && a.amount > a.reversed,
	);
	const refund = data.refunds.find((r) => r.out_tx_id === t.id);
	const returned = data.refunds.filter((r) => r.in_tx_id === t.id);
	const expense = data.expenses.find((e) => e.bank_tx_id === t.id);
	const expenseGroup = data.groups.find((g) => g.id === expense?.group_id);
	const [selectedDraft, setDraft] = useState<OperationDraft | null>(null);
	const [completed, setCompleted] = useState(0);
	const pending = positions.find(
		(p) => p.amount > 0 && ["unassigned", "member_pending"].includes(p.purpose),
	);
	const draft: OperationDraft | null =
		selectedDraft ??
		(pending
			? { type: "pay", positionId: pending.id }
			: t.direction === "out" && !refund && !expense?.group_id
				? { type: "expense", outTxId: t.id }
				: null);
	const [saved, setSaved] = useState(false);
	// The entry point belongs in the audit reason, not in the presentation choice.
	const receipt = draft?.type === "pay" || draft?.type === "expense";
	const paidReceipt =
		!receipt &&
		t.direction === "in" &&
		allocations.reduce((sum, a) => sum + a.amount - a.reversed, 0) === t.amount;
	const onAction = (next: OperationDraft) => {
		setSaved(false);
		setDraft(next);
	};
	const settlementHistory =
		allocations.length > 0 || returned.length > 0 ? (
			<div
				className="ac-settlement-history"
				role="group"
				aria-label="이 입금의 처리 내역"
			>
				{allocations.map((a) => (
					<div key={a.id} className="ac-allocation">
						<div className="ac-allocation-copy">
							<div className="ac-allocation-person">
								{!paidReceipt && (
									<span className="ac-badge is-green">납부</span>
								)}
								<strong>{memberLabel(data, a.owner_id)}</strong>
							</div>
							<small>
								{
									data.groups.find(
										(g) =>
											g.id ===
											data.charges.find((c) => c.id === a.charge_id)?.group_id,
									)?.label
								}
							</small>
						</div>
						<div className="ac-allocation-side">
							<strong className="ac-number">
								{won(a.amount - a.reversed)}
							</strong>
							<button
								type="button"
								className="ac-chip ac-allocation-undo"
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
					</div>
				))}
				{returned.map((r) => (
					<p key={r.out_tx_id} className="ac-caption">
						<span className="ac-badge is-neutral">환불</span> {won(r.amount)} ·
						출금 #{r.out_tx_id}
					</p>
				))}
			</div>
		) : null;
	// 카드 좌측 리브의 색. 판단이 남았으면 대기, 끝났으면 정착.
	const tone: RowTone =
		pending || (t.direction === "out" && !refund && !expense?.group_id)
			? "ask"
			: "settled";

	const date = new Date(t.occurred_at).toLocaleDateString("ko-KR", {
		timeZone: "Asia/Seoul",
		month: "numeric",
		day: "numeric",
	});
	return (
		<section
			className={`ac-card ac-transaction is-${tone}${receipt ? " ac-inbox-receipt" : ""}${paidReceipt ? " ac-settled-receipt" : ""}`}
			aria-label={`거래 ${t.id}`}
		>
			{!receipt && (
				<>
					{paidReceipt ? (
						<div className="ac-settled-heading">
							<div className="ac-settled-meta">
								<span>{date} 입금</span>
								<span className="ac-badge is-green">
									<Check size={12} aria-hidden="true" /> 납부 완료
								</span>
							</div>
							<div className="ac-settled-identity">
								<strong>{t.name || `거래 #${t.id}`}</strong>
								<strong className="ac-number">{signed(t.amount)}</strong>
							</div>
						</div>
					) : (
						<div className="ac-row ac-transaction-heading">
							<span className="ac-row-gutter" aria-hidden="true">
								{directionMark(t.direction)}
							</span>
							<span className="ac-row-body">
								<strong>{t.name || `거래 #${t.id}`}</strong>
								<span className="ac-transaction-date">{date}</span>
							</span>
							<strong
								className={`ac-amount ${t.direction === "in" ? "ac-in" : "ac-out"}`}
							>
								{signed(t.direction === "in" ? t.amount : -t.amount)}
							</strong>
						</div>
					)}
					{t.direction === "in" ? (
						<>
							{settlementHistory}
							{positions.map((p) => (
								<div key={p.id} className="ac-position">
									{!(
										positions.length === 1 &&
										p.amount === t.amount &&
										["unassigned", "member_pending"].includes(p.purpose)
									) && (
										<div className="ac-position-heading">
											<span
												className={`ac-badge ${p.purpose === "unassigned" ? "is-amber" : "is-neutral"}`}
											>
												{purposeLabel[p.purpose]}
											</span>
											<strong className="ac-number">{won(p.amount)}</strong>
										</div>
									)}
									{(p.owner_id || p.group_id || p.available_ym) &&
										draft?.positionId !== p.id && (
											<p className="ac-caption">
												{p.purpose === "club"
													? data.groups.find((g) => g.id === p.group_id)?.label
													: memberLabel(data, p.owner_id)}
												{p.available_ym && ` · ${p.available_ym}부터 사용`}
											</p>
										)}
									{/* 처리 방식은 한 트랙 안에서 고른다 — 선택은 잉크 반전 하나로만 표현한다. */}
									<div className="ac-actions ac-segment">
										{["unassigned", "member_pending", "carry"].includes(
											p.purpose,
										) && (
											<>
												<button
													type="button"
													className="ac-chip"
													aria-pressed={
														draft?.type === "pay" && draft.positionId === p.id
													}
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
													aria-pressed={
														draft?.type === "carry" && draft.positionId === p.id
													}
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
										<button
											type="button"
											className="ac-chip"
											aria-pressed={
												draft?.type === "position" && draft.positionId === p.id
											}
											disabled={disabled}
											onClick={() =>
												onAction({ type: "position", positionId: p.id })
											}
										>
											용도 지정
										</button>
									</div>
								</div>
							))}
						</>
					) : (
						<div className="ac-actions">
							{refund ? (
								<>
									<span className="ac-badge is-green">환불 완료</span>
									<button
										type="button"
										className="ac-chip"
										disabled={disabled}
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
									{/* 되돌리기는 형태로 구분한다 — 12px 회색 링크였던 것을 결과 예고와 함께. */}
									<div className="ac-undo-block">
										<strong>되돌리기</strong>
										<span>
											{won(refund.amount)}이 원입금 잔액으로 돌아갑니다.
										</span>
										<button
											type="button"
											className="ac-btn-undo"
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
									</div>
								</>
							) : (
								<>
									{expense?.group_id && (
										<p className="ac-expense-saved">
											<span className="ac-badge is-green">지출 처리됨</span>
											<span>{expenseGroup?.label ?? "연결된 지출 항목"}</span>
										</p>
									)}
									<button
										type="button"
										className="ac-chip"
										aria-pressed={draft?.type === "expense"}
										aria-label={
											expense?.group_id ? "지출 항목 변경" : "지출 항목 지정"
										}
										disabled={disabled}
										onClick={() => onAction({ type: "expense", outTxId: t.id })}
									>
										{expense?.group_id ? "항목 변경" : "지출 항목 지정"}
									</button>
									{!expense?.group_id && (
										<button
											type="button"
											className="ac-chip"
											aria-pressed={draft?.type === "refund"}
											disabled={disabled}
											onClick={() =>
												onAction({ type: "refund", outTxId: t.id })
											}
										>
											<RotateCcw size={14} />
											환불 연결
										</button>
									)}
								</>
							)}
						</div>
					)}
				</>
			)}
			{draft && (
				<QuickSettlement
					key={`${completed}:${JSON.stringify(draft)}`}
					data={data}
					draft={draft}
					bankId={t.id}
					disabled={disabled}
					origin={origin}
					receipt={receipt}
					history={settlementHistory}
					onAction={onAction}
					onPendingChange={onPendingChange}
					onDone={onDone}
					onClose={(success, summary) => {
						if (success) {
							setCompleted((n) => n + 1);
							setSaved(true);
							onSettled?.(
								`${date} ${t.name || `거래 #${t.id}`} · ${summary ?? "처리 완료"}`,
							);
						}
						setDraft(null);
					}}
				/>
			)}
			{saved && (
				<p className={paidReceipt ? "sr-only" : "ac-saved"} role="status">
					선택한 내역을 반영했습니다.
				</p>
			)}
		</section>
	);
}
