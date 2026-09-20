import { useState } from "react";
import {
	CalendarDays,
	ChevronRight,
	ClipboardList,
	Plus,
	Users,
} from "lucide-react";
import { isReversedPrepayment } from "../../lib/dues/chargeState";
import { holdReasonLabel, won } from "../../lib/dues/duesText";
import { sessionChoiceLabels } from "../../lib/dues/selection";
import { groupSummary, memberLabel } from "../../lib/dues/summary";
import type { AccountingData, BillingGroup } from "../../lib/dues/types";
import type { accountingSessions } from "../../lib/supabase/dues";
import type { OperationDraft } from "./OperationDialog";
import "./charge-management.css";

const kinds = { monthly: "회비", court: "대관", manual: "수동" };

export default function ChargeManagement({
	data,
	ym,
	sessions,
	sessionsError,
	onRetrySessions,
	disabled,
	manualDirty,
	onManual,
	onDraft,
	onCandidate,
}: {
	data: AccountingData;
	ym: string;
	sessions: Awaited<ReturnType<typeof accountingSessions>> | null;
	sessionsError: string;
	onRetrySessions: () => void;
	disabled: boolean;
	manualDirty: boolean;
	onManual: () => void;
	onDraft: (draft: OperationDraft) => void;
	onCandidate: (
		kind: "monthly" | "court",
		sid?: number,
		period?: string,
	) => Promise<void>;
}) {
	const [courtOpen, setCourtOpen] = useState(false);
	const [sessionId, setSessionId] = useState("");
	const [filter, setFilter] = useState<"all" | BillingGroup["kind"]>("all");
	const [expanded, setExpanded] = useState<string | null>(null);
	const labels = sessionChoiceLabels(sessions ?? []);
	const monthGroups = data.groups.filter((g) => g.occurred_on.startsWith(ym));
	const issued = monthGroups.filter((g) =>
		data.charges.some((c) => c.group_id === g.id),
	);
	const accountOnly = monthGroups.filter(
		(g) => !data.charges.some((c) => c.group_id === g.id),
	);
	const shown = issued
		.filter((g) => filter === "all" || g.kind === filter)
		.sort(
			(a, b) =>
				b.occurred_on.localeCompare(a.occurred_on) ||
				a.label.localeCompare(b.label),
		);
	const courtSessions = (sessions ?? []).filter((s) => s.court);
	return (
		<div className="ac-charge-management">
			<section aria-label="새 부과" className="ac-charge-start">
				<button
					type="button"
					disabled={disabled}
					onClick={() => void onCandidate("monthly")}
					aria-label="회비 부과"
				>
					<Users size={20} aria-hidden="true" />
					<strong>회비 부과</strong>
					<span>{Number(ym.slice(5))}월 대상 확인</span>
				</button>
				<button
					type="button"
					disabled={disabled}
					onClick={() => setCourtOpen((open) => !open)}
					aria-expanded={courtOpen}
					aria-controls="charge-court-picker"
					aria-label="대관 부과"
				>
					<CalendarDays size={20} aria-hidden="true" />
					<strong>대관 부과</strong>
					<span>회차 선택</span>
				</button>
				<button
					type="button"
					disabled={disabled}
					onClick={onManual}
					aria-label="새 수동 부과"
				>
					<Plus size={20} aria-hidden="true" />
					<strong>수동 부과</strong>
					<span>{manualDirty ? "작성 중 · 이어쓰기" : "회식·기타 비용"}</span>
				</button>
			</section>
			{courtOpen && (
				<section
					id="charge-court-picker"
					className="ac-sheet ac-charge-court"
					aria-label="대관 회차 선택"
				>
					<div className="ac-sheet-head">
						<h2>대관 회차 선택</h2>
					</div>
					{sessionsError ? (
						<div className="ac-charge-load-error">
							<p role="alert">회차를 불러오지 못했습니다. {sessionsError}</p>
							<button
								type="button"
								className="ac-link"
								onClick={onRetrySessions}
								disabled={disabled}
							>
								회차 다시 불러오기
							</button>
						</div>
					) : sessions === null ? (
						<p role="status" className="ac-caption">
							회차를 불러오는 중…
						</p>
					) : !courtSessions.length ? (
						<p className="ac-caption">부과할 수 있는 대관 회차가 없습니다.</p>
					) : (
						<div className="ac-charge-court-fields">
							<label htmlFor="charge-session" className="ac-label">
								대관 회차
							</label>
							<select
								id="charge-session"
								value={sessionId}
								disabled={disabled}
								onChange={(e) => setSessionId(e.target.value)}
							>
								<option value="">회차를 선택하세요</option>
								{courtSessions.map((s) => (
									<option key={s.id} value={s.id}>
										{labels.get(s.id)}
									</option>
								))}
							</select>
							<button
								type="button"
								className="ac-charge-primary"
								disabled={disabled || !sessionId}
								onClick={() => void onCandidate("court", Number(sessionId))}
							>
								대관 부과 대상 확인
							</button>
						</div>
					)}
				</section>
			)}
			{data.drafts.length > 0 && (
				<section className="ac-sheet ac-charge-review" aria-label="발행 대기">
					<div className="ac-sheet-head">
						<h2>
							확인이 필요해요 <span>{data.drafts.length}건</span>
						</h2>
						<span>전체 기간</span>
					</div>
					{data.drafts.map((d) => (
						<button
							key={d.source_key}
							type="button"
							className="ac-charge-review-row"
							disabled={disabled}
							aria-label={`${String(d.payload.label)} 대상 다시 확인`}
							onClick={() =>
								void onCandidate(
									d.payload.kind as "monthly" | "court",
									d.payload.session_id as number | undefined,
									String(d.payload.ym),
								)
							}
						>
							<span>
								<strong>{String(d.payload.label)}</strong>
								<small>{holdReasonLabel[d.hold_reason] ?? d.hold_reason}</small>
							</span>
							<ChevronRight size={18} aria-hidden="true" />
						</button>
					))}
				</section>
			)}
			<section className="ac-sheet ac-charge-history" aria-label="발행 내역">
				<div className="ac-sheet-head">
					<h2>
						발행 내역 <span>{issued.length}건</span>
					</h2>
					<span>부과액 · 미납</span>
				</div>
				{issued.length > 0 && (
					<div
						className="ac-charge-filters"
						role="group"
						aria-label="부과 종류"
					>
						{(["all", "monthly", "court", "manual"] as const).map((kind) => (
							<button
								key={kind}
								type="button"
								aria-pressed={filter === kind}
								onClick={() => {
									setFilter(kind);
									setExpanded(null);
								}}
							>
								{kind === "all" ? "전체" : kinds[kind]}
							</button>
						))}
					</div>
				)}
				{shown.map((g) => (
					<IssuedGroup
						key={g.id}
						data={data}
						group={g}
						label={
							g.session_id ? (labels.get(g.session_id) ?? g.label) : g.label
						}
						open={expanded === g.id}
						onToggle={() => setExpanded(expanded === g.id ? null : g.id)}
						disabled={disabled}
						onDraft={onDraft}
					/>
				))}
				{!shown.length && (
					<div className="ac-charge-empty">
						<ClipboardList size={26} aria-hidden="true" />
						<strong>
							{issued.length
								? "이 종류의 발행 내역이 없습니다."
								: "아직 발행한 부과가 없습니다."}
						</strong>
						<p>
							{issued.length
								? "다른 종류를 선택해 주세요."
								: "위에서 회비·대관·수동 부과를 선택해 시작하세요."}
						</p>
					</div>
				)}
			</section>
			<details className="ac-disclosure ac-charge-more">
				<summary>이월·회계 항목 관리</summary>
				<div className="ac-charge-secondary">
					<button
						type="button"
						disabled={disabled}
						aria-label="미납·입금 이월"
						onClick={() => onDraft({ type: "carry" })}
					>
						<span>
							<strong>미납·입금 이월</strong>
							<small>납기나 입금 사용 월을 다음 달로 변경</small>
						</span>
						<ChevronRight size={18} aria-hidden="true" />
					</button>
					<button
						type="button"
						disabled={disabled}
						onClick={() =>
							onDraft({
								type: "simple",
								command: {
									action: "apply",
									reason: "납기가 도래한 이월 입금 사용",
								},
							})
						}
					>
						<span>
							<strong>이월금 적용</strong>
							<small>사용할 수 있는 이월금으로 미납 처리</small>
						</span>
						<ChevronRight size={18} aria-hidden="true" />
					</button>
					<button
						type="button"
						disabled={disabled}
						aria-label="부과 없이 모금·지출 항목 만들기"
						onClick={() =>
							onDraft({
								type: "issue",
								candidate: {
									action: "issue",
									reason: "",
									kind: "manual",
									label: "",
									date: `${ym}-01`,
									ym,
									lines: [],
									group_only: true,
								},
							})
						}
					>
						<span>
							<strong>수입·지출 항목 만들기</strong>
							<small>회원에게 부과하지 않는 모금·지출 분류</small>
						</span>
						<Plus size={18} aria-hidden="true" />
					</button>
				</div>
				{accountOnly.length > 0 && (
					<div className="ac-charge-account-list">
						<h3>
							회원 부과 없는 항목 <span>{accountOnly.length}건</span>
						</h3>
						{accountOnly.map((g) => {
							const s = groupSummary(data, g);
							return (
								<div key={g.id}>
									<strong>{g.label}</strong>
									<span>
										수입 {won(s.direct)} · 지출 {won(s.spent)}
									</span>
								</div>
							);
						})}
					</div>
				)}
			</details>
		</div>
	);
}

