import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { sessionChoiceLabels } from "../../lib/dues/v2/selection";
import { nameMatches } from "../admin/dues/matching";
import { groupSummary, kstMonth, memberLabel } from "../../lib/dues/v2/summary";
import { actionLabel, purposeLabel } from "../../lib/dues/v2/types";
import {
	accountingCandidates,
	accountingError,
	accountingSessions,
} from "../../lib/supabase/accountingV2";
import { ingestBankEmail } from "../../lib/supabase/dues";
import {
	useAccountingData,
	useAccountingStore,
} from "../../store/accountingV2Store";
import { currentYm, shiftYm, won } from "../admin/dues/duesText";
import DuesSettingsModal from "../admin/dues/DuesSettingsModal";
import AppScreen from "../common/AppScreen";
import AccountingControls from "./AccountingControls";
import CashLedgerView from "./CashLedgerView";
import OperationDialog, { type OperationDraft } from "./OperationDialog";

const tabs = [
	["home", "현황"],
	["inbox", "정산함"],
	["ledger", "회계"],
	["charge", "부과"],
] as const;
const ymPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
export default function AccountingAdmin() {
	const navigate = useNavigate();
	const params = useParams<{ ym: string; page: string }>();
	const ym = params.ym && ymPattern.test(params.ym) ? params.ym : currentYm();
	const page = tabs.some(([id]) => id === params.page) ? params.page : "home";
	const { data, error, loading, refresh } = useAccountingData();
	const mode = useAccountingStore((s) => s.mode)!;
	const [draft, setDraft] = useState<OperationDraft | null>(null);
	const [expanded, setExpanded] = useState<string | null>(null);
	const [selected, setSelected] = useState<string[]>([]);
	const [search, setSearch] = useState("");
	const [issueError, setIssueError] = useState("");
	const [busy, setBusy] = useState(false);
	const [settings, setSettings] = useState(false);
	const [sessions, setSessions] = useState<
		Awaited<ReturnType<typeof accountingSessions>>
	>([]);
	const [sessionId, setSessionId] = useState("");
	useEffect(() => {
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
	}, []);
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
						? (sessionChoiceLabels(sessions).get(sid) ?? result.payload.label)
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
		} catch (e) {
			setIssueError(accountingError(e));
		} finally {
			setBusy(false);
		}
	};
	const sessionLabels = sessionChoiceLabels(sessions);
	const disabled = mode.paused || busy || loading;
	return (
		<AppScreen
			title="회비 관리"
			onBack={() => navigate("/")}
			onRefresh={refresh}
			right={
				<button
					type="button"
					className="text-muted text-sm"
					onClick={() => setSettings(true)}
				>
					설정
				</button>
			}
		>
			<div className="flex items-center justify-center gap-5 mb-4">
				<button
					type="button"
					aria-label="이전 달"
					onClick={() => go(shiftYm(ym, -1))}
				>
					‹
				</button>
				<strong>{ym}</strong>
				<button
					type="button"
					aria-label="다음 달"
					onClick={() => go(shiftYm(ym, 1))}
				>
					›
				</button>
			</div>
			<nav className="flex gap-1 rounded-xl bg-black/5 dark:bg-white/5 p-1 mb-4">
				{tabs.map(([id, label]) => (
					<button
						type="button"
						key={id}
						aria-current={page === id ? "page" : undefined}
						onClick={() => go(ym, id)}
						className={`flex-1 rounded-lg py-2 text-sm ${page === id ? "bg-white dark:bg-white/15 font-bold" : "text-muted"}`}
					>
						{label}
					</button>
				))}
			</nav>
			{mode.paused && (
				<p
					role="status"
					className="mb-3 rounded-xl bg-amber-100 dark:bg-amber-950 p-3 text-sm"
				>
					회계 처리가 일시 중지되었습니다. 현재 내역은 계속 볼 수 있습니다.
				</p>
			)}
			{error && (
				<p role="alert" className="text-red-600">
					{error}
				</p>
			)}
			{issueError && (
				<p role="alert" className="text-red-600 mb-3">
					{issueError}
				</p>
			)}
			{!data ? (
				<p className="text-muted">회계 내역을 불러오는 중…</p>
			) : (
				<>
					{page === "ledger" ? (
						<CashLedgerView ym={ym} revision={data.mode.revision} />
					) : page === "inbox" ? (
						<div className="flex flex-col gap-3">
							<button
								type="button"
								className="btn-lq-secondary"
								disabled={busy}
								onClick={() => void ingest()}
							>
								{busy ? "가져오는 중…" : "통장내역 가져오기 (Gmail)"}
							</button>
							<input
								aria-label="거래 검색"
								className="rounded-xl border border-black/15 dark:border-white/20 p-3 bg-transparent"
								placeholder="입금자명·거래 번호 검색"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
							/>
							{data.bank
								.filter(
									(t) =>
										kstMonth(t.occurred_at) === ym &&
										(nameMatches(t.name ?? "", search) ||
											String(t.id) === search),
								)
								.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
								.map((t) => {
									const positions = data.positions.filter(
											(p) => p.bank_tx_id === t.id,
										),
										allocations = data.allocations.filter(
											(a) => a.bank_tx_id === t.id && a.amount > a.reversed,
										);
									const refund = data.refunds.find((r) => r.out_tx_id === t.id),
										expense = data.expenses.find((e) => e.bank_tx_id === t.id);
									return (
										<section
											key={t.id}
											className="rounded-xl border border-black/10 dark:border-white/15 p-3 flex flex-col gap-2"
										>
											<div className="flex justify-between gap-2 text-sm">
												<span>
													{new Date(t.occurred_at).toLocaleDateString("ko-KR", {
														timeZone: "Asia/Seoul",
													})}{" "}
													· {t.name || `거래 #${t.id}`}
												</span>
												<strong>
													{t.direction === "in" ? "+" : "−"}
													{won(t.amount)}
												</strong>
											</div>
											{t.direction === "in" ? (
												<>
													{allocations.map((a) => (
														<div
															key={a.id}
															className="flex gap-2 justify-between text-xs"
														>
															<span>
																{memberLabel(data, a.owner_id)} →{" "}
																{
																	data.groups.find(
																		(g) =>
																			g.id ===
																			data.charges.find(
																				(c) => c.id === a.charge_id,
																			)?.group_id,
																	)?.label
																}{" "}
																· {won(a.amount - a.reversed)}
															</span>
															<button
																type="button"
																className="text-muted underline"
																disabled={disabled}
																onClick={() =>
																	setDraft({
																		type: "simple",
																		command: {
																			action: "reverse_payment",
																			reason: "",
																			allocation_id: a.id,
																			amount: a.amount - a.reversed,
																		},
																	})
																}
															>
																연결 해제
															</button>
														</div>
													))}
													{data.refunds
														.filter((r) => r.in_tx_id === t.id)
														.map((r) => (
															<p
																key={r.out_tx_id}
																className="text-xs text-muted"
															>
																환불 {won(r.amount)} · 출금 #{r.out_tx_id}
															</p>
														))}
													{positions.map((p) => (
														<div
															key={p.id}
															className="rounded-lg bg-black/5 dark:bg-white/5 p-2 text-sm"
														>
															<p>
																{purposeLabel[p.purpose]} {won(p.amount)} ·{" "}
																{p.purpose === "club"
																	? data.groups.find((g) => g.id === p.group_id)
																			?.label
																	: memberLabel(data, p.owner_id)}
																{p.available_ym &&
																	` · ${p.available_ym}부터 사용`}
															</p>
															<div className="flex gap-3 mt-2 text-xs text-[#0b84ff]">
																<button
																	type="button"
																	disabled={disabled}
																	onClick={() =>
																		setDraft({
																			type: "position",
																			positionId: p.id,
																		})
																	}
																>
																	용도 지정
																</button>
																{["member_pending", "carry"].includes(
																	p.purpose,
																) && (
																	<>
																		<button
																			type="button"
																			disabled={disabled}
																			onClick={() =>
																				setDraft({
																					type: "pay",
																					positionId: p.id,
																				})
																			}
																		>
																			납부 연결
																		</button>
																		<button
																			type="button"
																			disabled={disabled}
																			onClick={() =>
																				setDraft({
																					type: "carry",
																					memberId: p.owner_id!,
																				})
																			}
																		>
																			이월
																		</button>
																	</>
																)}
															</div>
														</div>
													))}
												</>
											) : (
												<>
													<p className="text-xs text-muted">
														{refund
															? `환불 완료 · 원입금 #${refund.in_tx_id}`
															: (data.groups.find(
																	(g) => g.id === expense?.group_id,
																)?.label ?? "미분류 출금")}
													</p>
													<div className="flex gap-3 text-sm text-[#0b84ff]">
														{refund ? (
															<>
																<button
																	type="button"
																	onClick={() => {
																		const source = data.bank.find(
																			(b) => b.id === refund.in_tx_id,
																		);
																		if (source)
																			go(kstMonth(source.occurred_at), "inbox");
																	}}
																>
																	원입금 월 보기
																</button>
																<button
																	type="button"
																	disabled={disabled}
																	onClick={() =>
																		setDraft({
																			type: "simple",
																			command: {
																				action: "reverse_refund",
																				reason: "",
																				out_tx_id: t.id,
																			},
																		})
																	}
																>
																	환불 연결 해제
																</button>
															</>
														) : (
															<>
																<button
																	type="button"
																	disabled={disabled}
																	onClick={() =>
																		setDraft({ type: "expense", outTxId: t.id })
																	}
																>
																	지출 항목 지정
																</button>
																<button
																	type="button"
																	disabled={disabled || !!expense?.group_id}
																	onClick={() =>
																		setDraft({ type: "refund", outTxId: t.id })
																	}
																>
																	환불 연결
																</button>
															</>
														)}
													</div>
												</>
											)}
										</section>
									);
								})}
						</div>
					) : (
						<div className="flex flex-col gap-3">
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									className="btn-lq-primary"
									disabled={disabled}
									onClick={() => setDraft({ type: "carry" })}
								>
									미납·입금 이월
								</button>
								<button
									type="button"
									className="btn-lq-secondary"
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
									이월금 적용
								</button>
							</div>
							{page === "charge" && (
								<div className="rounded-xl border border-black/10 dark:border-white/15 p-3 flex flex-col gap-3">
									<div className="flex gap-2">
										<button
											type="button"
											className="btn-lq-primary"
											disabled={disabled}
											onClick={() => setDraft({ type: "issue" })}
										>
											새 수동 부과
										</button>
										<button
											type="button"
											className="btn-lq-secondary"
											disabled={disabled}
											onClick={() => void candidate("monthly")}
										>
											회비 대상 확인
										</button>
									</div>
									<select
										aria-label="대관 회차"
										className="rounded-lg border border-black/15 dark:border-white/20 p-2 bg-transparent"
										value={sessionId}
										onChange={(e) => setSessionId(e.target.value)}
									>
										<option value="">대관 회차 선택</option>
										{sessions
											.filter((s) => s.court)
											.map((s) => (
												<option key={s.id} value={s.id}>
													{sessionLabels.get(s.id)}
												</option>
											))}
									</select>
									<button
										type="button"
										className="btn-lq-secondary"
										disabled={disabled || !sessionId}
										onClick={() => void candidate("court", Number(sessionId))}
									>
										대관 부과 대상 확인
									</button>
									<button
										type="button"
										className="text-sm text-[#0b84ff]"
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
										부과 없이 모금·지출 항목 만들기
									</button>
								</div>
							)}
							{data.drafts?.length > 0 && (
								<div className="rounded-xl bg-amber-50 dark:bg-amber-950 p-3">
									<h3 className="font-semibold text-sm mb-2">발행 대기</h3>
									{data.drafts.map((d) => (
										<button
											key={d.source_key}
											type="button"
											className="block text-sm text-[#0b84ff] py-2"
											disabled={disabled}
											onClick={() =>
												void candidate(
													d.payload.kind as "monthly" | "court",
													d.payload.session_id as number | undefined,
													String(d.payload.ym),
												)
											}
										>
											{String(d.payload.label)} · 대상 다시 확인
										</button>
									))}
								</div>
							)}
							{page === "home" && (
								<details className="rounded-xl bg-black/5 dark:bg-white/5 p-3">
									<summary className="text-sm font-semibold">
										이번 달까지 남은 미납{" "}
										{won(
											data.due
												.filter((d) => d.due_ym <= ym)
												.reduce((s, d) => s + d.remaining, 0),
										)}
									</summary>
									{data.members.map((m) => {
										const ids = new Set(
											data.charges
												.filter(
													(c) => c.member_id === m.id && c.state === "live",
												)
												.map((c) => c.id),
										);
										const sum = data.due
											.filter((d) => ids.has(d.charge_id) && d.due_ym <= ym)
											.reduce((s, d) => s + d.remaining, 0);
										return sum > 0 ? (
											<div
												key={m.id}
												className="flex justify-between gap-2 py-2 text-sm"
											>
												<span>
													{memberLabel(data, m.id)} · {won(sum)}
												</span>
												<button
													type="button"
													className="text-[#0b84ff]"
													disabled={disabled}
													onClick={() =>
														setDraft({ type: "carry", memberId: m.id })
													}
												>
													이월
												</button>
											</div>
										) : null;
									})}
								</details>
							)}
							{data.groups
								.filter((g) => g.occurred_on.startsWith(ym))
								.sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
								.map((g) => {
									const s = groupSummary(data, g),
										live = s.charges.filter((c) => c.state === "live");
									return (
										<section
											key={g.id}
											className="rounded-xl border border-black/10 dark:border-white/15 p-3"
										>
											<button
												type="button"
												className="w-full text-left"
												onClick={() => {
													setExpanded(expanded === g.id ? null : g.id);
													setSelected(live.map((c) => c.id));
												}}
											>
												<strong className="text-sm">
													{g.session_id
														? (sessionLabels.get(g.session_id) ?? g.label)
														: g.label}
												</strong>
												<p className="text-xs text-muted mt-1">
													납부 {won(s.paid)} · 직접 수입 {won(s.direct)} · 지출{" "}
													{won(s.spent)}
												</p>
												<p className="text-sm mt-1">
													남은 미납 {won(s.outstanding)} · 현재 순액{" "}
													{won(s.net)}
												</p>
											</button>
											{expanded === g.id && (
												<div className="mt-3 flex flex-col gap-3">
													{s.charges.map((c) => {
														const due = data.due.filter(
															(d) => d.charge_id === c.id,
														);
														return (
															<div key={c.id} className="text-sm">
																<label>
																	<input
																		type="checkbox"
																		disabled={c.state !== "live"}
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
																	{won(c.amount)} ·{" "}
																	{c.state === "cancelled"
																		? "취소"
																		: c.state === "waived"
																			? "면제"
																			: due.some((d) => d.remaining > 0)
																				? "미납/부분납"
																				: "완납"}
																</label>
																{due
																	.filter((d) => d.remaining > 0)
																	.map((d) => (
																		<p
																			className="text-xs text-muted ml-5"
																			key={d.id}
																		>
																			{d.due_ym} 납기 · {won(d.remaining)} 남음
																		</p>
																	))}
																{c.previous_id && (
																	<p className="text-xs text-muted ml-5">
																		기존 부과 취소 후 발행
																	</p>
																)}
															</div>
														);
													})}
													<button
														type="button"
														className="btn-lq-secondary"
														disabled={disabled || !selected.length}
														onClick={() =>
															setDraft({ type: "replace", chargeIds: selected })
														}
													>
														선택한 {selected.length}건 취소 후 발행
													</button>
												</div>
											)}
										</section>
									);
								})}
						</div>
					)}
					<details className="my-5">
						<summary className="text-sm text-muted">처리 이력</summary>
						<div className="flex flex-col gap-2 mt-3">
							{data.operations.map((op) => (
								<div
									className="text-xs border-b border-black/10 dark:border-white/10 py-2"
									key={op.id}
								>
									<strong>
										{actionLabel[op.action] ?? "발행 대기"}
										{op.reverted_at && " · 되돌림"}
									</strong>
									<p>
										{op.reason} ·{" "}
										{new Date(op.created_at).toLocaleString("ko-KR", {
											timeZone: "Asia/Seoul",
										})}
									</p>
								</div>
							))}
						</div>
					</details>
					{draft && (
						<OperationDialog
							key={JSON.stringify(draft)}
							draft={draft}
							data={data}
							sessions={sessions}
							onClose={() => setDraft(null)}
							onDone={refresh}
						/>
					)}
				</>
			)}
			<AccountingControls
				mode={mode}
				operationCount={data?.active_operations ?? 0}
			/>
			{settings && <DuesSettingsModal onClose={() => setSettings(false)} />}
		</AppScreen>
	);
}
