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
	courtCatId: number | null;
	ledgerSessions: SessionFeeRow[];
	refundTargets: RefundTarget[]; // 환불 후보(잔여 있는 입금)
	busy: boolean;
	onCategorize: (categoryId: number | null) => void;
	onSetSession: (sessionId: number | null) => void;
	onLinkRefund: (inTxId: number) => void;
}

// 미처리 출금 1건 처리. 정산 항목 = 자동반영형(콕공구·기타 등, 채운 칩=한 번에 반영) + 하위메뉴형(코트대관·환불,
// 외곽선+`›`=누르면 세션/입금 선택이 한 뎁스 더). 하위메뉴형은 앞쪽 정렬·모양을 달리해 '한 단계 더 있음'을 표시.
export default function ReconcileOutRow({ tx, categories, courtCatId, ledgerSessions, refundTargets, busy, onCategorize, onSetSession, onLinkRefund }: Props) {
	const [refundOpen, setRefundOpen] = useState(false);
	const isCourt = tx.categoryId != null && tx.categoryId === courtCatId;
	// 코트대관은 하위메뉴(세션)형이라 자동반영 칩 목록에서 뺀다(환불은 카테고리가 아니라 별도 처리).
	const plainCats = categories.filter((c) => c.id !== courtCatId);

	// 자동반영 칩(한 번 누르면 바로 반영).
	const plainChip = (label: string, on: boolean, onClick: () => void, key: string) => (
		<button
			key={key}
			type="button"
			onClick={onClick}
			disabled={busy}
			className={on ? "text-[#1c8a3b]" : "text-muted"}
			style={{ fontSize: 12, fontWeight: on ? 700 : 600, padding: "5px 10px", borderRadius: 8, border: "none", background: on ? "rgba(52,199,89,0.18)" : "rgba(120,120,128,0.1)", cursor: "pointer" }}
		>
			{on ? "✓ " : ""}{label}
		</button>
	);
	// 하위메뉴형 칩(외곽선 + `›`/`▾`, 누르면 아래에 선택지가 열림).
	const stepChip = (label: string, open: boolean, onClick: () => void, key: string) => (
		<button
			key={key}
			type="button"
			onClick={onClick}
			disabled={busy}
			className={open ? "text-[#0b84ff]" : "text-muted"}
			style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 8, cursor: "pointer", border: open ? "1.5px solid #0b84ff" : "1.5px solid rgba(120,120,128,0.35)", background: open ? "rgba(11,132,255,0.1)" : "transparent" }}
		>
			{label} <span style={{ opacity: 0.7, fontWeight: 800 }}>{open ? "▾" : "›"}</span>
		</button>
	);
	// 하위 선택지 칩(세션·입금) — 한 뎁스 안이라 살짝 들여쓰고 구분.
	const subChip = (label: string, on: boolean, onClick: () => void, key: string, tint = "#1c8a3b") => (
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

			{/* 정산 항목 — 하위메뉴형(코트대관·환불) 먼저, 그다음 자동반영형 */}
			<div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 9 }}>
				<span className="text-faint" style={{ fontSize: 11 }}>정산</span>
				{courtCatId != null && stepChip("코트대관", isCourt, () => onCategorize(isCourt ? null : courtCatId), "court")}
				{stepChip("환불", refundOpen, () => setRefundOpen((v) => !v), "refund")}
				{plainCats.map((c) => plainChip(c.name, tx.categoryId === c.id, () => onCategorize(tx.categoryId === c.id ? null : c.id), `c${c.id}`))}
			</div>

			{/* 코트대관 → 어느 세션(하위) */}
			{isCourt && (
				<div className="flex flex-wrap gap-1.5" style={{ marginTop: 7, marginLeft: 10, paddingLeft: 8, borderLeft: "2px solid rgba(11,132,255,0.25)" }}>
					{ledgerSessions.length === 0 ? (
						<span className="text-faint" style={{ fontSize: 11.5 }}>대관 세션이 없어요</span>
					) : (
						ledgerSessions.map((s) => subChip(sessionLabel(s), tx.sessionId === s.id, () => onSetSession(tx.sessionId === s.id ? null : s.id), `s${s.id}`))
					)}
				</div>
			)}

			{/* 환불 → 어느 입금(하위) */}
			{refundOpen && (
				<div className="flex flex-wrap gap-1.5" style={{ marginTop: 7, marginLeft: 10, paddingLeft: 8, borderLeft: "2px solid rgba(11,132,255,0.25)" }}>
					{refundTargets.length === 0 ? (
						<span className="text-faint" style={{ fontSize: 11.5 }}>잔여 있는 입금이 없어요</span>
					) : (
						refundTargets.map((r) => subChip(`${fmtMD(r.date)} ${r.name} +${won(r.amount)}`, false, () => onLinkRefund(r.id), `r${r.id}`, "#c2670a"))
					)}
				</div>
			)}
		</div>
	);
}
