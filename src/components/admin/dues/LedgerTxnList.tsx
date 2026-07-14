import { useMemo, useState } from "react";
import { type BankTxnRow, duesCancelMatch, duesUnlinkRefund, setTxnCategory, setTxnSession } from "../../../lib/supabase/dues";
import { duesActions, useDuesStore } from "../../../store/duesStore";
import { toast } from "../../../store/toastStore";
import ConfirmDialog from "../../common/ConfirmDialog";
import { inputCls, inputStyle } from "../../common/fieldStyles";
import { fmtMD, sessionLabel, won } from "./duesText";

// 거래별 처리 요약 + 취소 방식. 처리된 모든 거래는 되돌릴 수 있게.
// 항목 개념 통일: 코트대관=session_id, 환불=refund_of_tx_id, 그 외=category_id / 회비=배분.
type TxInfo = { note: string | null; cancel: null | "match" | "category" | "refund" | "session"; linkTo?: number };

// 회계 거래 내역(러닝 잔액) — 최신순 목록 + 필터(회비·세션·환불·카테고리) + 처리 취소.
export default function LedgerTxnList({ ym }: { ym: string }) {
	const txns = useDuesStore((s) => s.bankTxns);
	const txAllocations = useDuesStore((s) => s.txAllocations);
	const monthSessions = useDuesStore((s) => s.monthSessions);
	const categories = useDuesStore((s) => s.categories);

	const [busyId, setBusyId] = useState<number | null>(null);
	const [cancelTx, setCancelTx] = useState<BankTxnRow | null>(null);
	const [query, setQuery] = useState("");
	// 필터 키: null=전체 · "fee" · "refund" · `cat:{id}` · `sess:{id}`(세션별)
	const [catFilter, setCatFilter] = useState<string | null>(null);
	const [highlightId, setHighlightId] = useState<number | null>(null);

	const ledger = useMemo(() => [...txns].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [txns]);
	const sessionLabelById = useMemo(() => new Map(monthSessions.map((s) => [s.id, sessionLabel(s)])), [monthSessions]);
	const txById = useMemo(() => new Map(txns.map((t) => [t.id, t])), [txns]);
	// 이 입금(IN)을 환불한 출금(OUT) 매핑 — 오입금 전액환불 입금이 '미정산'으로 보이지 않게.
	const refundOutByIn = useMemo(() => {
		const m = new Map<number, number>();
		for (const t of txns) if (t.refundOfTxId != null) m.set(t.refundOfTxId, t.id);
		return m;
	}, [txns]);

	const courtLabel = (t: BankTxnRow) => `코트대관 · ${(t.sessionId != null && sessionLabelById.get(t.sessionId)) || (t.sessionDate ? fmtMD(t.sessionDate) : "세션")}`;
	const txInfo = (t: BankTxnRow): TxInfo => {
		if (t.direction === "in") {
			if (txAllocations[t.id]) return { note: txAllocations[t.id].label, cancel: "match" };
			if (t.sessionId != null) return { note: courtLabel(t), cancel: "match" }; // 비회원 대관 수입(세션 귀속·matched) — cancel_match가 세션 해제
			if (t.categoryId != null) return { note: t.categoryName ?? "수입 분류", cancel: "category" };
			// 전액 환불된 오입금(matched) — 배분 없이 환불로만 해결. 원출금으로 점프(취소는 그 출금에서).
			// 부분 환불(아직 unmatched)은 여기 안 걸리고 아래 null → '미정산'(남은 금액 배분 필요).
			const refOut = refundOutByIn.get(t.id);
			if (refOut != null && t.status === "matched") return { note: "환불 처리됨", cancel: null, linkTo: refOut };
			return { note: null, cancel: null };
		}
		if (t.refundOfTxId != null) {
			const inName = txById.get(t.refundOfTxId)?.counterpartyName;
			return { note: `환불 → ${inName || "입금"}`, cancel: "refund", linkTo: t.refundOfTxId };
		}
		if (t.sessionId != null) return { note: courtLabel(t), cancel: "session" }; // 코트대관 지출
		if (t.categoryId != null) return { note: t.categoryName ?? "지출", cancel: "category" };
		return { note: null, cancel: null };
	};

	// 하이라이트(환불 → 원입금) : 잠시 강조 후 해제 + 스크롤.
	const jumpTo = (id: number) => {
		setHighlightId(id);
		document.getElementById(`ledgertx-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
		window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2000);
	};

	// 필터 적용(키워드=적요·처리내역, 항목=세션별/회비/환불/카테고리).
	const q = query.trim().toLowerCase();
	const filteredLedger = useMemo(
		() =>
			ledger.filter((t) => {
				if (catFilter === "fee" && !(txAllocations[t.id]?.key ?? "").startsWith("a-회비")) return false;
				else if (catFilter === "refund" && !(t.refundOfTxId != null || refundOutByIn.has(t.id))) return false;
				// 세션: 직접 링크(출금·비회원수입) + 그 세션 대관비에 배분된 입금 모두.
				else if (catFilter?.startsWith("sess:")) {
					const sid = Number(catFilter.slice(5));
					if (t.sessionId !== sid && !(txAllocations[t.id]?.sessionIds ?? []).includes(sid)) return false;
				} else if (catFilter?.startsWith("cat:") && t.categoryId !== Number(catFilter.slice(4))) return false;
				if (q) {
					const hay = `${t.counterpartyName ?? ""} ${txAllocations[t.id]?.label ?? ""} ${t.categoryName ?? ""}`.toLowerCase();
					if (!hay.includes(q)) return false;
				}
				return true;
			}),
		[ledger, catFilter, q, txAllocations, refundOutByIn],
	);

	const cancelKind = cancelTx ? txInfo(cancelTx).cancel : null;
	const cancelMsg =
		cancelKind === "match"
			? "이 입금의 연결을 취소하고 정산함(미처리)으로 되돌립니다. 이미 나간 입금확인 푸시는 회수되지 않으니 회원에게 직접 안내하세요."
			: cancelKind === "refund"
				? "이 출금의 환불 연결을 해제하고 정산함(미처리)으로 되돌립니다."
				: cancelKind === "session"
					? "이 거래의 코트대관(세션) 지정을 해제하고 정산함(미처리)으로 되돌립니다."
					: "이 거래의 분류를 취소하고 정산함(미처리)으로 되돌립니다.";

	const doCancel = async () => {
		if (!cancelTx) return;
		const t = cancelTx;
		const info = txInfo(t);
		setCancelTx(null);
		setBusyId(t.id);
		let res: { ok: boolean; error?: string };
		if (info.cancel === "match") res = await duesCancelMatch(t.id);
		else if (info.cancel === "refund") res = await duesUnlinkRefund(t.id);
		else if (info.cancel === "session") res = await setTxnSession(t.id, null); // 코트대관 해제
		else if (info.cancel === "category") res = await setTxnCategory(t.id, null);
		else res = { ok: false, error: "취소 불가" };
		setBusyId(null);
		if (res.ok) {
			// 대사 취소만 charge(amount_paid)를 되돌림 → refreshMonth. 나머지(분류·세션·환불 해제)는 tx만 → refreshTxns.
			await (info.cancel === "match" ? duesActions.refreshMonth(ym) : duesActions.refreshTxns(ym));
		} else toast("취소 실패", { variant: "error" });
	};

	const filters = [
		{ key: null as string | null, name: "전체" },
		{ key: "fee", name: "회비" },
		// 세션별 — queryCourtSessions가 이미 '경기기록 있는' 세션만 반환(원천 필터)
		...monthSessions.map((s) => ({ key: `sess:${s.id}`, name: sessionLabel(s) })),
		{ key: "refund", name: "환불" },
		...categories.map((c) => ({ key: `cat:${c.id}`, name: c.name })),
	];

	return (
		<div>
			{/* 헤더 + 필터(스크롤해도 상단 고정) */}
			<div className="bg-[#fafbff] dark:bg-[#0f172a]" style={{ position: "sticky", top: "calc(52px + env(safe-area-inset-top))", zIndex: 20, paddingTop: 6, paddingBottom: 8, marginBottom: 2 }}>
				<div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
					<span style={{ width: 3.5, height: 16, borderRadius: 2, background: "#0b84ff", flexShrink: 0 }} />
					<h3 className="text-strong" style={{ fontSize: 16, fontWeight: 800 }}>거래 내역</h3>
					<span className="text-faint" style={{ fontSize: 11.5 }}>통장 잔액 대사</span>
				</div>
				<input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·처리내역 검색" className={inputCls} style={{ ...inputStyle, padding: "7px 10px", fontSize: 13 }} />
				<div className="flex flex-wrap gap-1.5" style={{ marginTop: 7 }}>
					{filters.map((c) => {
						const on = catFilter === c.key;
						return (
							<button key={c.key ?? "all"} type="button" onClick={() => setCatFilter(c.key)} className={on ? "text-strong" : "text-muted"} style={{ fontSize: 12, fontWeight: on ? 700 : 500, padding: "4px 10px", borderRadius: 999, border: "none", background: on ? "rgba(11,132,255,0.16)" : "rgba(120,120,128,0.1)", cursor: "pointer" }}>
								{c.name}
							</button>
						);
					})}
				</div>
			</div>
			<div style={{ minHeight: 360 }}>
				{ledger.length === 0 ? (
					<p className="text-faint" style={{ fontSize: 13 }}>이 달 거래가 없어요.</p>
				) : filteredLedger.length === 0 ? (
					<p className="text-faint" style={{ fontSize: 13, paddingTop: 6 }}>조건에 맞는 거래가 없어요.</p>
				) : (
					<div className="flex flex-col">
						{filteredLedger.map((t) => {
							const info = txInfo(t);
							const pending = info.note == null; // 아직 정산 안 함
							const hl = highlightId === t.id;
							return (
								<div
									key={t.id}
									id={`ledgertx-${t.id}`}
									className="flex flex-col"
									style={{ gap: 2, borderBottom: "1px solid rgba(120,120,128,0.14)", padding: "7px 4px", borderRadius: 8, opacity: busyId === t.id ? 0.5 : pending ? 0.45 : 1, background: hl ? "rgba(11,132,255,0.16)" : undefined, transition: "background 0.4s" }}
								>
									<div className="flex items-center gap-2" style={{ fontSize: 13 }}>
										<span className="text-faint" style={{ width: 36, flexShrink: 0 }}>{fmtMD(t.occurredAt)}</span>
										<span className="text-strong" style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{t.counterpartyName || "(적요 없음)"}</span>
										<span className={t.direction === "in" ? "text-[#1c8a3b]" : "text-[#d1362c]"} style={{ fontWeight: 700 }}>{t.direction === "in" ? "+" : "−"}{won(t.amount)}</span>
										{t.balanceAfter != null && <span className="text-faint" style={{ fontSize: 11, width: 74, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{t.balanceAfter.toLocaleString("ko-KR")}</span>}
									</div>
									<div className="flex items-center gap-2" style={{ paddingLeft: 44 }}>
										{pending ? (
											<span className="text-faint" style={{ fontSize: 11 }}>미정산</span>
										) : info.linkTo != null ? (
											<button type="button" onClick={() => info.linkTo != null && jumpTo(info.linkTo)} className="text-[#0b84ff]" style={{ fontSize: 11, fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>{info.note} ↗</button>
										) : (
											info.note && <span className="text-faint" style={{ fontSize: 11, minWidth: 0 }}>{info.note}</span>
										)}
										<span style={{ flex: 1 }} />
										{info.cancel && (
											<button type="button" onClick={() => setCancelTx(t)} disabled={busyId === t.id} className="text-[#d1362c]" style={{ fontSize: 11.5, fontWeight: 700, background: "rgba(209,54,44,0.1)", border: "none", borderRadius: 6, padding: "2px 8px", cursor: "pointer", flexShrink: 0 }}>취소</button>
										)}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{cancelTx && (
				<ConfirmDialog title="처리 취소" message={cancelMsg} confirmLabel="취소 진행" tone="danger" maxWidth="xs" onCancel={() => setCancelTx(null)} onDismiss={() => setCancelTx(null)} onConfirm={doCancel} />
			)}
		</div>
	);
}
