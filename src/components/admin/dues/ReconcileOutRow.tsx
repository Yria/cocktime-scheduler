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
	refundTargets: RefundTarget[]; // 환불 연결 후보(잔여 있는 입금)
	busy: boolean;
	onCategorize: (categoryId: number | null) => void;
	onSetSession: (sessionId: number | null) => void;
	onIgnore: () => void;
	onLinkRefund: (inTxId: number) => void;
}

// 미처리 출금 1건 처리. 카테고리 지정(코트대관이면 어느 세션인지) 또는 무시.
// 초과입금 차액/오입금이면 [환불 연결]로 입금과 연결(수지에서 미스터리 지출로 안 잡히게).
export default function ReconcileOutRow({ tx, categories, courtCatId, ledgerSessions, refundTargets, busy, onCategorize, onSetSession, onIgnore, onLinkRefund }: Props) {
	const [refundOpen, setRefundOpen] = useState(false);
	const isCourt = tx.categoryId != null && tx.categoryId === courtCatId;

	const catChip = (label: string, on: boolean, onClick: () => void, key: string) => (
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

			{/* 분류 */}
			<div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 9 }}>
				<span className="text-faint" style={{ fontSize: 11 }}>분류</span>
				{categories.map((cat) => catChip(cat.name, tx.categoryId === cat.id, () => onCategorize(tx.categoryId === cat.id ? null : cat.id), `cat${cat.id}`))}
				<button type="button" onClick={onIgnore} disabled={busy} className="text-faint" style={{ fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 8, border: "none", background: "rgba(120,120,128,0.1)", cursor: "pointer" }}>
					무시
				</button>
			</div>

			{/* 코트대관이면 어느 세션 */}
			{isCourt && (
				<div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 8 }}>
					<span className="text-faint" style={{ fontSize: 11 }}>세션</span>
					{ledgerSessions.length === 0 ? (
						<span className="text-faint" style={{ fontSize: 11.5 }}>대관 세션이 없어요</span>
					) : (
						ledgerSessions.map((s) => catChip(sessionLabel(s), tx.sessionId === s.id, () => onSetSession(tx.sessionId === s.id ? null : s.id), `s${s.id}`))
					)}
					{tx.sessionId == null && <span className="text-[#c2670a]" style={{ fontSize: 11 }}>← 어느 날 대관인지 고르세요</span>}
				</div>
			)}

			{/* 환불 연결 */}
			<div style={{ marginTop: 8 }}>
				<button type="button" onClick={() => setRefundOpen((v) => !v)} disabled={busy} className="text-[#c2670a]" style={{ fontSize: 11.5, fontWeight: 700, background: "none", cursor: "pointer" }}>
					{refundOpen ? "환불 닫기" : "차액·오입금 환불"}
				</button>
				{refundOpen && (
					<div className="flex flex-wrap gap-1.5" style={{ marginTop: 6 }}>
						{refundTargets.length === 0 ? (
							<span className="text-faint" style={{ fontSize: 11.5 }}>연결할 입금(잔여 있는)이 없어요</span>
						) : (
							refundTargets.map((r) => (
								<button
									key={r.id}
									type="button"
									onClick={() => onLinkRefund(r.id)}
									disabled={busy}
									className="text-muted"
									style={{ fontSize: 11.5, fontWeight: 600, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(194,103,10,0.4)", background: "rgba(194,103,10,0.08)", cursor: "pointer" }}
								>
									{fmtMD(r.date)} {r.name} <span className="text-[#1c8a3b]">+{won(r.amount)}</span>
								</button>
							))
						)}
					</div>
				)}
			</div>
		</div>
	);
}
