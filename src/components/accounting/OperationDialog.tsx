import { useState } from "react";
import {
	matchingMembers,
	receiptHistory,
	sessionChoiceLabels,
	type SessionChoice,
} from "../../lib/dues/v2/selection";
import MemberPicker from "./MemberPicker";
import RefundPicker, { type RefundSelection } from "./RefundPicker";
import { memberLabel } from "../../lib/dues/v2/summary";
import type {
	AccountingCommand,
	AccountingData,
	OperationResult,
} from "../../lib/dues/v2/types";
import { actionLabel, purposeLabel } from "../../lib/dues/v2/types";
import {
	accountingError,
	accountingReferenceMembers,
	commitAccounting,
	previewAccounting,
} from "../../lib/supabase/accountingV2";
import { currentYm, shiftYm, won } from "../admin/dues/duesText";
import ModalSheet from "../common/ModalSheet";

export interface OperationDraft {
	type:
		| "issue"
		| "replace"
		| "carry"
		| "pay"
		| "position"
		| "refund"
		| "expense"
		| "simple";
	chargeIds?: string[];
	memberId?: string;
	positionId?: string;
	outTxId?: number;
	candidate?: AccountingCommand;
	command?: AccountingCommand;
}
type IssueLine = {
	member_id: string;
	amount: number;
	due_ym: string;
	previous_id?: string;
	payer_hint?: string | null;
	due_schedule?: { due_ym: string; amount: number }[];
};
const field =
	"w-full rounded-xl border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-strong";
