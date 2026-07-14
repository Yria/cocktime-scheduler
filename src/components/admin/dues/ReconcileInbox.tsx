import { useMemo, useState } from "react";
import {
	type BankTxnRow,
	type IngestResult,
	duesConfirmCourtExternal,
	duesConfirmReconcile,
	duesLinkRefund,
	ingestBankEmail,
	setTxnCategory,
	setTxnSession,
} from "../../../lib/supabase/dues";
import { duesActions, useDuesStore } from "../../../store/duesStore";
import { toast } from "../../../store/toastStore";
import EmptyState from "../../shared/EmptyState";
import ReconcileInRow from "./ReconcileInRow";
import ReconcileOutRow, { type RefundTarget } from "./ReconcileOutRow";
import { fmtMD, won } from "./duesText";

type Filter = "all" | "in" | "out";

// 정산함: 은행 거래 처리 큐. 상단 가져오기 → 미처리(입금·출금 한 큐, 날짜순) → 부분 처리.
// 확인·분류·무시된 거래는 모두 [회계] 거래내역에서 조회·취소한다(정산함은 '처리할 것'만 남김).
export default function ReconcileInbox({ ym }: { ym: string }) {
	const loading = useDuesStore((s) => s.monthLoading);
	const txns = useDuesStore((s) => s.bankTxns);
	const members = useDuesStore((s) => s.members);
	const unpaidByMember = useDuesStore((s) => s.unpaidByMember);
	const monthlyFee = useDuesStore((s) => s.monthlyFee);
	const courtFee = useDuesStore((s) => s.courtFee);
	const monthSessions = useDuesStore((s) => s.monthSessions);
	const ledgerSessions = useDuesStore((s) => s.ledgerSessions);
	const categories = useDuesStore((s) => s.categories);
	const txAllocations = useDuesStore((s) => s.txAllocations);

	const [ingesting, setIngesting] = useState(false);
	const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
	const [busyId, setBusyId] = useState<number | null>(null);
	const [filter, setFilter] = useState<Filter>("all");

	const { pending, partial } = useMemo(() => {
		const pending: BankTxnRow[] = [];
		const partial: BankTxnRow[] = [];
		for (const t of txns) {
			if (t.status === "ignored") continue; // 레거시 무시 거래는 회계 거래내역에서만(정산함은 처리할 것만)
			if (t.direction === "in") {
				if (t.categoryId != null || t.status === "matched") continue; // 처리됨(회계로)
				if (t.status === "partial") partial.push(t);
				else pending.push(t);
			} else {
				// 출금 처리됨 = 환불연결 / 카테고리 분류 / 코트대관(세션 지정). 셋 다 없으면 미처리.
				if (t.refundOfTxId != null || t.categoryId != null || t.sessionId != null) continue;
				pending.push(t);
			}
		}
		const byDateDesc = (a: BankTxnRow, b: BankTxnRow) => b.occurredAt.localeCompare(a.occurredAt);
		pending.sort(byDateDesc);
		partial.sort(byDateDesc);
		return { pending, partial };
	}, [txns]);

	// 환불 연결 후보: 잔여 있는 입금(미처리·부분).
	const refundTargets = useMemo<RefundTarget[]>(
		() =>
			txns
				.filter((t) => t.direction === "in" && t.categoryId == null && (t.status === "unmatched" || t.status === "partial" || t.status === "proposed"))
				.map((t) => ({ id: t.id, name: t.counterpartyName || "(적요 없음)", date: t.occurredAt, amount: t.amount }))
				.sort((a, b) => b.date.localeCompare(a.date)),
		[txns],
	);

	const filteredPending = useMemo(() => (filter === "all" ? pending : pending.filter((t) => t.direction === filter)), [pending, filter]);

	// 뮤테이션 후 갱신 범위(§10.2):
	//  - charge를 바꾸는 입금 확정(reconcile)은 refreshMonth(charges·unpaid 포함).
	//  - tx만 바꾸는 분류·세션·무시·환불·외부대관은 refreshTxns(3쿼리).
	const run = async (
		id: number,
		fn: () => Promise<{ ok: boolean; error?: string }>,
		errMsg: string,
		opts?: { okMsg?: string; touchesCharges?: boolean },
	) => {
		if (busyId) return;
		setBusyId(id);
		const res = await fn();
		setBusyId(null);
		if (res.ok) {
			if (opts?.okMsg) toast(opts.okMsg, { variant: "success" });
			await (opts?.touchesCharges ? duesActions.refreshMonth(ym) : duesActions.refreshTxns(ym));
		} else {
			toast(res.error?.includes("nothing") ? "선택 항목이 없어요." : errMsg, { variant: "error" });
		}
	};

	const handleIngest = async () => {
		if (ingesting) return;
		setIngesting(true);
		const res = await ingestBankEmail();
		setIngesting(false);
		if (res.ok) {
			setIngestResult(res.data);
			toast(`신규 ${res.data.inserted}건 · 중복 ${res.data.skipped} 건너뜀`, { variant: "success" });
			await duesActions.loadMonth(ym, true); // 가져오기=대량 변경 → 전체 갱신
		} else {
			toast(res.error.includes("forbidden") ? "운영진만 가능해요." : `가져오기 실패: ${res.error}`, { variant: "error" });
		}
	};

	if (loading) return <EmptyState loading style={{ padding: "2.5rem 0" }} />;

	const seg = (key: Filter, label: string) => (
		<button
			key={key}
			type="button"
			onClick={() => setFilter(key)}
			className={filter === key ? "text-strong" : "text-faint"}
			style={{ fontSize: 12.5, fontWeight: 700, padding: "5px 12px", borderRadius: 999, cursor: "pointer", border: "none", background: filter === key ? "rgba(11,132,255,0.14)" : "rgba(120,120,128,0.1)" }}
		>
			{label}
		</button>
	);

	return (
		<div className="flex flex-col gap-4">
			{/* 통장내역 가져오기 */}
			<div className="flex flex-col gap-1.5">
				<button type="button" onClick={handleIngest} disabled={ingesting} className="btn-solid-blue">
					{ingesting ? "가져오는 중…" : "통장내역 가져오기 (Gmail)"}
				</button>
				{ingestResult && (
					<p className="text-faint" style={{ fontSize: 12 }}>
						메일 {ingestResult.fetched} · 거래 {ingestResult.parsed} · 신규 {ingestResult.inserted} · 중복 {ingestResult.skipped}
						{ingestResult.errors ? ` · ⚠️ ${ingestResult.errors.join("; ")}` : ""}
					</p>
				)}
			</div>

			{/* 미처리 */}
			<section>
				<div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
					<h3 className="text-strong" style={{ fontSize: 14, fontWeight: 800 }}>
						처리할 거래 {pending.length}건
						{pending.length === 0 && txns.length > 0 && <span className="text-[#1c8a3b]" style={{ fontWeight: 700 }}> · 모두 처리됨 👍</span>}
					</h3>
					<span style={{ flex: 1 }} />
					<div className="flex gap-1">{seg("all", "전체")}{seg("in", "입금")}{seg("out", "출금")}</div>
				</div>
				{txns.length === 0 ? (
					<p className="text-faint" style={{ fontSize: 13 }}>[통장내역 가져오기]로 거래를 불러오세요.</p>
				) : filteredPending.length === 0 ? (
					<p className="text-faint" style={{ fontSize: 13 }}>{pending.length === 0 ? "미처리 거래가 없어요." : "해당 필터에 미처리 거래가 없어요."}</p>
				) : (
					<div className="flex flex-col gap-2">
						{filteredPending.map((t) =>
							t.direction === "in" ? (
								<ReconcileInRow
									key={t.id}
									tx={t}
									members={members}
									unpaidByMember={unpaidByMember}
									monthSessions={monthSessions}
									categories={categories}
									monthlyFee={monthlyFee}
									courtFee={courtFee}
									busy={busyId === t.id}
									onConfirm={(payerId, chargeIds, cym, sessions) => run(t.id, () => duesConfirmReconcile(t.id, payerId, chargeIds, cym, sessions), "처리 실패", { touchesCharges: true })}
									onConfirmCourtExternal={(sid) => run(t.id, () => duesConfirmCourtExternal(t.id, sid), "외부인 대관비 처리 실패")}
									onCategorize={(catId) => run(t.id, () => setTxnCategory(t.id, catId), "분류 실패")}
								/>
							) : (
								<ReconcileOutRow
									key={t.id}
									tx={t}
									categories={categories}
									ledgerSessions={ledgerSessions}
									refundTargets={refundTargets}
									busy={busyId === t.id}
									onCategorize={(catId) => run(t.id, () => setTxnCategory(t.id, catId), "분류 실패")}
									onSetSession={(sid) => run(t.id, () => setTxnSession(t.id, sid), "세션 지정 실패")}
									onLinkRefund={(inId) => run(t.id, () => duesLinkRefund(t.id, inId), "환불 연결 실패", { okMsg: "환불로 연결했어요" })}
								/>
							),
						)}
					</div>
				)}
			</section>

			{/* 부분 처리 */}
			{partial.length > 0 && (
				<section>
					<h3 className="text-[#c2670a]" style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>
						부분 처리 {partial.length}건 <span className="text-faint" style={{ fontSize: 11.5, fontWeight: 600 }}>· 입금액 일부만 배분됨</span>
					</h3>
					<div className="flex flex-col gap-1.5">
						{partial.map((t) => (
							<div key={t.id} className="flex items-center gap-2" style={{ fontSize: 13 }}>
								<span className="text-faint" style={{ width: 40 }}>{fmtMD(t.occurredAt)}</span>
								<span className="text-strong" style={{ flex: 1, minWidth: 0 }}>
									{t.counterpartyName}
									{txAllocations[t.id] && <span className="text-[#0b84ff]" style={{ fontSize: 11.5, fontWeight: 600, marginLeft: 5 }}>→ {txAllocations[t.id].label}</span>}
								</span>
								<span className="text-[#c2670a]" style={{ fontWeight: 700 }}>{won(t.amount)}</span>
							</div>
						))}
					</div>
					<p className="text-faint" style={{ fontSize: 11.5, marginTop: 6 }}>남은 금액은 회원에게 더 받거나, 초과분이면 위 출금에서 [환불 연결]하세요. 취소·재처리는 [회계]에서.</p>
				</section>
			)}
		</div>
	);
}
