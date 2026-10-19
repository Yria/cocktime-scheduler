import { ChevronRight, Pencil, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fmtMD, won } from "../../lib/dues/duesText";
import { billingProgress } from "../../lib/dues/overview";
import {
	type AccountingParticipation,
	type BillingPerson,
	groupParticipation,
} from "../../lib/dues/participation";
import { TARGET_LABEL } from "../../lib/dues/sessionSettle";
import { splitDrift, splitPerHead } from "../../lib/dues/splitDrift";
import { groupSummary, memberLabel } from "../../lib/dues/summary";
import type { AccountingData } from "../../lib/dues/types";
import { readAccountingParticipation } from "../../lib/supabase/dues";
import AccountingDetailModal from "./AccountingDetailModal";
import AttendanceTimeline from "./AttendanceTimeline";
import { RosterRow, RosterSection } from "./ChargeRoster";
import ChargeVoucher from "./ChargeVoucher";
import type { OperationDraft } from "./OperationDialog";
import { useAttendanceLog } from "./useAttendanceLog";
import { useRespreadPrompt } from "./useRespreadPrompt";

/** 대관 명단 모달 위의 시간별 확정 인원 그래프(참석 변경 기록은 열 때 한 번 읽는다). */
function GroupTimeline({
	data,
	sessionId,
}: {
	data: AccountingData;
	sessionId: number;
}) {
	const { log, error } = useAttendanceLog(sessionId, true);
	if (error) return <p className="ac-tl-empty">{error}</p>;
	if (!log) return <p className="ac-tl-empty">참석 기록 불러오는 중…</p>;
	return (
		<AttendanceTimeline log={log} nameOf={(id) => memberLabel(data, id)} />
	);
}

const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);

/**
 * 엔빵 회차의 "총액 ÷ 인원 = 1인 금액". 인원은 카드의 '부과 N명'과 **같은 값**(지금 유효한 부과 수)이고,
 * 1인 금액은 그 인원으로 서버 규칙(10원 절상·정액 근처 스냅)을 다시 계산한다. 발행 당시 기준
 * (basis.head·per_head)은 부과를 취소해도 그대로라 화면 숫자끼리 어긋난다(세션 395: ÷17 vs 부과 16명).
 * 아직 발행 전이면 참석 기록의 대상 수로 보여 준다.
 */
