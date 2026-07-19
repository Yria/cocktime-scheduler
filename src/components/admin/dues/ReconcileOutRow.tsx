import { useMemo, useState } from "react";
import type { BankTxnRow, SessionFeeRow, TxnCategory } from "../../../lib/supabase/dues";
import { fmtMD, sessionLabel, won } from "./duesText";
import { ToggleChip } from "./duesUi";

export interface RefundTarget {
	id: number;
	name: string;
	date: string;
	amount: number;
}

interface Props {
	tx: BankTxnRow;
	categories: TxnCategory[];
	ledgerSessions: SessionFeeRow[]; // 실제 열린 세션(±1개월·경기기록) — 대부분의 대관 지출 대상
	upcomingSessions: SessionFeeRow[]; // 참가 예정(open) 세션 — 미래 대관비 선지급 대상(경기기록 없어 ledgerSessions엔 없음)
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

export default function ReconcileOutRow({ tx, categories, ledgerSessions, upcomingSessions, refundTargets, busy, onCategorize, onSetSession, onLinkRefund }: Props) {
	const [sel, setSel] = useState<Sel>({ kind: "court" }); // 코트대관 기본 선택
	const [sessionSel, setSessionSel] = useState<number | null>(null);
	const [refundSel, setRefundSel] = useState<number | null>(null);

	// 코트대관 세션 후보 = 실제 열린 세션(ledgerSessions) + 참가 예정(open) 세션(upcomingSessions).
	// 미래에 대관비를 선지급하면 세션이 아직 open(경기기록 없음)이라 ledgerSessions엔 안 잡힘 → upcoming을 병합해 '(예정)'으로 노출(입금 선납 칩과 대칭).
	// status로 상호배타(open ↔ active/closed)라 실제 겹칠 일은 없지만 id 기준 dedup으로 방어. 세션일 내림차순(미래·최근이 위).
	const courtSessions = useMemo(() => {
		const seen = new Set<number>();
		const list: { s: SessionFeeRow; upcoming: boolean }[] = [];
		for (const s of ledgerSessions) if (!seen.has(s.id)) { seen.add(s.id); list.push({ s, upcoming: false }); }
		for (const s of upcomingSessions) if (!seen.has(s.id)) { seen.add(s.id); list.push({ s, upcoming: true }); }
		return list.sort((a, b) => (b.s.scheduledAt ?? "").localeCompare(a.s.scheduledAt ?? ""));
	}, [ledgerSessions, upcomingSessions]);

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
	// 선택 칩(세션·입금·카테고리) — 입금행 항목 칩(ToggleChip)과 동일.
	const pickChip = (label: string, on: boolean, onClick: () => void, key: string) => (
		<ToggleChip key={key} label={label} on={on} onClick={onClick} disabled={busy} />
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
				{stepChip("환불", selRefund, () => { setSel({ kind: "refund" }); setRefundSel(refundTargets.find((r) => r.amount === tx.amount)?.id ?? null); }, "refund")}
			</div>

			{/* 코트대관 → 세션 / 환불 → 입금 (하위 선택지, 입금행 칩 디자인) */}
			{selCourt && (
				<div className="flex flex-wrap gap-1.5" style={{ marginTop: 7 }}>
					{courtSessions.length === 0 ? (
						<span className="text-faint" style={{ fontSize: 11.5 }}>대관 세션이 없어요</span>
					) : (
						courtSessions.map(({ s, upcoming }) => pickChip(upcoming ? `${sessionLabel(s)} (예정)` : sessionLabel(s), sessionSel === s.id, () => setSessionSel((v) => (v === s.id ? null : s.id)), `s${s.id}`))
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

			{/* 확인 (입금 카드와 동일: 구분선 위) */}
			<div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(120,120,128,0.16)" }}>
			<button
				type="button"
				onClick={confirm}
				disabled={busy || !ready}
				className="rounded-[9px] py-2 text-sm disabled:opacity-35"
				style={{ width: "100%", fontWeight: 800, color: ready ? "#fff" : undefined, background: ready ? "#1c8a3b" : "rgba(120,120,128,0.14)" }}
			>
				{selCourt && sessionSel == null ? "세션 선택" : selRefund && refundSel == null ? "환불할 입금 선택" : "확인"}
			</button>
			</div>
		</div>
	);
}
