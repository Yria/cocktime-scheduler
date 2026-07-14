import { type ReactNode, useMemo, useState } from "react";
import { type BankTxnRow, type TxnCategory, addCategory, deleteCategory } from "../../../lib/supabase/dues";
import { duesActions, useDuesStore } from "../../../store/duesStore";
import { toast } from "../../../store/toastStore";
import ConfirmDialog from "../../common/ConfirmDialog";
import { inputCls, inputStyle } from "../../common/fieldStyles";
import { sessionLabel } from "./duesText";
import { NetAmount } from "./duesUi";

// 항목별 정산(월 통장 기준·현금주의): 그 달 통장 거래만 버킷에 담아 합이 반드시 '이 달 남은 돈'과 일치.
//  - 매칭 입금은 배분내역(txAllocations)으로 회비/세션대관에 쪼갬(부분배분 잔액은 미분류).
//  - 세션 지출/수입은 '그 달' 세션거래만(다른 달 선결제 대관비는 그 달 회계로). 환불 출금은 별도 라인.
export default function LedgerBreakdown({ ym }: { ym: string }) {
	const txns = useDuesStore((s) => s.bankTxns);
	const txAllocations = useDuesStore((s) => s.txAllocations);
	const ledgerSessions = useDuesStore((s) => s.ledgerSessions); // 세션 행 라벨용(±1개월 상위집합)
	const categories = useDuesStore((s) => s.categories);

	const [newCat, setNewCat] = useState("");
	const [addingCat, setAddingCat] = useState(false);
	const [confirmDeleteCat, setConfirmDeleteCat] = useState<TxnCategory | null>(null);

	const { feeIncome, sessionRows, catRows, uncatIn, uncatOut, refundOut } = useMemo(() => {
		let uIn = 0;
		let uOut = 0;
		let fee = 0;
		let refOut = 0;
		const catMap = new Map<number, { name: string; inSum: number; outSum: number }>();
		const sess = new Map<number, { income: number; expense: number }>();
		const addSess = (id: number, key: "income" | "expense", amt: number) => {
			const e = sess.get(id) ?? { income: 0, expense: 0 };
			e[key] += amt;
			sess.set(id, e);
		};
		const addCat = (t: BankTxnRow, key: "inSum" | "outSum") => {
			const e = catMap.get(t.categoryId!) ?? { name: t.categoryName ?? "?", inSum: 0, outSum: 0 };
			e[key] += t.amount;
			catMap.set(t.categoryId!, e);
		};
		for (const t of txns) {
			if (t.direction === "in") {
				if (t.sessionId != null) addSess(t.sessionId, "income", t.amount); // 비회원 대관 입금
				else if (t.categoryId != null) addCat(t, "inSum");
				else if (t.status === "matched" || t.status === "partial") {
					const a = txAllocations[t.id];
					let allocated = 0;
					if (a) {
						fee += a.feeAmount;
						allocated += a.feeAmount;
						for (const [sid, amt] of Object.entries(a.courtBySession)) {
							addSess(Number(sid), "income", amt);
							allocated += amt;
						}
					}
					if (t.amount - allocated !== 0) uIn += t.amount - allocated; // 부분 배분 잔액 → 미분류
				} else uIn += t.amount; // 미매칭
			} else {
				if (t.refundOfTxId != null) refOut += t.amount; // 환불 출금 = 별도 라인
				else if (t.sessionId != null) addSess(t.sessionId, "expense", t.amount);
				else if (t.categoryId != null) addCat(t, "outSum");
				else uOut += t.amount;
			}
		}
		const label = new Map(ledgerSessions.map((s) => [s.id, s]));
		const rows = [...sess.entries()]
			.map(([id, e]) => ({ id, income: e.income, expense: e.expense, net: e.income - e.expense, s: label.get(id) ?? null }))
			.filter((r) => r.income > 0 || r.expense > 0)
			.sort((a, b) => (b.s?.scheduledAt ?? "").localeCompare(a.s?.scheduledAt ?? ""));
		return {
			feeIncome: fee,
			sessionRows: rows,
			uncatIn: uIn,
			uncatOut: uOut,
			refundOut: refOut,
			catRows: [...catMap.entries()].map(([id, e]) => ({ id, name: e.name, inSum: e.inSum, outSum: e.outSum, net: e.inSum - e.outSum })),
		};
	}, [txns, txAllocations, ledgerSessions]);

	const reloadFull = () => duesActions.loadMonth(ym, true); // 카테고리 추가/삭제는 전체(categories 갱신)
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

	const empty = catRows.length === 0 && sessionRows.length === 0 && feeIncome === 0 && refundOut === 0 && uncatIn === 0 && uncatOut === 0;

	return (
		<div>
			<div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
				<span style={{ width: 3.5, height: 16, borderRadius: 2, background: "#0b84ff", flexShrink: 0 }} />
				<h3 className="text-strong" style={{ fontSize: 16, fontWeight: 800 }}>항목별 정산</h3>
			</div>
			<div className="flex flex-col gap-1.5">
				{feeIncome > 0 && <Row name="걷은 회비" right={<span className="text-[#1c8a3b]" style={{ fontWeight: 800 }}>+{feeIncome.toLocaleString("ko-KR")}원</span>} />}
				{sessionRows.map((r) => (
					<Row key={r.id} name={r.s ? `${sessionLabel(r.s)} 대관비` : `세션 #${r.id} 대관비`} inAmt={r.income} outAmt={r.expense} right={<NetAmount n={r.net} />} />
				))}
				{catRows.map((r) => (
					<Row key={r.id} name={r.name} inAmt={r.inSum} outAmt={r.outSum} right={<NetAmount n={r.net} />} />
				))}
				{refundOut > 0 && <Row name="환불" outAmt={refundOut} right={<span className="text-[#d1362c]" style={{ fontWeight: 800 }}>−{refundOut.toLocaleString("ko-KR")}원</span>} />}
				{(uncatIn > 0 || uncatOut > 0) && <Row name="미분류" nameColor="#9498a2" inAmt={uncatIn} outAmt={uncatOut} right={null} />}
				{empty && <p className="text-faint" style={{ fontSize: 13 }}>이 달 거래가 없어요.</p>}
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

			{confirmDeleteCat && (
				<ConfirmDialog title={`"${confirmDeleteCat.name}" 삭제`} message="이 항목을 삭제합니다. 이 항목으로 분류했던 거래는 미분류로 돌아갑니다." confirmLabel="삭제" tone="danger" maxWidth="xs" onCancel={() => setConfirmDeleteCat(null)} onDismiss={() => setConfirmDeleteCat(null)} onConfirm={handleDeleteCategory} />
			)}
		</div>
	);
}

// 항목 한 줄: 이름 + (수입/지출 색 표시) + 순액. 수입=초록 +, 지출=빨강 −(대관료·소비 구분 없이 통일).
function Row({ name, nameColor, sub, inAmt, outAmt, right }: { name: string; nameColor?: string; sub?: string; inAmt?: number; outAmt?: number; right: ReactNode }) {
	const showIn = inAmt != null && inAmt > 0;
	const showOut = outAmt != null && outAmt > 0;
	return (
		<div className="flex items-center gap-2" style={{ fontSize: 13.5 }}>
			<span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: nameColor }} className={nameColor ? undefined : "text-strong"}>
				{name}
				{sub && <span className="text-faint" style={{ fontWeight: 500, fontSize: 11.5 }}> · {sub}</span>}
			</span>
			{(showIn || showOut) && (
				<span className="flex items-center gap-1.5" style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
					{showIn && <span className="text-[#1c8a3b]">+{inAmt.toLocaleString("ko-KR")}</span>}
					{showOut && <span className="text-[#d1362c]">−{outAmt.toLocaleString("ko-KR")}</span>}
				</span>
			)}
			{right && <span style={{ minWidth: 74, textAlign: "right" }}>{right}</span>}
		</div>
	);
}
