import { useEffect, useMemo } from "react";
import type { MyPayment } from "../../lib/supabase/dues";
import { duesActions, useDuesStore } from "../../store/duesStore";
import EmptyState from "../shared/EmptyState";
import { currentYm, fmtMD, remaining, won, ymLabel } from "../admin/dues/duesText";
import AccountCopyRow from "./AccountCopyRow";
import RefundPendingCard from "./RefundPendingCard";
import { chargeLabel, selectUnpaid, unpaidSum } from "./myUnpaid";

// 내 회비 탭: ① 회비 납부(이번 달 미납 + 계좌 전체번호·복사) ② 납부 이력(실제 낸 것만, 월별).
export default function MyDuesTab({ memberId }: { memberId: string }) {
	const loading = useDuesStore((s) => s.myLoading);
	const charges = useDuesStore((s) => s.myCharges);
	const account = useDuesStore((s) => s.account);
	const payments = useDuesStore((s) => s.myPayments);
	const refunds = useDuesStore((s) => s.myRefunds);

	useEffect(() => {
		void duesActions.loadMine(memberId);
	}, [memberId]);

	const ym = currentYm();
	// 미납 판정은 myUnpaid.selectUnpaid 공유(진입 알림과 정의 일치).
	const unpaidAll = useMemo(() => selectUnpaid(charges, ym), [charges, ym]);
	const unpaidTotal = unpaidSum(unpaidAll);

	// 납부 이력 월별 그룹(RPC가 이미 최신순 → 삽입순 유지)
	const groups = useMemo(() => {
		const m = new Map<string, MyPayment[]>();
		for (const p of payments) {
			const arr = m.get(p.ym);
			if (arr) arr.push(p);
			else m.set(p.ym, [p]);
		}
		return [...m.entries()];
	}, [payments]);

	if (loading) return <EmptyState loading style={{ padding: "2.5rem 0" }} />;

	return (
		<div className="flex flex-col gap-4">
			{/* ① 회비 납부 */}
			<div>
				<div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
					<span style={{ width: 3.5, height: 15, borderRadius: 2, background: "#0b84ff", flexShrink: 0 }} />
					<h3 className="text-strong" style={{ fontSize: 15, fontWeight: 800 }}>회비 납부</h3>
				</div>
				<div className="bg-[rgba(11,132,255,0.06)] border border-[rgba(11,132,255,0.22)]" style={{ borderRadius: 14, padding: "15px 16px" }}>
					{/* 미납 현황(전체 — 이번 달만이 아님) */}
					<div className="flex items-center justify-between">
						<span className="text-muted" style={{ fontSize: 13, fontWeight: 600 }}>미납 현황</span>
						{unpaidTotal > 0 ? (
							<span className="bg-[rgba(255,59,48,0.14)] text-[#d1362c]" style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 999 }}>미납</span>
						) : (
							<span className="bg-[rgba(52,199,89,0.16)] text-[#1c8a3b]" style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 999 }}>완납</span>
						)}
					</div>
					{unpaidTotal > 0 ? (
						<>
							<p className="text-[#d1362c]" style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{won(unpaidTotal)}</p>
							<div className="flex flex-col gap-0.5" style={{ marginTop: 2 }}>
								{unpaidAll.map((c) => (
									<span key={c.id} className="text-muted" style={{ fontSize: 12.5 }}>{chargeLabel(c)} · {won(remaining(c.amountDue, c.amountPaid))}</span>
								))}
							</div>
						</>
					) : (
						<p className="text-[#1c8a3b]" style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>미납이 없어요 👍</p>
					)}

					{/* 계좌 */}
					<div style={{ borderTop: "1px solid rgba(11,132,255,0.18)", margin: "12px 0 10px" }} />
					<AccountCopyRow account={account} />
				</div>

				{/* 돌려받을 돈 — 미납과 반대 방향의 돈이라 납부 카드 밖에 따로 세운다. */}
				{refunds.length > 0 && (
					<div style={{ marginTop: 10 }}>
						<RefundPendingCard rows={refunds} />
					</div>
				)}
			</div>

			{/* ② 납부 이력 */}
			<div>
				<div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
					<span style={{ width: 3.5, height: 15, borderRadius: 2, background: "#0b84ff", flexShrink: 0 }} />
					<h3 className="text-strong" style={{ fontSize: 15, fontWeight: 800 }}>납부 이력</h3>
				</div>
				{groups.length === 0 ? (
					<p className="text-faint" style={{ fontSize: 13 }}>아직 납부한 내역이 없어요.</p>
				) : (
					<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 12, padding: "4px 14px" }}>
						{groups.map(([gYm, items]) => (
							<div key={gYm}>
								<p className="text-faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.03em", margin: "9px 0 3px" }}>{ymLabel(gYm)}</p>
								{items.map((p) => (
									<div key={p.txId} className="flex flex-col" style={{ borderBottom: "1px solid rgba(120,120,128,0.14)", padding: "8px 0" }}>
										<div className="flex items-baseline gap-2">
											<span className="text-faint" style={{ fontSize: 11.5, width: 40, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{fmtMD(p.date)}</span>
											<span className="text-strong" style={{ fontSize: 14, fontWeight: 800 }}>{won(p.amount)}</span>
										</div>
										<span className="text-muted" style={{ fontSize: 12, marginLeft: 48, marginTop: 1 }}>{p.purpose}</span>
									</div>
								))}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
