import {
	ArrowUpRight,
	Check,
	ChevronDown,
	ChevronRight,
	Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { billingProgress, overviewBalances } from "../../lib/dues/v2/overview";
import { transactionNeedsSettlement } from "../../lib/dues/v2/quickSettlement";
import { groupSummary, kstMonth, memberLabel } from "../../lib/dues/v2/summary";
import type { AccountingData } from "../../lib/dues/v2/types";
import { fmtMD, won } from "../admin/dues/duesText";
import { nameMatches } from "../admin/dues/matching";

function Progress({
	paid,
	total,
	label,
}: {
	paid: number;
	total: number;
	label: string;
}) {
	const percent =
		total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
	return (
		<div
			className={`ac-overview-meter ${total > 0 && paid >= total ? "is-complete" : ""}`}
			role="progressbar"
			aria-label={label}
			aria-valuenow={percent}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			<span style={{ width: `${percent}%` }} />
		</div>
	);
}

export default function AccountingOverview({
	data,
	ym,
	sessionLabels,
	onNavigate,
}: {
	data: AccountingData;
	ym: string;
	sessionLabels: Map<number, string>;
	onNavigate: (page: "inbox" | "charge" | "ledger") => void;
}) {
	const [feeOpen, setFeeOpen] = useState(false);
	const [groupOpen, setGroupOpen] = useState<string | null>(null);
	const [unpaidOpen, setUnpaidOpen] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [unpaidLimit, setUnpaidLimit] = useState(5);
	const groups = useMemo(
		() =>
			data.groups
				.filter((g) => g.occurred_on.startsWith(ym))
				.sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)),
		[data.groups, ym],
	);
	const fee = useMemo(
		() =>
			billingProgress(
				data,
				groups.filter((g) => g.kind === "monthly"),
				ym,
			),
		[data, groups, ym],
	);
	const balances = useMemo(() => overviewBalances(data, ym), [data, ym]);
	const pending = data.bank.filter(
		(t) =>
			kstMonth(t.occurred_at) === ym && transactionNeedsSettlement(data, t.id),
	).length;
	const drafts = data.drafts.filter((d) =>
		String(d.payload.ym ?? d.payload.date ?? "").startsWith(ym),
	).length;
	const month = `${Number(ym.slice(5))}월`;
	const unpaid = balances.unpaid.filter((m) =>
		nameMatches(memberLabel(data, m.id), query),
	);
	const roster = (progress: ReturnType<typeof billingProgress>) => (
		<div className="ac-overview-roster">
			{progress.rows.map((r) => {
				const paidDates = [
					...new Set(
						r.payments
							.map(
								(a) =>
									data.bank.find((t) => t.id === a.bank_tx_id)?.occurred_at,
							)
							.filter((date): date is string => !!date),
					),
				].sort();
				return (
					<div key={r.charge.id} className="ac-overview-person">
						<div>
							<strong>{memberLabel(data, r.charge.member_id)}</strong>
							<small>
								{r.remaining > 0
									? r.due
											.map(
												(d) =>
													`${d.due_ym.slice(0, 4)}년 ${Number(d.due_ym.slice(5))}월 납기 · ${won(d.remaining)}`,
											)
											.join(" / ")
									: paidDates.length
										? `${paidDates.map(fmtMD).join(", ")} 입금으로 납부`
										: "납부 완료"}
							</small>
						</div>
						<div className="ac-overview-person-amount">
							<span
								className={r.remaining === 0 ? "ac-in" : "ac-overview-amber"}
							>
								{r.remaining === 0
									? "완납"
									: r.remaining === r.later
										? "납기 이월"
										: r.paid > 0
											? "부분 납부"
											: "미납"}
							</span>
							<strong className="ac-number">
								{won(r.remaining || r.paid)}
							</strong>
						</div>
					</div>
				);
			})}
			{!progress.rows.length && (
				<p className="ac-overview-empty">발행된 부과가 없습니다.</p>
			)}
		</div>
	);
	return (
		<div className="ac-overview" aria-label="월별 납부 현황" role="region">
			<section className="ac-overview-fee" aria-label={`${month} 회비 현황`}>
				<div className="ac-overview-heading">
					<h2>{month} 회비</h2>
					<span
						className={`ac-overview-status ${fee.rows.length && !fee.remaining ? "is-complete" : ""}`}
					>
						{fee.rows.length ? (
							fee.remaining > 0 ? (
								`${fee.rows.length - fee.paidCount}명 납부 전`
							) : (
								<>
									<Check size={12} /> 모두 납부
								</>
							)
						) : (
							"부과 없음"
						)}
					</span>
				</div>
				<div className="ac-overview-fee-number">
					<strong>
						{fee.paidCount}
						<span> / {fee.rows.length}명</span>
					</strong>
					<span>납부 완료</span>
				</div>
				<Progress
					paid={fee.paid}
					total={fee.total}
					label={`${month} 회비 납부율`}
				/>
				<dl className="ac-overview-fee-totals">
					<div>
						<dt>부과액</dt>
						<dd>{won(fee.total)}</dd>
					</div>
					<div>
						<dt>납부액</dt>
						<dd>{won(fee.paid)}</dd>
					</div>
					<div>
						<dt>남은 회비</dt>
						<dd className={fee.remaining > 0 ? "ac-overview-amber" : ""}>
							{won(fee.remaining)}
						</dd>
					</div>
				</dl>
				{fee.later > 0 && (
					<p className="ac-overview-footnote">
						남은 회비 중 {won(fee.later)}은 다음 달 이후 납기입니다.
					</p>
				)}
				{fee.rows.length ? (
					<button
						className="ac-overview-expand"
						type="button"
						aria-expanded={feeOpen}
						onClick={() => setFeeOpen(!feeOpen)}
					>
						납부 명단 <ChevronDown size={15} />
					</button>
				) : (
					<p className="ac-overview-empty">이 달에 발행된 회비가 없습니다.</p>
				)}
				{feeOpen && roster(fee)}
			</section>
			<button
				type="button"
				className="ac-overview-inbox"
				onClick={() => onNavigate("inbox")}
			>
				<span>
					<span className="ac-overview-dot" />
					정산할 거래 <strong>{pending}건</strong>
				</span>
				<span>
					정산함 <ChevronRight size={15} />
				</span>
			</button>
			{drafts > 0 && (
				<button
					type="button"
					className="ac-overview-drafts"
					onClick={() => onNavigate("charge")}
				>
					<span>
						발행 검토 대기 <strong>{drafts}건</strong>
					</span>
					<ChevronRight size={15} />
				</button>
			)}
			<section className="ac-overview-section" aria-label="대관·모임 현황">
				<div className="ac-overview-heading">
					<h2>대관·모임</h2>
					<span>
						{groups.filter((g) => g.kind !== "monthly").length}개 항목
					</span>
				</div>
				<div className="ac-overview-list">
					{groups
						.filter((g) => g.kind !== "monthly")
						.map((g) => {
							const progress = billingProgress(data, [g], ym);
							const summary = groupSummary(data, g);
							const label = g.session_id
								? (sessionLabels.get(g.session_id) ?? g.label)
								: g.label;
							return (
								<div key={g.id} className="ac-overview-group">
									<button
										type="button"
										className="ac-overview-group-toggle"
										aria-expanded={groupOpen === g.id}
										onClick={() =>
											setGroupOpen(groupOpen === g.id ? null : g.id)
										}
									>
										<div className="ac-overview-group-title">
											<span className="ac-overview-kind">
												{g.kind === "court" ? "대관" : "모임"}
											</span>
											<strong>{label}</strong>
											<ChevronDown size={15} />
										</div>
										<div className="ac-overview-group-meta">
											<span>
												{progress.rows.length
													? `${progress.paidCount}/${progress.rows.length}명 납부`
													: "부과 없음"}
												{g.kind === "court" &&
													(summary.spent > 0
														? " · 지출 연결됨"
														: " · 지출 미연결")}
											</span>
											<strong
												className={
													progress.remaining > 0 ? "ac-overview-amber" : "ac-in"
												}
											>
												{progress.remaining > 0
													? `${won(progress.remaining)} 남음`
													: progress.rows.length
														? "납부 완료"
														: ""}
											</strong>
										</div>
										{progress.rows.length > 0 && (
											<Progress
												paid={progress.paid}
												total={progress.total}
												label={`${label} 납부율`}
											/>
										)}
										{!progress.rows.length && (
											<p className="ac-overview-footnote">
												직접 수입 {won(summary.direct)} · 지출{" "}
												{won(summary.spent)}
											</p>
										)}
									</button>
									{groupOpen === g.id && roster(progress)}
								</div>
							);
						})}
				</div>
				{!groups.some((g) => g.kind !== "monthly") && (
					<p className="ac-overview-empty">
						이 달의 대관·모임 내역이 없습니다.
					</p>
				)}
			</section>
			<section className="ac-overview-section" aria-label="미납 현황">
				<div className="ac-overview-heading">
					<h2>
						남은 미납 <span>{balances.unpaid.length}명</span>
					</h2>
					<strong className="ac-number">{won(balances.outstanding)}</strong>
				</div>
				<p className="ac-overview-footnote">
					{month}까지 납기가 도래한 금액 · 이전 달 미납 포함
				</p>
				{balances.unpaid.length > 0 && (
					<>
						<div className="ac-search ac-overview-search">
							<Search size={15} />
							<input
								aria-label="미납 회원 검색"
								placeholder="이름으로 찾기"
								value={query}
								onChange={(e) => {
									setQuery(e.target.value);
									setUnpaidLimit(5);
								}}
							/>
						</div>
						<div className="ac-overview-list">
							{unpaid.slice(0, unpaidLimit).map((m) => (
								<div key={m.id} className="ac-overview-unpaid">
									<button
										type="button"
										aria-expanded={unpaidOpen === m.id}
										onClick={() =>
											setUnpaidOpen(unpaidOpen === m.id ? null : m.id)
										}
									>
										<span>{memberLabel(data, m.id)}</span>
										<strong className="ac-number">{won(m.amount)}</strong>
										<ChevronDown size={14} />
									</button>
									{unpaidOpen === m.id && (
										<div className="ac-overview-unpaid-lines">
											{m.lines.map((l, i) => (
												<div key={`${l.label}-${l.ym}-${i}`}>
													<span>
														{l.label}
														<small>{l.ym} 납기</small>
													</span>
													<span className="ac-number">{won(l.amount)}</span>
												</div>
											))}
										</div>
									)}
								</div>
							))}
						</div>
						{unpaid.length > unpaidLimit && (
							<button
								type="button"
								className="ac-overview-expand"
								onClick={() => setUnpaidLimit(unpaidLimit + 10)}
							>
								미납 회원 더 보기 ({unpaid.length - unpaidLimit}명)
								<ChevronDown size={14} />
							</button>
						)}
						{!unpaid.length && (
							<p className="ac-overview-empty">검색된 미납 회원이 없습니다.</p>
						)}
					</>
				)}
				{!balances.unpaid.length && (
					<p className="ac-overview-empty">
						<Check size={15} /> 이 달까지 남은 미납이 없습니다.
					</p>
				)}
			</section>
			<section className="ac-overview-section" aria-label="이월 현황">
				<div className="ac-overview-heading">
					<h2>이월 현황</h2>
					<ArrowUpRight size={16} />
				</div>
				<div className="ac-overview-carry">
					<div>
						<span>다음 달 이후 낼 돈</span>
						<strong className="ac-number">{won(balances.futureDue)}</strong>
						<small>이 달까지 발생한 부과 중</small>
					</div>
					<div>
						<span>보관 중인 이월 입금</span>
						<strong className="ac-number">{won(balances.carryCash)}</strong>
						<small>이 달까지 받은 입금 중</small>
					</div>
				</div>
				{balances.carry.length > 0 && (
					<details className="ac-overview-carry-detail">
						<summary>
							이월 입금 내역 <ChevronDown size={14} />
						</summary>
						{balances.carry.map((p) => (
							<div className="ac-overview-person" key={p.id}>
								<div>
									<strong>{memberLabel(data, p.owner_id)}</strong>
									<small>
										{p.available_ym}부터 사용 ·{" "}
										{fmtMD(
											data.bank.find((t) => t.id === p.bank_tx_id)!.occurred_at,
										)}{" "}
										입금
									</small>
								</div>
								<strong className="ac-number">{won(p.amount)}</strong>
							</div>
						))}
					</details>
				)}
			</section>
		</div>
	);
}
