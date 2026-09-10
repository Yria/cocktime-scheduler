import { SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";
import { receiptHistory } from "../../lib/dues/selection";
import { kstMonth, memberLabel } from "../../lib/dues/summary";
import type { AccountingData } from "../../lib/dues/types";
import { nameMatches, normalizeDepositName } from "../../lib/dues/matching";
import { won } from "../../lib/dues/duesText";
import { SettlementField } from "./SettlementForm";
import SettlementChoice from "./SettlementChoice";
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
	receipt = false,
}: {
	receipt?: boolean;
	data: AccountingData;
	outTxId: number;
	value: RefundSelection;
	onChange: (next: RefundSelection) => void;
}) {
	// 라디오 그룹은 인스턴스마다 격리한다 — 출금 카드 두 개를 동시에 펼치면
	// 전역 상수 name 이 두 목록을 한 그룹으로 묶어 서로의 선택을 해제했다.
	const radioGroup = useId();
	const [payerOpen, setPayerOpen] = useState(!value.memberId);
	const [month, setMonth] = useState("");
	const [search, setSearch] = useState("");
	const [filters, setFilters] = useState(false);
	const [unknownPicked, setUnknownPicked] = useState(false);
	const outgoing = data.bank.find((t) => t.id === outTxId)!;
	const history = receiptHistory(data);
	const member = data.members.find((m) => m.id === value.memberId);
	const selected = history.find(
		(t) => String(t.id) === value.bankId && t.available >= outgoing.amount,
	);
	const visible = history.filter(
		(t) =>
			t.available >= outgoing.amount &&
			(!month || kstMonth(t.occurred_at) === month) &&
			(nameMatches(t.name ?? "", search) || String(t.id) === search),
	);
	// 이름이 일치하는 미정산 입금도 바로 제안한다. 소유자 확정은 선택 후
	// 별도 확인을 거치며, 다른 회원에게 귀속된 입금은 이름이 같아도 제외한다.
	const candidates = visible.filter(
		(t) =>
			(t.owners.length === 1 && t.owners[0] === value.memberId) ||
			(!t.owners.length &&
				member &&
				nameMatches(normalizeDepositName(t.name ?? ""), member.name)),
	);
	const candidateIds = new Set(candidates.map((t) => t.id));
	const unknown = visible.filter(
		(t) => !t.owners.length && !candidateIds.has(t.id),
	);
	// 미등록 납부자 환불을 켜면 그 목록이 곧 대상이므로 항상 펼쳐 둔다.
	const unknownOpen = unknownPicked || value.external;
	const choose = (id: string) =>
		onChange({ ...value, bankId: id, confirmedOwner: false });
	const rows = (list: typeof history) =>
		list.map((t) => {
			const date = new Date(new Date(t.occurred_at).getTime() + 9 * 3600000)
				.toISOString()
				.slice(0, 10);
			return (
				<SettlementChoice
					key={t.id}
					title={t.name || "적요 없음"}
					detail={date.replaceAll("-", ". ")}
					amount={won(t.available)}
					label={`${date} · ${t.name || "적요 없음"} · 입금 #${t.id} · 입금 ${won(t.amount)} · 환불 가능 ${won(t.available)}`}
					selected={value.bankId === String(t.id)}
					onSelect={() => choose(String(t.id))}
					radio={{ name: radioGroup, value: String(t.id) }}
				/>
			);
		});
	return (
		<div className={`ac-refund ${receipt ? "ac-refund-inline" : ""}`}>
			<SettlementField label="납부자">
				<div className="ac-refund-payer">
					{!value.external &&
						(receipt && member && !payerOpen ? (
							<div className="ac-refund-payer-value">
								<strong>{memberLabel(data, member.id)}</strong>
								<button
									type="button"
									className="ac-receipt-change"
									aria-label="납부자 변경"
									onClick={() => setPayerOpen(true)}
								>
									변경
								</button>
							</div>
						) : (
							<div
								className={receipt ? "ac-settlement-member-search" : undefined}
							>
								<MemberPicker
									data={data}
									compact={receipt}
									receipt={receipt}
									showOwingFilter={false}
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
										setPayerOpen(false);
									}}
								/>
							</div>
						))}
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
				</div>
			</SettlementField>
			{(member || value.external) && (
				<SettlementField label="원입금" stacked>
					<div className="ac-refund-sources">
						<div className="ac-section-heading">
							<span className="ac-caption">
								{month || "전체 기간"} · 환불 가능 잔액
							</span>
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
							<div className="ac-receipts" aria-label="환불 원입금 후보">
								<div className="ac-choice-chips">{rows(candidates)}</div>
								{!candidates.length && (
									<p className="ac-empty">
										이 납부자의 환불 가능한 입금이 없습니다.
									</p>
								)}
							</div>
						)}
						{(unknown.length > 0 || value.external) && (
							<div className="ac-disclosure ac-unknown-receipts">
								<button
									type="button"
									className="ac-link ac-muted-link"
									aria-expanded={unknownOpen}
									onClick={() => setUnknownPicked(!unknownOpen)}
								>
									{value.external
										? "아직 납부자를 확인하지 않은 입금"
										: "다른 미정산 입금 찾기"}
									<span className="ac-count">{unknown.length}</span>
								</button>
								{unknownOpen && (
									<>
										<p className="ac-caption">
											{value.external
												? "선택한 원입금의 실제 납부자를 확인해 주세요."
												: "다른 이름으로 입금했다면 여기에서 찾을 수 있어요."}
										</p>
										<div className="ac-choice-chips">
											{rows(unknown)}
											{!unknown.length && (
												<p className="ac-empty">
													환불 가능한 미매칭 입금이 없습니다.
												</p>
											)}
										</div>
									</>
								)}
							</div>
						)}
						{selected && (
							<div
								className="ac-refund-selection"
								aria-label="선택한 원입금 상세"
							>
								<p className="ac-caption">
									{[
										`입금 ${won(selected.amount)} · #${selected.id}`,
										selected.used > 0 && `납부 사용 ${won(selected.used)}`,
										selected.refunded > 0 && `기환불 ${won(selected.refunded)}`,
										selected.club > 0 && `클럽 귀속 ${won(selected.club)}`,
									]
										.filter(Boolean)
										.join(" · ")}
								</p>
								{!selected.owners.length && (
									<label className="ac-check">
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
							</div>
						)}
					</div>
				</SettlementField>
			)}
		</div>
	);
}
