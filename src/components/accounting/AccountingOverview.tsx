import { ArrowUpRight, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { billingProgress, overviewBalances } from "../../lib/dues/v2/overview";
import { transactionNeedsSettlement } from "../../lib/dues/v2/quickSettlement";
import { groupSummary, kstMonth, memberLabel } from "../../lib/dues/v2/summary";
import type { AccountingData } from "../../lib/dues/v2/types";
import { fmtMD, won } from "../admin/dues/duesText";
import { readAccountingParticipation } from "../../lib/supabase/accountingV2";
import {
	groupParticipation,
	type AccountingParticipation,
	type BillingPerson,
} from "../../lib/dues/v2/participation";

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
	const groups = useMemo(
		() =>
			data.groups
				.filter((g) => g.occurred_on.startsWith(ym))
				.sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)),
		[data.groups, ym],
	);
	const [participation, setParticipation] = useState<{
		key: string;
		source: AccountingData;
		data: AccountingParticipation;
	} | null>(null);
	const [participationError, setParticipationError] = useState("");
	const [retry, setRetry] = useState(0);
	const sessionKey = groups
		.filter((g) => g.kind === "court" && g.session_id != null)
		.map((g) => g.session_id)
		.sort((a, b) => a! - b!)
		.join(",");
	const contextKey = `${ym}:${sessionKey}:${data.mode.revision}:${retry}`;
	useEffect(() => {
		let disposed = false;
		void readAccountingParticipation(
			sessionKey ? sessionKey.split(",").map(Number) : [],
		)
			.then((result) => {
				if (!disposed) {
					setParticipation({ key: contextKey, source: data, data: result });
					setParticipationError("");
				}
			})
			.catch(() => {
				if (!disposed) setParticipationError(contextKey);
			});
		return () => {
			disposed = true;
		};
	}, [contextKey, sessionKey, data]);
	const context =
		participation?.key === contextKey && participation.source === data
			? participation.data
			: undefined;
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
	const roster = (
		progress: ReturnType<typeof billingProgress>,
		people?: BillingPerson[],
	) => (
		<div className="ac-overview-roster">
			{(
				people ??
				progress.rows.map(
					(payment): BillingPerson => ({
						memberId: payment.charge.member_id,
						state: "charged",
						reason: "",
						payment,
						label:
							payment.remaining === 0
								? "완납"
								: payment.remaining === payment.later
									? "납기 이월"
									: payment.paid > 0
										? "부분 납부"
										: "미납",
					}),
				)
			).map((person) => {
				const r = person.payment;
				const paidDates = [
					...new Set(
						(r?.payments ?? [])
							.map(
								(a) =>
									data.bank.find((t) => t.id === a.bank_tx_id)?.occurred_at,
							)
							.filter((date): date is string => !!date),
					),
				].sort();
				return (
					<div key={person.memberId} className="ac-overview-person">
						<div>
							<strong>{memberLabel(data, person.memberId)}</strong>
							{r && (
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
							)}
							{person.reason && <small>{person.reason}</small>}
						</div>
						<div className="ac-overview-person-amount">
							<span
								className={
									person.state === "excluded"
										? "ac-caption"
										: r?.remaining === 0
											? "ac-in"
											: "ac-overview-amber"
								}
							>
								{person.label}
							</span>
							{r && (
								<strong className="ac-number">
									{won(r.remaining || r.paid)}
								</strong>
							)}
						</div>
					</div>
				);
			})}
			{!(people?.length ?? progress.rows.length) && (
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
				{participationError === contextKey && (
					<div className="ac-overview-context-error" role="alert">
						<p>
							참석·제외 내역을 불러오지 못했습니다. 납부 내역은 아래에서 확인할
							수 있습니다.
						</p>
						<button
							type="button"
							className="ac-link"
							onClick={() => setRetry((n) => n + 1)}
						>
							다시 불러오기
						</button>
					</div>
				)}
				<div className="ac-overview-list">
					{groups
						.filter((g) => g.kind !== "monthly")
						.map((g) => {
							const participation = groupParticipation(data, g, ym, context);
							const progress = participation.progress;
							const summary = groupSummary(data, g);
							const label = g.session_id
								? (sessionLabels.get(g.session_id) ?? g.label)
								: g.label;
							return (
								<div
									key={g.id}
									className="ac-overview-group"
									role="region"
									aria-label={`${label} 부과 현황`}
								>
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
										<div className="ac-overview-headcounts">
											<span>
												{participation.complete ? "전체" : "발행 명단"}{" "}
												<b>{participation.totalCount}명</b>
											</span>
											<span>
												부과 <b>{participation.chargedCount}명</b>
											</span>
											{participation.excludedCount > 0 && (
												<span>
													제외 <b>{participation.excludedCount}명</b>
												</span>
											)}
											{participation.unissuedCount > 0 && (
												<span className="ac-overview-amber">
													미발행 <b>{participation.unissuedCount}명</b>
												</span>
											)}
										</div>
										{participation.exclusions.length > 0 && (
											<p className="ac-overview-exclusions">
												부과 제외 ·{" "}
												{participation.exclusions
													.map((e) => `${e.label} ${e.count}명`)
													.join(" · ")}
											</p>
										)}
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
													progress.remaining > 0 ||
													participation.unissuedCount > 0
														? "ac-overview-amber"
														: "ac-in"
												}
											>
												{progress.remaining > 0
													? `${won(progress.remaining)} 남음`
													: participation.unissuedCount > 0
														? "부과 확인 필요"
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
									{groupOpen === g.id && (
										<>
											{participation.attendance && (
												<p className="ac-overview-attendance ac-caption">
													현재 참석 기록 · 참석 확정{" "}
													{participation.attendance.attendCount}명
													{participation.attendance.targetDayCancelCount > 0 &&
														` · 당일취소 부과 ${participation.attendance.targetDayCancelCount}명`}
													{participation.attendance.boardAddedCount > 0 &&
														` · 보드 추가 ${participation.attendance.boardAddedCount}명`}
													{participation.attendance.mode === "split" &&
														" · 엔빵은 운영진 포함"}
												</p>
											)}
											{g.kind === "court" && !participation.complete && (
												<p className="ac-overview-attendance ac-caption">
													{context || participationError === contextKey
														? "참석 기록을 확인할 수 없어 발행 명단만 표시합니다."
														: "참석·제외 인원을 확인 중입니다."}
												</p>
											)}
											{roster(progress, participation.rows)}
										</>
									)}
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