export default function OperationDialog({
	draft,
	data,
	onClose,
	onDone,
	sessions = [],
}: {
	draft: OperationDraft;
	data: AccountingData;
	onClose: () => void;
	onDone: () => Promise<void>;
	sessions?: SessionChoice[];
}) {
	const initialCharges = data.charges.filter((c) =>
		draft.chargeIds?.includes(c.id),
	);
	const source = data.positions.find((p) => p.id === draft.positionId);
	const outgoing = data.bank.find((t) => t.id === draft.outTxId);
	const [reason, setReason] = useState(
		draft.candidate?.reason ?? draft.command?.reason ?? "",
	);
	const [member, setMember] = useState(
		draft.memberId ?? source?.owner_id ?? "",
	);
	const [search, setSearch] = useState("");
	const [ym, setYm] = useState(
		draft.type === "carry"
			? shiftYm(currentYm(), 1)
			: String(draft.candidate?.ym ?? currentYm()),
	);
	const [label, setLabel] = useState(String(draft.candidate?.label ?? ""));
	const [date, setDate] = useState(
		String(draft.candidate?.date ?? `${currentYm()}-01`),
	);
	const [unitAmount, setUnitAmount] = useState("5000");
	const [totalAmount, setTotalAmount] = useState("");
	const [rounding, setRounding] = useState("10");
	const [lines, setLines] = useState<IssueLine[]>(() =>
		draft.type === "replace"
			? initialCharges.map((c) => {
					const schedule = data.due
						.filter((d) => d.charge_id === c.id)
						.map((d) => ({
							due_ym: d.due_ym,
							amount:
								d.remaining +
								data.allocations
									.filter((a) => a.due_id === d.id)
									.reduce((sum, a) => sum + a.amount - a.reversed, 0),
						}))
						.filter((d) => d.amount > 0)
						.sort((a, b) => a.due_ym.localeCompare(b.due_ym));
					return {
						member_id: c.member_id,
						amount: c.amount,
						previous_id: c.id,
						payer_hint: c.payer_hint,
						due_ym: schedule[0]?.due_ym ?? currentYm(),
						due_schedule: schedule.length > 1 ? schedule : undefined,
					};
				})
			: ((draft.candidate?.lines as IssueLine[] | undefined) ?? []),
	);
	const [cancelOnly, setCancelOnly] = useState(false);
	const [manualOverride, setManualOverride] = useState(false);
	const ruleLocked = !!draft.candidate?.rule && !manualOverride;
	const [proxy, setProxy] = useState(false);
	const [changeMonth, setChangeMonth] = useState(false);
	const [debts, setDebts] = useState<Record<string, string>>({});
	const [money, setMoney] = useState<Record<string, string>>({});
	const [amount, setAmount] = useState(String(source?.amount ?? ""));
	const [purpose, setPurpose] = useState("member_pending");
	const [group, setGroup] = useState("");
	const [refund, setRefund] = useState<RefundSelection>({
		memberId: "",
		bankId: "",
		confirmedOwner: false,
		external: false,
	});
	const bank = refund.bankId;
	const [referenceId, setReferenceId] = useState("");
	const [mealOnly, setMealOnly] = useState(false);
	const sessionLabels = sessionChoiceLabels(sessions);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [pending, setPending] = useState<{
		payload: AccountingCommand;
		request: string;
		revision: number;
		result: OperationResult;
	} | null>(null);
	const [attempted, setAttempted] = useState(false);
	const memberDues = data.due.filter(
		(d) =>
			d.remaining > 0 &&
			data.charges.some(
				(c) =>
					c.id === d.charge_id && c.state === "live" && c.member_id === member,
			),
	);
	const memberMoney = data.positions.filter(
		(p) =>
			p.owner_id === member && ["member_pending", "carry"].includes(p.purpose),
	);
	const selectedMembers = new Set(lines.map((l) => l.member_id));
	const chargeName = (id: string) =>
		data.groups.find(
			(g) => g.id === data.charges.find((c) => c.id === id)?.group_id,
		)?.label ?? "부과";
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
	const resetMember = (id: string) => {
		setMember(id);
		setDebts({});
		setMoney({});
		setProxy(false);
	};
	const title =
		draft.type === "simple"
			? actionLabel[draft.command!.action]
			: draft.type === "issue"
				? "부과 발행"
				: draft.type === "replace"
					? "취소 후 발행"
					: draft.type === "carry"
						? "미납·입금 이월"
						: draft.type === "pay"
							? "납부 확인"
							: draft.type === "position"
								? "입금 잔액 용도"
								: draft.type === "refund"
									? "환불 원입금 연결"
									: "지출 귀속";

	const payload = (): AccountingCommand => {
		if (!reason.trim()) throw new Error("처리 사유를 입력하세요");
		const base = { reason: reason.trim() };
		if ((draft.type === "issue" || draft.type === "replace") && !cancelOnly) {
			for (const line of lines) {
				positive(String(line.amount));
				if (
					line.due_schedule &&
					(line.due_schedule.some(
						(s) => !Number.isSafeInteger(s.amount) || s.amount <= 0,
					) ||
						line.due_schedule.reduce((sum, s) => sum + s.amount, 0) !==
							line.amount)
				)
					throw new Error(
						`${memberLabel(data, line.member_id)}의 납기별 금액 합계를 부과액과 맞춰 주세요`,
					);
			}
		}
		if (draft.type === "simple") return { ...draft.command!, ...base };
		if (draft.type === "issue") {
			if (!label.trim() || (!lines.length && !draft.candidate?.group_only))
				throw new Error("부과 이름과 대상 회원을 확인하세요");
			return {
				...(draft.candidate ?? {}),
				...base,
				action: "issue",
				rule: manualOverride ? null : draft.candidate?.rule,
				kind: draft.candidate?.kind ?? "manual",
				label: label.trim(),
				date,
				ym: date.slice(0, 7),
				lines,
				basis: {
					...(draft.candidate?.basis as Record<string, unknown> | undefined),
					manual_override: manualOverride,
					total: totalAmount
						? positive(totalAmount)
						: ((draft.candidate?.basis as Record<string, unknown> | undefined)
								?.total ?? null),
					rounding: positive(rounding),
					members: lines.map((l) => l.member_id),
					reference_session_id: referenceId ? Number(referenceId) : null,
					reference_label: referenceId
						? sessionLabels.get(Number(referenceId))
						: null,
				},
			};
		}
		if (draft.type === "replace")
			return {
				...base,
				action: "replace",
				charge_ids: draft.chargeIds,
				lines: cancelOnly ? [] : lines,
				basis: {
					total: totalAmount ? positive(totalAmount) : null,
					rounding: positive(rounding),
				},
				proxy,
			};
		if (draft.type === "carry") {
			const ds = entries(debts, "due_id"),
				ms = entries(money, "position_id");
			if (!member || (!ds.length && !ms.length))
				throw new Error("이월할 회원과 금액을 선택하세요");
			return {
				...base,
				action: "carry",
				member_id: member,
				target_ym: ym,
				debts: ds,
				money: ms,
				change_month: changeMonth,
			};
		}
		if (draft.type === "position")
			return {
				...base,
				action: "position",
				position_id: source?.id,
				amount: positive(amount),
				purpose,
				owner_id: member || null,
				group_id: group || null,
			};
		if (draft.type === "pay") {
			const ls = entries(debts, "due_id").map((l) => ({
				...l,
				position_id: source?.id,
			}));
			if (!ls.length) throw new Error("납부할 부과와 금액을 선택하세요");
			return { ...base, action: "pay", lines: ls, proxy };
		}
		if (draft.type === "expense")
			return {
				...base,
				action: "expense",
				out_tx_id: draft.outTxId,
				group_id: group || null,
			};
		if (!refund.memberId && !refund.external)
			throw new Error("환불받는 납부자를 선택하세요");
		const receipt = receiptHistory(data).find((t) => String(t.id) === bank);
		if (!receipt || receipt.owners.some((id) => id !== refund.memberId))
			throw new Error("선택한 납부자의 원입금을 확인하세요");
		if (!receipt.owners.length && !refund.confirmedOwner)
			throw new Error("미매칭 원입금의 실제 납부자를 확인해 주세요");
		let left = outgoing?.amount ?? 0;
		const ls = data.positions
			.filter((p) => p.bank_tx_id === Number(bank) && p.purpose !== "club")
			.map((p) => {
				const n = Math.min(left, p.amount);
				left -= n;
				return { position_id: p.id, amount: n };
			})
			.filter((l) => l.amount > 0);
		if (left || !ls.length)
			throw new Error("실제 출금액을 환불할 수 있는 원입금을 선택하세요");
		return {
			...base,
			action: "refund",
			out_tx_id: draft.outTxId,
			owner_id: refund.memberId || null,
			confirm_owner: refund.confirmedOwner,
			external_refund: refund.external,
			lines: ls,
		};
	};
	const preview = async () => {
		setBusy(true);
		setError("");
		try {
			const command = payload(),
				request = crypto.randomUUID(),
				revision = data.mode.revision;
			const result = await previewAccounting(command, request, revision);
			setPending({ payload: command, request, revision, result });
		} catch (e) {
			setError(accountingError(e));
		} finally {
			setBusy(false);
		}
	};
	const confirm = async () => {
		if (!pending) return;
		setBusy(true);
		setAttempted(true);
		setError("");
		try {
			await commitAccounting(
				pending.payload,
				pending.request,
				pending.revision,
			);
			await onDone();
			onClose();
		} catch (e) {
			setError(
				`${accountingError(e)} 같은 확인 버튼으로 결과를 다시 확인할 수 있습니다.`,
			);
		} finally {
			setBusy(false);
		}
	};
	const chooseMember = (
		<MemberPicker
			data={data}
			value={member}
			onChange={resetMember}
			label={
				draft.type === "position"
					? "납부자"
					: draft.type === "pay"
						? "낼 사람"
						: "회원"
			}
			suggestedName={
				draft.type === "position"
					? (data.bank.find((t) => t.id === source?.bank_tx_id)?.name ?? "")
					: ""
			}
		/>
	);
	const addReferenceMembers = async () => {
		setBusy(true);
		setError("");
		try {
			const ids = await accountingReferenceMembers(
				Number(referenceId),
				mealOnly,
			);
			setLines((previous) => [
				...previous,
				...ids
					.filter((id) => !previous.some((l) => l.member_id === id))
					.map((id) => ({
						member_id: id,
						amount: positive(unitAmount),
						due_ym: date.slice(0, 7),
					})),
			]);
			if (!ids.length)
				setError(
					"참고 회차에서 가져올 대상이 없습니다. 회원을 직접 선택할 수 있습니다.",
				);
		} catch (e) {
			setError(accountingError(e));
		} finally {
			setBusy(false);
		}
	};
	const chooseGroup = (
		<select
			aria-label="회계 항목"
			className={field}
			value={group}
			onChange={(e) => setGroup(e.target.value)}
		>
			<option value="">미분류 / 귀속 해제</option>
			{data.groups.map((g) => (
				<option key={g.id} value={g.id}>
					{g.label}
				</option>
			))}
		</select>
	);
	const moneyRows = (kind: "debt" | "money") =>
		kind === "debt"
			? memberDues.map((d) => (
					<label key={d.id} className="flex items-center gap-2 text-sm">
						<span className="flex-1">
							{chargeName(d.charge_id)} · {d.due_ym} 납기
							<br />
							<span className="text-muted">남은 금액 {won(d.remaining)}</span>
						</span>
						<input
							aria-label={`${chargeName(d.charge_id)} 선택 금액`}
							className={`${field} max-w-28`}
							type="number"
							min="0"
							max={d.remaining}
							step="1"
							value={debts[d.id] ?? ""}
							placeholder="0"
							onChange={(e) => setDebts({ ...debts, [d.id]: e.target.value })}
						/>
					</label>
				))
			: memberMoney.map((p) => (
					<label key={p.id} className="flex items-center gap-2 text-sm">
						<span className="flex-1">
							{data.bank
								.find((t) => t.id === p.bank_tx_id)
								?.occurred_at.slice(0, 10)}{" "}
							입금 · {purposeLabel[p.purpose]}
							<br />
							<span className="text-muted">
								{won(p.amount)}
								{p.available_ym ? ` · ${p.available_ym}부터 사용` : ""}
							</span>
						</span>
						<input
							aria-label={`입금 ${p.bank_tx_id} 이월 금액`}
							className={`${field} max-w-28`}
							type="number"
							min="0"
							max={p.amount}
							step="1"
							value={money[p.id] ?? ""}
							placeholder="0"
							onChange={(e) => setMoney({ ...money, [p.id]: e.target.value })}
						/>
					</label>
				));
	return (
		<ModalSheet
			position="bottom"
			className="p-5"
			onClose={busy ? undefined : onClose}
			closeOnEscape
		>
			<div className="flex items-center justify-between mb-4">
				<h2 className="font-bold text-lg text-strong">{title}</h2>
				<button
					type="button"
					className="text-muted"
					disabled={busy}
					onClick={onClose}
				>
					닫기
				</button>
			</div>
			<div className="flex flex-col gap-4 max-h-[70dvh] overflow-y-auto pb-3">
				{pending ? (
					<>
						<p className="text-sm text-muted">{pending.payload.reason}</p>
						{(draft.type === "replace" || draft.type === "issue") && (
							<div className="text-sm flex flex-col gap-3">
								{initialCharges.map((c) => (
									<div key={c.id}>
										<p>
											취소: {memberLabel(data, c.member_id)} ·{" "}
											{chargeName(c.id)} · {won(c.amount)}
										</p>
										{data.allocations
											.filter(
												(a) => a.charge_id === c.id && a.amount > a.reversed,
											)
											.map((a) => (
												<p key={a.id} className="text-xs text-muted">
													풀리는 돈: {memberLabel(data, a.owner_id)} · 원입금 #
													{a.bank_tx_id} · {won(a.amount - a.reversed)}
												</p>
											))}
									</div>
								))}
								{!cancelOnly &&
									lines.map((l, i) => (
										<p key={i}>
											새 발행: {memberLabel(data, l.member_id)} ·{" "}
											{won(l.amount)}
											<br />
											<span className="text-xs text-muted">
												{l.due_schedule
													? l.due_schedule
															.map((s) => `${s.due_ym} ${won(s.amount)}`)
															.join(" / ")
													: `${l.due_ym} 납기`}
											</span>
										</p>
									))}
							</div>
						)}
						{draft.type === "pay" && (
							<div className="text-sm">
								<p>
									{memberLabel(data, source?.owner_id ?? null)}의 원입금 #
									{source?.bank_tx_id} → {memberLabel(data, member)}
								</p>
								{memberDues
									.filter((d) => Number(debts[d.id]) > 0)
									.map((d) => (
										<p key={d.id} className="text-muted">
											{chargeName(d.charge_id)} · {d.due_ym} ·{" "}
											{won(Number(debts[d.id]))}
										</p>
									))}
							</div>
						)}
						{draft.type === "refund" && (
							<p className="text-sm">
								{refund.external
									? "미등록 납부자"
									: memberLabel(data, refund.memberId)}{" "}
								· 원입금 #{bank} (
								{data.bank
									.find((t) => t.id === Number(bank))
									?.occurred_at.slice(0, 10)}
								) → 출금 #{outgoing?.id} · 환불 {won(outgoing?.amount ?? 0)}
							</p>
						)}
						{draft.type === "carry" && (
							<div className="text-xs text-muted">
								{memberDues
									.filter((d) => Number(debts[d.id]) > 0)
									.map((d) => (
										<p key={d.id}>
											{chargeName(d.charge_id)} · {d.due_ym} → {ym} · 미납{" "}
											{won(Number(debts[d.id]))}
										</p>
									))}
								{memberMoney
									.filter((p) => Number(money[p.id]) > 0)
									.map((p) => (
										<p key={p.id}>
											원입금 #{p.bank_tx_id} → {ym}부터 사용 ·{" "}
											{won(Number(money[p.id]))}
										</p>
									))}
							</div>
						)}
						{draft.type === "replace" && (
							<p className="text-sm">
								선택한 기존 부과 {initialCharges.length}건을 취소하고{" "}
								{cancelOnly
									? "새 부과 없이 잔액을 돌려놓습니다."
									: `${lines.length}건을 새로 발행합니다.`}
							</p>
						)}
						{draft.type === "carry" && (
							<p className="text-sm">
								{memberLabel(data, member)} · {ym} 이월: 미납{" "}
								{won(
									entries(debts, "due_id").reduce((s, l) => s + l.amount, 0),
								)}{" "}
								/ 이미 낸 돈{" "}
								{won(
									entries(money, "position_id").reduce(
										(s, l) => s + l.amount,
										0,
									),
								)}
							</p>
						)}
						<dl className="grid grid-cols-2 gap-3 text-sm">
							<dt>전체 미납</dt>
							<dd>
								{won(pending.result.outstanding_before)} →{" "}
								{won(pending.result.outstanding_after)}
							</dd>
							<dt>전체 회원 잔액</dt>
							<dd>
								{won(pending.result.member_balance_before)} →{" "}
								{won(pending.result.member_balance_after)}
							</dd>
							{pending.result.reused != null && (
								<>
									<dt>기존 납부금 재사용</dt>
									<dd>{won(pending.result.reused)}</dd>
								</>
							)}
							<dt>이월금 자동 사용</dt>
							<dd>{won(pending.result.auto_applied)}</dd>
						</dl>
						<p className="text-sm text-muted">
							실제 통장 입출금은 유지됩니다. 같은 돈을 중복 사용하지 않는지
							서버에서 다시 확인합니다.
						</p>
					</>
				) : (
					<>
						{(draft.type === "issue" || draft.type === "replace") && (
							<>
								{draft.type === "issue" && (
									<>
										{!draft.candidate?.rule && !draft.candidate?.group_only && (
											<div className="rounded-xl bg-black/5 dark:bg-white/5 p-3 flex flex-col gap-2">
												<label className="text-sm">
													참고 회차
													<select
														aria-label="참고 회차"
														className={field}
														value={referenceId}
														onChange={(e) => setReferenceId(e.target.value)}
													>
														<option value="">회원 직접 선택</option>
														{sessions.map((s) => (
															<option key={s.id} value={s.id}>
																{sessionLabels.get(s.id)}
															</option>
														))}
													</select>
												</label>
												{referenceId && (
													<>
														<label className="text-sm">
															<input
																type="checkbox"
																checked={mealOnly}
																onChange={(e) => setMealOnly(e.target.checked)}
															/>{" "}
															회식 참여자만
														</label>
														<button
															type="button"
															className="btn-lq-secondary"
															disabled={busy}
															onClick={() => void addReferenceMembers()}
														>
															참고 회차 명단 추가
														</button>
														<p className="text-xs text-muted">
															{sessionLabels.get(Number(referenceId))} · 기존에
															선택한 회원은 유지합니다.
														</p>
													</>
												)}
											</div>
										)}
										<label className="text-sm">
											부과 이름
											<input
												className={field}
												value={label}
												onChange={(e) => setLabel(e.target.value)}
											/>
										</label>
										<label className="text-sm">
											발생일
											<input
												className={field}
												type="date"
												value={date}
												onChange={(e) => {
													setDate(e.target.value);
													setLines(
														lines.map((l) => ({
															...l,
															due_ym: e.target.value.slice(0, 7),
														})),
													);
												}}
											/>
										</label>
									</>
								)}
								{draft.type === "replace" && (
									<>
										<p className="text-sm text-muted">
											원부과와 납부 이력은 남습니다. 바뀔 회원의 부과만
											선택했고, 기존 납부금을 새 부과에 사용합니다.
										</p>
										<label className="text-sm">
											<input
												type="checkbox"
												checked={cancelOnly}
												onChange={(e) => setCancelOnly(e.target.checked)}
											/>{" "}
											취소만 하고 받은 돈을 잔액으로 돌려놓기
										</label>
									</>
								)}
								{draft.candidate?.rule && (
									<label className="text-sm">
										<input
											type="checkbox"
											checked={manualOverride}
											onChange={(e) => {
												setManualOverride(e.target.checked);
												if (!e.target.checked)
													setLines(
														(draft.candidate?.lines as IssueLine[]) ?? [],
													);
											}}
										/>{" "}
										계산 규칙 대신 대상·금액을 직접 지정
									</label>
								)}
								{!cancelOnly && (
									<>
										{!ruleLocked && (
											<div className="grid grid-cols-2 gap-2">
												<label className="text-sm">
													총액으로 나누기
													<input
														className={field}
														type="number"
														min="1"
														value={totalAmount}
														onChange={(e) => setTotalAmount(e.target.value)}
													/>
												</label>
												<label className="text-sm">
													올림 단위
													<select
														className={field}
														value={rounding}
														onChange={(e) => setRounding(e.target.value)}
													>
														{[10, 100, 1000].map((n) => (
															<option key={n} value={n}>
																{n}원
															</option>
														))}
													</select>
												</label>
												<button
													type="button"
													className="btn-lq-secondary col-span-2"
													onClick={() => {
														const n = Number(totalAmount),
															unit = Number(rounding);
														if (n > 0 && lines.length)
															setLines(
																lines.map((l) => ({
																	...l,
																	amount:
																		Math.ceil(n / lines.length / unit) * unit,
																})),
															);
													}}
												>
													선택한 {lines.length}명에게 나누기
												</button>
											</div>
										)}
										{lines.map((l, i) => (
											<div
												key={l.member_id}
												className="flex flex-col gap-2 rounded-xl border border-black/10 dark:border-white/15 p-3"
											>
												<div className="flex items-center gap-2">
													<span className="flex-1 text-sm">
														{memberLabel(data, l.member_id)}
													</span>
													<input
														aria-label={`${memberLabel(data, l.member_id)} 부과액`}
														className={`${field} max-w-28`}
														type="number"
														min="1"
														step="1"
														value={l.amount || ""}
														disabled={ruleLocked}
														onChange={(e) =>
															setLines(
																lines.map((row, index) =>
																	index === i
																		? { ...row, amount: Number(e.target.value) }
																		: row,
																),
															)
														}
													/>
													<button
														type="button"
														className="text-muted"
														aria-label="대상 제외"
														disabled={ruleLocked}
														onClick={() =>
															setLines(lines.filter((_, index) => index !== i))
														}
													>
														제외
													</button>
												</div>
												{draft.type === "replace" &&
													initialCharges.length > 1 && (
														<label className="text-sm">
															대체할 원부과
															<select
																className={field}
																value={l.previous_id ?? ""}
																onChange={(e) =>
																	setLines(
																		lines.map((row, index) =>
																			index === i
																				? {
																						...row,
																						previous_id: e.target.value,
																					}
																				: row,
																		),
																	)
																}
															>
																{initialCharges.map((c) => (
																	<option key={c.id} value={c.id}>
																		{memberLabel(data, c.member_id)} ·{" "}
																		{won(c.amount)}
																	</option>
																))}
															</select>
														</label>
													)}
												{l.due_schedule ? (
													<>
														<p className="text-sm text-muted">
															납기별 합계{" "}
															{won(
																l.due_schedule.reduce(
																	(sum, part) => sum + part.amount,
																	0,
																),
															)}{" "}
															/ 부과 {won(l.amount)}
														</p>
														{l.due_schedule.map((part, j) => (
															<div key={j} className="flex gap-2">
																<input
																	aria-label={`납기 ${j + 1} 월`}
																	className={field}
																	type="month"
																	value={part.due_ym}
																	onChange={(e) =>
																		setLines(
																			lines.map((row, index) =>
																				index === i
																					? {
																							...row,
																							due_schedule:
																								row.due_schedule!.map((s, k) =>
																									k === j
																										? {
																												...s,
																												due_ym: e.target.value,
																											}
																										: s,
																								),
																						}
																					: row,
																			),
																		)
																	}
																/>
																<input
																	aria-label={`납기 ${j + 1} 금액`}
																	className={`${field} max-w-28`}
																	type="number"
																	min="1"
																	step="1"
																	value={part.amount || ""}
																	onChange={(e) =>
																		setLines(
																			lines.map((row, index) =>
																				index === i
																					? {
																							...row,
																							due_schedule:
																								row.due_schedule!.map((s, k) =>
																									k === j
																										? {
																												...s,
																												amount: Number(
																													e.target.value,
																												),
																											}
																										: s,
																								),
																						}
																					: row,
																			),
																		)
																	}
																/>
																<button
																	type="button"
																	className="text-muted text-xs"
																	onClick={() =>
																		setLines(
																			lines.map((row, index) =>
																				index === i
																					? {
																							...row,
																							due_schedule:
																								row.due_schedule!.filter(
																									(_, k) => k !== j,
																								),
																						}
																					: row,
																			),
																		)
																	}
																>
																	제거
																</button>
															</div>
														))}
														<button
															type="button"
															className="text-sm text-[#0b84ff]"
															onClick={() =>
																setLines(
																	lines.map((row, index) =>
																		index === i
																			? {
																					...row,
																					due_schedule: [
																						...row.due_schedule!,
																						{
																							due_ym: shiftYm(
																								row.due_schedule!.at(-1)
																									?.due_ym ?? row.due_ym,
																								1,
																							),
																							amount: 0,
																						},
																					],
																				}
																			: row,
																	),
																)
															}
														>
															납기 추가
														</button>
														<button
															type="button"
															className="text-sm text-muted"
															onClick={() =>
																setLines(
																	lines.map((row, index) =>
																		index === i
																			? {
																					...row,
																					due_ym:
																						row.due_schedule![0]?.due_ym ??
																						row.due_ym,
																					due_schedule: undefined,
																				}
																			: row,
																	),
																)
															}
														>
															한 달 납기로 합치기
														</button>
													</>
												) : (
													<>
														<label className="flex items-center gap-2 text-sm">
															납기
															<input
																className={field}
																type="month"
																value={l.due_ym}
																onChange={(e) =>
																	setLines(
																		lines.map((row, index) =>
																			index === i
																				? { ...row, due_ym: e.target.value }
																				: row,
																		),
																	)
																}
															/>
														</label>
														<button
															type="button"
															className="text-sm text-muted"
															onClick={() =>
																setLines(
																	lines.map((row, index) =>
																		index === i
																			? {
																					...row,
																					due_schedule: [
																						{
																							due_ym: row.due_ym,
																							amount: row.amount,
																						},
																						{
																							due_ym: shiftYm(row.due_ym, 1),
																							amount: 0,
																						},
																					],
																				}
																			: row,
																	),
																)
															}
														>
															납기를 나누기
														</button>
													</>
												)}
												{!ruleLocked &&
													data.members.find((m) => m.id === l.member_id)
														?.guest && (
														<label className="text-sm">
															게스트 대납 안내 대상
															<select
																className={field}
																value={l.payer_hint ?? ""}
																onChange={(e) =>
																	setLines(
																		lines.map((row, index) =>
																			index === i
																				? {
																						...row,
																						payer_hint: e.target.value || null,
																					}
																				: row,
																		),
																	)
																}
															>
																<option value="">없음</option>
																{data.members
																	.filter((m) => !m.guest)
																	.map((m) => (
																		<option key={m.id} value={m.id}>
																			{memberLabel(data, m.id)}
																		</option>
																	))}
															</select>
														</label>
													)}
											</div>
										))}
										<p className="text-sm font-semibold">
											발행 합계 {won(lines.reduce((s, l) => s + l.amount, 0))}
										</p>
										{!ruleLocked && (
											<>
												<input
													aria-label="대상 회원 검색"
													className={field}
													placeholder="대상 회원 검색"
													value={search}
													onChange={(e) => setSearch(e.target.value)}
												/>
												<label className="text-sm">
													추가 회원의 부과액
													<input
														className={field}
														type="number"
														min="1"
														value={unitAmount}
														onChange={(e) => setUnitAmount(e.target.value)}
													/>
												</label>
												<div className="max-h-40 overflow-y-auto flex flex-col gap-2">
													{data.members
														.filter(
															(m) =>
																!selectedMembers.has(m.id) &&
																matchingMembers(data, search).some(
																	(candidate) => candidate.id === m.id,
																),
														)
														.map((m) => (
															<button
																type="button"
																key={m.id}
																className="text-left text-sm text-[#0b84ff]"
																onClick={() =>
																	setLines([
																		...lines,
																		{
																			member_id: m.id,
																			previous_id:
																				draft.type === "replace"
																					? initialCharges[0]?.id
																					: undefined,
																			amount: Number(unitAmount),
																			due_ym: ym,
																		},
																	])
																}
															>
																+ {memberLabel(data, m.id)}
															</button>
														))}
												</div>
											</>
										)}
									</>
								)}
								{draft.type === "replace" && (
									<label className="text-sm">
										<input
											type="checkbox"
											checked={proxy}
											onChange={(e) => setProxy(e.target.checked)}
										/>{" "}
										기존 납부자가 다른 사람의 새 부과에 대납하는 것을 확인함
									</label>
								)}
							</>
						)}
						{(draft.type === "carry" || draft.type === "pay") && (
							<>
								{source && (
									<p className="text-sm">
										{memberLabel(data, source.owner_id)}의 입금 잔액{" "}
										{won(source.amount)}
									</p>
								)}
								{chooseMember}
								<p className="text-sm text-muted">
									{draft.type === "pay"
										? "낼 사람을 선택하세요. 돈 소유자는 그대로 유지됩니다."
										: "아직 안 낸 돈과 이미 낸 돈에서 넘길 금액을 각각 입력하세요."}
								</p>
								{draft.type === "carry" && (
									<>
										<label className="text-sm">
											이월할 월
											<input
												type="month"
												className={field}
												value={ym}
												onChange={(e) => setYm(e.target.value)}
											/>
										</label>
										<label className="text-sm">
											<input
												type="checkbox"
												checked={changeMonth}
												onChange={(e) => setChangeMonth(e.target.checked)}
											/>{" "}
											기존 납기를 앞당기거나 이월 월을 변경함
										</label>
									</>
								)}
								<h3 className="font-semibold text-sm">아직 안 낸 돈</h3>
								{moneyRows("debt")}
								{memberDues.length === 0 && (
									<p className="text-muted text-sm">남은 부과가 없습니다.</p>
								)}
								{draft.type === "carry" && (
									<>
										<h3 className="font-semibold text-sm">이미 낸 돈</h3>
										{moneyRows("money")}
										<p className="text-muted text-sm">
											선택한 달부터 본인의 납기가 도래한 부과에 자동 사용합니다.
											남는 입금은 이후 납부에 이어 사용합니다.
										</p>
									</>
								)}
								{draft.type === "pay" && member !== source?.owner_id && (
									<label className="text-sm">
										<input
											type="checkbox"
											checked={proxy}
											onChange={(e) => setProxy(e.target.checked)}
										/>{" "}
										다른 사람의 부과에 대납하는 것을 확인함
									</label>
								)}
							</>
						)}
						{draft.type === "position" && (
							<>
								<p className="text-sm">
									{purposeLabel[source!.purpose]} · {won(source!.amount)}
								</p>
								<label className="text-sm">
									변경할 금액
									<input
										className={field}
										type="number"
										min="1"
										max={source?.amount}
										value={amount}
										onChange={(e) => setAmount(e.target.value)}
									/>
								</label>
								{source?.owner_id ? (
									<p className="text-sm">
										돈 소유자: {memberLabel(data, source.owner_id)}
									</p>
								) : (
									chooseMember
								)}
								<select
									aria-label="입금 용도"
									className={field}
									value={purpose}
									onChange={(e) => setPurpose(e.target.value)}
								>
									<option value="member_pending">회원 잔액으로 보관</option>
									<option value="refund_pending">환불 대기</option>
									<option value="club">클럽 직접 수입</option>
									<option value="unassigned">미귀속으로 되돌림</option>
								</select>
								{purpose === "club" && chooseGroup}
								<p className="text-sm text-muted">
									일부 금액만 바꾸면 나머지는 원래 용도로 남습니다. 이월 입금의
									미사용분도 보관이나 환불 대기로 바꿀 수 있습니다.
								</p>
							</>
						)}
						{draft.type === "expense" && (
							<>
								<p className="text-sm">
									출금 {won(outgoing?.amount ?? 0)}의 항목
								</p>
								{chooseGroup}
							</>
						)}
						{draft.type === "refund" && (
							<RefundPicker
								data={data}
								outTxId={draft.outTxId!}
								value={refund}
								onChange={(value) => { setRefund(value); setError(""); }}
							/>
						)}
						<label className="text-sm">
							처리 사유
							<textarea
								className={field}
								rows={2}
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								placeholder="변경 내용과 확인한 이유"
							/>
						</label>
					</>
				)}
				{error && (
					<p role="alert" className="text-sm text-red-600 whitespace-pre-wrap">
						{error}
					</p>
				)}
				<div className="flex gap-2">
					{pending && !attempted && (
						<button
							type="button"
							disabled={busy}
							className="btn-lq-secondary flex-1"
							onClick={() => setPending(null)}
						>
							입력으로 돌아가기
						</button>
					)}
					<button
						type="button"
						disabled={busy}
						className="btn-lq-primary flex-1"
						onClick={() => void (pending ? confirm() : preview())}
					>
						{busy ? "확인 중…" : pending ? "확정" : "변경 결과 확인"}
					</button>
				</div>
			</div>
		</ModalSheet>
	);
}
