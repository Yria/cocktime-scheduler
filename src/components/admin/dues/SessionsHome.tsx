import { Send } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { duesNotifySelected } from "../../../lib/supabase/dues";
import { useDuesStore } from "../../../store/duesStore";
import { toast } from "../../../store/toastStore";
import ConfirmDialog from "../../common/ConfirmDialog";
import EmptyState from "../../shared/EmptyState";
import { remaining, sessionLabel, won, ymLabel } from "./duesText";

interface UnpaidRow {
	payerId: string;
	name: string;
	remain: number;
	hasGuest: boolean;
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
	const sessionTxns = useDuesStore((s) => s.sessionTxns);
	const bankTxns = useDuesStore((s) => s.bankTxns);

	const [openGroup, setOpenGroup] = useState<string | null>(null); // 펼친 발송 그룹
	const [excluded, setExcluded] = useState<Set<string>>(new Set()); // 발송 제외(groupKey:payerId)
	const [notifyReq, setNotifyReq] = useState<{ ids: string[]; msg: string; label: string } | null>(null);
	const [busy, setBusy] = useState(false);

	const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
	const roster = useMemo(() => members.filter((m) => m.isActive && !m.isAdmin), [members]);

	// 회비 진행
	const fee = useMemo(() => {
		const byMember = new Map(monthly.map((c) => [c.memberId, c]));
		let paid = 0;
		const unpaid: UnpaidRow[] = [];
		for (const m of roster) {
			const c = byMember.get(m.id);
			if (c && (c.status === "paid" || c.status === "overpaid")) paid++;
			else if (c && (c.status === "unpaid" || c.status === "partial")) unpaid.push({ payerId: m.id, name: m.name, remain: remaining(c.amountDue, c.amountPaid), hasGuest: false });
		}
		unpaid.sort((a, b) => a.name.localeCompare(b.name));
		return { paid, total: roster.length, unpaid };
	}, [monthly, roster]);

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
			.sort((a, b) => (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? ""));
	}, [monthSessions, court, sessionTxns, memberById]);

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
			/>

			{/* 세션별 정산 상태 */}
			<p className="text-faint" style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", marginTop: 4 }}>정모 · 정산 상태</p>
			{sessionCards.length === 0 ? (
				<EmptyState style={{ fontSize: 14, padding: "2rem 0" }}>이 달 대관 세션이 없어요.</EmptyState>
			) : (
				sessionCards.map((c) => (
					<div key={c.id} className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 12, padding: "11px 13px", opacity: c.status === "settled" || c.status === "none" ? 0.82 : 1 }}>
						<div className="flex items-center gap-2">
							<b className="text-strong" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{c.label}</b>
							{c.status === "settled" ? (
								<span style={pill("ok")}>마감 ✓</span>
							) : c.status === "none" ? (
								<span style={pill("mut")}>정산 대상 없음</span>
							) : (
								<span style={pill("warn")}>정산 미완</span>
							)}
						</div>
						{c.status !== "none" && (
							<div className="flex flex-col gap-1" style={{ marginTop: 7 }}>
								<div className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
									<span style={mark(c.courtLinked)}>{c.courtLinked ? "✓" : "!"}</span>
									<span className={c.courtLinked ? "text-muted" : "text-[#c2670a]"}>코트지출 {c.courtLinked ? `연결 · ${won(c.expense)}` : "미연결 (정산함에서 출금→세션 지정)"}</span>
								</div>
								{c.totalCount > 0 && (
									<div className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
										<span style={mark(c.unpaid.length === 0)}>{c.unpaid.length === 0 ? "✓" : "!"}</span>
										<span className={c.unpaid.length === 0 ? "text-muted" : "text-[#c2670a]"}>수납 {c.paidCount}/{c.totalCount}{c.unpaid.length > 0 ? ` · 미납 ${c.unpaid.length}` : ""}</span>
									</div>
								)}
								{c.unpaid.length > 0 && (
									<div style={{ marginTop: 4 }}>
										<button
											type="button"
											onClick={() => setOpenGroup((g) => (g === `s${c.id}` ? null : `s${c.id}`))}
											className="btn-tint-blue rounded-[8px] px-2.5 py-1 bg-[rgba(194,103,10,0.14)]"
											style={{ fontSize: 12, fontWeight: 700, color: "#c2670a" }}
										>
											<Send size={12} strokeWidth={2.4} style={{ display: "inline", marginRight: 4, verticalAlign: "-1px" }} />
											미납 {c.unpaid.length} 발송
										</button>
										{openGroup === `s${c.id}` && (
											<MemberToggleList groupKey={`s${c.id}`} rows={c.unpaid} excluded={excluded} onToggle={toggleSel} busy={busy} onSend={() => requestNotify(`s${c.id}`, c.unpaid, `${c.label} 대관비가 아직 미납이에요. 확인 부탁드려요`, `${c.label} 대관비`)} />
										)}
									</div>
								)}
							</div>
						)}
					</div>
				))
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

