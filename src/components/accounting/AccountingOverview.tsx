import { ChevronRight } from "lucide-react";
import AccountingDetailModal from "./AccountingDetailModal";
import { useEffect, useMemo, useState } from "react";
import { billingProgress } from "../../lib/dues/v2/overview";
import { groupSummary, memberLabel } from "../../lib/dues/v2/summary";
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
	// 미터 옆에 수치와 분모를 병기한다 — 채움 길이만으로는 인원/금액 어느 기준인지
	// 알 수 없어 '1 / 4명'과 62%가 같은 카드에서 서로 다른 진실처럼 보였다.
	return (
		<div className="ac-meter-line">
			<div
				className="ac-meter"
				role="progressbar"
				aria-label={label}
				aria-valuenow={percent}
				aria-valuemin={0}
				aria-valuemax={100}
			>
				<span style={{ width: `${percent}%` }} />
			</div>
			<strong className="ac-number">
				완납{" "}
				<span>
					{paid} / {total}명
				</span>
			</strong>
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
	const drafts = data.drafts.length;
	const month = `${Number(ym.slice(5))}월`;
	// 납기 이월 인원은 독촉 대상이 아니다 — '납부 전'으로 뭉쳐 세던 것을 나눈다.
	const deferred = fee.rows.filter(
		(r) => r.remaining > 0 && r.remaining === r.later,
	).length;
	const unpaidPeople = fee.rows.filter(
		(r) => r.remaining > 0 && r.remaining !== r.later,
	).length;
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
				const done = person.state !== "excluded" && r?.remaining === 0;
				const tone =
					person.state === "excluded" ? "" : done ? "is-ok" : "is-ask";
				return (
					<div key={person.memberId} className="ac-row">
						<span className={`ac-row-gutter ${tone}`} aria-hidden="true">
							{person.state === "excluded" ? "—" : done ? "✓" : "?"}
						</span>
						<span className="ac-row-body">
							<strong>{memberLabel(data, person.memberId)}</strong>
							<span className={`ac-row-state ${tone}`}>{person.label}</span>
							{r && (
								<span className="ac-row-note">
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
								</span>
							)}
							{person.reason && (
								<span className="ac-row-note">{person.reason}</span>
							)}
						</span>
						{r ? (
							<strong className="ac-amount">
								{won(r.remaining || r.paid)}
							</strong>
						) : (
							<span className="ac-amount" aria-hidden="true">
								—
							</span>
						)}
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
			{drafts > 0 && (
				<div className="ac-notice is-ask">
					<span aria-hidden="true">?</span>
					<div>
						발행 검토 대기 <strong>{drafts}건</strong>
						<button
							type="button"
							className="ac-link"
							onClick={() => onNavigate("charge")}
						>
							부과 탭에서 확인 <ChevronRight size={14} aria-hidden="true" />
						</button>
					</div>
				</div>
			)}
			<section
				className="ac-card ac-status-card"
				aria-label={`${month} 회비 현황`}
			>
				<div className="ac-overview-heading">
					<div>
						<h2>{month} 회비</h2>
						<p className="ac-caption">
							{ym.slice(0, 4)}년 {month} · 부과 {fee.rows.length}명
						</p>
					</div>
					<span
						className={`ac-badge ${!fee.rows.length ? "is-neutral" : unpaidPeople > 0 ? "is-amber" : deferred > 0 ? "is-neutral" : "is-green"}`}
					>
						{!fee.rows.length
							? "부과 없음"
							: unpaidPeople > 0
								? `미납 ${unpaidPeople}명`
								: deferred > 0
									? `납기 이월 ${deferred}명`
									: "모두 납부"}
					</span>
				</div>
				<Progress
					paid={fee.paidCount}
					total={fee.rows.length}
					label={`${month} 회비 완납 인원`}
				/>

				<p className="ac-caption">
					부과 {won(fee.total)} · 납부 {won(fee.paid)} · 남은 회비{" "}
					{won(fee.remaining)}
					{fee.later > 0 && ` (다음 달 이후 ${won(fee.later)})`}
				</p>
				{fee.rows.length > 0 && (
					<button
						className="ac-chip ac-status-detail"
						type="button"
						aria-label="납부 명단"
						aria-haspopup="dialog"
						onClick={() => setFeeOpen(true)}
					>
						자세히 보기 <ChevronRight size={15} aria-hidden="true" />
					</button>
				)}
				{feeOpen && (
					<AccountingDetailModal
						title={`${month} 회비 납부 명단`}
						subtitle={`부과 ${fee.rows.length}명 · 완납 ${fee.paidCount}명 · 미납 ${unpaidPeople}명 · 납기 이월 ${deferred}명`}
						onClose={() => setFeeOpen(false)}
					>
						{roster(fee)}
					</AccountingDetailModal>
				)}
			</section>
			<section className="ac-overview-section" aria-label="대관·모임 현황">
				<div className="ac-overview-heading">
					<h2>대관·모임</h2>
					<span>{groups.filter((g) => g.kind !== "monthly").length}건</span>
				</div>
				{participationError === contextKey && (
					<div className="ac-notice is-stop" role="alert">
						<span aria-hidden="true">!</span>
						<span>
							참석·제외 내역을 불러오지 못했습니다. 납부 내역은 아래에서 확인할
							수 있습니다.{" "}
							<button
								type="button"
								className="ac-link"
								onClick={() => setRetry((n) => n + 1)}
							>
								다시 불러오기
							</button>
						</span>
					</div>
				)}
				<div className="ac-status-list">
					{groups
						.filter((g) => g.kind !== "monthly")
						.map((g) => {
							const participation = groupParticipation(data, g, ym, context);
							const progress = participation.progress;
							const summary = groupSummary(data, g);
							const label = g.session_id
								? (sessionLabels.get(g.session_id) ?? g.label)
								: g.label;
							const open = groupOpen === g.id;
							return (
								<div
									key={g.id}
									className="ac-card ac-status-card"
									role="region"
									aria-label={`${label} 부과 현황`}
								>
									{/* 세부 명단은 모달에서 확인하고 현황 카드의 높이는 유지한다. */}
									<div className="ac-overview-group-toggle">
										<span className="ac-overview-group-title">
											<span className="ac-overview-kind">
												{g.kind === "court" ? "대관" : "모임"}
											</span>
											<strong>{label}</strong>
										</span>
										<span className="ac-overview-headcounts">
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
										</span>
									</div>

									<div className="ac-overview-group-meta">
										<span>
											{progress.rows.length
												? `${progress.paidCount}/${progress.rows.length}명 납부`
												: "부과 없음"}
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
											paid={progress.paidCount}
											total={progress.rows.length}
											label={`${label} 납부율`}
										/>
									)}

									{/* 대관비 대조의 핵심 신호. 문장 뒤 중점에 붙어 있던 것을
									    자기 행으로 올린다. */}
									{g.kind === "court" && (
										<p
											className={`ac-row-state ${summary.spent > 0 ? "is-ok" : "is-stop"}`}
										>
											<span aria-hidden="true">
												{summary.spent > 0 ? "✓ " : "! "}
											</span>
											{summary.spent > 0
												? "지출 연결됨"
												: "지출 미연결 — 통장 출금과 연결되지 않았습니다"}
										</p>
									)}
									{!progress.rows.length && (
										<p className="ac-overview-footnote">
											직접 수입 {won(summary.direct)} · 지출{" "}
											{won(summary.spent)}
										</p>
									)}
									<button
										type="button"
										className="ac-chip ac-status-detail"
										aria-label={`${label} 부과 현황 자세히 보기`}
										aria-haspopup="dialog"
										onClick={() => setGroupOpen(g.id)}
									>
										자세히 보기 <ChevronRight size={15} aria-hidden="true" />
									</button>
									{open && (
										<AccountingDetailModal
											title={`${label} 부과 명단`}
											subtitle={`${participation.complete ? "전체" : "발행 명단"} ${participation.totalCount}명 · 부과 ${participation.chargedCount}명 · 제외 ${participation.excludedCount}명`}
											onClose={() => setGroupOpen(null)}
										>
											{participation.exclusions.length > 0 && (
												<p className="ac-overview-exclusions">
													부과 제외 ·{" "}
													{participation.exclusions
														.map((e) => `${e.label} ${e.count}명`)
														.join(" · ")}
												</p>
											)}
											{participation.attendance && (
												<p className="ac-overview-attendance">
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
												<p className="ac-overview-attendance">
													{context || participationError === contextKey
														? "참석 기록을 확인할 수 없어 발행 명단만 표시합니다."
														: "참석·제외 인원을 확인 중입니다."}
												</p>
											)}
											{roster(progress, participation.rows)}
										</AccountingDetailModal>
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
		</div>
	);
}
