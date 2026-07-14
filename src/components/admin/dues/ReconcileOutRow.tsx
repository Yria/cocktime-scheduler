import { useState } from "react";
import type { BankTxnRow, SessionFeeRow, TxnCategory } from "../../../lib/supabase/dues";
import { fmtMD, sessionLabel, won } from "./duesText";

export interface RefundTarget {
	id: number;
	name: string;
	date: string;
	amount: number;
}

interface Props {
	tx: BankTxnRow;
	categories: TxnCategory[];
	ledgerSessions: SessionFeeRow[];
	refundTargets: RefundTarget[]; // 환불 후보(잔여 있는 입금)
	busy: boolean;
	onCategorize: (categoryId: number) => void;
	onSetSession: (sessionId: number) => void; // 코트대관 = 세션만 지정(카테고리 없음)
	onLinkRefund: (inTxId: number) => void;
}

// 미처리 출금 1건 처리(입금행과 동일한 구조). 상단에서 정산 항목을 고르면 하단 내용이 바뀌고 [확인]으로 정산.
//   · 하위메뉴형(코트대관·환불): 외곽선+`›`/`▾`, 앞 정렬. 누르면 하단에 세션/입금 선택이 열림.
//   · 자동선택형(콕공구·이자·정모·기타 = 카테고리): 채운 칩. 누르면 바로 선택됨.
// 코트대관은 category가 아니라 session_id 로만 식별(미리 정의된 항목). 환불은 refund_of_tx_id.
type Sel = { kind: "court" } | { kind: "refund" } | { kind: "category"; id: number } | null;

