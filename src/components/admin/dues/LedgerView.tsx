import { type ReactNode, useMemo, useState } from "react";
import {
	type BankTxnRow,
	type TxnCategory,
	addCategory,
	deleteCategory,
	duesCancelMatch,
	duesUnlinkRefund,
	setTxnCategory,
	setTxnSession,
} from "../../../lib/supabase/dues";
import { duesActions, useDuesStore } from "../../../store/duesStore";
import { toast } from "../../../store/toastStore";
import ConfirmDialog from "../../common/ConfirmDialog";
import { inputCls, inputStyle } from "../../common/fieldStyles";
import EmptyState from "../../shared/EmptyState";
import { fmtMD, sessionLabel, won } from "./duesText";

// 회계: 은행 입출금 기반 장부. 수입/지출/남은 돈 + 항목별 정산(세션 단위 대관비 순액 포함) + 거래 내역(러닝 잔액).
// 거래를 탭하면 처리 취소·재처리(정산함으로 되돌림). 출금 분류·세션 지정은 정산함에서.
export default function LedgerView({ ym }: { ym: string }) {
	const loading = useDuesStore((s) => s.monthLoading);
	const txns = useDuesStore((s) => s.bankTxns);
	const categories = useDuesStore((s) => s.categories);
	const monthSessions = useDuesStore((s) => s.monthSessions);
	const sessionTxns = useDuesStore((s) => s.sessionTxns);
	const court = useDuesStore((s) => s.court);
	const monthly = useDuesStore((s) => s.monthly);
	const txAllocations = useDuesStore((s) => s.txAllocations);

	const courtCatId = useMemo(() => categories.find((c) => c.name === "코트대관")?.id ?? null, [categories]);
	const [busyId, setBusyId] = useState<number | null>(null);
	const [openTx, setOpenTx] = useState<number | null>(null);
	const [cancelTx, setCancelTx] = useState<BankTxnRow | null>(null);
	const [newCat, setNewCat] = useState("");
	const [addingCat, setAddingCat] = useState(false);
	const [confirmDeleteCat, setConfirmDeleteCat] = useState<TxnCategory | null>(null);

	const reloadFull = () => duesActions.loadMonth(ym, true); // 카테고리 추가/삭제는 전체(categories 갱신)

	const { income, expense, latestBalance, feeIncome, sessionRows, catRows, courtUnassignedOut, uncatIn, uncatOut } = useMemo(() => {
		let inc = 0, exp = 0, courtUnassigned = 0, uIn = 0, uOut = 0;
		const catMap = new Map<number, { name: string; inSum: number; outSum: number }>();
		const sess = new Map<number, { income: number; expense: number }>();
		let latest: { at: string; bal: number } | null = null;
		for (const t of txns) {
			if (t.direction === "in") inc += t.amount;
			else exp += t.amount;
			if (t.balanceAfter != null && (!latest || t.occurredAt > latest.at)) latest = { at: t.occurredAt, bal: t.balanceAfter };
			if (t.categoryId != null && t.categoryId !== courtCatId) {
				const e = catMap.get(t.categoryId) ?? { name: t.categoryName ?? "?", inSum: 0, outSum: 0 };
				if (t.direction === "in") e.inSum += t.amount;
				else e.outSum += t.amount;
				catMap.set(t.categoryId, e);
			} else if (t.categoryId === courtCatId && t.direction === "out" && t.sessionId == null) {
				courtUnassigned += t.amount;
			} else if (t.categoryId == null) {
				if (t.direction === "in" && (t.status === "matched" || t.status === "partial")) {
					// 회비/대관비 수납은 부과(amount_paid)로 집계 → 여기선 스킵(중복 방지)
				} else if (t.direction === "in") uIn += t.amount;
				else if (t.refundOfTxId == null) uOut += t.amount; // 환불 출금은 미분류 지출로 안 잡음
			}
		}
		for (const t of sessionTxns) {
			const e = sess.get(t.sessionId) ?? { income: 0, expense: 0 };
			if (t.direction === "in") e.income += t.amount;
			else e.expense += t.amount;
			sess.set(t.sessionId, e);
		}
		for (const c of court) {
			const e = sess.get(c.sessionId) ?? { income: 0, expense: 0 };
			e.income += c.amountPaid;
			sess.set(c.sessionId, e);
		}
		const label = new Map(monthSessions.map((s) => [s.id, s]));
		const rows = [...sess.entries()]
			.map(([id, e]) => ({ id, income: e.income, expense: e.expense, net: e.income - e.expense, s: label.get(id) ?? null }))
			.filter((r) => r.income > 0 || r.expense > 0)
			.sort((a, b) => (b.s?.scheduledAt ?? "").localeCompare(a.s?.scheduledAt ?? ""));
		return {
			income: inc,
			expense: exp,
			latestBalance: latest?.bal ?? null,
			feeIncome: monthly.reduce((s, m) => s + m.amountPaid, 0),
			sessionRows: rows,
			courtUnassignedOut: courtUnassigned,
			uncatIn: uIn,
			uncatOut: uOut,
			catRows: [...catMap.entries()].map(([id, e]) => ({ id, name: e.name, inSum: e.inSum, outSum: e.outSum, net: e.inSum - e.outSum })),
		};
	}, [txns, court, monthly, monthSessions, sessionTxns, courtCatId]);

	// 거래 내역(러닝 잔액) — 최신순.
	const ledger = useMemo(() => [...txns].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [txns]);
	const sessionLabelById = useMemo(() => new Map(monthSessions.map((s) => [s.id, sessionLabel(s)])), [monthSessions]);

	// 거래별 처리 요약 + 취소 방식.
	const txInfo = (t: BankTxnRow): { note: string | null; cancel: null | "match" | "category" | "refund" } => {
		if (t.status === "ignored") return { note: "무시", cancel: null };
		if (t.direction === "in") {
			if (txAllocations[t.id]) return { note: `처리: ${txAllocations[t.id].label}`, cancel: "match" };
			if (t.categoryId != null) return { note: t.categoryName ?? "수입 분류", cancel: "category" };
			return { note: null, cancel: null };
		}
		if (t.refundOfTxId != null) return { note: "환불 연결", cancel: "refund" };
		if (t.categoryId != null) {
			const base = t.categoryName ?? "지출";
			if (t.categoryId === courtCatId && t.sessionId != null) return { note: `${base} · ${sessionLabelById.get(t.sessionId) ?? (t.sessionDate ? fmtMD(t.sessionDate) : "세션")}`, cancel: "category" };
			return { note: base, cancel: "category" };
		}
		return { note: null, cancel: null };
	};

	const doCancel = async () => {
		if (!cancelTx) return;
		const t = cancelTx;
		const info = txInfo(t);
		setCancelTx(null);
		setOpenTx(null);
		setBusyId(t.id);
		let res: { ok: boolean; error?: string };
		if (info.cancel === "match") res = await duesCancelMatch(t.id);
		else if (info.cancel === "refund") res = await duesUnlinkRefund(t.id);
		else if (info.cancel === "category") {
			// 분류 해제 = 미처리로. 세션이 물려 있으면 함께 해제(안 그러면 세션 순액에 이중 계상).
			if (t.sessionId != null) {
				const s = await setTxnSession(t.id, null);
				res = s.ok ? await setTxnCategory(t.id, null) : s;
			} else {
				res = await setTxnCategory(t.id, null);
			}
		} else res = { ok: false, error: "취소 불가" };
		setBusyId(null);
		if (res.ok) {
			// 대사 취소만 charge(amount_paid)를 되돌림 → refreshMonth. 분류·환불 해제는 tx만 → refreshTxns(§10.2).
			await (info.cancel === "match" ? duesActions.refreshMonth(ym) : duesActions.refreshTxns(ym));
		} else toast("취소 실패", { variant: "error" });
	};

	const handleAddCategory = async () => {
		const name = newCat.trim();
		if (!name || addingCat) return;
		setAddingCat(true);
		const res = await addCategory(name);
		setAddingCat(false);
		if (res.ok) {
			setNewCat("");
			await reloadFull();
		} else toast("카테고리 추가 실패", { variant: "error" });
	};
	const handleDeleteCategory = async () => {
		if (!confirmDeleteCat) return;
		const res = await deleteCategory(confirmDeleteCat.id);
		setConfirmDeleteCat(null);
		if (res.ok) await reloadFull();
		else toast("카테고리 삭제 실패", { variant: "error" });
	};

	if (loading) return <EmptyState loading style={{ padding: "2.5rem 0" }} />;

	const net = income - expense;
	const cancelMsg = cancelTx
		? txInfo(cancelTx).cancel === "match"
			? "이 입금의 연결을 취소하고 정산함(미처리)으로 되돌립니다. 이미 나간 입금확인 푸시는 회수되지 않으니 회원에게 직접 안내하세요."
			: txInfo(cancelTx).cancel === "refund"
				? "이 출금의 환불 연결을 해제하고 정산함(미처리)으로 되돌립니다."
				: "이 거래의 분류를 취소하고 정산함(미처리)으로 되돌립니다."
		: "";

	return (
		<div className="flex flex-col gap-4">
			{/* 요약 */}
			<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 14, padding: "14px 16px" }}>
				<div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
					<span className="text-muted" style={{ fontSize: 13 }}>수입</span>
					<span className="text-[#1c8a3b]" style={{ fontSize: 15, fontWeight: 800 }}>+{won(income)}</span>
				</div>
				<div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
					<span className="text-muted" style={{ fontSize: 13 }}>지출</span>
					<span className="text-[#d1362c]" style={{ fontSize: 15, fontWeight: 800 }}>−{won(expense)}</span>
				</div>
				<div className="flex items-center justify-between" style={{ borderTop: "1px solid rgba(100,116,139,0.2)", paddingTop: 8 }}>
					<span className="text-strong" style={{ fontSize: 14, fontWeight: 700 }}>이 달 남은 돈</span>
					<span className="flex flex-col items-end">
						<span className={net >= 0 ? "text-[#1c8a3b]" : "text-[#d1362c]"} style={{ fontSize: 17, fontWeight: 800 }}>{net >= 0 ? "+" : "−"}{won(Math.abs(net))}</span>
						{latestBalance != null && <span className="text-faint" style={{ fontSize: 11 }}>통장 잔액 {won(latestBalance)}</span>}
					</span>
				</div>
			</div>

			{/* 항목별 정산 */}
			<div>
				<h3 className="text-strong" style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>항목별 정산</h3>
				<div className="flex flex-col gap-1.5">
					{feeIncome > 0 && (
						<Row name="걷은 회비" right={<span className="text-[#1c8a3b]" style={{ fontWeight: 800 }}>+{won(feeIncome)}</span>} />
					)}
					{sessionRows.map((r) => (
						<Row
							key={r.id}
							name={r.s ? `${sessionLabel(r.s)} 대관비` : `세션 #${r.id} 대관비`}
							io={`받은 ${r.income.toLocaleString("ko-KR")} / 낸 ${r.expense.toLocaleString("ko-KR")}`}
							right={<span className={r.net >= 0 ? "text-[#1c8a3b]" : "text-[#d1362c]"} style={{ fontWeight: 800 }}>{r.net === 0 ? "정산 0" : `${r.net > 0 ? "+" : "−"}${won(Math.abs(r.net))}`}</span>}
						/>
					))}
					{courtUnassignedOut > 0 && (
						<Row name="세션 안 정한 코트비" nameColor="#c2670a" sub="정산함에서 출금→세션 지정" right={<span className="text-[#d1362c]" style={{ fontWeight: 800 }}>−{won(courtUnassignedOut)}</span>} />
					)}
					{catRows.map((r) => (
						<Row key={r.id} name={r.name} io={`받은 ${r.inSum.toLocaleString("ko-KR")} / 쓴 ${r.outSum.toLocaleString("ko-KR")}`} right={<span className={r.net >= 0 ? "text-[#1c8a3b]" : "text-[#d1362c]"} style={{ fontWeight: 800 }}>{r.net === 0 ? "정산 0" : `${r.net > 0 ? "+" : "−"}${won(Math.abs(r.net))}`}</span>} />
					))}
					{(uncatIn > 0 || uncatOut > 0) && (
						<Row name="미분류" nameColor="#9498a2" io={`받은 ${uncatIn.toLocaleString("ko-KR")} / 쓴 ${uncatOut.toLocaleString("ko-KR")}`} right={null} />
					)}
					{catRows.length === 0 && sessionRows.length === 0 && feeIncome === 0 && courtUnassignedOut === 0 && uncatIn === 0 && uncatOut === 0 && (
						<p className="text-faint" style={{ fontSize: 13 }}>이 달 거래가 없어요.</p>
					)}
				</div>
				{/* 카테고리 관리 */}
				<div style={{ marginTop: 10 }}>
					{categories.length > 0 && (
						<div className="flex flex-wrap gap-1.5" style={{ marginBottom: 8 }}>
							{categories.map((c) => (
								<span key={c.id} className="flex items-center bg-[rgba(100,116,139,0.12)] text-strong" style={{ fontSize: 12.5, fontWeight: 600, padding: "3px 3px 3px 10px", borderRadius: 999 }}>
									{c.name}
									<button type="button" onClick={() => setConfirmDeleteCat(c)} aria-label={`${c.name} 삭제`} className="text-faint" style={{ width: 20, height: 20, lineHeight: "18px", fontSize: 15, background: "none", cursor: "pointer" }}>×</button>
								</span>
							))}
						</div>
					)}
					<div className="flex gap-2">
						<input type="text" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAddCategory(); } }} placeholder="새 항목 (예: 회식, 상품)" className={inputCls} style={{ ...inputStyle, flex: 1, padding: "8px 10px", fontSize: 13.5 }} />
						<button type="button" onClick={handleAddCategory} disabled={addingCat || !newCat.trim()} className="btn-tint-blue rounded-[8px] px-3 text-sm bg-[rgba(11,132,255,0.12)] disabled:opacity-40" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>추가</button>
					</div>
				</div>
			</div>

			{/* 거래 내역(러닝 잔액) */}
			<div>
				<div className="flex items-baseline gap-2" style={{ marginBottom: 8 }}>
					<h3 className="text-strong" style={{ fontSize: 14, fontWeight: 800 }}>거래 내역</h3>
					<span className="text-faint" style={{ fontSize: 11.5 }}>· 탭하면 취소·재처리</span>
				</div>
				{ledger.length === 0 ? (
					<p className="text-faint" style={{ fontSize: 13 }}>이 달 거래가 없어요.</p>
				) : (
					<div className="flex flex-col">
						{ledger.map((t) => {
							const info = txInfo(t);
							const open = openTx === t.id;
							return (
								<div key={t.id} style={{ borderBottom: "1px solid rgba(120,120,128,0.14)", opacity: busyId === t.id ? 0.5 : 1 }}>
									<button
										type="button"
										onClick={() => info.cancel && setOpenTx((v) => (v === t.id ? null : t.id))}
										style={{ width: "100%", textAlign: "left", background: open ? "rgba(11,132,255,0.06)" : "none", cursor: info.cancel ? "pointer" : "default", padding: "7px 6px", borderRadius: 8, display: "flex", flexDirection: "column", gap: 2 }}
									>
										<div className="flex items-center gap-2" style={{ fontSize: 13 }}>
											<span className="text-faint" style={{ width: 36, flexShrink: 0 }}>{fmtMD(t.occurredAt)}</span>
											<span className="text-strong" style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{t.counterpartyName || "(적요 없음)"}</span>
											<span className={t.direction === "in" ? "text-[#1c8a3b]" : "text-[#d1362c]"} style={{ fontWeight: 700 }}>{t.direction === "in" ? "+" : "−"}{won(t.amount)}</span>
											{t.balanceAfter != null && <span className="text-faint" style={{ fontSize: 11, width: 74, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{t.balanceAfter.toLocaleString("ko-KR")}</span>}
										</div>
										{info.note && <span className="text-faint" style={{ fontSize: 11, paddingLeft: 44 }}>{info.note}</span>}
									</button>
									{open && info.cancel && (
										<div className="flex items-center gap-2" style={{ padding: "2px 6px 8px 44px" }}>
											<span className="text-faint" style={{ fontSize: 11.5 }}>잘못 처리했나요?</span>
											<span style={{ flex: 1 }} />
											<button type="button" onClick={() => setCancelTx(t)} className="text-[#d1362c]" style={{ fontSize: 12, fontWeight: 700, background: "none", cursor: "pointer" }}>취소하고 다시</button>
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>

			{cancelTx && (
				<ConfirmDialog title="처리 취소" message={cancelMsg} confirmLabel="취소 진행" tone="danger" maxWidth="xs" onCancel={() => setCancelTx(null)} onDismiss={() => setCancelTx(null)} onConfirm={doCancel} />
			)}
			{confirmDeleteCat && (
				<ConfirmDialog title={`"${confirmDeleteCat.name}" 삭제`} message="이 항목을 삭제합니다. 이 항목으로 분류했던 거래는 미분류로 돌아갑니다." confirmLabel="삭제" tone="danger" maxWidth="xs" onCancel={() => setConfirmDeleteCat(null)} onDismiss={() => setConfirmDeleteCat(null)} onConfirm={handleDeleteCategory} />
			)}
		</div>
	);
}

function Row({ name, nameColor, sub, io, right }: { name: string; nameColor?: string; sub?: string; io?: string; right: ReactNode }) {
	return (
		<div className="flex items-center gap-2" style={{ fontSize: 13.5 }}>
			<span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: nameColor }} className={nameColor ? undefined : "text-strong"}>
				{name}
				{sub && <span className="text-faint" style={{ fontWeight: 500, fontSize: 11.5 }}> · {sub}</span>}
			</span>
			{io && <span className="text-faint" style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>{io}</span>}
			{right && <span style={{ minWidth: 74, textAlign: "right" }}>{right}</span>}
		</div>
	);
}
