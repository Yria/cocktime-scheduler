import { Copy } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { MyChargeRow, MyPayment } from "../../lib/supabase/dues";
import { duesActions, useDuesStore } from "../../store/duesStore";
import { toast } from "../../store/toastStore";
import EmptyState from "../shared/EmptyState";
import { currentYm, fmtMD, remaining, won, ymLabel } from "../admin/dues/duesText";

function chargeLabel(c: MyChargeRow): string {
	if (c.kind === "monthly_fee") return `${c.periodYm ? `${Number(c.periodYm.slice(5))}월` : ""} 회비`;
	const d = c.scheduledAt ? fmtMD(c.scheduledAt) : (c.sessionTitle ?? "세션");
	return `${d} 대관비${c.isProxy ? " (게스트 대납)" : ""}`;
}

// 내 회비 탭: ① 회비 납부(이번 달 미납 + 계좌 전체번호·복사) ② 납부 이력(실제 낸 것만, 월별).
export default function MyDuesTab({ memberId }: { memberId: string }) {
	const loading = useDuesStore((s) => s.myLoading);
	const charges = useDuesStore((s) => s.myCharges);
	const account = useDuesStore((s) => s.account);
	const payments = useDuesStore((s) => s.myPayments);

	useEffect(() => {
		void duesActions.loadMine(memberId);
	}, [memberId]);

	const ym = currentYm();
	// 전체 미납/부분납. 대관비는 월 무관 전부, 회비는 실효 월(이월=deferred_to, 없으면 period_ym)이
	// 이번 달 이하인 것만(미래로 이월된 건 아직 안 뜸). 회비 시스템 정산은 이번 달부터라 과거 회비 미납은 없음.
	const unpaidAll = useMemo(
		() =>
			charges.filter(
				(c) =>
					(c.status === "unpaid" || c.status === "partial") &&
					(c.kind === "court_fee" ||
						(c.kind === "monthly_fee" && (c.deferredTo ?? c.periodYm ?? "") <= ym)),
			),
		[charges, ym],
	);
	const unpaidTotal = unpaidAll.reduce((s, c) => s + remaining(c.amountDue, c.amountPaid), 0);

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

	const copyAccount = async () => {
		const num = account?.account?.replace(/\s/g, "");
		if (!num) return;
		try {
			await navigator.clipboard.writeText(num);
			toast("계좌번호를 복사했어요", { variant: "success" });
		} catch {
			toast("복사가 안 돼요 — 번호를 길게 눌러 복사하세요", { variant: "error" });
		}
	};

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
					{account?.account ? (
						<>
							<div style={{ borderTop: "1px solid rgba(11,132,255,0.18)", margin: "12px 0 10px" }} />
							<div className="flex items-center gap-2">
								<span className="text-strong" style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{account.bankName ? `${account.bankName} ` : ""}{account.account}</span>
								<button type="button" onClick={copyAccount} aria-label="계좌번호 복사" className="text-[#0b84ff] flex items-center gap-1" style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, border: "1px solid #0b84ff", background: "transparent", borderRadius: 8, padding: "4px 10px", cursor: "pointer", flexShrink: 0 }}>
									<Copy size={13} strokeWidth={2.2} /> 복사
								</button>
							</div>
							{account.accountHolder && <p className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>예금주 {account.accountHolder}</p>}
						</>
					) : (
						<>
							<div style={{ borderTop: "1px solid rgba(11,132,255,0.18)", margin: "12px 0 10px" }} />
							<p className="text-faint" style={{ fontSize: 13 }}>입금 계좌가 아직 등록되지 않았어요. 운영진에게 문의하세요.</p>
						</>
					)}
				</div>
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
