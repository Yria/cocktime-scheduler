import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { MyChargeRow } from "../../lib/supabase/dues";
import { useAuthStore } from "../../store/authStore";
import { duesActions, useDuesStore } from "../../store/duesStore";
import AppScreen from "../common/AppScreen";
import EmptyState from "../shared/EmptyState";
import {
	currentYm,
	fmtMD,
	moneyClass,
	remaining,
	signed,
	statusChipClass,
	statusLabel,
	won,
	ymLabel,
	ymOfIso,
} from "../admin/dues/duesText";
import { NetAmount } from "../admin/dues/duesUi";

function chargeLabel(c: MyChargeRow): string {
	if (c.kind === "monthly_fee") return `${c.periodYm ?? ""} 회비`;
	const d = c.scheduledAt ? fmtMD(c.scheduledAt) : (c.sessionTitle ?? "세션");
	return `${d} 대관비${c.isProxy ? " (게스트 대납)" : ""}`;
}

// 내 회비(로그인 회원 전체). 본인 부과·납부 내역 + 클럽 계좌(마스킹) + 클럽 회계(항목별, 투명성).
export default function MyDuesPage() {
	const navigate = useNavigate();
	const ready = useAuthStore((s) => s.ready);
	const memberLoaded = useAuthStore((s) => s.memberLoaded);
	const memberId = useAuthStore((s) => s.memberId);

	const loading = useDuesStore((s) => s.myLoading);
	const charges = useDuesStore((s) => s.myCharges);
	const account = useDuesStore((s) => s.account);
	const ledger = useDuesStore((s) => s.myLedger);

	const ym = currentYm();

	useEffect(() => {
		if (ready && memberLoaded && !memberId) navigate("/", { replace: true });
	}, [ready, memberLoaded, memberId, navigate]);

	const load = useCallback(
		() => (memberId ? duesActions.loadMine(memberId, ym) : Promise.resolve()),
		[memberId, ym],
	);
	useEffect(() => {
		if (ready && memberId) void load();
	}, [ready, memberId, load]);

	const thisMonth = useMemo(
		() =>
			charges.filter(
				(c) => (c.kind === "monthly_fee" && c.periodYm === ym) || (c.kind === "court_fee" && ymOfIso(c.scheduledAt) === ym),
			),
		[charges, ym],
	);
	const thisMonthUnpaid = thisMonth.reduce((s, c) => s + (c.status === "unpaid" || c.status === "partial" ? remaining(c.amountDue, c.amountPaid) : 0), 0);

	if (!ready || !memberLoaded) return null;

	return (
		<AppScreen title="내 회비" onBack={() => navigate(-1)} onRefresh={load}>
			{loading ? (
				<EmptyState loading style={{ padding: "2.5rem 0" }} />
			) : (
				<div className="flex flex-col gap-4">
					{/* 이번 달 요약 */}
					<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 14, padding: "16px 16px" }}>
						<p className="text-faint" style={{ fontSize: 13, fontWeight: 600 }}>{ymLabel(ym)}</p>
						{thisMonthUnpaid > 0 ? (
							<p className="text-strong" style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>미납 <span style={{ color: "#d1362c" }}>{won(thisMonthUnpaid)}</span></p>
						) : thisMonth.length > 0 ? (
							<p className="text-strong" style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: "#1c8a3b" }}>납부 완료 👍</p>
						) : (
							<p className="text-muted" style={{ fontSize: 15, marginTop: 4 }}>부과 내역이 없어요.</p>
						)}
						{thisMonth.length > 0 && (
							<div className="flex flex-col gap-1.5" style={{ marginTop: 12 }}>
								{thisMonth.map((c) => (
									<div key={c.id} className="flex items-center gap-2">
										<span className="text-muted" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{chargeLabel(c)} · {won(c.amountDue)}</span>
										<span className={`${statusChipClass(c.status)} px-2 py-0.5`} style={{ borderRadius: 999, fontSize: 11.5, fontWeight: 700 }}>{statusLabel(c.status)}</span>
									</div>
								))}
							</div>
						)}
					</div>

					{/* 클럽 계좌 */}
					{account && (account.accountMasked || account.bankName) && (
						<div className="bg-[rgba(11,132,255,0.06)] border border-[rgba(11,132,255,0.18)]" style={{ borderRadius: 14, padding: "14px 16px" }}>
							<p className="text-faint" style={{ fontSize: 12.5, fontWeight: 600 }}>입금 계좌</p>
							<p className="text-strong" style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>{account.bankName ?? ""} {account.accountMasked ?? ""}</p>
							{account.accountHolder && <p className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>예금주 {account.accountHolder}</p>}
							<p className="text-faint" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>정확한 계좌번호는 운영진에게 문의하세요.</p>
						</div>
					)}

					{/* 납부 내역 */}
					<div>
						<p className="text-strong" style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>납부 내역</p>
						{charges.length === 0 ? (
							<p className="text-muted" style={{ fontSize: 14 }}>아직 부과된 회비가 없어요.</p>
						) : (
							<div className="flex flex-col gap-2">
								{charges.map((c) => (
									<div key={c.id} className="flex items-center gap-2 bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]" style={{ borderRadius: 10, padding: "10px 12px" }}>
										<span className="text-strong" style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 }}>{chargeLabel(c)}</span>
										<span className="text-faint" style={{ fontSize: 13 }}>{won(c.amountDue)}</span>
										<span className={`${statusChipClass(c.status)} px-2 py-0.5`} style={{ borderRadius: 999, fontSize: 11.5, fontWeight: 700 }}>{statusLabel(c.status)}</span>
									</div>
								))}
							</div>
						)}
					</div>

					{/* 클럽 회계(항목별, 투명성) */}
					{ledger && (ledger.feeCollected > 0 || ledger.sessions.length > 0 || ledger.categories.length > 0 || ledger.refund > 0 || ledger.uncatIn > 0 || ledger.uncatOut > 0) && (
						<div>
							<p className="text-strong" style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>클럽 회계 · {ymLabel(ym)}</p>
							<p className="text-faint" style={{ fontSize: 12, marginBottom: 8 }}>클럽이 이 달 무엇으로 얼마를 걷고 썼는지(항목별). 개별 회원 내역은 운영진만 봅니다.</p>
							<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)] flex flex-col gap-1.5" style={{ borderRadius: 12, padding: "12px 14px" }}>
								{ledger.feeCollected > 0 && (
									<LedgerRow name="걷은 회비" right={<span className="text-[#1c8a3b]" style={{ fontWeight: 800 }}>+{won(ledger.feeCollected)}</span>} />
								)}
								{ledger.sessions.map((s, i) => (
									<LedgerRow key={`sess${i}`} name={`${s.date} ${s.place ?? ""} 대관비`.trim()} right={<NetAmount n={s.net} />} />
								))}
								{ledger.categories.map((c, i) => (
									<LedgerRow key={`cat${i}`} name={c.name} right={<NetAmount n={c.net} />} />
								))}
								{ledger.refund > 0 && (
									<LedgerRow name="환불" right={<span className="text-[#d1362c]" style={{ fontWeight: 800 }}>−{won(ledger.refund)}</span>} />
								)}
								{(ledger.uncatIn > 0 || ledger.uncatOut > 0) && (
									<LedgerRow name="미분류" nameColor="#9498a2" right={<NetAmount n={ledger.uncatIn - ledger.uncatOut} />} />
								)}
								<div className="flex items-center gap-2" style={{ borderTop: "1px solid rgba(120,120,128,0.2)", paddingTop: 7, marginTop: 2 }}>
									<span className="text-strong" style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>이 달 남은 돈</span>
									<span className={moneyClass(ledger.net >= 0)} style={{ fontSize: 15, fontWeight: 800 }}>{signed(ledger.net)}</span>
								</div>
							</div>
						</div>
					)}
				</div>
			)}
		</AppScreen>
	);
}

function LedgerRow({ name, nameColor, right }: { name: string; nameColor?: string; right: ReactNode }) {
	return (
		<div className="flex items-center gap-2" style={{ fontSize: 13.5 }}>
			<span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: nameColor }} className={nameColor ? undefined : "text-strong"}>{name}</span>
			{right}
		</div>
	);
}
