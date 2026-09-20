import {
	ChevronLeft,
	ChevronRight,
	Download,
	Search,
	Settings,
	X,
} from "lucide-react";
import { transactionNeedsSettlement } from "../../lib/dues/quickSettlement";
import "./accounting.css";
import "./accounting-layout.css";
// 홈 톤 스킨 — 반드시 accounting-layout.css **뒤**. 모든 규칙이 .ac-layout-v2 스코프이고
// 동률 특정도 다수가 소스 순서로 갈린다. 2026-09-11 부터 회원 화면(AccountingMember)도
// 같은 클래스를 달아 홈 톤으로 그린다 — 이 스킨을 고칠 때 회원 화면도 함께 본다.
import "./accounting-home.css";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { currentYm, shiftYm, won } from "../../lib/dues/duesText";
import { nameMatches } from "../../lib/dues/matching";
import { sessionChoiceLabels } from "../../lib/dues/selection";
import { kstMonth } from "../../lib/dues/summary";
import { actionLabel } from "../../lib/dues/types";
import {
	accountingCandidates,
	accountingError,
	accountingSessions,
} from "../../lib/supabase/dues";
import { ingestBankEmail } from "../../lib/supabase/duesSettings";
import { useDuesData, useDuesStore } from "../../store/duesStore";
import AppScreen from "../common/AppScreen";
import AccountingLedger from "./AccountingLedger";
import AccountingOverview from "./AccountingOverview";
import ChargeVoucher from "./ChargeVoucher";
import ChargeManagement from "./ChargeManagement";
import DuesSettingsModal from "./DuesSettingsModal";
import type { OperationDraft } from "./OperationDialog";
import TransactionCard from "./TransactionCard";

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
	const [chargeManagement, setChargeManagement] = useState(true);
	const [manualVersion, setManualVersion] = useState(0);
	const [manualDirty, setManualDirty] = useState(false);
	const [chargeNotice, setChargeNotice] = useState("");
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
	const [sessionsError, setSessionsError] = useState("");
	const [sessionAttempt, setSessionAttempt] = useState(0);
	useEffect(() => {
		if (page !== "charge" || !chargeManagement || sessions !== null) return;
		let disposed = false;
		void accountingSessions()
			.then((s) => {
				if (!disposed) {
					setSessions(s);
					setSessionsError("");
				}
			})
			.catch((e) => {
				if (!disposed) setSessionsError(accountingError(e));
			});
		return () => {
			disposed = true;
		};
	}, [page, chargeManagement, sessions, sessionAttempt]);
	const go = (month: string, tab = page) => {
		if (tab === "charge" && (page !== "charge" || month !== ym) && !manualDirty && !draft)
			setChargeManagement(true);
		navigate(`/dues/${month}${tab === "home" ? "" : `/${tab}`}`);
	};
	const candidate = async (
		kind: "monthly" | "court",
		sid?: number,
		period = ym,
	) => {
		setBusy(true);
		setIssueError("");
		setChargeNotice("");
		try {
			const result = await accountingCandidates(kind, period, sid ?? null);
			if (!(result.payload.lines as unknown[]).length) {
				setChargeNotice(
					"새로 발행할 대상이 없습니다. 발행 내역에서 기존 부과를 확인해 주세요.",
				);
				return;
			}
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
		setSyncedAt(null);
		try {
			const result = await ingestBankEmail();
			if (!result.ok) throw new Error(result.error);
			await refresh();
			if (result.data.errors?.length) {
				throw new Error(
					`새 거래 ${result.data.inserted}건을 저장했지만 일부 처리를 완료하지 못했습니다. ${result.data.errors.join(" / ")}`,
				);
			}
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
			{(!!draft || manualDirty) && (
				<p className="ac-caption">
					{draft
						? "전표를 확정하거나 닫은 뒤에 월을 옮길 수 있습니다."
						: "수동 부과를 작성 중입니다. 발행하거나 초기화한 뒤 월을 옮길 수 있습니다."}
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
					{page === "charge" && !draft && !chargeManagement && (
						<div className="ac-charge-editor-nav">
							<button
								type="button"
								className="ac-link"
								disabled={disabled}
								onClick={() => setChargeManagement(true)}
							>
								<ChevronLeft size={18} aria-hidden="true" />
								부과 목록
							</button>
							<h2>수동 부과</h2>
						</div>
					)}
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
								setChargeManagement(true);
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
							{!draft && chargeManagement && (
								<ChargeManagement
									key={ym}
									data={data}
									ym={ym}
									sessions={sessions}
									sessionsError={sessionsError}
									onRetrySessions={() => {
										setSessionsError("");
										setSessionAttempt((n) => n + 1);
									}}
									disabled={disabled}
									manualDirty={manualDirty}
									onManual={() => {
										setChargeNotice("");
										setIssueError("");
										setChargeManagement(false);
									}}
									onDraft={(next) => {
										setChargeNotice("");
										setIssueError("");
										setDraft(next);
									}}
									onCandidate={candidate}
								/>
							)}
							{draft && (
								<ChargeVoucher
									key={JSON.stringify(draft)}
									draft={draft}
									data={data}
									viewYm={ym}
									onClose={(saved) => {
										setDraft(null);
										setChargeManagement(true);
										setChargeNotice(saved ? "처리한 내용을 반영했습니다." : "");
									}}
									onDone={refresh}
									onPendingChange={setSettling}
								/>
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
