import { SlidersHorizontal } from "lucide-react";
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
	const [filters, setFilters] = useState(false);
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
	const refundable = own.filter((t) => t.available >= outgoing.amount);
	const insufficient = own.filter((t) => t.available < outgoing.amount);
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
		list.map((t) => {
			const date = new Date(new Date(t.occurred_at).getTime() + 9 * 3600000)
				.toISOString()
				.slice(0, 10);
			const deductions = [
				t.used > 0 && `납부 사용 ${won(t.used)}`,
				t.refunded > 0 && `기환불 ${won(t.refunded)}`,
				t.club > 0 && `클럽 귀속 ${won(t.club)}`,
			].filter(Boolean);
			return (
				<label
					key={t.id}
					className={`ac-receipt ${value.bankId === String(t.id) ? "is-selected" : ""} ${t.available < outgoing.amount ? "is-unavailable" : ""}`}
				>
					<input
						type="radio"
						name="refund-source"
						aria-label={`${date} · ${t.name || "적요 없음"} · 입금 #${t.id} · 입금 ${won(t.amount)} · 환불 가능 ${won(t.available)}`}
						checked={value.bankId === String(t.id)}
						disabled={t.available < outgoing.amount}
						onChange={() => choose(String(t.id))}
					/>
					<span className="ac-receipt-content">
						<span className="ac-receipt-top">
							<span className="ac-caption">{date.replaceAll("-", ". ")}</span>
							<span
								className={`ac-badge ${t.available < outgoing.amount ? "is-neutral" : "is-blue"}`}
							>
								{t.available < outgoing.amount ? "잔액 부족" : "환불 가능"}
							</span>
						</span>
						<span className="ac-receipt-top">
							<strong>{t.name || "적요 없음"}</strong>
							<strong className="ac-number">{won(t.available)}</strong>
						</span>
						<span className="ac-caption">
							입금 {won(t.amount)}
							<span className="ac-receipt-id"> · #{t.id}</span>
						</span>
						{deductions.length > 0 && (
							<span className="ac-receipt-deductions">
								{deductions.join(" · ")}
							</span>
						)}
					</span>
				</label>
			);
		});
	return (
		<div className="ac-refund">
			<div className="ac-refund-outgoing">
				<div>
					<span className="ac-caption">
						환불할 출금 ·{" "}
						{new Date(outgoing.occurred_at).toLocaleDateString("ko-KR", {
							timeZone: "Asia/Seoul",
							month: "numeric",
							day: "numeric",
						})}
					</span>
					<strong>{outgoing.name || "출금"}</strong>
				</div>
				<strong className="ac-out ac-number">−{won(outgoing.amount)}</strong>
			</div>
			<div className="ac-step-title">
				<span>1</span>
				<h3>돌려받는 납부자</h3>
			</div>
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
			<label className="ac-check ac-caption">
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
				/>
				회원으로 등록되지 않은 사람에게 오입금 환불
			</label>
			{(member || value.external) && (
				<>
					<div className="ac-section-heading">
						<div className="ac-step-title">
							<span>2</span>
							<h3>환불할 입금 선택</h3>
						</div>
						<button
							type="button"
							className="ac-link ac-filter-toggle"
							aria-label="입금 검색 필터"
							aria-expanded={filters}
							onClick={() => setFilters(!filters)}
						>
							<SlidersHorizontal size={15} />
							필터{(month || search) && " · 적용 중"}
						</button>
					</div>
					<p className="ac-caption ac-refund-period">
						{month || "전체 기간"} ·{" "}
						{member ? `${member.name}님의 입금 내역` : "미매칭 입금 내역"}
					</p>
					{filters && (
						<div className="ac-filter-fields">
							<label className="ac-label">
								입금월 (비우면 전체)
								<input
									className="ac-input"
									type="month"
									value={month}
									onChange={(e) => {
										setMonth(e.target.value);
										choose("");
									}}
								/>
							</label>
							<label className="ac-label">
								입금 적요·번호 검색
								<input
									className="ac-input"
									value={search}
									placeholder="적요 또는 번호"
									onChange={(e) => {
										setSearch(e.target.value);
										choose("");
									}}
								/>
							</label>
						</div>
					)}
					{!value.external && (
						<div className="ac-receipts" aria-label="납부자와 매칭된 입금">
							{rows(refundable)}
							{!own.length && (
								<p className="ac-empty">
									이 납부자로 매칭된 입금이 없습니다.
									<br />
									아래에서 미매칭 입금을 확인해 주세요.
								</p>
							)}
							{own.length > 0 && !refundable.length && (
								<p className="ac-empty">
									이 출금액만큼 환불할 수 있는 입금 잔액이 없어요.
								</p>
							)}
							{insufficient.length > 0 && (
								<details className="ac-disclosure ac-insufficient-receipts">
									<summary>
										잔액이 부족한 입금{" "}
										<span className="ac-count">{insufficient.length}</span>
									</summary>
									<div className="ac-receipts">{rows(insufficient)}</div>
									<p className="ac-caption">
										부과액이 바뀌었다면 해당 부과에서 취소 후 발행을 먼저 처리해
										주세요.
									</p>
								</details>
							)}
						</div>
					)}
					<details
						open={value.external || undefined}
						className="ac-disclosure ac-unknown-receipts"
					>
						<summary>
							아직 납부자를 확인하지 않은 입금
							<span className="ac-count">{unknown.length}</span>
						</summary>
						<p className="ac-caption">
							이름이 같은 입금도 납부자 확인이 필요해요.
						</p>
						{!value.external && (
							<label className="ac-check ac-caption">
								<input
									type="checkbox"
									checked={allUnknown}
									onChange={(e) => setAllUnknown(e.target.checked)}
								/>
								이름이 다른 미매칭 입금도 찾기
							</label>
						)}
						<div className="ac-receipts">
							{rows(unknown)}
							{!unknown.length && (
								<p className="ac-empty">해당하는 미매칭 입금이 없습니다.</p>
							)}
						</div>
					</details>
					{selected && !selected.owners.length && (
						<label className="ac-check ac-owner-confirm">
							<input
								type="checkbox"
								checked={value.confirmedOwner}
								onChange={(e) =>
									onChange({ ...value, confirmedOwner: e.target.checked })
								}
							/>
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
