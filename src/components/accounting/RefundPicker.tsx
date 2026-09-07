import { useState } from "react";
import { receiptHistory } from "../../lib/dues/v2/selection";
import { kstMonth, memberLabel } from "../../lib/dues/v2/summary";
import type { AccountingData } from "../../lib/dues/v2/types";
import { nameMatches, normalizeDepositName } from "../admin/dues/matching";
import { won } from "../admin/dues/duesText";
import MemberPicker from "./MemberPicker";

export interface RefundSelection {
	memberId: string;
	bankId: string;
	confirmedOwner: boolean;
	external: boolean;
}
export default function RefundPicker({
	data,
	outTxId,
	value,
	onChange,
}: {
	data: AccountingData;
	outTxId: number;
	value: RefundSelection;
	onChange: (next: RefundSelection) => void;
}) {
	const [month, setMonth] = useState("");
	const [search, setSearch] = useState("");
	const [allUnknown, setAllUnknown] = useState(false);
	const outgoing = data.bank.find((t) => t.id === outTxId)!;
	const history = receiptHistory(data);
	const member = data.members.find((m) => m.id === value.memberId);
	const selected = history.find((t) => String(t.id) === value.bankId);
	const visible = history.filter(
		(t) =>
			(!month || kstMonth(t.occurred_at) === month) &&
			(nameMatches(t.name ?? "", search) || String(t.id) === search),
	);
	const own = visible.filter(
		(t) => t.owners.length === 1 && t.owners[0] === value.memberId,
	);
	const unknown = visible.filter(
		(t) =>
			!t.owners.length &&
			(value.external ||
				allUnknown ||
				(member &&
					nameMatches(normalizeDepositName(t.name ?? ""), member.name))),
	);
	const choose = (id: string) =>
		onChange({ ...value, bankId: id, confirmedOwner: false });
	const rows = (list: typeof history) =>
		list.map((t) => (
			<label
				key={t.id}
				className={`block text-sm rounded-xl border p-3 ${value.bankId === String(t.id) ? "border-blue-500" : "border-black/10 dark:border-white/15"}`}
			>
				<input
					type="radio"
					name="refund-source"
					checked={value.bankId === String(t.id)}
					disabled={t.available < outgoing.amount}
					onChange={() => choose(String(t.id))}
				/>{" "}
				{new Date(new Date(t.occurred_at).getTime() + 9 * 3600000)
					.toISOString()
					.slice(0, 10)}{" "}
				· {t.name || "적요 없음"} · 입금 #{t.id}
				<p>
					입금 {won(t.amount)} · 환불 가능 {won(t.available)}
				</p>
				<p className="text-xs text-muted">
					납부 사용 {won(t.used)} · 기환불 {won(t.refunded)} · 클럽 귀속{" "}
					{won(t.club)}
				</p>
				{t.available < outgoing.amount && (
					<p className="text-xs text-muted">
						환불 가능 잔액이 부족합니다. 부과액이 바뀌었다면 해당 부과에서 취소
						후 발행을 먼저 처리하세요.
					</p>
				)}
			</label>
		));
	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm">
				{outgoing.name || "출금"} · {won(outgoing.amount)}을 돌려받는 납부자를
				먼저 선택하세요.
			</p>
			{!value.external && (
				<MemberPicker
					data={data}
					value={value.memberId}
					label="납부자"
					suggestedName={outgoing.name ?? ""}
					onChange={(memberId) => {
						onChange({
							memberId,
							bankId: "",
							confirmedOwner: false,
							external: false,
						});
						setSearch("");
						setMonth("");
						setAllUnknown(false);
					}}
				/>
			)}
			<label className="text-sm">
				<input
					type="checkbox"
					checked={value.external}
					onChange={(e) =>
						onChange({
							memberId: "",
							bankId: "",
							confirmedOwner: false,
							external: e.target.checked,
						})
					}
				/>{" "}
				회원으로 등록되지 않은 사람에게 오입금 환불
			</label>
			{(member || value.external) && (
				<>
					<p className="font-semibold text-sm">
						{member
							? `${memberLabel(data, member.id)}의 입금 내역`
							: "미매칭 입금 내역"}{" "}
						· 전체 기간
					</p>
					<div className="grid grid-cols-2 gap-2">
						<label className="text-sm">
							입금월 (비우면 전체)
							<input
								className="w-full min-w-0 rounded-lg border border-black/15 dark:border-white/20 p-2 bg-transparent"
								type="month"
								value={month}
								onChange={(e) => {
									setMonth(e.target.value);
									choose("");
								}}
							/>
						</label>
						<label className="text-sm">
							입금 적요·번호 검색
							<input
								className="w-full rounded-lg border border-black/15 dark:border-white/20 p-2 bg-transparent"
								value={search}
								onChange={(e) => {
									setSearch(e.target.value);
									choose("");
								}}
							/>
						</label>
					</div>
					{!value.external && (
						<div
							className="flex flex-col gap-2 max-h-72 overflow-y-auto"
							aria-label="납부자와 매칭된 입금"
						>
							{rows(own)}
							{!own.length && (
								<p className="text-sm text-muted">
									이 납부자로 매칭된 입금이 없습니다.
								</p>
							)}
						</div>
					)}
					<details
						open={value.external || undefined}
						className="rounded-xl bg-black/5 dark:bg-white/5 p-3"
					>
						<summary className="text-sm font-semibold">
							아직 납부자를 확인하지 않은 입금
						</summary>
						<p className="text-xs text-muted my-2">
							이름 일치는 후보입니다. 다른 납부자로 매칭된 입금은 여기에 나오지
							않습니다.
						</p>
						{!value.external && (
							<label className="text-sm">
								<input
									type="checkbox"
									checked={allUnknown}
									onChange={(e) => setAllUnknown(e.target.checked)}
								/>{" "}
								이름이 다른 미매칭 입금도 찾기
							</label>
						)}
						<div className="flex flex-col gap-2 max-h-72 overflow-y-auto mt-2">
							{rows(unknown)}
							{!unknown.length && (
								<p className="text-sm text-muted">
									해당하는 미매칭 입금이 없습니다.
								</p>
							)}
						</div>
					</details>
					{selected && !selected.owners.length && (
						<label className="text-sm rounded-xl border border-amber-500 p-3">
							<input
								type="checkbox"
								checked={value.confirmedOwner}
								onChange={(e) =>
									onChange({ ...value, confirmedOwner: e.target.checked })
								}
							/>{" "}
							{value.external
								? "이 원입금이 출금받는 미등록 납부자의 돈임을 확인했습니다"
								: `이 원입금이 ${memberLabel(data, value.memberId)}의 돈임을 확인했습니다`}
						</label>
					)}
				</>
			)}
		</div>
	);
}
