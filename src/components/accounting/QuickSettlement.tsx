import { useEffect, useState } from "react";
import {
	payableDues,
	quickGroups,
	refundLines,
} from "../../lib/dues/v2/quickSettlement";
import { receiptHistory } from "../../lib/dues/v2/selection";
import { kstMonth, memberLabel } from "../../lib/dues/v2/summary";
import {
	actionLabel,
	type AccountingCommand,
	type AccountingData,
} from "../../lib/dues/v2/types";
import { currentYm, shiftYm, won } from "../admin/dues/duesText";
import MemberPicker from "./MemberPicker";
import type { OperationDraft } from "./OperationDialog";
import RefundPicker, { type RefundSelection } from "./RefundPicker";
import { useInlineAccounting } from "./useInlineAccounting";

export default function QuickSettlement({
	data,
	draft,
	bankId,
	onDone,
	onClose,
	disabled,
	onPendingChange,
}: {
	data: AccountingData;
	draft: OperationDraft;
	bankId: number;
	onDone: () => Promise<void>;
	onClose: (saved?: boolean) => void;
	disabled: boolean;
	onPendingChange: (pending: boolean) => void;
}) {
	const tx = data.bank.find((t) => t.id === bankId)!;
	const source = data.positions.find((p) => p.id === draft.positionId);
	const initialMember = source?.owner_id ?? draft.memberId ?? "";
	const [member, setMember] = useState(initialMember);
	const [beneficiary, setBeneficiary] = useState("");
	const [proxy, setProxy] = useState(false);
	const [debts, setDebts] = useState<Record<string, string>>({});
	const [money, setMoney] = useState<Record<string, string>>({});
	const [ym, setYm] = useState(shiftYm(currentYm(), 1));
	const [changeMonth, setChangeMonth] = useState(false);
	const [amount, setAmount] = useState(String(source?.amount ?? ""));
	const [purpose, setPurpose] = useState("member_pending");
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
	const owner = source?.owner_id ?? member;
	const recipient = beneficiary || owner;
	const dues = payableDues(
		data,
		draft.type === "pay" ? recipient : owner,
		kstMonth(tx.occurred_at),
	);
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
	const reason =
		memo.trim() || `정산함 · ${tx.name || `거래 #${tx.id}`} · ${title} 확인`;
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
			const lines = entries(debts, "due_id").map((l) => ({
				...l,
				position_id: source?.id,
			}));
			if (!lines.length)
				throw new Error(
					dues.length
						? "납부할 항목을 선택하세요"
						: "이 회원에게 남은 미납이 없습니다",
				);
			if (!source || selectedTotal > source.amount)
				throw new Error("선택 금액이 입금 잔액보다 큽니다");
			if (owner !== recipient && !proxy)
				throw new Error("대납 여부를 확인하세요");
			command = {
				action: "pay",
				reason,
				owner_id: owner,
				confirm_owner: !source.owner_id,
				lines,
				proxy,
			};
			summary = `${memberLabel(data, owner)}${owner !== recipient ? ` → ${memberLabel(data, recipient)}` : ""} · ${won(selectedTotal)} 납부 / 입금 잔액 ${won(source.amount - selectedTotal)}`;
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
		setDebts({});
		setMoney({});
		setBeneficiary("");
		setProxy(false);
	};
	const groupPicker = (
		<div className="ac-quick-groups">
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
			<details className="ac-quick-more">
				<summary>다른 항목 찾기</summary>
				<input
					className="ac-input"
					aria-label="회계 항목 검색"
					placeholder="항목·장소 검색"
					value={groupQuery}
					onChange={(e) => {
						setGroupQuery(e.target.value);
						setGroupLimit(6);
					}}
				/>
				{groups.length > groupLimit && (
					<button
						type="button"
						className="ac-link"
						onClick={() => setGroupLimit(groupLimit + 12)}
					>
						항목 더 보기 ({groups.length - groupLimit})
					</button>
				)}
			</details>
		</div>
	);
	const duePicker = (
		<div
			className="ac-quick-dues"
			role="group"
			aria-label={
				draft.type === "carry" ? "이월할 미납 선택" : "납부할 항목 선택"
			}
		>
			{dues.map((d) => (
				<div key={d.id} className="ac-quick-due">
					<button
						type="button"
						className="ac-chip"
						aria-pressed={!!debts[d.id]}
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
							<small>
								{d.due_ym} 납기 · {won(d.remaining)} 남음
							</small>
						</span>
					</button>
					{debts[d.id] !== undefined && debts[d.id] !== "" && (
						<label className="ac-quick-amount">
							<input
								type="number"
								aria-label={`${groupName(d.charge_id)} 선택 금액`}
								min="1"
								max={d.remaining}
								value={debts[d.id]}
								onChange={(e) => setDebts({ ...debts, [d.id]: e.target.value })}
							/>
							원
						</label>
					)}
				</div>
			))}
			{owner && !dues.length && (
				<p className="ac-caption">남은 미납이 없습니다.</p>
			)}
		</div>
	);
	return (
		<div className="ac-quick" role="region" aria-label={`${title} 정산`}>
			<fieldset
				disabled={disabled || flow.locked || flow.busy || data.mode.paused}
				className="ac-quick-fields"
			>
				{!["refund", "expense", "simple"].includes(draft.type) &&
					(source?.owner_id ? (
						<p className="ac-quick-owner">
							납부자 <strong>{memberLabel(data, source.owner_id)}</strong>
						</p>
					) : (
						<MemberPicker
							data={data}
							value={member}
							onChange={changeMember}
							suggestedName={tx.name ?? ""}
						/>
					))}
				{draft.type === "pay" && owner && (
					<>
						{owner && duePicker}
						<details className="ac-quick-more">
							<summary>다른 사람의 부과에 대납</summary>
							<MemberPicker
								data={data}
								value={beneficiary}
								label="낼 사람"
								onChange={(id) => {
									setBeneficiary(id);
									setDebts({});
									setProxy(false);
								}}
							/>
							{beneficiary && beneficiary !== owner && (
								<label className="ac-check">
									<input
										type="checkbox"
										checked={proxy}
										onChange={(e) => setProxy(e.target.checked)}
									/>
									다른 사람의 부과에 대납하는 것을 확인함
								</label>
							)}
						</details>
					</>
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
						<details className="ac-quick-more">
							<summary>기존 납기·이월 월 변경</summary>
							<label className="ac-check">
								<input
									type="checkbox"
									checked={changeMonth}
									onChange={(e) => setChangeMonth(e.target.checked)}
								/>
								기존 납기를 앞당기거나 이월 월을 변경함
							</label>
						</details>
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
				<details className="ac-quick-more">
					<summary>메모 추가</summary>
					<label className="ac-label">
						처리 사유
						<input
							className="ac-input"
							value={memo}
							onChange={(e) => setMemo(e.target.value)}
							placeholder="필요한 경우 입력"
						/>
					</label>
				</details>
			</fieldset>
			<div className="ac-quick-confirm">
				<p className="ac-caption" aria-live="polite">
					{hint || summary}
					{flow.preparing && " · 확인 중…"}
				</p>
				{flow.result && draft.type === "carry" && (
					<p className="ac-caption">
						이월 후 바로 납부에 사용 {won(flow.result.auto_applied)}
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
					<button
						type="button"
						className="ac-link ac-muted-link"
						disabled={flow.locked || flow.busy}
						onClick={() => onClose()}
					>
						접기
					</button>
					{(!unchangedExpense || flow.locked) && (
						<button
							type="button"
							className="ac-inline-confirm"
							disabled={
								(!flow.locked && disabled) ||
								!flow.ready ||
								flow.busy ||
								data.mode.paused
							}
							onClick={() =>
								void flow.confirm().then((done) => {
									if (done) onClose(true);
								})
							}
						>
							{flow.busy
								? "처리 중…"
								: flow.locked
									? "결과 다시 확인"
									: draft.type === "expense" && savedGroup
										? "변경 저장"
										: `${title} 확인`}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
