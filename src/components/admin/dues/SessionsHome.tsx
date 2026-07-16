import { Send } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { duesDeferCharge, duesNotifySelected, duesSettleDeferred, duesUndeferCharge } from "../../../lib/supabase/dues";
import { duesActions, useDuesStore } from "../../../store/duesStore";
import { toast } from "../../../store/toastStore";
import ConfirmDialog from "../../common/ConfirmDialog";
import EmptyState from "../../shared/EmptyState";
import { remaining, sessionLabel, won, ymLabel } from "./duesText";

interface UnpaidRow {
	payerId: string;
	name: string;
	remain: number;
	hasGuest: boolean;
	chargeId?: number; // 회비 미납 행 — 이월용
}
interface SessionCard {
	id: number;
	label: string;
	scheduledAt: string | null;
	courtLinked: boolean; // 코트대관 지출이 세션에 연결됨
	expense: number;
	paidCount: number;
	totalCount: number;
	unpaid: UnpaidRow[];
	status: "settled" | "open" | "none"; // 마감 / 정산 미완 / 대상 없음
}

// 정모(메인): 각 세션이 정산 단위로 잘 됐는지(①코트지출 연결 ②수납 완료 → 마감/미완) + 회비 진행 + 정산함 진입.
// 월 순액 헤드라인 없음(그건 회계). 미납 알림은 여기서 분류(회비/세션) 단위로 발송.
export default function SessionsHome({ ym }: { ym: string }) {
	const navigate = useNavigate();
	const loading = useDuesStore((s) => s.monthLoading);
	const members = useDuesStore((s) => s.members);
	const monthly = useDuesStore((s) => s.monthly);
	const court = useDuesStore((s) => s.court);
	const monthSessions = useDuesStore((s) => s.monthSessions);
	const upcomingSessions = useDuesStore((s) => s.upcomingSessions); // 예정(open) 세션 — 선납만 존재하는 미개장 세션 카드용
	const sessionTxns = useDuesStore((s) => s.sessionTxns);
	const bankTxns = useDuesStore((s) => s.bankTxns);

	const [openGroup, setOpenGroup] = useState<string | null>(null); // 펼친 발송 그룹
	const [excluded, setExcluded] = useState<Set<string>>(new Set()); // 발송 제외(groupKey:payerId)
	const [notifyReq, setNotifyReq] = useState<{ ids: string[]; msg: string; label: string } | null>(null);
	const [busy, setBusy] = useState(false);

	const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
	const roster = useMemo(() => members.filter((m) => m.isActive && !m.isAdmin), [members]);

	// 회비 진행 — 원 월(period_ym=ym) 기준. 이월된(deferred_to set) 건은 '낸 것처럼' 해결로 카운트.
	const fee = useMemo(() => {
		const own = new Map(monthly.filter((c) => c.periodYm === ym).map((c) => [c.memberId, c]));
		let paid = 0;
		const unpaid: UnpaidRow[] = [];
		for (const m of roster) {
			const c = own.get(m.id);
			if (!c) continue;
			if (c.deferredTo != null) paid++; // 이월 = 해결로 취급
			else if (c.status === "paid" || c.status === "overpaid") paid++;
			else if (c.status === "unpaid" || c.status === "partial") unpaid.push({ payerId: m.id, name: m.name, remain: remaining(c.amountDue, c.amountPaid), hasGuest: false, chargeId: c.id });
		}
		unpaid.sort((a, b) => a.name.localeCompare(b.name));
		// 다른 달에서 이월돼 온 회비(이번 달 미정산 대상)
		const carried = monthly
			.filter((c) => c.deferredTo === ym)
			.map((c) => ({ chargeId: c.id, name: memberById.get(c.memberId)?.name ?? "회원", settled: c.status === "waived", fromYm: c.periodYm }))
			.sort((a, b) => a.name.localeCompare(b.name));
		return { paid, total: roster.length, unpaid, carried };
	}, [monthly, roster, ym, memberById]);

	// 세션별 정산 상태
	const sessionCards = useMemo<SessionCard[]>(() => {
		const expenseBySession = new Map<number, number>();
		const incomeBySession = new Map<number, number>();
		for (const t of sessionTxns) {
			if (t.direction === "out") expenseBySession.set(t.sessionId, (expenseBySession.get(t.sessionId) ?? 0) + t.amount);
			else incomeBySession.set(t.sessionId, (incomeBySession.get(t.sessionId) ?? 0) + t.amount);
		}
		const chargesBySession = new Map<number, typeof court>();
		for (const c of court) {
			const arr = chargesBySession.get(c.sessionId) ?? [];
			arr.push(c);
			chargesBySession.set(c.sessionId, arr);
		}
		return monthSessions
			.map((s): SessionCard => {
				const charges = chargesBySession.get(s.id) ?? [];
				// 대납자(payer_hint ?? member)별 미납 합산
				const byPayer = new Map<string, { remain: number; hasGuest: boolean; paid: boolean }>();
				for (const c of charges) {
					const payerId = c.payerHint ?? c.memberId;
					const rem = remaining(c.amountDue, c.amountPaid);
					const e = byPayer.get(payerId) ?? { remain: 0, hasGuest: false, paid: true };
					e.remain += rem;
					if (rem > 0) e.paid = false;
					if (c.payerHint && c.memberId !== payerId) e.hasGuest = true;
					byPayer.set(payerId, e);
				}
				const payers = [...byPayer.entries()];
				const unpaid: UnpaidRow[] = payers
					.filter(([, e]) => e.remain > 0)
					.map(([payerId, e]) => ({ payerId, name: memberById.get(payerId)?.name ?? "(회원)", remain: e.remain, hasGuest: e.hasGuest }))
					.sort((a, b) => a.name.localeCompare(b.name));
				const expense = expenseBySession.get(s.id) ?? 0;
				const income = incomeBySession.get(s.id) ?? 0;
				const courtLinked = expense > 0;
				const paidCount = payers.filter(([, e]) => e.paid).length;
				const totalCount = payers.length;
				const hasSomething = charges.length > 0 || expense > 0 || income > 0;
				const status: SessionCard["status"] = !hasSomething ? "none" : courtLinked && unpaid.length === 0 ? "settled" : "open";
				return { id: s.id, label: sessionLabel(s), scheduledAt: s.scheduledAt, courtLinked, expense, paidCount, totalCount, unpaid, status };
			})
			// 실제로 열리지 않은 세션(부과·지출·수입 전무)은 정산 대상이 아니므로 숨김.
			.filter((c) => c.status !== "none")
			.sort((a, b) => (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? ""));
	}, [monthSessions, court, sessionTxns, memberById]);

	// 예정(선납) 세션: 아직 안 열린(경기기록 없어 monthSessions에 없는) 세션인데 대관비가 선납된 것.
	// 전체 참가자 부과는 세션 종료 시 생성되므로 진행률(N/전체)은 무의미 → '몇 명 선납'으로만 표시.
	const upcomingCards = useMemo(() => {
		const monthIds = new Set(monthSessions.map((s) => s.id));
		const labelById = new Map(upcomingSessions.map((s) => [s.id, s]));
		const bySession = new Map<number, typeof court>();
		for (const c of court) {
			if (monthIds.has(c.sessionId)) continue; // 열린 세션은 아래 정상 카드에서 처리
			const arr = bySession.get(c.sessionId) ?? [];
			arr.push(c);
			bySession.set(c.sessionId, arr);
		}
		return [...bySession.entries()]
			.map(([sid, charges]) => {
				const s = labelById.get(sid);
				const payers = new Set(charges.map((c) => c.payerHint ?? c.memberId)); // 대납자 기준 인원
				const paid = charges.reduce((sum, c) => sum + c.amountPaid, 0);
				return { id: sid, label: s ? sessionLabel(s) : `세션 #${sid}`, scheduledAt: s?.scheduledAt ?? null, payerCount: payers.size, paid };
			})
			.sort((a, b) => (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? ""));
	}, [court, monthSessions, upcomingSessions]);

	// 정산함 미처리 입금 수(진입 배지)
	const pendingIn = useMemo(() => bankTxns.filter((t) => t.direction === "in" && t.categoryId == null && (t.status === "unmatched" || t.status === "proposed")).length, [bankTxns]);

	const toggleSel = (key: string) =>
		setExcluded((prev) => {
			const n = new Set(prev);
			if (n.has(key)) n.delete(key);
			else n.add(key);
			return n;
		});
	const requestNotify = (groupKey: string, rows: UnpaidRow[], msg: string, label: string) => {
		const ids = rows.filter((r) => !excluded.has(`${groupKey}:${r.payerId}`)).map((r) => r.payerId);
		if (ids.length === 0) {
			toast("선택된 회원이 없어요.", { variant: "info" });
			return;
		}
		setNotifyReq({ ids, msg, label });
	};
	const doNotify = async () => {
		if (!notifyReq) return;
		const req = notifyReq;
		setNotifyReq(null);
		setBusy(true);
		const res = await duesNotifySelected(req.ids, req.msg);
		setBusy(false);
		if (res.ok) {
			const n = (res.data as { notified?: number })?.notified ?? 0;
			toast(`${req.label} 미납 알림 ${n}명 발송`, { variant: n > 0 ? "success" : "info" });
		} else {
			toast("알림 발송 실패", { variant: "error" });
		}
	};
	// 회비 이월/정산/취소 — charge 변경이라 전체 재로드.
	const runCharge = async (fn: () => Promise<{ ok: boolean; error?: string }>, errMsg: string) => {
		if (busy) return;
		setBusy(true);
		const res = await fn();
		setBusy(false);
		if (res.ok) await duesActions.loadMonth(ym, true);
		else toast(errMsg, { variant: "error" });
	};

	if (loading) return <EmptyState loading style={{ padding: "2.5rem 0" }} />;

	return (
		<div className="flex flex-col gap-3">
			{/* 정산함 진입 */}
			<button
				type="button"
				onClick={() => navigate(`/dues/${ym}/inbox`)}
				className="flex items-center gap-2 bg-[rgba(11,132,255,0.08)] border border-[rgba(11,132,255,0.2)]"
				style={{ borderRadius: 11, padding: "11px 13px", cursor: "pointer", width: "100%", textAlign: "left" }}
			>
				<span style={{ fontSize: 15 }}>📥</span>
				<span className="text-[#0b84ff]" style={{ fontSize: 13.5, fontWeight: 700 }}>정산함 · 통장 거래 처리</span>
				<span style={{ flex: 1 }} />
				{pendingIn > 0 ? (
					<span style={{ background: "#ff3b30", color: "#fff", fontSize: 11.5, fontWeight: 800, borderRadius: 999, padding: "1px 8px" }}>미처리 {pendingIn}</span>
				) : (
					<span className="text-faint" style={{ fontSize: 12 }}>›</span>
				)}
			</button>

			{/* 회비 진행 */}
			<NotifyGroup
				title={`${ymLabel(ym)} 회비`}
				subtitle={`납부 ${fee.paid}/${fee.total}`}
				meter={fee.total > 0 ? fee.paid / fee.total : 1}
				groupKey="fee"
				unpaid={fee.unpaid}
				open={openGroup === "fee"}
				onOpen={() => setOpenGroup((g) => (g === "fee" ? null : "fee"))}
				excluded={excluded}
				onToggle={toggleSel}
				busy={busy}
				onSend={() => requestNotify("fee", fee.unpaid, `${ymLabel(ym)} 회비가 아직 미납이에요. 확인 부탁드려요`, `${ymLabel(ym)} 회비`)}
				onDefer={(chargeId) => runCharge(() => duesDeferCharge(chargeId), "이월 실패")}
			/>

			{/* 이월돼 온 회비(다른 달 → 이번 달 미정산) */}
			{fee.carried.length > 0 && (
				<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 12, padding: "11px 13px" }}>
					<b className="text-strong" style={{ fontSize: 13, display: "block", marginBottom: 6 }}>이월된 회비 <span className="text-faint" style={{ fontSize: 11, fontWeight: 600 }}>· 지난달에서 미룬 것</span></b>
					<div className="flex flex-col gap-1.5">
						{fee.carried.map((c) => (
							<div key={c.chargeId} className="flex items-center gap-2" style={{ fontSize: 13 }}>
								<span className="text-strong" style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{c.name}<span className="text-faint" style={{ fontSize: 11, fontWeight: 500, marginLeft: 5 }}>{c.fromYm} 회비</span></span>
								{c.settled ? (
									<>
										<span className="text-[#1c8a3b]" style={{ fontSize: 12, fontWeight: 700 }}>정산됨</span>
										<button type="button" onClick={() => runCharge(() => duesUndeferCharge(c.chargeId), "취소 실패")} disabled={busy} className="text-faint" style={{ fontSize: 11.5, background: "none", cursor: "pointer" }}>이월 취소</button>
									</>
								) : (
									<>
										<button type="button" onClick={() => runCharge(() => duesSettleDeferred(c.chargeId), "정산 실패")} disabled={busy} className="rounded-[7px]" style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#1c8a3b", padding: "3px 10px", border: "none", cursor: "pointer" }}>정산</button>
										<button type="button" onClick={() => runCharge(() => duesUndeferCharge(c.chargeId), "취소 실패")} disabled={busy} className="text-faint" style={{ fontSize: 11.5, background: "none", cursor: "pointer" }}>취소</button>
									</>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{/* 예정(선납) 세션 — 아직 안 열렸는데 대관비 선납된 것. 진행률 대신 '몇 명 선납'. */}
			{upcomingCards.map((c) => (
				<div key={`up${c.id}`} className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 12, padding: "11px 13px" }}>
					<div className="flex items-center gap-2">
						<b className="text-strong" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{c.label}</b>
						<span style={pill("info")}>예정</span>
					</div>
					<div className="flex items-center gap-1.5" style={{ fontSize: 12, marginTop: 8 }}>
						<span className="text-muted">선납 {c.payerCount}명 · {won(c.paid)}</span>
						<span style={{ flex: 1 }} />
						<span className="text-faint" style={{ fontSize: 11.5 }}>세션 종료 후 나머지 부과 생성</span>
					</div>
				</div>
			))}

			{/* 세션별 정산 상태 */}
			{sessionCards.length === 0 && upcomingCards.length === 0 ? (
				<EmptyState style={{ fontSize: 14, padding: "2rem 0" }}>이 달 정산할 대관 세션이 없어요.</EmptyState>
			) : (
				sessionCards.map((c) => {
					const done = c.status === "settled";
					return (
						<div key={c.id} className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 12, padding: "11px 13px", opacity: done ? 0.85 : 1 }}>
							<div className="flex items-center gap-2">
								<b className="text-strong" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{c.label}</b>
								<span style={pill(done ? "ok" : "warn")}>{done ? "마감 ✓" : "정산 미완"}</span>
							</div>
							<div className="flex flex-col gap-2" style={{ marginTop: 8 }}>
								{/* 코트지출 연결 */}
								<div className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
									<span style={mark(c.courtLinked)}>{c.courtLinked ? "✓" : "!"}</span>
									<span className={c.courtLinked ? "text-muted" : "text-[#c2670a]"}>코트지출 {c.courtLinked ? `연결 · ${won(c.expense)}` : "미연결 · 정산함에서 출금→세션 지정"}</span>
								</div>
								{/* 수납 진행(막대그래프) */}
								{c.totalCount > 0 && (
									<div className="flex flex-col gap-1">
										<div className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
											<span style={mark(c.unpaid.length === 0)}>{c.unpaid.length === 0 ? "✓" : "!"}</span>
											<span className={c.unpaid.length === 0 ? "text-muted" : "text-[#c2670a]"}>대관비 수납</span>
											<span style={{ flex: 1 }} />
											<span className="text-muted" style={{ fontSize: 11.5 }}>{c.paidCount}/{c.totalCount}{c.unpaid.length > 0 ? ` · 미납 ${c.unpaid.length}` : ""}</span>
										</div>
										<Meter ratio={c.totalCount > 0 ? c.paidCount / c.totalCount : 1} done={c.unpaid.length === 0} />
									</div>
								)}
								{c.unpaid.length > 0 && (
									<div>
										<SendButton
											count={c.unpaid.length}
											open={openGroup === `s${c.id}`}
											onClick={() => setOpenGroup((g) => (g === `s${c.id}` ? null : `s${c.id}`))}
										/>
										{openGroup === `s${c.id}` && (
											<MemberToggleList groupKey={`s${c.id}`} rows={c.unpaid} excluded={excluded} onToggle={toggleSel} busy={busy} onSend={() => requestNotify(`s${c.id}`, c.unpaid, `${c.label} 대관비가 아직 미납이에요. 확인 부탁드려요`, `${c.label} 대관비`)} />
										)}
									</div>
								)}
							</div>
						</div>
					);
				})
			)}

			{notifyReq && (
				<ConfirmDialog
					title="미납 알림 발송"
					message={`${notifyReq.label} 미납 ${notifyReq.ids.length}명에게 푸시 알림을 보낼까요? (게스트/미로그인 제외)`}
					confirmLabel="발송"
					maxWidth="xs"
					onCancel={() => setNotifyReq(null)}
					onDismiss={() => setNotifyReq(null)}
					onConfirm={doNotify}
				/>
			)}
		</div>
	);
}

function pill(kind: "ok" | "warn" | "info"): CSSProperties {
	const map = {
		ok: { background: "rgba(52,199,89,0.16)", color: "#1c8a3b" },
		warn: { background: "rgba(255,149,0,0.16)", color: "#c2670a" },
		info: { background: "rgba(11,132,255,0.14)", color: "#0b84ff" },
	}[kind];
	return { fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, ...map };
}
function mark(ok: boolean): CSSProperties {
	return { width: 14, height: 14, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 9, fontWeight: 900, color: "#fff", background: ok ? "#1c8a3b" : "#d1362c", flexShrink: 0 };
}

// 진행 막대(회비·코트 수납 공용).
function Meter({ ratio, done }: { ratio: number; done: boolean }) {
	return (
		<div style={{ height: 7, borderRadius: 999, background: "rgba(120,120,128,0.16)", overflow: "hidden" }}>
			<i style={{ display: "block", height: "100%", width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`, background: done ? "#1c8a3b" : "#0b84ff", transition: "width 0.2s" }} />
		</div>
	);
}

// 미납 안내 발송 토글 버튼.
function SendButton({ count, open, onClick }: { count: number; open: boolean; onClick: () => void }) {
	return (
		<button type="button" onClick={onClick} aria-expanded={open} className="flex items-center rounded-[8px]" style={{ gap: 5, fontSize: 12, fontWeight: 700, color: "#c2670a", padding: "5px 11px", border: "none", background: "rgba(194,103,10,0.14)", cursor: "pointer" }}>
			<Send size={12} strokeWidth={2.4} />
			미납 {count}명 안내
			<span style={{ opacity: 0.7, fontWeight: 800 }}>{open ? "▲" : "▼"}</span>
		</button>
	);
}

// 회비 카드: 진행 막대 + (미납 있으면) 발송 펼침.
function NotifyGroup({ title, subtitle, meter, groupKey, unpaid, open, onOpen, excluded, onToggle, busy, onSend, onDefer }: {
	title: string;
	subtitle: string;
	meter: number;
	groupKey: string;
	unpaid: UnpaidRow[];
	open: boolean;
	onOpen: () => void;
	excluded: Set<string>;
	onToggle: (key: string) => void;
	busy: boolean;
	onSend: () => void;
	onDefer?: (chargeId: number) => void; // 회비 미납 이월(다음 달로)
}) {
	return (
		<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 12, padding: "11px 13px" }}>
			<div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
				<b className="text-strong" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{title}</b>
				<span className="text-muted" style={{ fontSize: 12 }}>{subtitle}</span>
			</div>
			<Meter ratio={meter} done={unpaid.length === 0} />
			{unpaid.length > 0 && (
				<div style={{ marginTop: 8 }}>
					<SendButton count={unpaid.length} open={open} onClick={onOpen} />
					{open && <MemberToggleList groupKey={groupKey} rows={unpaid} excluded={excluded} onToggle={onToggle} busy={busy} onSend={onSend} onDefer={onDefer} />}
				</div>
			)}
		</div>
	);
}

// 발송 대상 회원 취사선택(기본 전원 포함) + 발송. 회비면 각 회원 '이월' 가능.
function MemberToggleList({ groupKey, rows, excluded, onToggle, busy, onSend, onDefer }: {
	groupKey: string;
	rows: UnpaidRow[];
	excluded: Set<string>;
	onToggle: (key: string) => void;
	busy: boolean;
	onSend: () => void;
	onDefer?: (chargeId: number) => void;
}) {
	const selCount = rows.filter((r) => !excluded.has(`${groupKey}:${r.payerId}`)).length;
	return (
		<div className="flex flex-col" style={{ gap: 2, marginTop: 8, background: "rgba(120,120,128,0.06)", borderRadius: 10, padding: "9px 10px" }}>
			<p className="text-faint" style={{ fontSize: 11, marginBottom: 4 }}>안내 보낼 사람 · 탭하면 제외{onDefer ? " · 이월=다음 달로" : ""}</p>
			{rows.map((r) => {
				const on = !excluded.has(`${groupKey}:${r.payerId}`);
				return (
					<div key={r.payerId} className="flex items-center gap-2" style={{ fontSize: 13 }}>
						<button
							type="button"
							onClick={() => onToggle(`${groupKey}:${r.payerId}`)}
							aria-pressed={on}
							className="flex items-center gap-2"
							style={{ flex: 1, minWidth: 0, padding: "4px 2px", background: "none", border: "none", cursor: "pointer", textAlign: "left", opacity: on ? 1 : 0.4 }}
						>
							<span aria-hidden style={{ width: 18, height: 18, borderRadius: 6, flexShrink: 0, border: on ? "1.5px solid #c2670a" : "1.5px solid rgba(120,120,128,0.5)", background: on ? "#c2670a" : "transparent", color: "#fff", fontSize: 11, lineHeight: "15px", textAlign: "center", fontWeight: 900 }}>{on ? "✓" : ""}</span>
							<span className="text-strong" style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{r.name}{r.hasGuest && <span className="text-[#0b84ff]" style={{ fontSize: 11, fontWeight: 700, marginLeft: 5 }}>게스트분 포함</span>}</span>
							<span className="text-[#d1362c]" style={{ fontWeight: 700 }}>{won(r.remain)}</span>
						</button>
						{onDefer && r.chargeId != null && (
							<button type="button" onClick={() => r.chargeId != null && onDefer(r.chargeId)} disabled={busy} className="text-[#0b84ff]" style={{ fontSize: 11.5, fontWeight: 700, background: "rgba(11,132,255,0.1)", border: "none", borderRadius: 7, padding: "3px 8px", cursor: "pointer", flexShrink: 0 }}>이월</button>
						)}
					</div>
				);
			})}
			<button type="button" onClick={onSend} disabled={busy || selCount === 0} className="rounded-[9px] py-2 disabled:opacity-40" style={{ fontSize: 13, fontWeight: 800, color: "#fff", background: selCount > 0 ? "#c2670a" : "rgba(120,120,128,0.3)", marginTop: 6 }}>
				{selCount > 0 ? `${selCount}명에게 미납 안내 보내기` : "보낼 사람을 선택하세요"}
			</button>
		</div>
	);
}
