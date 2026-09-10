import { transactionNeedsSettlement } from "../../lib/dues/quickSettlement";
import {
	ChevronLeft,
	ChevronRight,
	Download,
	Search,
	Settings,
	X,
} from "lucide-react";
import "./accounting.css";
import "./accounting-layout.css";
import TransactionCard from "./TransactionCard";
import AccountingOverview from "./AccountingOverview";
import AccountingLedger from "./AccountingLedger";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { sessionChoiceLabels } from "../../lib/dues/selection";
import { nameMatches } from "../../lib/dues/matching";
import { groupSummary, kstMonth, memberLabel } from "../../lib/dues/summary";
import { actionLabel } from "../../lib/dues/types";
import {
	accountingCandidates,
	accountingError,
	accountingSessions,
} from "../../lib/supabase/dues";
import { ingestBankEmail } from "../../lib/supabase/duesSettings";
import {
	useDuesData,
	useDuesStore,
} from "../../store/duesStore";
import {
	currentYm,
	holdReasonLabel,
	shiftYm,
	won,
} from "../../lib/dues/duesText";
import DuesSettingsModal from "./DuesSettingsModal";
import AppScreen from "../common/AppScreen";
import ChargeVoucher from "./ChargeVoucher";
import type { OperationDraft } from "./OperationDialog";