function splitFormula(
	basis: Record<string, unknown>,
	settle:
		| { mode: string; total: number | null; targetCount: number }
		| undefined,
	charged: number,
	flatFee: number | null,
): { total: number; head: number; perHead: number; snapped: boolean } | null {
	const split = settle?.mode === "split" ? settle : undefined;
	const total = num(basis.total) ?? num(split?.total);
	const head = charged || num(split?.targetCount);
	if (!total || !head) return null;
	const perHead = splitPerHead(total, head, flatFee);
	return {
		total,
		head,
		perHead,
		snapped: perHead !== Math.ceil(total / head / 10) * 10,
	};
}

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
	disabled,
	onDone,
	onPendingChange,
}: {
	data: AccountingData;
	ym: string;
	sessionLabels: Map<number, string>;
	onNavigate: (page: "inbox" | "charge" | "ledger") => void;
	disabled: boolean;
	onDone: () => Promise<void>;
	onPendingChange: (pending: boolean) => void;
}) {
	const [feeOpen, setFeeOpen] = useState(false);
	const [groupOpen, setGroupOpen] = useState<string | null>(null);
	// 명단 모달 안에서 한 사람 부과를 고치는 흐름: 행의 [변경] → 처리 선택 → 같은 모달에서 전표.
	const [picked, setPicked] = useState<string | null>(null);
	const [voucher, setVoucher] = useState<OperationDraft | null>(null);
	const respread = useRespreadPrompt(data);
	const openVoucher = (draft: OperationDraft) => {
		respread.watch(draft);
		setVoucher(draft);
	};
	const closeDetail = () => {
		setPicked(null);
		setVoucher(null);
	};
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
	// 명단은 앱의 참가자 명단(SessionParticipantsModal)과 같은 문법으로 그린다 —
	// 상태별 섹션 머리 + 아바타 한 줄 행. 섹션 머리가 상태를 말하므로 행마다 같은
	// 상태어 알약을 되풀이하지 않고, 섹션과 다른 상태어(부분 납부·납기 이월·미납 면제 …)만 보인다.
	const roster = (
		progress: ReturnType<typeof billingProgress>,
		people?: BillingPerson[],
		inviters?: Map<string, string>,
	) => {
		const list =
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
			);
		const sections: {
			title: string;
			tone: string;
			rank: number;
			rows: BillingPerson[];
		}[] = [];
		for (const person of list) {
			const [title, tone, rank]: [string, string, number] =
				person.state === "excluded"
					? ["부과 제외", "", 3]
					: person.state === "unissued"
						? [person.label, "is-ask", 1]
						: person.payment?.remaining
							? ["납부 전", "is-ask", 0]
							: ["완납", "is-ok", 2];
			const section = sections.find((s) => s.title === title);
			if (section) section.rows.push(person);
			else sections.push({ title, tone, rank, rows: [person] });
		}
		sections.sort((a, b) => a.rank - b.rank);
		return (
			<div className="ac-overview-roster">
				{sections.map((section) => (
					<RosterSection
						key={section.title}
						title={section.title}
						tone={section.tone}
						count={section.rows.length}
					>
						{section.rows.map((person) => {
							const r = person.payment;
							const member = data.members.find((m) => m.id === person.memberId);
							const name = memberLabel(data, person.memberId).split(" · ")[0];
							const paidDates = [
								...new Set(
									(r?.payments ?? [])
										.map(
											(a) =>
												data.bank.find((t) => t.id === a.bank_tx_id)
													?.occurred_at,
										)
										.filter((date): date is string => !!date),
								),
							].sort();
							// '참석 확정'은 종료 후 부과 대상의 기본 사유라 행마다 되풀이하지 않는다
							// (머리글의 참석 기록 요약이 인원을 센다). 당일취소·보드 참가만 보인다.
							const reason =
								person.reason === TARGET_LABEL.attending ? "" : person.reason;
							const inviter = inviters?.get(person.memberId);
							const guestNote = member?.guest
								? inviter
									? `${memberLabel(data, inviter).split(" · ")[0]} 님이 데려온 게스트`
									: "게스트 · 초대한 회원 기록 없음"
								: "";
							const charge = r?.charge;
							const editable = !!charge && charge.state === "live";
							const note = r
								? r.remaining > 0
									? r.due
											.map(
												(d) =>
													`${d.due_ym.slice(0, 4)}년 ${Number(d.due_ym.slice(5))}월 납기 · ${won(d.remaining)}`,
											)
											.join(" / ")
									: paidDates.length
										? `${paidDates.map(fmtMD).join(", ")} 입금으로 납부`
										: "납부 완료"
								: "";
							return (
								<RosterRow
									key={person.memberId}
									data={data}
									memberId={person.memberId}
									label={person.label}
									tone={
										person.state === "excluded"
											? ""
											: r?.remaining === 0
												? "is-ok"
												: "is-ask"
									}
									// 섹션 머리와 같은 상태어는 화면에서 감추되 DOM 에는 남겨 보조기기·e2e 에 전한다.
									echo={
										person.label === section.title ||
										(section.title === "납부 전" && person.label === "미납")
									}
									notes={[note, reason, guestNote]}
									amount={r ? won(r.remaining || r.paid) : undefined}
									settled={!!r && r.remaining === 0}
									trailing={
										editable && (
											<button
												type="button"
												className="ac-link ac-roster-edit"
												aria-expanded={picked === charge.id}
												aria-label={`${name} 부과 변경`}
												disabled={disabled}
												onClick={() =>
													setPicked(picked === charge.id ? null : charge.id)
												}
											>
												변경
											</button>
										)
									}
								>
									{editable && picked === charge.id && (
										<div
											className="ac-member-charge-actions ac-roster-actions"
											role="group"
											aria-label={`${name} 부과 처리`}
										>
											<button
												type="button"
												disabled={disabled}
												onClick={() =>
													openVoucher({
														type: "replace",
														chargeIds: [charge.id],
													})
												}
											>
												<Pencil size={16} aria-hidden="true" />
												금액 변경
											</button>
											<button
												type="button"
												className="is-stop"
												disabled={disabled}
												onClick={() =>
													openVoucher({
														type: "replace",
														chargeIds: [charge.id],
														cancelOnly: true,
													})
												}
											>
												<XCircle size={16} aria-hidden="true" />
												부과 취소
											</button>
										</div>
									)}
								</RosterRow>
							);
						})}
					</RosterSection>
				))}
				{!list.length && (
					<p className="ac-overview-empty">발행된 부과가 없습니다.</p>
				)}
			</div>
		);
	};
	const voucherView = () =>
		voucher && (
			<ChargeVoucher
				key={JSON.stringify(voucher)}
				draft={voucher}
				data={data}
				viewYm={ym}
				onClose={(saved) => {
					closeDetail();
					if (saved) respread.saved();
				}}
				onDone={onDone}
				onPendingChange={onPendingChange}
			/>
		);
	const inviterMap = (sessionId: number | null) => {
		const session = context?.sessions.find((s) => s.id === sessionId);
		return new Map(
			(session?.attendances ?? []).flatMap((a) =>
				a.invitedBy ? [[a.memberId, a.invitedBy] as const] : [],
			),
		);
	};
	return (
		<div className="ac-overview" aria-label="월별 납부 현황" role="region">
			{respread.dialog}
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
						onClose={() => {
							setFeeOpen(false);
							closeDetail();
						}}
					>
						{voucher ? voucherView() : roster(fee)}
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
							const missingCount =
								participation.unissuedCount - participation.pendingCount;
							const summary = groupSummary(data, g);
							const label = g.session_id
								? (sessionLabels.get(g.session_id) ?? g.label)
								: g.label;
							const open = groupOpen === g.id;
							// 정액 맞춤 판정에 정액 기본값이 필요해 참석 기록(context)을 읽은 뒤에만 본다.
							const drift = context
								? splitDrift(g, data.charges, context.flatFee)
								: null;
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
											{participation.pendingCount > 0 && (
												<span>
													예정 <b>{participation.pendingCount}명</b>
												</span>
											)}
											{missingCount > 0 && (
												<span className="ac-overview-amber">
													미발행 <b>{missingCount}명</b>
												</span>
											)}
										</span>
									</div>

									{g.kind === "court" &&
										(() => {
											const f = splitFormula(
												g.basis,
												participation.attendance,
												participation.chargedCount,
												context?.flatFee ?? null,
											);
											if (drift)
												return (
													<div className="ac-overview-drift" role="alert">
														<p>
															<strong>엔빵 재분배 필요</strong> · 부과 인원이{" "}
															{drift.issuedHead !== null
																? `${drift.issuedHead}명 → `
																: ""}
															{drift.head}명으로 바뀌었습니다.
														</p>
														<p>
															대관 {won(drift.total)} ÷ {drift.head}명 ={" "}
															<strong>1인 {won(drift.perHead)}</strong> · 지금{" "}
															{drift.charged.map(won).join("/")}씩 부과되어{" "}
															{drift.shortfall >= 0
																? `${won(drift.shortfall)} 덜 걷힘`
																: `${won(-drift.shortfall)} 더 걷힘`}
														</p>
													</div>
												);
											if (!f) return null;
											return (
												<p className="ac-overview-footnote ac-overview-split">
													엔빵 · 대관 {won(f.total)} ÷ {f.head}명 ={" "}
													<strong>1인 {won(f.perHead)}</strong>
													{f.snapped && " (정액에 맞춤)"}
												</p>
											);
										})()}
									<div className="ac-overview-group-meta">
										<span>
											{progress.rows.length
												? `${progress.paidCount}/${progress.rows.length}명 납부`
												: "부과 없음"}
										</span>
										<strong
											className={
												progress.remaining > 0 || missingCount > 0 || drift
													? "ac-overview-amber"
													: participation.pendingCount > 0
														? ""
														: "ac-in"
											}
										>
											{drift
												? "재분배 필요"
												: progress.remaining > 0
													? `${won(progress.remaining)} 남음`
													: missingCount > 0
														? "부과 확인 필요"
														: participation.pendingCount > 0
															? "종료 후 부과"
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
											onClose={() => {
												setGroupOpen(null);
												closeDetail();
											}}
										>
											{voucher ? (
												voucherView()
											) : (
												<>
													{/* 명단의 근거(참석 기록)와 제외 사유를 한 장의 요약 면으로 묶는다. */}
													{(participation.attendance ||
														participation.exclusions.length > 0 ||
														(g.kind === "court" &&
															!participation.complete)) && (
														<dl className="ac-roster-facts">
															{participation.attendance && (
																<div className="ac-overview-attendance">
																	<dt>참석 기록</dt>
																	<dd>
																		참석 확정{" "}
																		{participation.attendance.attendCount}명
																		{participation.attendance
																			.targetDayCancelCount > 0 &&
																			` · 당일취소 부과 ${participation.attendance.targetDayCancelCount}명`}
																		{participation.attendance.boardAddedCount >
																			0 &&
																			` · 보드 추가 ${participation.attendance.boardAddedCount}명`}
																		{participation.attendance.mode ===
																			"split" && " · 엔빵은 운영진 포함"}
																	</dd>
																</div>
															)}
															{participation.exclusions.length > 0 && (
																<div className="ac-overview-exclusions">
																	<dt>부과 제외</dt>
																	<dd>
																		{participation.exclusions
																			.map((e) => `${e.label} ${e.count}명`)
																			.join(" · ")}
																	</dd>
																</div>
															)}
															{g.kind === "court" &&
																!participation.complete && (
																	<div className="ac-overview-attendance is-wide">
																		<dd>
																			{context ||
																			participationError === contextKey
																				? "참석 기록을 확인할 수 없어 발행 명단만 표시합니다."
																				: "참석·제외 인원을 확인 중입니다."}
																		</dd>
																	</div>
																)}
														</dl>
													)}
													{g.kind === "court" && g.session_id != null && (
														<GroupTimeline
															data={data}
															sessionId={g.session_id}
														/>
													)}
													{roster(
														progress,
														participation.rows,
														inviterMap(g.session_id),
													)}
												</>
											)}
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
