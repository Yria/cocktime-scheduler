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

// 미처리 출금 1건 처리(입금행과 동일한 구조). 상단 하위메뉴형(코트대관·환불) → 누르면 하단 선택지 → [확인].
//   · 코트대관을 기본 선택(대부분의 출금이 대관료). 세션 고르면 됨.
//   · 콕공구·이자 등 카테고리는 '그 외 분류'로 아래에.
//   · 하위 선택 버튼(세션·입금·카테고리) 디자인은 입금행 항목 칩과 통일.
// 코트대관은 category가 아니라 session_id 로만 식별. 환불은 refund_of_tx_id.
type Sel = { kind: "court" } | { kind: "refund" } | { kind: "category"; id: number };

export default function ReconcileOutRow({ tx, categories, ledgerSessions, refundTargets, busy, onCategorize, onSetSession, onLinkRefund }: Props) {
	const [sel, setSel] = useState<Sel>({ kind: "court" }); // 코트대관 기본 선택
	const [sessionSel, setSessionSel] = useState<number | null>(null);
	const [refundSel, setRefundSel] = useState<number | null>(null);

	const selCourt = sel.kind === "court";
	const selRefund = sel.kind === "refund";
	const selCatId = sel.kind === "category" ? sel.id : null;
	const ready = selCatId != null || (selCourt && sessionSel != null) || (selRefund && refundSel != null);

	const confirm = () => {
		if (!ready) return;
		if (selCatId != null) onCategorize(selCatId);
		else if (selCourt && sessionSel != null) onSetSession(sessionSel);
		else if (selRefund && refundSel != null) onLinkRefund(refundSel);
	};

	// 하위메뉴형 칩(외곽선 + `›`/`▾`) — '한 뎁스 더 있음'.
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
	// 선택 칩(세션·입금·카테고리) — 입금행 항목 칩과 동일 디자인.
	const pickChip = (label: string, on: boolean, onClick: () => void, key: string) => (
		<button
			key={key}
			type="button"
			onClick={onClick}
			disabled={busy}
			className={on ? "text-[#1c8a3b]" : "text-faint"}
			style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, padding: "5px 11px", borderRadius: 8, cursor: "pointer", border: "none", background: on ? "rgba(52,199,89,0.18)" : "rgba(120,120,128,0.1)" }}
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

			{/* 하위메뉴형: 코트대관·환불 */}
			<div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 9 }}>
				{stepChip("코트대관", selCourt, () => { setSel({ kind: "court" }); setSessionSel(null); }, "court")}
				{stepChip("환불", selRefund, () => { setSel({ kind: "refund" }); setRefundSel(null); }, "refund")}
			</div>

			{/* 코트대관 → 세션 / 환불 → 입금 (하위 선택지, 입금행 칩 디자인) */}
			{selCourt && (
				<div className="flex flex-wrap gap-1.5" style={{ marginTop: 7 }}>
					{ledgerSessions.length === 0 ? (
						<span className="text-faint" style={{ fontSize: 11.5 }}>대관 세션이 없어요</span>
					) : (
						ledgerSessions.map((s) => pickChip(sessionLabel(s), sessionSel === s.id, () => setSessionSel((v) => (v === s.id ? null : s.id)), `s${s.id}`))
					)}
				</div>
			)}
			{selRefund && (
				<div className="flex flex-wrap gap-1.5" style={{ marginTop: 7 }}>
					{refundTargets.length === 0 ? (
						<span className="text-faint" style={{ fontSize: 11.5 }}>잔여 있는 입금이 없어요</span>
					) : (
						refundTargets.map((r) => pickChip(`${fmtMD(r.date)} ${r.name} +${won(r.amount)}`, refundSel === r.id, () => setRefundSel((v) => (v === r.id ? null : r.id)), `r${r.id}`))
					)}
				</div>
			)}

			{/* 그 외 분류(콕공구·이자 등) — 아래에 */}
			{categories.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 9 }}>
					<span className="text-faint" style={{ fontSize: 11 }}>그 외</span>
					{categories.map((c) => pickChip(c.name, selCatId === c.id, () => setSel({ kind: "category", id: c.id }), `c${c.id}`))}
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
				{selCourt && sessionSel == null ? "세션 선택" : selRefund && refundSel == null ? "환불할 입금 선택" : "확인"}
			</button>
		</div>
	);
}