function pill(kind: "ok" | "warn" | "mut"): CSSProperties {
	const map = {
		ok: { background: "rgba(52,199,89,0.16)", color: "#1c8a3b" },
		warn: { background: "rgba(255,149,0,0.16)", color: "#c2670a" },
		mut: { background: "rgba(120,120,128,0.14)", color: "#8b8e97" },
	}[kind];
	return { fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, ...map };
}
function mark(ok: boolean): CSSProperties {
	return { width: 14, height: 14, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 9, fontWeight: 900, color: "#fff", background: ok ? "#1c8a3b" : "#d1362c", flexShrink: 0 };
}

// 회비 카드: 진행 미터 + (미납 있으면) 발송 펼침.
function NotifyGroup({ title, subtitle, meter, groupKey, unpaid, open, onOpen, excluded, onToggle, busy, onSend }: {
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
}) {
	return (
		<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 12, padding: "11px 13px" }}>
			<div className="flex items-center gap-2">
				<b className="text-strong" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{title}</b>
				<span className="text-muted" style={{ fontSize: 12 }}>{subtitle}</span>
			</div>
			<div style={{ height: 7, borderRadius: 999, background: "rgba(120,120,128,0.16)", overflow: "hidden", marginTop: 7 }}>
				<i style={{ display: "block", height: "100%", width: `${Math.round(meter * 100)}%`, background: unpaid.length === 0 ? "#1c8a3b" : "#0b84ff" }} />
			</div>
			{unpaid.length > 0 && (
				<div style={{ marginTop: 8 }}>
					<button type="button" onClick={onOpen} className="btn-tint-blue rounded-[8px] px-2.5 py-1 bg-[rgba(194,103,10,0.14)]" style={{ fontSize: 12, fontWeight: 700, color: "#c2670a" }}>
						<Send size={12} strokeWidth={2.4} style={{ display: "inline", marginRight: 4, verticalAlign: "-1px" }} />
						미납 {unpaid.length} 발송
					</button>
					{open && <MemberToggleList groupKey={groupKey} rows={unpaid} excluded={excluded} onToggle={onToggle} busy={busy} onSend={onSend} />}
				</div>
			)}
		</div>
	);
}

// 발송 대상 회원 취사선택(기본 전원 포함) + 발송.
function MemberToggleList({ groupKey, rows, excluded, onToggle, busy, onSend }: {
	groupKey: string;
	rows: UnpaidRow[];
	excluded: Set<string>;
	onToggle: (key: string) => void;
	busy: boolean;
	onSend: () => void;
}) {
	const selCount = rows.filter((r) => !excluded.has(`${groupKey}:${r.payerId}`)).length;
	return (
		<div className="flex flex-col gap-1" style={{ marginTop: 8 }}>
			{rows.map((r) => {
				const on = !excluded.has(`${groupKey}:${r.payerId}`);
				return (
					<div key={r.payerId} className="flex items-center gap-2" style={{ fontSize: 13 }}>
						<button
							type="button"
							onClick={() => onToggle(`${groupKey}:${r.payerId}`)}
							aria-label={on ? "발송 대상 해제" : "발송 대상 선택"}
							style={{ width: 19, height: 19, borderRadius: 6, cursor: "pointer", flexShrink: 0, border: on ? "1.5px solid #c2670a" : "1.5px solid rgba(120,120,128,0.4)", background: on ? "#c2670a" : "transparent", color: "#fff", fontSize: 12, lineHeight: "16px", textAlign: "center", fontWeight: 900 }}
						>
							{on ? "✓" : ""}
						</button>
						<span className="text-strong" style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{r.name}{r.hasGuest && <span className="text-[#0b84ff]" style={{ fontSize: 11, fontWeight: 700, marginLeft: 5 }}>게스트분 포함</span>}</span>
						<span className="text-[#d1362c]" style={{ fontWeight: 700 }}>{won(r.remain)}</span>
					</div>
				);
			})}
			<button type="button" onClick={onSend} disabled={busy || selCount === 0} className="rounded-[8px] py-1.5 disabled:opacity-40" style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: "#c2670a", marginTop: 3 }}>
				{selCount}명에게 발송
			</button>
		</div>
	);
}