function IssuedGroup({
	data,
	group,
	label,
	open,
	onToggle,
	disabled,
	onDraft,
}: {
	data: AccountingData;
	group: BillingGroup;
	label: string;
	open: boolean;
	onToggle: () => void;
	disabled: boolean;
	onDraft: (draft: OperationDraft) => void;
}) {
	const summary = groupSummary(data, group);
	const live = summary.charges.filter((c) => c.state === "live");
	const [editing, setEditing] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const selectedLive = selected.filter((id) => live.some((c) => c.id === id));
	const total = live.reduce((sum, c) => sum + c.amount, 0);
	return (
		<div className="ac-issued-group">
			<button
				type="button"
				className="ac-issued-toggle"
				aria-expanded={open}
				onClick={() => {
					setEditing(false);
					onToggle();
				}}
			>
				<span className="ac-issued-name">
					<strong>{label}</strong>
					<span>
						{kinds[group.kind]} · {group.occurred_on.slice(5).replace("-", "/")}{" "}
						· {live.length}명
					</span>
				</span>
				<span className="ac-issued-amount">
					<strong>{won(total)}</strong>
					<span
						className={
							!live.length ? "" : summary.outstanding > 0 ? "is-ask" : "is-ok"
						}
					>
						{!live.length
							? "취소·면제"
							: summary.outstanding > 0
								? `미납 ${won(summary.outstanding)}`
								: "납부 완료"}
					</span>
				</span>
				<ChevronRight
					size={18}
					aria-hidden="true"
					className={open ? "ac-expanded" : ""}
				/>
			</button>
			{open && (
				<div className="ac-issued-detail">
					<div className="ac-issued-detail-head">
						<h3>부과 명단</h3>
						{live.length > 0 && (
							<button
								type="button"
								className="ac-link"
								disabled={disabled}
								onClick={() => {
									setEditing(!editing);
									setSelected(live.map((c) => c.id));
								}}
							>
								{editing ? "선택 닫기" : "부과 변경"}
							</button>
						)}
					</div>
					{summary.charges.map((c) => {
						const dues = data.due.filter(
							(d) => d.charge_id === c.id && d.remaining > 0,
						);
						const state = isReversedPrepayment(c)
							? "선납 취소"
							: c.state === "cancelled"
								? "취소"
								: c.state === "waived"
									? "면제"
									: dues.length
										? "미납/부분납"
										: "완납";
						const name = memberLabel(data, c.member_id);
						return (
							<div key={c.id} className="ac-issued-member">
								<div>
									{editing ? (
										<label>
											<input
												type="checkbox"
												disabled={disabled || c.state !== "live"}
												checked={selectedLive.includes(c.id)}
												onChange={(e) =>
													setSelected(
														e.target.checked
															? [...selectedLive, c.id]
															: selectedLive.filter((id) => id !== c.id),
													)
												}
											/>
											{name}
										</label>
									) : (
										<strong>{name}</strong>
									)}
									<span>
										{state}
										{c.previous_id ? " · 변경 발행" : ""}
									</span>
									{dues.map((d) => (
										<small key={d.id}>
											{d.due_ym} 납기 · {won(d.remaining)} 남음
										</small>
									))}
								</div>
								<strong className="ac-number">{won(c.amount)}</strong>
							</div>
						);
					})}
					{editing && (
						<div className="ac-undo-block">
							<strong>선택한 부과 변경</strong>
							<span>
								기존 부과를 취소하고 새 금액으로 발행합니다. 이미 받은 돈은
								잔액으로 돌린 뒤 새 부과에 다시 사용합니다.
							</span>
							<button
								type="button"
								className="ac-btn-undo"
								disabled={disabled || !selectedLive.length}
								onClick={() =>
									onDraft({ type: "replace", chargeIds: selectedLive })
								}
							>
								선택한 {selectedLive.length}건 취소 후 발행
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
