import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import {
	canChooseReceiptPayer,
	suggestedReceiptPayer,
	suggestedReceiptDue,
	payableDues,
	payableTargets,
	previouslyPaidReceiptTargets,
	type PaymentTarget,
	refundLines,
} from "../../lib/dues/quickSettlement";
import { billingProgress } from "../../lib/dues/overview";
import { receiptHistory } from "../../lib/dues/selection";
import { kstMonth, memberLabel } from "../../lib/dues/summary";
import {
	actionLabel,
	purposeLabel,
	type AccountingCommand,
	type AccountingData,
	type FundPurpose,
} from "../../lib/dues/types";
import { shiftYm, won } from "../../lib/dues/duesText";
import MemberPicker from "./MemberPicker";
import type { OperationDraft } from "./OperationDialog";
import RefundPicker, { type RefundSelection } from "./RefundPicker";
import { useInlineAccounting } from "./useInlineAccounting";
import {
	SettlementHeader,
	SettlementEditor,
	SettlementMemo,
} from "./SettlementForm";
import CarrySettlementFields from "./CarrySettlementFields";
import PositionSettlementFields from "./PositionSettlementFields";
import SettlementConfirmation from "./SettlementConfirmation";
import SettlementGroupPicker from "./SettlementGroupPicker";
import PaymentSettlementFields from "./PaymentSettlementFields";
import SettlementOptions from "./SettlementOptions";
import SettlementTargetPicker from "./SettlementTargetPicker";