export default function ReconcileOutRow({ tx, categories, ledgerSessions, refundTargets, busy, onCategorize, onSetSession, onLinkRefund }: Props) {
	const [sel, setSel] = useState<Sel>(null);
	const [sessionSel, setSessionSel] = useState<number | null>(null);
	const [refundSel, setRefundSel] = useState<number | null>(null);

	const selCourt = sel?.kind === "court";
	const selRefund = sel?.kind === "refund";
	const selCatId = sel?.kind === "category" ? sel.id : null;
	const ready = selCatId != null || (selCourt && sessionSel != null) || (selRefund && refundSel != null);

	const confirm = () => {
		if (!ready) return;
		if (selCatId != null) onCategorize(selCatId);
		else if (selCourt && sessionSel != null) onSetSession(sessionSel);
		else if (selRefund && refundSel != null) onLinkRefund(refundSel);
	};

	// 하위메뉴형 칩(외곽선 + `›`/`▾`).
	const stepChip = (label: string, open: boolean, onClick: () => void, key: string) => (
		<button
			key={key}
			type="button"
			onClick={onClick}
			disabled={busy}
			className={open ? "text-[#0b84ff]" : "text-muted"}
			style={{ fontSize: 12.5, fontWeight: 700, padding: "6px 11px", borderRadius: 8, cursor: "pointer", border: open ? "1.5px solid #0b84ff" : "1.5px solid rgba(120,120,128,0.35)", background: open ? "rgba(11,132,255,0.1)" : "transparent" }}
		>
			{label} <span style={{ opacity: 0.7, fontWeight: 800 }}>{open ? "▾" : "›"}</span>
		</button>
	);
	// 자동선택형(카테고리) 칩.
	const plainChip = (label: string, on: boolean, onClick: () => void, key: string) => (
		<button
			key={key}
			type="button"
			onClick={onClick}
			disabled={busy}
			className={on ? "text-[#1c8a3b]" : "text-muted"}
			style={{ fontSize: 12.5, fontWeight: on ? 700 : 600, padding: "6px 11px", borderRadius: 8, border: "none", background: on ? "rgba(52,199,89,0.18)" : "rgba(120,120,128,0.1)", cursor: "pointer" }}
		>
			{on ? "✓ " : ""}{label}
		</button>
	);
	// 하위 선택지(세션·입금).
	const subChip = (label: string, on: boolean, onClick: () => void, key: string, tint: string) => (
		<button
			key={key}
			type="button"
			onClick={onClick}
			disabled={busy}
			style={{ fontSize: 11.5, fontWeight: on ? 700 : 600, padding: "5px 10px", borderRadius: 8, border: "none", cursor: "pointer", color: on ? "#fff" : tint, background: on ? tint : `${tint}1f` }}
		>
			{on ? "✓ " : ""}{label}
		</button>
	);

	return (
		<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 12, padding: "11px 13px", opacity: busy ? 0.5 : 1 }}>
			<div className="flex items-center gap-2">
				<span className="text-faint" style={{ fontSize: 12, width: 40 }}>{fmtMD(tx.occurredAt)}</span>
				<span className="text-strong" style={{ flex: 1, fontSize: 14, fontWeight: 600, minWidth: 0 }}>{tx.counterpartyName || "(적요 없음)"}</span>
				<span className="flex flex-col items-end" style={{ flexShrink: 0 }}>
					<span className="text-[#d1362c]" style={{ fontSize: 14, fontWeight: 800 }}>−{won(tx.amount)}</span>
					{tx.balanceAfter != null && <span className="text-faint" style={{ fontSize: 10.5 }}>잔액 {won(tx.balanceAfter)}</span>}
				</span>
			</div>

			{/* 정산 항목 — 하위메뉴형(코트대관·환불) 먼저, 그다음 자동선택 카테고리 */}
			<div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 9 }}>
				{stepChip("코트대관", selCourt, () => { setSel(selCourt ? null : { kind: "court" }); setSessionSel(null); }, "court")}
				{stepChip("환불", selRefund, () => { setSel(selRefund ? null : { kind: "refund" }); setRefundSel(null); }, "refund")}
				{categories.map((c) => plainChip(c.name, selCatId === c.id, () => setSel(selCatId === c.id ? null : { kind: "category", id: c.id }), `c${c.id}`))}
			</div>

			{/* 하단: 선택에 따라 변경 */}
			{selCourt && (
				<div className="flex flex-wrap gap-1.5" style={{ marginTop: 7, marginLeft: 10, paddingLeft: 8, borderLeft: "2px solid rgba(11,132,255,0.25)" }}>
					{ledgerSessions.length === 0 ? (
						<span className="text-faint" style={{ fontSize: 11.5 }}>대관 세션이 없어요</span>
					) : (
						ledgerSessions.map((s) => subChip(sessionLabel(s), sessionSel === s.id, () => setSessionSel((v) => (v === s.id ? null : s.id)), `s${s.id}`, "#1c8a3b"))
					)}
				</div>
			)}
			{selRefund && (
				<div className="flex flex-wrap gap-1.5" style={{ marginTop: 7, marginLeft: 10, paddingLeft: 8, borderLeft: "2px solid rgba(11,132,255,0.25)" }}>
					{refundTargets.length === 0 ? (
						<span className="text-faint" style={{ fontSize: 11.5 }}>잔여 있는 입금이 없어요</span>
					) : (
						refundTargets.map((r) => subChip(`${fmtMD(r.date)} ${r.name} +${won(r.amount)}`, refundSel === r.id, () => setRefundSel((v) => (v === r.id ? null : r.id)), `r${r.id}`, "#c2670a"))
					)}
				</div>
			)}

			{/* 확인 */}
			<button
				type="button"
				onClick={confirm}
				disabled={busy || !ready}
				className="rounded-[9px] py-2 text-sm disabled:opacity-35"
				style={{ width: "100%", marginTop: 10, fontWeight: 800, color: ready ? "#fff" : undefined, background: ready ? "#1c8a3b" : "rgba(120,120,128,0.14)" }}
			>
				{sel == null ? "정산 항목 선택" : selCourt && sessionSel == null ? "세션 선택" : selRefund && refundSel == null ? "환불할 입금 선택" : "확인"}
			</button>
		</div>
	);
}