const tabs = [
	["home", "현황"],
	["inbox", "정산함"],
	["ledger", "회계"],
	["charge", "부과"],
] as const;
const ymPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const manualDraft: OperationDraft = { type: "issue" };
export default function AccountingAdmin() {
	const navigate = useNavigate();
	const params = useParams<{ ym: string; page: string }>();
	const ym = params.ym && ymPattern.test(params.ym) ? params.ym : currentYm();
	const page = tabs.some(([id]) => id === params.page) ? params.page : "home";
	const { data, error, loading, refresh } = useDuesData();
	const mode = useDuesStore((s) => s.mode)!;
	const [draft, setDraft] = useState<OperationDraft | null>(null);
	const [chargeManagement, setChargeManagement] = useState(false);
	const [manualVersion, setManualVersion] = useState(0);
	const [manualDirty, setManualDirty] = useState(false);
	const [chargeNotice, setChargeNotice] = useState("");
	const [expanded, setExpanded] = useState<string | null>(null);
	const [selected, setSelected] = useState<string[]>([]);
	const [settling, setSettling] = useState(false);
	const [search, setSearch] = useState("");
	const [issueError, setIssueError] = useState("");
	const [busy, setBusy] = useState(false);
	const [settings, setSettings] = useState(false);
	const [syncedAt, setSyncedAt] = useState<string | null>(null);
	// 처리한 건의 누적 기록. 확정하면 카드가 목록에서 사라지므로 '반영됐다'를
	// 확인할 근거가 남지 않았다.
	const [done, setDone] = useState<string[]>([]);
	// 항목별 내역과 거래 목록이 공유하는 필터(막다른 골목 해소).
	const [ledgerFilter, setLedgerFilter] = useState("all");
	const [sessions, setSessions] = useState<Awaited<
		ReturnType<typeof accountingSessions>
	> | null>(null);
	const [sessionId, setSessionId] = useState("");
	useEffect(() => {
		if (page !== "charge" || !chargeManagement || sessions !== null) return;
		let disposed = false;
		void accountingSessions()
			.then((s) => {
				if (!disposed) setSessions(s);
			})
			.catch((e) => {
				if (!disposed) setIssueError(accountingError(e));
			});
		return () => {
			disposed = true;
		};
	}, [page, chargeManagement, sessions]);
	const go = (month: string, tab = page) =>
		navigate(`/dues/${month}${tab === "home" ? "" : `/${tab}`}`);
	const candidate = async (
		kind: "monthly" | "court",
		sid?: number,
		period = ym,
	) => {
		setBusy(true);
		setIssueError("");
		try {
			const result = await accountingCandidates(kind, period, sid ?? null);
			if (!(result.payload.lines as unknown[]).length)
				throw new Error(
					"새로 발행할 대상이 없습니다. 기존 부과 변경은 취소 후 발행에서 처리하세요.",
				);
			setDraft({
				type: "issue",
				candidate: {
					...result.payload,
					label: sid
						? (sessionChoiceLabels(sessions ?? []).get(sid) ??
							result.payload.label)
						: result.payload.label,
				},
			});
		} catch (e) {
			setIssueError(accountingError(e));
		} finally {
			setBusy(false);
		}
	};
	const ingest = async () => {
		setBusy(true);
		setIssueError("");
		try {
			const result = await ingestBankEmail();
			if (!result.ok) throw new Error(result.error);
			await refresh();
			setSyncedAt(
				new Date().toLocaleTimeString("ko-KR", {
					hour: "2-digit",
					minute: "2-digit",
				}),
			);
		} catch (e) {
			setIssueError(accountingError(e));
		} finally {
			setBusy(false);
		}
	};
	const sessionLabels = sessionChoiceLabels(sessions ?? []);
	const disabled = mode.paused || busy || loading || settling;
	const pending =
		data?.bank
			.filter(
				(t) =>
					kstMonth(t.occurred_at) === ym &&
					transactionNeedsSettlement(data, t.id),
			)
			.sort(
				(a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id - a.id,
			) ?? [];
	const shownPending = pending.filter(
		(t) => nameMatches(t.name ?? "", search) || String(t.id) === search.trim(),
	);
	// 전표를 열어 둔 채 월을 옮기면 입력이 전부 날아갔다 — 확정하거나 닫은 뒤에만 옮긴다.
	const monthLocked = settling || !!draft || manualDirty;
	return (
		<AppScreen
			title="회비 관리"
			contentClassName={`accounting-screen ac-layout-v2 ${page === "inbox" ? "is-inbox" : page === "ledger" ? "is-ledger" : ""}`}
			onBack={() => navigate("/")}
			onRefresh={refresh}
			right={
				<button
					type="button"
					className="ac-settings"
					aria-label="회비 설정"
					onClick={() => setSettings(true)}
				>
					<Settings size={19} />
				</button>
			}
		>
			<div className="ac-month">
				<button
					type="button"
					aria-label="이전 달"
					disabled={monthLocked}
					onClick={() => go(shiftYm(ym, -1))}
				>
					<ChevronLeft size={20} />
				</button>
				<strong>
					{ym.split("-")[0]}년 {Number(ym.split("-")[1])}월
				</strong>
				<button
					type="button"
					aria-label="다음 달"
					disabled={monthLocked || ym >= shiftYm(currentYm(), 1)}
					onClick={() => go(shiftYm(ym, 1))}
				>
					<ChevronRight size={20} />
				</button>
			</div>
			<nav className="ac-tabs">
				{tabs.map(([id, label]) => (
					<button
						type="button"
						key={id}
						aria-current={page === id ? "page" : undefined}
						disabled={settling}
						onClick={() => go(ym, id)}
					>
						{label}
					</button>
				))}
			</nav>
			{!!draft && (
				<p className="ac-caption">
					전표를 확정하거나 닫은 뒤에 월을 옮길 수 있습니다.
				</p>
			)}
			{mode.paused && (
				<p role="status" className="ac-notice is-ask">
					<span aria-hidden="true">!</span>
					<span>
						회계 처리가 일시 중지되었습니다. 현재 내역은 계속 볼 수 있습니다.
					</span>
				</p>
			)}
			{error && (
				<p role="alert" className="ac-notice is-stop">
					<span aria-hidden="true">!</span>
					<span>{error}</span>
				</p>
			)}
			{/* 부과 조작의 실패는 부과 탭에서만 알린다 — 전에는 모든 탭에 남아
			    맥락 없는 빨간 문장이 됐다. */}
			{issueError &&
				(page === "charge" || page === "inbox" || page === "ledger") && (
					<p role="alert" className="ac-notice is-stop">
						<span aria-hidden="true">!</span>
						<span>{issueError}</span>
					</p>
				)}
			{/* 다른 탭을 확인하거나 발행 내역을 열어도 입력 중인 전표는 유지한다. */}
			{data && (
				<>
					{page === "charge" && chargeNotice && (
						<p className="ac-saved" role="status">
							{chargeNotice}
						</p>
					)}
					<div hidden={page !== "charge" || chargeManagement || !!draft}>
						<ChargeVoucher
							key={`manual:${ym}:${manualVersion}`}
							draft={manualDraft}
							data={data}
							active={page === "charge" && !chargeManagement && !draft}
							viewYm={ym}
							onDirtyChange={setManualDirty}
							onPendingChange={setSettling}
							onClose={(saved) => {
								setManualVersion((n) => n + 1);
								setManualDirty(false);
								setChargeNotice(
									saved
										? "부과를 발행했습니다. 발행 내역에서 확인할 수 있습니다."
										: "",
								);
							}}
							onDone={refresh}
						/>
					</div>
				</>
			)}
			{!data ? (
				<p className="ac-caption">회계 내역을 불러오는 중…</p>
			) : (
				<>
					{page === "home" ? (
						<AccountingOverview
							key={ym}
							data={data}
							ym={ym}
							sessionLabels={sessionLabels}
							onNavigate={(tab) => go(ym, tab)}
						/>
					) : page === "ledger" ? (
						<AccountingLedger
							key={ym}
							data={data}
							ym={ym}
							disabled={disabled}
							onDone={refresh}
							onPendingChange={setSettling}
							settling={settling}
							filter={ledgerFilter}
							onFilter={setLedgerFilter}
							onMonth={(month) => go(month, "ledger")}
							onInbox={() => go(ym, "inbox")}
						/>
					) : page === "inbox" ? (
						<div className="flex flex-col gap-3">
							<div className="ac-inbox-toolbar">
								<h2 aria-label={`처리할 내역 ${pending.length}`}>
									<span>미정산</span>
									<strong>{pending.length}건</strong>
									<span>
										· {won(pending.reduce((sum, tx) => sum + tx.amount, 0))}
									</span>
									{done.length > 0 && <span>· 오늘 {done.length}건 처리</span>}
								</h2>
								<div className="ac-search">
									<Search size={16} aria-hidden="true" />
									<input
										aria-label="거래 검색"
										name="transaction-search"
										autoComplete="off"
										disabled={settling}
										placeholder="이름·거래 번호…"
										value={search}
										onChange={(e) => setSearch(e.target.value)}
									/>
									{!!search && (
										<button
											type="button"
											className="ac-search-clear"
											aria-label="거래 검색어 지우기"
											onClick={() => setSearch("")}
										>
											<X size={16} aria-hidden="true" />
										</button>
									)}
								</div>
								<button
									type="button"
									className="ac-import-button"
									aria-label={busy ? "가져오는 중…" : "내역 가져오기"}
									title="내역 가져오기"
									disabled={disabled}
									onClick={() => void ingest()}
								>
									<Download size={18} aria-hidden="true" />
									<span>통장 가져오기</span>
								</button>
							</div>
							{syncedAt && (
								<p className="ac-caption" role="status">
									이번 화면에서 가져오기 완료 · {syncedAt}
								</p>
							)}
							{shownPending.map((t) => (
								<TransactionCard
									key={t.id}
									data={data}
									transaction={t}
									disabled={disabled}
									onDone={refresh}
									onPendingChange={setSettling}
									onSettled={(text) => setDone((rows) => [text, ...rows])}
									onMonth={(month) => go(month, "ledger")}
								/>
							))}
							{!shownPending.length && (
								<p className="ac-empty">
									{search
										? "검색된 거래가 없습니다."
										: "이 달에 정산할 내역이 없습니다."}
								</p>
							)}
							{/* 처리한 건은 사라지지 않고 한 줄로 내려앉는다. */}
							{done.length > 0 && (
								<div className="ac-done-list">
									<span className="ac-label">오늘 처리한 {done.length}건</span>
									{done.map((text, i) => (
										<div className="ac-done-row" key={`${i}-${text}`}>
											<span aria-hidden="true">✓</span>
											<span>{text}</span>
										</div>
									))}
								</div>
							)}
						</div>
					) : (
						<div className="ac-charge">
							{!draft && !chargeManagement && (
								<button
									type="button"
									className="ac-link ac-charge-manage-link"
									disabled={disabled}
									onClick={() => setChargeManagement(true)}
								>
									발행 내역·회비·대관 부과
								</button>
							)}
							{/* ① 발행 — 대상 계산이 필요한 것부터. 전에는 성격이 다른 버튼
							    일곱 개가 한 무더기로 쌓여 있었다. */}
							{!draft && chargeManagement && (
								<div className="ac-sheet">
									<div className="ac-sheet-head">
										<h2>발행</h2>
										<span>동시에 한 건만</span>
									</div>
									<div className="ac-charge-launcher">
										<button
											type="button"
											aria-label="회비 대상 확인"
											disabled={disabled}
											onClick={() => void candidate("monthly")}
										>
											<span>회비 대상 확인</span>
											<span>{ym} 대상 계산</span>
										</button>
										<div className="ac-charge-session">
											<label className="ac-label" htmlFor="charge-session">
												대관 부과
											</label>
											<select
												id="charge-session"
												aria-label="대관 회차"
												value={sessionId}
												disabled={disabled}
												onChange={(e) => {
													setSessionId(e.target.value);
													if (e.target.value)
														void candidate("court", Number(e.target.value));
												}}
											>
												<option value="">대관 회차 선택</option>
												{(sessions ?? [])
													.filter((s) => s.court)
													.map((s) => (
														<option key={s.id} value={s.id}>
															{sessionLabels.get(s.id)}
														</option>
													))}
											</select>
											<button
												type="button"
												className="ac-link"
												disabled={disabled || !sessionId}
												onClick={() =>
													void candidate("court", Number(sessionId))
												}
											>
												대관 부과 대상 확인
											</button>
										</div>
										<button
											type="button"
											aria-label="새 수동 부과"
											disabled={disabled}
											onClick={() => setChargeManagement(false)}
										>
											<span>새 수동 부과</span>
											<span>이름·발생일 직접 입력</span>
										</button>
										<button
											type="button"
											aria-label="부과 없이 모금·지출 항목 만들기"
											disabled={disabled}
											onClick={() =>
												setDraft({
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
											<span>부과 없이 모금·지출 항목 만들기</span>
											<span>부과 0건</span>
										</button>
									</div>
								</div>
							)}
							{/* ② 전표 — 모달이 아니라 이 자리에서 열리고 이 자리에서 끝난다. */}
							{draft && (
								<ChargeVoucher
									key={JSON.stringify(draft)}
									draft={draft}
									data={data}
									viewYm={ym}
									onClose={() => setDraft(null)}
									onDone={refresh}
									onPendingChange={setSettling}
								/>
							)}
							{/* ③ 발행 대기 — 서버가 보류한 이유(hold_reason)를 처음으로 보여 준다. */}
							{(chargeManagement || !!draft) && data.drafts?.length > 0 && (
								<div className="ac-sheet">
									<div className="ac-sheet-head">
										<h2>발행 대기</h2>
										<span>{data.drafts.length}건</span>
									</div>
									<div className="ac-drafts">
										{data.drafts.map((d) => (
											<button
												key={d.source_key}
												type="button"
												className="ac-draft-row"
												aria-label={`${String(d.payload.label)} 대상 다시 확인`}
												disabled={disabled}
												onClick={() =>
													void candidate(
														d.payload.kind as "monthly" | "court",
														d.payload.session_id as number | undefined,
														String(d.payload.ym),
													)
												}
											>
												<span aria-hidden="true">?</span>
												<span>
													<strong>{String(d.payload.label)}</strong>
													{d.hold_reason && (
														<em>
															{holdReasonLabel[d.hold_reason] ?? d.hold_reason}
														</em>
													)}
												</span>
												<span className="ac-link">대상 다시 확인</span>
											</button>
										))}
									</div>
								</div>
							)}
							{/* ④ 이 달 발행된 묶음 */}
							{(chargeManagement || !!draft) && (
								<>
									<div className="ac-sheet">
										<div className="ac-sheet-head">
											<h2>이 달 발행된 묶음</h2>
											<span>
												{
													data.groups.filter((g) =>
														g.occurred_on.startsWith(ym),
													).length
												}
												건
											</span>
										</div>
										{data.groups
											.filter((g) => g.occurred_on.startsWith(ym))
											.sort((a, b) =>
												b.occurred_on.localeCompare(a.occurred_on),
											)
											.map((g) => {
												const s = groupSummary(data, g),
													live = s.charges.filter((c) => c.state === "live");
												const open = expanded === g.id;
												return (
													<div key={g.id} className="ac-group">
														<button
															type="button"
															className="ac-group-toggle"
															aria-expanded={open}
															onClick={() => {
																setExpanded(open ? null : g.id);
																setSelected(live.map((c) => c.id));
															}}
														>
															<span className="ac-section-heading">
																<strong>
																	{g.session_id
																		? (sessionLabels.get(g.session_id) ??
																			g.label)
																		: g.label}
																</strong>
																<span
																	className={`ac-badge ${s.outstanding > 0 ? "is-amber" : "is-green"}`}
																>
																	{s.outstanding > 0
																		? "미납 있음"
																		: "미납 없음"}
																</span>
															</span>
															<span className="ac-group-total">
																<span>납부액</span>
																<strong className="ac-number">
																	{won(s.paid)}
																</strong>
																<ChevronRight
																	size={16}
																	aria-hidden="true"
																	className={open ? "ac-expanded" : ""}
																/>
															</span>
															<span className="ac-group-facts">
																<span>
																	남은 미납 <b>{won(s.outstanding)}</b>
																</span>
																<span>
																	현재 순액 <b>{won(s.net)}</b>
																</span>
															</span>
															{(s.direct > 0 || s.spent > 0) && (
																<span className="ac-group-facts">
																	<span>
																		직접 수입 <b>{won(s.direct)}</b>
																	</span>
																	<span>
																		지출 <b>{won(s.spent)}</b>
																	</span>
																</span>
															)}
														</button>
														{open && (
															<div className="ac-group-members">
																{s.charges.map((c) => {
																	const due = data.due.filter(
																		(d) => d.charge_id === c.id,
																	);
																	const state =
																		c.state === "cancelled"
																			? "취소"
																			: c.state === "waived"
																				? "면제"
																				: due.some((d) => d.remaining > 0)
																					? "미납/부분납"
																					: "완납";
																	const dead = c.state !== "live";
																	return (
																		<div key={c.id} className="ac-row">
																			<span
																				className={`ac-row-gutter ${dead ? "" : state === "완납" ? "is-ok" : "is-ask"}`}
																				aria-hidden="true"
																			>
																				{dead
																					? "—"
																					: state === "완납"
																						? "✓"
																						: "?"}
																			</span>
																			<span className="ac-row-body">
																				<label>
																					<input
																						type="checkbox"
																						disabled={dead}
																						checked={selected.includes(c.id)}
																						onChange={(e) =>
																							setSelected(
																								e.target.checked
																									? [...selected, c.id]
																									: selected.filter(
																											(id) => id !== c.id,
																										),
																							)
																						}
																					/>{" "}
																					{memberLabel(data, c.member_id)} ·{" "}
																					{won(c.amount)} · {state}
																				</label>
																				{due
																					.filter((d) => d.remaining > 0)
																					.map((d) => (
																						<span
																							className="ac-row-note"
																							key={d.id}
																						>
																							{d.due_ym} 납기 ·{" "}
																							{won(d.remaining)} 남음
																						</span>
																					))}
																				{c.previous_id && (
																					<span className="ac-row-note">
																						기존 부과 취소 후 발행
																					</span>
																				)}
																			</span>
																			<span className="ac-amount">
																				{won(c.amount)}
																			</span>
																		</div>
																	);
																})}
																{/* 파괴적 동작 — 결과를 먼저 예고하고 형태로 구분한다. */}
																<div className="ac-undo-block">
																	<strong>취소 후 발행</strong>
																	<span>
																		선택한 {selected.length}건의 부과를 취소하고
																		새 금액으로 다시 발행합니다. 이미 받은 돈은
																		잔액으로 돌아갑니다.
																	</span>
																	<button
																		type="button"
																		className="ac-btn-undo"
																		disabled={disabled || !selected.length}
																		onClick={() =>
																			setDraft({
																				type: "replace",
																				chargeIds: selected,
																			})
																		}
																	>
																		선택한 {selected.length}건 취소 후 발행
																	</button>
																</div>
															</div>
														)}
													</div>
												);
											})}
										{!data.groups.some((g) => g.occurred_on.startsWith(ym)) && (
											<p className="ac-empty">
												이 달에 발행된 묶음이 없습니다.
											</p>
										)}
									</div>
									{/* ⑤ 돈 옮기기 — 부과가 아니므로 따로 둔다. */}
									<div className="ac-sheet">
										<div className="ac-sheet-head">
											<h2>돈 옮기기</h2>
											<span>부과가 아님</span>
										</div>
										<div className="ac-charge-launcher">
											<button
												type="button"
												aria-label="미납·입금 이월"
												disabled={disabled}
												onClick={() => setDraft({ type: "carry" })}
											>
												<span>미납·입금 이월</span>
												<span>다음 달로 넘기기</span>
											</button>
											<button
												type="button"
												aria-label="이월금 적용"
												disabled={disabled}
												onClick={() =>
													setDraft({
														type: "simple",
														command: {
															action: "apply",
															reason: "납기가 도래한 이월 입금 사용",
														},
													})
												}
											>
												<span>이월금 적용</span>
												<span>납기가 도래한 이월 입금 사용</span>
											</button>
										</div>
									</div>
								</>
							)}
						</div>
					)}
					{page === "ledger" && (
						<details className="ac-disclosure ac-history">
							<summary>회계 변경 이력</summary>
							<p className="ac-caption">
								전체 기간의 최근 {data.operations.length}건 · 작업
								종류·사유·처리 시각
							</p>
							{data.operations.map((op) => (
								<div className="ac-row" key={op.id}>
									<span className="ac-row-gutter" aria-hidden="true">
										{op.reverted_at ? "!" : "✓"}
									</span>
									<span className="ac-row-body">
										<strong>
											{actionLabel[op.action] ?? "발행 대기"}
											{op.reverted_at && " · 되돌림"}
										</strong>
										<span className="ac-row-note">
											{op.reason} ·{" "}
											{new Date(op.created_at).toLocaleString("ko-KR", {
												timeZone: "Asia/Seoul",
											})}
										</span>
									</span>
								</div>
							))}
						</details>
					)}
				</>
			)}
			{settings && <DuesSettingsModal onClose={() => setSettings(false)} />}
		</AppScreen>
	);
}