export default function QuickSettlement({
	data,
	draft: baseDraft,
	bankId,
	onDone,
	onClose,
	disabled,
	onPendingChange,
	origin = "정산함",
	history,
	onAction,
}: {
	data: AccountingData;
	draft: OperationDraft;
	bankId: number;
	onDone: () => Promise<void>;
	onClose: (saved?: boolean, summary?: string) => void;
	disabled: boolean;
	onPendingChange: (pending: boolean) => void;
	/** 감사 로그의 처리 위치. 회계 탭에서 한 처리가 '정산함'으로 남던 것을 구분한다. */
	origin?: string;
	/** Previously saved allocations/refunds, with their existing reversal actions. */
	history?: ReactNode;
	onAction?: (draft: OperationDraft) => void;
}) {
	// Secondary editors share the receipt so closing them preserves its payer and payment selection.
	const [receiptAction, setReceiptAction] = useState<
		"carry" | "position" | "refund" | null
	>(null);
	const draft = receiptAction
		? { ...baseDraft, type: receiptAction }
		: baseDraft;
	const receiptEditor = !["pay", "expense"].includes(draft.type);
	const optionsId = useId();
	const payerPickerId = useId();
	const optionsButton = useRef<HTMLButtonElement>(null);
	const tx = data.bank.find((t) => t.id === bankId)!;
	const source = data.positions.find((p) => p.id === draft.positionId);
	const choosePayer =
		draft.type === "pay" && canChooseReceiptPayer(data, bankId);
	const originalPayer = data.members.find((m) => m.id === source?.owner_id);
	const ambiguousPayer =
		choosePayer &&
		originalPayer &&
		data.members.some(
			(m) =>
				m.id !== originalPayer.id &&
				m.name.replaceAll(" ", "") === originalPayer.name.replaceAll(" ", ""),
		);
	const initialMember = ambiguousPayer
		? ""
		: (source?.owner_id ??
			draft.memberId ??
			suggestedReceiptPayer(data, bankId));
	const [member, setMember] = useState(initialMember);
	const [payerPickerOpen, setPayerPickerOpen] = useState(!initialMember);
	const payerButton = useRef<HTMLButtonElement>(null);
	const [optionsOpen, setOptionsOpen] = useState(false);
	const [proxyMembers, setProxyMembers] = useState<string[]>([]);
	const [proxyPickerOpen, setProxyPickerOpen] = useState(false);
	const proxyPickerId = useId();
	const proxyButton = useRef<HTMLButtonElement>(null);
	const [selectedPayments, setPayments] = useState<Record<string, string>>(
		() =>
			draft.type === "pay" && choosePayer && !ambiguousPayer
				? suggestedReceiptDue(data, bankId, initialMember)
				: {},
	);
	const [selectedCarryDebts, setCarryDebts] = useState<Record<string, string>>(
		{},
	);
	const selectedDebts =
		draft.type === "carry" ? selectedCarryDebts : selectedPayments;
	const setDebts = draft.type === "carry" ? setCarryDebts : setPayments;
	const [money, setMoney] = useState<Record<string, string>>({});
	// 이월 기본 월은 이 입금이 속한 달의 다음 달 — 지난달을 보정할 때 오늘 기준 다음 달로 튀지 않는다.
	const [ym, setYm] = useState(shiftYm(kstMonth(tx.occurred_at), 1));
	const [changeMonth, setChangeMonth] = useState(false);
	const [amount, setAmount] = useState(String(source?.amount ?? ""));
	// 현재 용도를 반영한다 — 항상 member_pending 이면 이월/직접수입 잔액에서도
	// '회원 잔액'이 눌린 것처럼 보여 현재 상태를 오표기했다. 미귀속만 제안값을 쓴다.
	const [purpose, setPurpose] = useState<FundPurpose>(
		source && source.purpose !== "unassigned"
			? source.purpose
			: "member_pending",
	);
	const savedGroup =
		data.expenses.find((e) => e.bank_tx_id === bankId)?.group_id ?? "";
	const [group, setGroup] = useState<string | null>(
		draft.type === "expense" ? savedGroup || null : null,
	);
	const unchangedExpense = draft.type === "expense" && group === savedGroup;
	const [memo, setMemo] = useState("");
	const [refund, setRefund] = useState<RefundSelection>({
		memberId: "",
		bankId: "",
		confirmedOwner: false,
		external: false,
	});
	const owner = choosePayer ? member : (source?.owner_id ?? member);
	const payerChanged =
		!!source?.owner_id && !!owner && owner !== source.owner_id;
	const payer = data.members.find((m) => m.id === owner);
	const dues: PaymentTarget[] =
		draft.type === "pay"
			? [
					...payableTargets(data, owner, kstMonth(tx.occurred_at)),
					...proxyMembers
						.filter((id) => id !== owner)
						.flatMap((id) => payableDues(data, id, kstMonth(tx.occurred_at))),
				]
			: payableDues(data, owner, kstMonth(tx.occurred_at));
	const alreadyPaid =
		draft.type === "pay"
			? previouslyPaidReceiptTargets(data, bankId, owner)
			: [];
	// A refreshed attendance/fee revision may remove a previously selected candidate.
	const debts = Object.fromEntries(
		Object.entries(selectedDebts).filter(([id]) =>
			dues.some((d) => d.id === id),
		),
	);
	const needsMonthChange = dues.some(
		(d) => Number(debts[d.id]) > 0 && ym <= d.due_ym,
	);
	const targetMember = (d: PaymentTarget) =>
		d.prepayment?.member_id ??
		data.charges.find((c) => c.id === d.charge_id)?.member_id;
	const targetName = (d: PaymentTarget) => {
		const id = targetMember(d);
		const label = d.prepayment?.label ?? groupName(d.charge_id);
		return draft.type === "pay" && proxyMembers.length && id
			? `${memberLabel(data, id)}${id !== owner ? " 대납" : ""} · ${label}`
			: label;
	};
	const memberMoney = data.positions.filter(
		(p) =>
			(p.owner_id === owner &&
				["member_pending", "carry"].includes(p.purpose)) ||
			(p.id === source?.id && p.purpose === "unassigned"),
	);
	const groupName = (id: string) =>
		data.groups.find(
			(g) => g.id === data.charges.find((c) => c.id === id)?.group_id,
		)?.label ?? "부과";
	const selectedTotal = Object.values(debts).reduce(
		(sum, n) => sum + Number(n || 0),
		0,
	);
	const title =
		draft.type === "pay"
			? "납부"
			: draft.type === "carry"
				? "이월"
				: draft.type === "refund"
					? "환불"
					: draft.type === "expense"
						? "지출"
						: draft.type === "simple"
							? actionLabel[draft.command!.action]
							: "용도 지정";
	const payerChangeSummary = payerChanged
		? `납부자 변경: ${memberLabel(data, source!.owner_id)} → ${memberLabel(data, owner)}`
		: "";
	const reason = [
		memo.trim() || `${origin} · ${tx.name || `거래 #${tx.id}`} · ${title} 확인`,
		payerChangeSummary,
	]
		.filter(Boolean)
		.join(" · ");
	const positive = (value: string) => {
		const n = Number(value);
		if (!Number.isSafeInteger(n) || n <= 0)
			throw new Error("금액은 1원 이상의 정수로 입력하세요");
		return n;
	};
	const entries = (values: Record<string, string>, key: string) =>
		Object.entries(values)
			.filter(([, n]) => n !== "" && Number(n) !== 0)
			.map(([id, n]) => ({ [key]: id, amount: positive(n) }));
	let command: AccountingCommand | null = null;
	let hint = "";
	let summary = "";
	try {
		if (draft.type === "pay") {
			if (!owner) throw new Error("납부자를 선택하세요");
			const selected = Object.entries(debts).filter(
				([, n]) => n !== "" && Number(n) !== 0,
			);
			if (!selected.length)
				throw new Error(
					dues.length
						? "납부할 항목을 선택하세요"
						: "본인 미납이 없습니다. 다른 회원 대납이나 잔액 용도를 선택하세요",
				);
			const lines = selected.map(([id, value]) => {
				const due = dues.find((d) => d.id === id);
				const amount = positive(value);
				if (!due || amount > due.remaining)
					throw new Error("선택 금액이 부과 잔액보다 큽니다");
				return {
					...(due.prepayment
						? {
								session_id: due.prepayment.session_id,
								expected_amount: due.remaining,
							}
						: { due_id: id }),
					amount,
					position_id: source?.id,
				};
			});
			if (!source || selectedTotal > source.amount)
				throw new Error("선택 금액이 입금 잔액보다 큽니다");
			command = {
				action: "pay",
				reason,
				owner_id: owner,
				confirm_owner: !source.owner_id || payerChanged,
				...(payerChanged ? { reassign_owner: true } : {}),
				...(dues.some(
					(d) => Number(debts[d.id]) > 0 && targetMember(d) !== owner,
				)
					? { proxy: true }
					: {}),
				lines,
			};
			const beneficiaries = [
				...new Set(
					dues.filter((d) => Number(debts[d.id]) > 0).map(targetMember),
				),
			]
				.filter((id): id is string => !!id)
				.map(
					(id) =>
						`${memberLabel(data, id)}${id !== owner ? " 대납" : " 납부"} ${won(dues.filter((d) => targetMember(d) === id).reduce((sum, d) => sum + Number(debts[d.id] || 0), 0))}`,
				);
			summary = `${beneficiaries.join(" · ")} · 입금 잔액 ${won(source.amount - selectedTotal)}`;
		} else if (draft.type === "carry") {
			if (!owner) throw new Error("이월할 납부자를 선택하세요");
			const ds = entries(debts, "due_id"),
				ms = entries(money, "position_id");
			if (!ds.length && !ms.length)
				throw new Error("이월할 미납 또는 입금을 선택하세요");
			if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym))
				throw new Error("이월할 월을 선택하세요");
			command = {
				action: "carry",
				reason,
				member_id: owner,
				target_ym: ym,
				debts: ds,
				money: ms,
				change_month: changeMonth,
				confirm_owner: !!source && !source.owner_id,
			};
			summary = `${ym}로 ${[
				ds.length ? `미납 ${won(selectedTotal)}` : "",
				ms.length ? `입금 ${won(ms.reduce((s, l) => s + l.amount, 0))}` : "",
			]
				.filter(Boolean)
				.join(" · ")} 이월`;
		} else if (draft.type === "position") {
			if (!source) throw new Error("입금 잔액을 다시 확인하세요");
			if (!owner && ["member_pending", "refund_pending"].includes(purpose))
				throw new Error("납부자를 선택하세요");
			if (purpose === "club" && !group)
				throw new Error("수입 항목을 선택하세요");
			if (
				purpose === source.purpose &&
				(owner || null) === (source.owner_id ?? null) &&
				(group || null) === (source.group_id ?? null) &&
				Number(amount) === source.amount
			)
				throw new Error("바꿀 내용이 없습니다. 용도나 금액을 바꿔 주세요.");
			command = {
				action: "position",
				reason,
				position_id: source.id,
				amount: positive(amount),
				purpose,
				owner_id: owner || null,
				group_id: group || null,
			};
			summary = `${purposeLabel[purpose]} ${won(Number(amount))} · ${purpose === "club" ? data.groups.find((g) => g.id === group)?.label : memberLabel(data, owner || null)}`;
		} else if (draft.type === "expense") {
			if (group === null) throw new Error("지출 항목을 선택하세요");
			if (unchangedExpense)
				throw new Error(
					savedGroup
						? "이미 이 항목으로 처리된 지출입니다. 변경할 항목을 선택하세요."
						: "이미 미분류 상태입니다. 지출 항목을 선택하세요.",
				);
			command = {
				action: "expense",
				reason,
				out_tx_id: bankId,
				group_id: group || null,
			};
			summary = `${data.groups.find((g) => g.id === group)?.label ?? "미분류"} · ${won(tx.amount)} 지출`;
		} else if (draft.type === "refund") {
			if (!refund.memberId && !refund.external)
				throw new Error("돌려받는 납부자를 선택하세요");
			const receipt = receiptHistory(data).find(
				(t) => String(t.id) === refund.bankId,
			);
			if (!receipt || receipt.owners.some((id) => id !== refund.memberId))
				throw new Error("환불할 원입금을 선택하세요");
			if (!receipt.owners.length && !refund.confirmedOwner)
				throw new Error("미매칭 원입금의 실제 납부자를 확인해 주세요");
			command = {
				action: "refund",
				reason,
				out_tx_id: bankId,
				owner_id: refund.memberId || null,
				confirm_owner: refund.confirmedOwner,
				external_refund: refund.external,
				lines: refundLines(data, Number(refund.bankId), tx.amount),
			};
			summary = `${refund.external ? "미등록 납부자" : memberLabel(data, refund.memberId)} · ${won(tx.amount)} 환불 / 입금 잔액 ${won(receipt.available - tx.amount)}`;
		} else if (draft.type === "simple") {
			command = { ...draft.command!, reason };
			summary = `${title} · ${won(Number(draft.command!.amount ?? tx.amount))}`;
			if (command.action === "reverse_payment") {
				const payment = data.allocations.find(
					(a) => a.id === command!.allocation_id && a.bank_tx_id === bankId,
				);
				const charge = data.charges.find((c) => c.id === payment?.charge_id);
				const amount = positive(String(command.amount));
				if (!payment || !charge || amount > payment.amount - payment.reversed)
					throw new Error(
						"해제할 납부 연결이 변경됐습니다. 내역을 다시 확인하세요",
					);
				summary = `${memberLabel(data, charge.member_id)} · ${groupName(charge.id)} · ${won(amount)} 연결 해제 → ${memberLabel(data, payment.owner_id)} 입금 잔액으로 복원`;
				command.reason = `${reason} · ${summary}`;
			}
		}
	} catch (e) {
		hint = (e as Error).message;
		command = null;
	}
	const flow = useInlineAccounting(
		command,
		data.mode.revision,
		data.mode.paused,
		onDone,
	);
	useEffect(() => {
		if (!flow.locked) return;
		onPendingChange(true);
		return () => onPendingChange(false);
	}, [flow.locked, onPendingChange]);
	const changeMember = (id: string) => {
		setMember(id);
		if (id) {
			setPayerPickerOpen(false);
			payerButton.current?.focus();
		}
		setPayments({});
		setProxyMembers([]);
		setProxyPickerOpen(false);
		setCarryDebts({});
		setMoney({});
	};
	const openReceiptEditor = (type: "carry" | "position" | "refund") => {
		setReceiptAction(type);
		setOptionsOpen(false);
	};
	const closeReceiptEditor = () => {
		if (receiptAction) {
			setReceiptAction(null);
			setOptionsOpen(false);
			optionsButton.current?.focus();
		} else {
			onClose(false);
		}
	};
	const memoField = <SettlementMemo value={memo} onChange={setMemo} />;
	const receiptMonth = kstMonth(tx.occurred_at);
	const monthlyProgress = billingProgress(
		data,
		data.groups.filter(
			(g) => g.kind === "monthly" && g.occurred_on.startsWith(receiptMonth),
		),
		receiptMonth,
	);
	const feeStatus = (id: string) => {
		if (!tx.name?.includes("회비")) {
			const unpaid = payableDues(data, id, receiptMonth);
			const prepayments = (data.prepayments ?? []).filter(
				(p) => p.member_id === id,
			);
			return [
				unpaid.length
					? `미납 ${unpaid.length}건 · ${won(unpaid.reduce((sum, d) => sum + d.remaining, 0))}`
					: "남은 미납 없음",
				prepayments.length ? `대관 선납 ${prepayments.length}건` : "",
			]
				.filter(Boolean)
				.join(" · ");
		}
		const rows = monthlyProgress.rows.filter((r) => r.charge.member_id === id);
		const remaining = rows.reduce((sum, r) => sum + r.remaining, 0);
		return `${Number(receiptMonth.slice(5))}월 회비 ${!rows.length ? "부과 없음" : remaining ? `${won(remaining)} 미납` : "완납"}`;
	};
	const groupPicker = (
		<SettlementGroupPicker
			data={data}
			month={kstMonth(tx.occurred_at)}
			value={group}
			onChange={setGroup}
			searchable={optionsOpen || receiptEditor}
			allowUnclassified={draft.type === "expense" && !!savedGroup}
		/>
	);
	const duePicker = (
		<SettlementTargetPicker
			targets={dues}
			selected={debts}
			onChange={setDebts}
			mode={draft.type === "carry" ? "carry" : "pay"}
			available={source?.amount ?? 0}
			detailed={optionsOpen}
			targetName={targetName}
		/>
	);

	return (
		<div
			className="ac-quick ac-receipt-form"
			role="region"
			aria-label={`${title} 정산`}
		>
			<fieldset
				disabled={disabled || flow.locked || flow.busy || data.mode.paused}
				className="ac-quick-fields"
			>
				<SettlementHeader
					transaction={tx}
					name={
						tx.direction === "out" || draft.type === "simple"
							? tx.name || (tx.direction === "out" ? "출금" : "입금")
							: payer?.name || "회원 미지정"
					}
					balance={source?.amount}
					hint={
						draft.type === "simple"
							? title
							: tx.direction === "out"
								? draft.type === "refund"
									? "환불할 원입금을 연결하세요"
									: "지출할 항목을 선택하세요"
								: !owner
									? ambiguousPayer
										? "동명이인이 있습니다. 실제 입금자를 선택해 주세요."
										: `입금자명 ${tx.name || "없음"} · 회원을 선택하세요`
									: `${memberLabel(data, owner) !== payer?.name ? `${memberLabel(data, owner)} · ` : ""}입금자명 ${tx.name || "없음"}${payerChanged ? " · 납부자 변경 예정" : ""}`
					}
					options={
						<button
							type="button"
							className="ac-link ac-receipt-options-toggle"
							aria-label="정산 옵션"
							ref={optionsButton}
							aria-expanded={optionsOpen}
							aria-controls={optionsOpen ? optionsId : undefined}
							onClick={() => setOptionsOpen(!optionsOpen)}
						>
							<Ellipsis size={18} aria-hidden="true" />
						</button>
					}
					payerAction={
						["pay", "carry", "position"].includes(draft.type) &&
						(choosePayer || !source?.owner_id) && (
							<button
								type="button"
								className="ac-receipt-change"
								ref={payerButton}
								aria-label={owner ? "납부자 변경" : "납부자 선택"}
								aria-expanded={payerPickerOpen}
								aria-controls={payerPickerOpen ? payerPickerId : undefined}
								onClick={() => setPayerPickerOpen(!payerPickerOpen)}
							>
								{owner ? "변경" : "회원 선택"}
							</button>
						)
					}
				/>
				{optionsOpen && (
					<SettlementOptions
						id={optionsId}
						data={data}
						bankId={bankId}
						draft={draft}
						savedExpense={!!savedGroup}
						history={history}
						onAction={(next) => {
							if (next.type === "refund") openReceiptEditor("refund");
							else if (
								next.positionId === source?.id &&
								(next.type === "carry" || next.type === "position")
							)
								openReceiptEditor(next.type);
							else onAction?.(next);
						}}
					/>
				)}
				{payerPickerOpen &&
					!["refund", "expense", "simple"].includes(draft.type) &&
					(!source?.owner_id || choosePayer) && (
						<div
							id={payerPickerId}
							className="ac-receipt-picker ac-settlement-member-search"
						>
							<MemberPicker
								compact
								receipt
								data={data}
								value={member}
								onChange={changeMember}
								suggestedName={tx.name ?? ""}
								descriptionForMember={
									draft.type === "pay" ? feeStatus : undefined
								}
							/>
						</div>
					)}
				{draft.type === "pay" && owner && (
					<PaymentSettlementFields
						available={source?.amount ?? 0}
						selected={debts}
					>
						{alreadyPaid.map(({ charge, group, payments }) => (
							<div
								key={charge.id}
								className="ac-quick-options"
								role="note"
								aria-label="기존 납부 내역"
							>
								<strong>{group.label} · 이미 완납</strong>
								{payments.map(({ receipt, amount }, index) => (
									<p key={`${receipt.id}:${index}`} className="ac-caption">
										{new Date(receipt.occurred_at).toLocaleDateString("ko-KR", {
											timeZone: "Asia/Seoul",
											month: "numeric",
											day: "numeric",
										})}{" "}
										입금 · {receipt.name || "입금"} · {won(amount)} 납부
									</p>
								))}
								<p className="ac-caption">
									이번 입금 {won(source?.amount ?? 0)}은 별도 잔액으로 남아
									있습니다.
								</p>
							</div>
						))}
						{duePicker}
						<div
							className="ac-choice-chips"
							role="group"
							aria-label="대납 대상"
						>
							{proxyMembers
								.filter((id) => id !== owner)
								.map((id) => (
									<button
										key={id}
										type="button"
										className="ac-chip"
										aria-label={`${memberLabel(data, id)} 대납 취소`}
										onClick={() => {
											setProxyMembers((before) =>
												before.filter((m) => m !== id),
											);
											const ids = new Set(
												payableDues(data, id, receiptMonth).map((d) => d.id),
											);
											setPayments((before) =>
												Object.fromEntries(
													Object.entries(before).filter(
														([key]) => !ids.has(key),
													),
												),
											);
										}}
									>
										{memberLabel(data, id)} 대납 · 취소
									</button>
								))}
							<button
								type="button"
								className="ac-chip"
								ref={proxyButton}
								aria-expanded={proxyPickerOpen}
								aria-controls={proxyPickerOpen ? proxyPickerId : undefined}
								onClick={() => setProxyPickerOpen(!proxyPickerOpen)}
							>
								다른 회원 대납
							</button>
						</div>
						{proxyPickerOpen && (
							<div
								id={proxyPickerId}
								className="ac-receipt-picker ac-settlement-member-search"
							>
								<p className="ac-caption">
									이 입금으로 대신 납부할 회원의 미납을 선택하세요. 입금자는{" "}
									{memberLabel(data, owner)}으로 유지됩니다.
								</p>
								<MemberPicker
									compact
									receipt
									label="대납할 회원"
									value=""
									data={{
										...data,
										members: data.members.filter(
											(m) => m.id !== owner && !proxyMembers.includes(m.id),
										),
									}}
									descriptionForMember={(id) => {
										const remaining = payableDues(
											data,
											id,
											receiptMonth,
										).reduce((sum, d) => sum + d.remaining, 0);
										return remaining
											? `미납 ${won(remaining)}`
											: "대납할 미납 없음";
									}}
									onChange={(id) => {
										setProxyMembers((before) => [...before, id]);
										setProxyPickerOpen(false);
										proxyButton.current?.focus();
									}}
								/>
							</div>
						)}
						{proxyMembers
							.filter(
								(id) =>
									id !== owner && !payableDues(data, id, receiptMonth).length,
							)
							.map((id) => (
								<p key={id} className="ac-caption">
									{memberLabel(data, id)}에게 대납할 미납이 없습니다.
								</p>
							))}
					</PaymentSettlementFields>
				)}
				{receiptEditor && (
					<SettlementEditor
						title={draft.type === "refund" ? "환불 연결" : title}
						onClose={closeReceiptEditor}
					>
						{draft.type === "carry" && (
							<CarrySettlementFields
								month={ym}
								onMonth={setYm}
								owner={owner}
								dues={dues.length ? duePicker : null}
								positions={memberMoney}
								bankId={bankId}
								money={money}
								onMoney={setMoney}
								needsMonthChange={needsMonthChange}
								changeMonth={changeMonth}
								onChangeMonth={setChangeMonth}
							/>
						)}
						{draft.type === "position" && (
							<PositionSettlementFields
								purpose={purpose}
								onPurpose={setPurpose}
								amount={amount}
								onAmount={setAmount}
								max={source?.amount}
								groups={groupPicker}
							/>
						)}
						{draft.type === "refund" && (
							<RefundPicker
								data={data}
								outTxId={bankId}
								value={refund}
								onChange={setRefund}
								receipt
							/>
						)}
						{memoField}
					</SettlementEditor>
				)}
				{draft.type === "expense" && groupPicker}
				{optionsOpen && !receiptEditor && (
					<div className="ac-quick-options">{memoField}</div>
				)}
			</fieldset>
			{/* 확정 블록 — 검증 문구가 버튼 바로 위에 붙는다. '왜 못 누르는지'와 '누르면
			    무엇이 일어나는지'를 손가락 위치에서 읽는다. hint 에 role="alert" 를 주지
			    않는다(화면의 alert 는 서버 오류 하나로 유지한다). */}
			{(draft.type !== "pay" || owner || flow.locked) && (
				<SettlementConfirmation
					flow={flow}
					paused={data.mode.paused}
					disabled={disabled}
					hint={hint}
					summary={summary}
					title={title}
					operation={draft.type}
					showSummary={
						receiptEditor || (draft.type === "pay" && proxyMembers.length > 0)
					}
					unchangedExpense={unchangedExpense}
					savedExpense={!!savedGroup}
					onClose={onClose}
				/>
			)}
		</div>
	);
}
