import { Check, RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { signed, won } from "../../lib/dues/duesText";
import { memberLabel } from "../../lib/dues/summary";
import {
	type AccountingData,
	type BankTransaction,
	purposeLabel,
} from "../../lib/dues/types";
import type { OperationDraft } from "./OperationDialog";
import QuickSettlement from "./QuickSettlement";
import { directionMark, type RowTone } from "./rowGlyph";

/**
 * 처리 내역 한 줄의 뼈대. 카드가 '이 돈이 어디로 갔나'를 말하는 유일한 형태다 —
 * 배분(납부)·환불로 나간 몫·처리 끝난 출금이 모두 이 한 구조를 쓴다.
 *
 * 겹치는 것(3단 골격·금액 활자)만 여기서 정하고, 자리마다 다른 것은 children 으로
 * 받는다 — 행 종류가 늘어도 이 파일에 슬롯 prop 이 늘지 않는다.
 * `actions` 만 prop 인 이유는 children 과 **다른 칸**(우측 레일)에 들어가기 때문이다.
 */
function SettledRow({
	amount,
	actions,
	children,
}: {
	amount: string;
	/** 금액 아래 붙는 되돌릴 버튼들. children 과 들어가는 칸이 달라 prop 이다. */
	actions?: ReactNode;
	/** 좌측 칸 전체 — `SettledWho` 와 근거 `<small>` 을 자유롭게 조합한다. */
	children: ReactNode;
}) {
	return (
		<div className="ac-allocation">
			<div className="ac-allocation-copy">{children}</div>
			<div className="ac-allocation-side">
				<strong className="ac-number">{amount}</strong>
				{actions}
			</div>
		</div>
	);
}

/** 좌측 첫 줄 — [배지] 대상. 배지도 이름도 자리마다 달라 전부 children 이다. */
function SettledWho({ children }: { children: ReactNode }) {
	return <div className="ac-allocation-person">{children}</div>;
}

/** 처리 내역 묶음. 방향에 따라 접근명만 갈린다. */
function SettledList({
	direction,
	children,
}: {
	direction: BankTransaction["direction"];
	children: ReactNode;
}) {
	return (
		<div
			className="ac-settlement-history"
			role="group"
			aria-label={`이 ${direction === "in" ? "입금" : "출금"}의 처리 내역`}
		>
			{children}
		</div>
	);
}

export default function TransactionCard({
	data,
	transaction: t,
	disabled,
	onDone,
	onPendingChange,
	origin = "정산함",
	onSettled,
}: {
	data: AccountingData;
	transaction: BankTransaction;
	disabled: boolean;
	onDone: () => Promise<void>;
	onPendingChange: (pending: boolean) => void;
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
	// 환불 출금의 '원입금'을 이 카드 안에서 펼쳐 본다. 전에는 달을 통째로 옮겨
	// (onMonth) 보던 화면을 잃었다 — 같은 카드 컴포넌트를 아래에 그대로 그린다.
	const [sourceOpen, setSourceOpen] = useState(false);
	// The entry point belongs in the audit reason, not in the presentation choice.
	// Every active settlement uses the same receipt shell, including refunds and reversals.
	const receipt = !!draft;
	const allocated = allocations.reduce(
		(sum, a) => sum + a.amount - a.reversed,
		0,
	);
	const returnedSum = returned.reduce((sum, r) => sum + r.amount, 0);
	// 처리가 끝난 카드는 방향과 무관하게 같은 껍데기를 쓴다 — 같은 목록에 서는 카드가
	// 둘 다 '끝난 건'인데 머리·행 구조가 다르면 훑을 때 눈이 두 번 적응한다.
	// 입금이 이 가지에 닿았다는 건 미배분 자리가 없다는 뜻이다(있으면 초안이 붙어
	// `receipt` 가 된다) — 배분·환불·귀속 중 무엇으로든 끝난 건이다.
	const settledIn = !receipt && t.direction === "in";
	const settledOut =
		!receipt && t.direction === "out" && (!!refund || !!expense?.group_id);
	const paidReceipt = settledIn && allocated === t.amount;
	const settledReceipt = settledIn || settledOut;
	// 배지는 실제로 무엇으로 끝났는지만 말한다 — 환불로 비운 입금까지 '납부 완료'라고
	// 부르지 않는다.
	const settledLabel = paidReceipt
		? "납부 완료"
		: settledIn
			? returnedSum === t.amount
				? "환불 완료"
				: "처리 완료"
			: refund
				? "환불 완료"
				: "지출 처리됨";
	const refundSource = refund
		? data.bank.find((b) => b.id === refund.in_tx_id)
		: undefined;
	const refundSourceDate = refundSource
		? new Date(refundSource.occurred_at).toLocaleDateString("ko-KR", {
				timeZone: "Asia/Seoul",
				month: "numeric",
				day: "numeric",
			})
		: "";
	const onAction = (next: OperationDraft) => {
		setSaved(false);
		setDraft(next);
	};
	const settlementHistory =
		allocations.length > 0 || returned.length > 0 ? (
			<SettledList direction={t.direction}>
				{allocations.map((a) => {
					const charge = data.charges.find((c) => c.id === a.charge_id);
					const beneficiary = memberLabel(data, charge?.member_id ?? null);
					const group =
						data.groups.find((g) => g.id === charge?.group_id)?.label ?? "부과";
					return (
						<SettledRow
							key={a.id}
							amount={won(a.amount - a.reversed)}
							actions={
								<button
									type="button"
									className="ac-chip ac-allocation-undo"
									aria-label={`${beneficiary} · ${group} · ${won(a.amount - a.reversed)} 연결 해제`}
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
							}
						>
							<SettledWho>
								{/* 머리글이 이미 '납부 완료'라고 말하면 줄마다 또 붙이지 않는다. */}
								{!paidReceipt && (
									<span className="ac-badge is-green">납부</span>
								)}
								<strong>{beneficiary}</strong>
							</SettledWho>
							<small>{group}</small>
							{charge?.member_id !== a.owner_id && (
								<small>{memberLabel(data, a.owner_id)} 입금으로 대납</small>
							)}
						</SettledRow>
					);
				})}
				{returned.map((r) => (
					<SettledRow key={r.out_tx_id} amount={won(r.amount)}>
						<SettledWho>
							<span className="ac-badge is-neutral">환불</span>
							<strong>출금 #{r.out_tx_id}</strong>
						</SettledWho>
					</SettledRow>
				))}
			</SettledList>
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
			className={`ac-card ac-transaction is-${tone}${receipt ? " ac-inbox-receipt" : ""}${settledReceipt ? " ac-settled-receipt" : ""}`}
			aria-label={`거래 ${t.id}`}
		>
			{!receipt && (
				<>
					{settledReceipt ? (
						<div className="ac-settled-heading">
							<div className="ac-settled-meta">
								<span>
									{date} {t.direction === "in" ? "입금" : "출금"}
								</span>
								<span className="ac-badge is-green">
									<Check size={12} aria-hidden="true" /> {settledLabel}
								</span>
							</div>
							<div className="ac-settled-identity">
								<strong>{t.name || `거래 #${t.id}`}</strong>
								<strong
									className={`ac-number ${t.direction === "in" ? "ac-in" : "ac-out"}`}
								>
									{signed(t.direction === "in" ? t.amount : -t.amount)}
								</strong>
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
									{(p.owner_id || p.group_id || p.available_ym) && (
										<p className="ac-caption">
											{p.purpose === "club"
												? data.groups.find((g) => g.id === p.group_id)?.label
												: memberLabel(data, p.owner_id)}
											{p.available_ym && ` · ${p.available_ym}부터 사용`}
										</p>
									)}
									<div className="ac-actions">
										{["unassigned", "member_pending", "carry"].includes(
											p.purpose,
										) && (
											<>
												<button
													type="button"
													className="ac-chip"
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
										<button
											type="button"
											className="ac-chip"
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
					) : settledOut ? (
						/* 처리 끝난 출금도 입금과 같은 한 줄 구조를 쓴다(SettledRow). */
						<SettledList direction={t.direction}>
							<SettledRow
								amount={won(refund ? refund.amount : t.amount)}
								actions={
									refund ? (
										<>
											{refundSource && (
												<button
													type="button"
													className="ac-chip ac-allocation-undo"
													aria-expanded={sourceOpen}
													onClick={() => setSourceOpen((open) => !open)}
												>
													{sourceOpen ? "원입금 닫기" : "원입금 보기"}
												</button>
											)}
											{/* 누르면 공용 확인 단계가 "환불 연결 해제 · N원" 요약과
										    확인 버튼을 띄운다(QuickSettlement) — 여기서 결과를
										    문장으로 미리 예고하면 같은 말을 두 번 한다. */}
											<button
												type="button"
												className="ac-chip ac-allocation-undo"
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
										<button
											type="button"
											className="ac-chip ac-allocation-undo"
											aria-label="지출 항목 변경"
											disabled={disabled}
											onClick={() =>
												onAction({ type: "expense", outTxId: t.id })
											}
										>
											항목 변경
										</button>
									)
								}
							>
								<SettledWho>
									<strong>
										{refund
											? refundSource?.name || `입금 #${refund.in_tx_id}`
											: (expenseGroup?.label ?? "연결된 지출 항목")}
									</strong>
								</SettledWho>
								<small>
									{refund
										? refundSource
											? `${refundSourceDate} 입금 · 원입금 환불`
											: "원입금 환불"
										: "지출 항목"}
								</small>
							</SettledRow>
							{/* 원입금을 달 이동 없이 이 자리에서 편다 — 같은 카드 컴포넌트라
							    거기서 바로 납부 연결까지 이어서 할 수 있다. */}
							{refund && sourceOpen && refundSource && (
								<div className="ac-refund-source">
									<TransactionCard
										data={data}
										transaction={refundSource}
										disabled={disabled}
										origin={origin}
										onDone={onDone}
										onPendingChange={onPendingChange}
									/>
								</div>
							)}
						</SettledList>
					) : (
						<div className="ac-actions">
							<button
								type="button"
								className="ac-chip"
								aria-label="지출 항목 지정"
								disabled={disabled}
								onClick={() => onAction({ type: "expense", outTxId: t.id })}
							>
								지출 항목 지정
							</button>
							<button
								type="button"
								className="ac-chip"
								disabled={disabled}
								onClick={() => onAction({ type: "refund", outTxId: t.id })}
							>
								<RotateCcw size={14} />
								환불 연결
							</button>
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
