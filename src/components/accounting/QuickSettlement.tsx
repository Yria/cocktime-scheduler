import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Ellipsis, Search } from "lucide-react";
import {
	canChooseReceiptPayer,
	suggestedReceiptPayer,
	suggestedReceiptDue,
	payableDues,
	quickGroups,
	refundLines,
} from "../../lib/dues/v2/quickSettlement";
import { billingProgress } from "../../lib/dues/v2/overview";
import { receiptHistory } from "../../lib/dues/v2/selection";
import { kstMonth, memberLabel } from "../../lib/dues/v2/summary";
import {
	actionLabel,
	purposeLabel,
	type AccountingCommand,
	type AccountingData,
} from "../../lib/dues/v2/types";
import { shiftYm, signed, won } from "../admin/dues/duesText";
import MemberPicker from "./MemberPicker";
import type { OperationDraft } from "./OperationDialog";
import RefundPicker, { type RefundSelection } from "./RefundPicker";
import { useInlineAccounting } from "./useInlineAccounting";
import { amountInputProps } from "../../lib/dues/v2/amountInput";

export default function QuickSettlement({
	data,
	draft,
	bankId,
	onDone,
	onClose,
	disabled,
	onPendingChange,
	origin = "정산함",
	receipt = false,
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
	/** Shared receipt presentation for settlement inbox and ledger detail. */
	receipt?: boolean;
	/** Previously saved allocations/refunds, with their existing reversal actions. */
	history?: ReactNode;
	onAction?: (draft: OperationDraft) => void;
}) {
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
	const [debts, setDebts] = useState<Record<string, string>>(() =>
		draft.type === "pay" && choosePayer && !ambiguousPayer
			? suggestedReceiptDue(data, bankId, initialMember)
			: {},
	);
	const [money, setMoney] = useState<Record<string, string>>({});
	// 이월 기본 월은 이 입금이 속한 달의 다음 달 — 지난달을 보정할 때 오늘 기준 다음 달로 튀지 않는다.
	const [ym, setYm] = useState(shiftYm(kstMonth(tx.occurred_at), 1));
	const [changeMonth, setChangeMonth] = useState(false);
	const [amount, setAmount] = useState(String(source?.amount ?? ""));
	// 현재 용도를 반영한다 — 항상 member_pending 이면 이월/직접수입 잔액에서도
	// '회원 잔액'이 눌린 것처럼 보여 현재 상태를 오표기했다. 미귀속만 제안값을 쓴다.
	const [purpose, setPurpose] = useState<string>(
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
	const [groupQuery, setGroupQuery] = useState("");
	const [groupLimit, setGroupLimit] = useState(6);
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
	const dues = payableDues(data, owner, kstMonth(tx.occurred_at));
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
	const groups = quickGroups(data, kstMonth(tx.occurred_at), groupQuery);
	const visibleGroups = groups.slice(0, groupLimit);
	const selectedGroup = data.groups.find((g) => g.id === group);
	if (selectedGroup && !visibleGroups.some((g) => g.id === selectedGroup.id))
		visibleGroups.unshift(selectedGroup);
	const selectedTotal = Object.values(debts).reduce(
		(sum, n) => sum + Number(n || 0),
		0,
	);
	// 아직 어느 미납에도 얹지 않은 입금 잔액. '전부 사용' 버튼과 잔액 표기가 함께 쓴다.
	const restAfterSelected = Math.max(0, (source?.amount ?? 0) - selectedTotal);
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
			const lines = Object.entries(debts)
				.filter(([, n]) => n !== "" && Number(n) !== 0)
				.map(([id, value]) => ({
					due_id: id,
					amount: positive(value),
					position_id: source?.id,
				}));
			if (!lines.length)
				throw new Error(
					dues.length
						? "납부할 항목을 선택하세요"
						: "이 회원에게 남은 미납이 없습니다",
				);
			for (const line of lines) {
				const due = dues.find((d) => d.id === line.due_id);
				if (!due || line.amount > due.remaining)
					throw new Error("선택 금액이 부과 잔액보다 큽니다");
			}
			if (!source || selectedTotal > source.amount)
				throw new Error("선택 금액이 입금 잔액보다 큽니다");
			command = {
				action: "pay",
				reason,
				owner_id: owner,
				confirm_owner: !source.owner_id || payerChanged,
				...(payerChanged ? { reassign_owner: true } : {}),
				lines,
			};
			summary = `${memberLabel(data, owner)} · 입금 잔액 ${won(source.amount - selectedTotal)}`;
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
			summary = `${ym}로 미납 ${won(selectedTotal)} · 입금 ${won(ms.reduce((s, l) => s + l.amount, 0))} 이월`;
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
			summary = `${won(Number(amount))} · ${purpose === "club" ? data.groups.find((g) => g.id === group)?.label : memberLabel(data, owner || null)}`;
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
		if (receipt && id) {
			setPayerPickerOpen(false);
			payerButton.current?.focus();
		}
		setDebts({});
		setMoney({});
	};
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
			return unpaid.length
				? `미납 ${unpaid.length}건 · ${won(unpaid.reduce((sum, d) => sum + d.remaining, 0))}`
				: "남은 미납 없음";
		}
		const rows = monthlyProgress.rows.filter((r) => r.charge.member_id === id);
		const remaining = rows.reduce((sum, r) => sum + r.remaining, 0);
		return `${Number(receiptMonth.slice(5))}월 회비 ${!rows.length ? "부과 없음" : remaining ? `${won(remaining)} 미납` : "완납"}`;
	};
	const groupPicker = (
		<div className="ac-quick-groups">
			{(!receipt || optionsOpen) && (
				<div className="ac-search">
					<Search size={15} aria-hidden="true" />
					<input
						aria-label="회계 항목 검색"
						name="group-search"
						autoComplete="off"
						placeholder="항목·장소 검색…"
						value={groupQuery}
						onChange={(e) => {
							setGroupQuery(e.target.value);
							setGroupLimit(6);
						}}
					/>
				</div>
			)}
			<div className="ac-choice-chips" role="group" aria-label="회계 항목 선택">
				{visibleGroups.map((g) => (
					<button
						type="button"
						key={g.id}
						className="ac-chip"
						aria-pressed={group === g.id}
						onClick={() => setGroup(g.id)}
					>
						{g.label}
						{group === g.id && <Check size={14} aria-hidden="true" />}
					</button>
				))}
				{draft.type === "expense" && savedGroup && (
					<button
						type="button"
						className="ac-chip"
						aria-pressed={group === ""}
						onClick={() => setGroup("")}
					>
						미분류로 변경
					</button>
				)}
			</div>
			{groups.length > groupLimit && (
				<button
					type="button"
					className="ac-link"
					onClick={() => setGroupLimit(groupLimit + 12)}
				>
					항목 더 보기 ({groups.length - groupLimit})
				</button>
			)}
		</div>
	);
	const duePicker = (
		<div
			className={`ac-quick-dues${receipt && !optionsOpen ? " ac-receipt-dues" : ""}`}
			role="group"
			aria-label={
				draft.type === "carry" ? "이월할 미납 선택" : "납부할 항목 선택"
			}
		>
			{dues.map((d) => (
				<div
					key={d.id}
					className={`ac-quick-due ${debts[d.id] ? "is-selected" : ""}`}
				>
					<button
						type="button"
						className="ac-chip"
						aria-pressed={!!debts[d.id]}
						aria-label={
							receipt
								? `${groupName(d.charge_id)} · ${d.due_ym} 납기 · ${won(debts[d.id] ? Number(debts[d.id]) : d.remaining)}`
								: undefined
						}
						disabled={
							draft.type === "pay" &&
							!debts[d.id] &&
							selectedTotal >= (source?.amount ?? 0)
						}
						onClick={() =>
							setDebts((before) => ({
								...before,
								[d.id]: before[d.id]
									? ""
									: String(
											draft.type === "pay"
												? Math.min(
														d.remaining,
														Math.max(0, (source?.amount ?? 0) - selectedTotal),
													)
												: d.remaining,
										),
							}))
						}
					>
						<span>
							{groupName(d.charge_id)}
							{(!receipt || optionsOpen) && (
								<small>
									{Number(d.due_ym.slice(5))}월 납기 · {won(d.remaining)} 남음
								</small>
							)}
						</span>
						{receipt && !optionsOpen ? (
							<span className="ac-number">
								{won(debts[d.id] ? Number(debts[d.id]) : d.remaining)}
							</span>
						) : (
							!!debts[d.id] && <Check size={14} aria-hidden="true" />
						)}
					</button>
					{(!receipt || optionsOpen) &&
						draft.type === "pay" &&
						!debts[d.id] &&
						selectedTotal >= (source?.amount ?? 0) && (
							<span className="ac-quick-amount">입금 잔액 없음</span>
						)}
					{(!receipt || optionsOpen) &&
						debts[d.id] !== undefined &&
						debts[d.id] !== "" && (
							<label className="ac-quick-amount">
								<input
									type="number"
									aria-label={`${groupName(d.charge_id)} 선택 금액`}
									min="1"
									max={d.remaining}
									value={debts[d.id]}
									{...amountInputProps}
									onChange={(e) =>
										setDebts({ ...debts, [d.id]: e.target.value })
									}
								/>
								원
							</label>
						)}
					{/* 칩 자동값은 min(잔액, 남은 미납)이라 부분납에서 대개 재입력이 필요했다.
					    남은 입금 잔액을 한 번에 얹는 버튼으로 재입력 4~6키를 없앤다. */}
					{(!receipt || optionsOpen) &&
						draft.type === "pay" &&
						!!debts[d.id] &&
						Number(debts[d.id]) < d.remaining &&
						restAfterSelected > 0 && (
							<button
								type="button"
								className="ac-chip"
								aria-label={`남은 잔액 ${won(restAfterSelected)} 전부 사용`}
								onClick={() =>
									setDebts((before) => ({
										...before,
										[d.id]: String(
											Math.min(
												d.remaining,
												Number(before[d.id] || 0) + restAfterSelected,
											),
										),
									}))
								}
							>
								+{won(restAfterSelected)}
							</button>
						)}
				</div>
			))}
		</div>
	);
	return (
		<div
			className={`ac-quick${receipt ? " ac-receipt-form" : ""}`}
			role="region"
			aria-label={`${title} 정산`}
		>
			<fieldset
				disabled={disabled || flow.locked || flow.busy || data.mode.paused}
				className="ac-quick-fields"
			>
				{receipt && (
					<header className="ac-receipt-heading">
						<div className="ac-receipt-meta">
							<time dateTime={tx.occurred_at}>
								{new Date(tx.occurred_at).toLocaleString("ko-KR", {
									timeZone: "Asia/Seoul",
									month: "numeric",
									day: "numeric",
									hour: "2-digit",
									minute: "2-digit",
									hour12: false,
								})}
							</time>
							<button
								type="button"
								className="ac-link ac-receipt-options-toggle"
								aria-label="정산 옵션"
								aria-expanded={optionsOpen}
								onClick={() => setOptionsOpen(!optionsOpen)}
							>
								<Ellipsis size={18} aria-hidden="true" />
							</button>
						</div>
						<div className="ac-receipt-identity">
							<div className="ac-receipt-payer">
								<strong
									className={!payer && draft.type === "pay" ? "ac-out" : ""}
								>
									{draft.type === "expense"
										? tx.name || "출금"
										: payer?.name || "회원 미지정"}
								</strong>
								{draft.type === "pay" && (choosePayer || !source?.owner_id) && (
									<button
										type="button"
										className="ac-receipt-change"
										ref={payerButton}
										aria-label={owner ? "납부자 변경" : "납부자 선택"}
										aria-expanded={payerPickerOpen}
										onClick={() => setPayerPickerOpen(!payerPickerOpen)}
									>
										{owner ? "변경" : "회원 선택"}
									</button>
								)}
							</div>
							<strong
								className={`ac-number ac-receipt-amount ${tx.direction === "in" ? "ac-in" : "ac-out"}`}
							>
								{tx.direction === "in" ? won(tx.amount) : signed(-tx.amount)}
							</strong>
						</div>
						<p className="ac-receipt-hint">
							{draft.type === "expense"
								? "지출할 항목을 선택하세요"
								: !owner
									? ambiguousPayer
										? "동명이인이 있습니다. 실제 입금자를 선택해 주세요."
										: `입금자명 ${tx.name || "없음"} · 회원을 선택하세요`
									: `${memberLabel(data, owner) !== payer?.name ? `${memberLabel(data, owner)} · ` : ""}입금자명 ${tx.name || "없음"}${payerChanged ? " · 납부자 변경 예정" : ""}`}
						</p>
						{source && source.amount !== tx.amount && (
							<p className="ac-caption">정산할 잔액 {won(source.amount)}</p>
						)}
					</header>
				)}
				{(!receipt || payerPickerOpen) &&
					!["refund", "expense", "simple"].includes(draft.type) &&
					(source?.owner_id && !choosePayer ? (
						<p className="ac-quick-owner">
							납부자 <strong>{memberLabel(data, source.owner_id)}</strong>
						</p>
					) : (
						<div className={receipt ? "ac-receipt-picker" : undefined}>
							{!receipt && ambiguousPayer && !member && (
								<p className="ac-caption">
									동명이인이 있습니다. 실제 입금자를 선택해 주세요.
								</p>
							)}
							<MemberPicker
								compact
								receipt={receipt}
								data={data}
								value={member}
								onChange={changeMember}
								suggestedName={tx.name ?? ""}
								descriptionForMember={
									draft.type === "pay" ? feeStatus : undefined
								}
							/>
							{!receipt && payerChanged && (
								<p className="ac-caption">{payerChangeSummary}</p>
							)}
						</div>
					))}
				{draft.type === "pay" && owner && (
					<div className="ac-payment-targets">
						<div className="ac-allocation-summary" aria-label="입금 배분 요약">
							<div className="ac-allocation-meter" aria-hidden="true">
								{Object.entries(debts)
									.filter(([, n]) => Number(n) > 0)
									.map(([id, n]) => (
										<span
											key={id}
											style={{
												width: `${Math.min(100, (Number(n) / (source?.amount || 1)) * 100)}%`,
											}}
										/>
									))}
							</div>
							<p>
								<span>
									{selectedTotal > (source?.amount ?? 0)
										? "! 입금 잔액 초과"
										: restAfterSelected > 0
											? `입금 잔액 ${won(restAfterSelected)}${selectedTotal ? " 보관" : ""}`
											: "✓ 남는 돈 없음"}
								</span>
								<strong className="ac-number">
									{won(selectedTotal)}
									{!receipt && " 선택"}
								</strong>
							</p>
						</div>
						{!receipt && <span className="ac-label">납부할 항목</span>}
						{duePicker}
					</div>
				)}
				{draft.type === "carry" && (
					<>
						<label className="ac-quick-month">
							이월할 월
							<input
								type="month"
								value={ym}
								onChange={(e) => setYm(e.target.value)}
							/>
						</label>
						{owner && (
							<>
								<h4>아직 안 낸 돈</h4>
								{duePicker}
								<h4>이미 낸 돈</h4>
								{memberMoney.map((p) => (
									<div key={p.id} className="ac-quick-due">
										<button
											type="button"
											className="ac-chip"
											aria-pressed={!!money[p.id]}
											onClick={() =>
												setMoney({
													...money,
													[p.id]: money[p.id] ? "" : String(p.amount),
												})
											}
										>
											{p.bank_tx_id === bankId
												? "이 입금"
												: `입금 #${p.bank_tx_id}`}{" "}
											· {won(p.amount)}
										</button>
										{money[p.id] && (
											<label className="ac-quick-amount">
												<input
													aria-label={`입금 ${p.bank_tx_id} 이월 금액`}
													type="number"
													min="1"
													max={p.amount}
													value={money[p.id]}
													onChange={(e) =>
														setMoney({ ...money, [p.id]: e.target.value })
													}
												/>
												원
											</label>
										)}
									</div>
								))}
								{!memberMoney.length && (
									<p className="ac-caption">이월할 입금 잔액이 없습니다.</p>
								)}
							</>
						)}
						<div className="ac-quick-options">
							{receipt && history}
							<label className="ac-check">
								<input
									type="checkbox"
									checked={changeMonth}
									onChange={(e) => setChangeMonth(e.target.checked)}
								/>
								기존 납기를 앞당기거나 이월 월을 변경함
							</label>
						</div>
					</>
				)}
				{draft.type === "position" && (
					<>
						<div
							className="ac-choice-chips"
							role="group"
							aria-label="입금 용도 선택"
						>
							{[
								["member_pending", "회원 잔액"],
								["refund_pending", "환불 대기"],
								["club", "직접 수입"],
								["unassigned", "미귀속"],
							].map(([id, label]) => (
								<button
									key={id}
									type="button"
									className="ac-chip"
									aria-pressed={purpose === id}
									onClick={() => setPurpose(id)}
								>
									{label}
								</button>
							))}
						</div>
						{purpose === "club" && groupPicker}
						<label className="ac-quick-amount">
							변경할 금액
							<input
								type="number"
								value={amount}
								min="1"
								max={source?.amount}
								onChange={(e) => setAmount(e.target.value)}
							/>
							원
						</label>
					</>
				)}
				{draft.type === "expense" && groupPicker}
				{draft.type === "refund" && (
					<RefundPicker
						data={data}
						outTxId={bankId}
						value={refund}
						onChange={setRefund}
						compact
					/>
				)}
				{(!receipt || optionsOpen) && (
					<div className="ac-quick-options">
						{receipt && history}
						{receipt && (
							<div
								className="ac-choice-chips"
								role="group"
								aria-label="다른 정산 방법"
							>
								{source && (
									<>
										<button
											type="button"
											className="ac-chip"
											onClick={() =>
												onAction?.({
													type: "carry",
													positionId: source.id,
													memberId: owner || undefined,
												})
											}
										>
											이월
										</button>
										<button
											type="button"
											className="ac-chip"
											onClick={() =>
												onAction?.({ type: "position", positionId: source.id })
											}
										>
											용도 지정
										</button>
									</>
								)}
								{draft.type === "expense" && !savedGroup && (
									<button
										type="button"
										className="ac-chip"
										onClick={() =>
											onAction?.({ type: "refund", outTxId: bankId })
										}
									>
										환불 연결
									</button>
								)}
							</div>
						)}
						{receipt &&
							source &&
							data.positions.some(
								(p) =>
									p.bank_tx_id === bankId && p.id !== source.id && p.amount > 0,
							) && (
								<div
									className="ac-choice-chips"
									role="group"
									aria-label="이 입금의 다른 잔액"
								>
									{data.positions
										.filter(
											(p) =>
												p.bank_tx_id === bankId &&
												p.id !== source.id &&
												p.amount > 0,
										)
										.map((p) => (
											<button
												key={p.id}
												type="button"
												className="ac-chip"
												onClick={() =>
													onAction?.({
														type: [
															"unassigned",
															"member_pending",
															"carry",
														].includes(p.purpose)
															? "pay"
															: "position",
														positionId: p.id,
													})
												}
											>
												{purposeLabel[p.purpose]} ·{" "}
												{p.owner_id
													? `${memberLabel(data, p.owner_id)} · `
													: ""}
												{won(p.amount)}
											</button>
										))}
								</div>
							)}
						<label className="ac-inline-memo">
							<span>메모</span>
							<input
								className="ac-input"
								aria-label="처리 사유"
								name="settlement-memo"
								autoComplete="off"
								value={memo}
								onChange={(e) => setMemo(e.target.value)}
								placeholder="필요한 경우 입력…"
							/>
						</label>
					</div>
				)}
			</fieldset>
			{/* 확정 블록 — 검증 문구가 버튼 바로 위에 붙는다. '왜 못 누르는지'와 '누르면
			    무엇이 일어나는지'를 손가락 위치에서 읽는다. hint 에 role="alert" 를 주지
			    않는다(화면의 alert 는 서버 오류 하나로 유지한다). */}
			{(!receipt || draft.type !== "pay" || owner || flow.locked) && (
				<div className="ac-quick-confirm">
					{hint ? (
						<p className="ac-blockers" aria-live="assertive">
							<span aria-hidden="true">!</span>
							<span>
								{hint}
								{flow.preparing && " · 확인 중…"}
							</span>
						</p>
					) : !receipt ? (
						<p className="ac-quick-summary" aria-live="polite">
							<span aria-hidden="true">✓</span>
							<span>
								{summary}
								{flow.preparing && " · 확인 중…"}
							</span>
						</p>
					) : null}
					{flow.result && draft.type === "carry" && (
						<p className="ac-caption">
							이월 후 바로 납부에 사용 {won(flow.result.auto_applied)}
						</p>
					)}
					{/* 잠긴 이유를 확정 블록 안에 적는다 — 스크롤로 카드가 화면 밖이면
				    화면이 이유 없이 굳은 것처럼 보였다. */}
					{data.mode.paused && (
						<p className="ac-caption">
							회계 처리가 일시 중지되어 확정할 수 없습니다.
						</p>
					)}
					{flow.error && !flow.locked && (
						<button
							type="button"
							className="ac-link"
							onClick={() => void flow.refreshPreview()}
						>
							내역 새로고침
						</button>
					)}
					{flow.error && (
						<p className="ac-quick-error" role="alert">
							{flow.error}
						</p>
					)}
					<div className="ac-quick-confirm-buttons">
						{(!unchangedExpense || flow.locked) && (
							<button
								type="button"
								className="ac-inline-confirm"
								aria-label={
									flow.busy
										? "처리 중…"
										: flow.locked
											? "결과 다시 확인"
											: draft.type === "expense" && savedGroup
												? "변경 저장"
												: `${title} 확인`
								}
								disabled={
									(!flow.locked && disabled) ||
									!flow.ready ||
									flow.busy ||
									data.mode.paused
								}
								onClick={() =>
									void flow.confirm().then((done) => {
										if (done) onClose(true, summary || `${title} 확인`);
									})
								}
							>
								{flow.busy
									? "처리 중…"
									: flow.locked
										? "결과 다시 확인"
										: draft.type === "expense" && savedGroup
											? "변경 저장"
											: receipt
												? "확인"
												: `${title} 확인`}
								{!receipt &&
									draft.type === "pay" &&
									selectedTotal > 0 &&
									!flow.busy &&
									!flow.locked &&
									` · ${won(selectedTotal)}`}
							</button>
						)}
						{/* 잘못 연 편집기를 접는 경로. 전에는 성공 외에 닫는 방법이 없어
					    새로고침이 유일한 탈출구였다. */}
						{!receipt && !flow.locked && !flow.busy && (
							<button
								type="button"
								className="ac-inline-cancel"
								onClick={() => onClose(false)}
							>
								취소
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
