import { Plus, Search } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import type { AdminMemberRow } from "../../../lib/supabase/adminMembers";
import type { BankTxnRow, SessionFeeRow, TxnCategory, UnpaidCharge } from "../../../lib/supabase/dues";
import { inputCls, inputStyle } from "../../common/fieldStyles";
import { genderText } from "../memberAdminText";
import { fmtMD, remaining, sessionLabel, won, ymOfIso } from "./duesText";
import { type MemberLite, suggestMembers } from "./matching";

interface Props {
	tx: BankTxnRow;
	members: AdminMemberRow[];
	unpaidByMember: Record<string, UnpaidCharge[]>;
	monthSessions: SessionFeeRow[]; // 이번 달 대관 세션(신규 대관비 생성 후보)
	categories: TxnCategory[];
	monthlyFee: number;
	courtFee: number;
	busy: boolean;
	/** 통합 확정: 기존 미납(chargeIds) 배분 + 신규 회비(ym)/세션(sessions) 생성·배분. */
	onConfirm: (payerId: string, chargeIds: number[], ym: string, sessions: { id: number; units: number }[]) => void;
	onConfirmCourtExternal: (sessionId: number) => void;
	onCategorize: (categoryId: number) => void;
}

interface Sel {
	charges: Set<number>; // 선택된 기존 미납 charge id
	monthly: boolean; // 신규 이번달 회비 생성
	sessions: Set<number>; // 신규 세션 대관비(온/오프, 1인분씩) — 비회원 대관과 동일한 토글
}

// 미처리 입금 1건 처리. 납부자 지정 → 그 회원의 기존 미납(본인+대납·월무관) 배분 + 신규(회비/세션) 생성을
// 함께 골라 [확인] 1회로. 금액(§4)으로 기본 선택 제안. 비회원 대관·비회비 수입 분류도 여기서.
export default function ReconcileInRow({ tx, members, unpaidByMember, monthSessions, categories, monthlyFee, courtFee, busy, onConfirm, onConfirmCourtExternal, onCategorize }: Props) {
	const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
	const candidates = useMemo(() => suggestMembers(tx.counterpartyName, members), [tx.counterpartyName, members]);
	const [selectedId, setSelectedId] = useState<string | null>(candidates[0]?.id ?? null);
	const [extraIds, setExtraIds] = useState<string[]>([]); // 이 입금으로 함께 내주는 다른 사람(회원·게스트)
	const [searchOpen, setSearchOpen] = useState(false); // 사람 검색(납부자 없으면 납부자 지정, 있으면 대납 추가)
	const [query, setQuery] = useState("");
	const [override, setOverride] = useState<Sel | null>(null); // null = 프리셀렉트 사용
	const [extSession, setExtSession] = useState<number | null>(null); // 비회원 대관 세션

	const depositYm = ymOfIso(tx.occurredAt) ?? "";
	const selectedMember = selectedId ? memberById.get(selectedId) : undefined;

	// 이 회원의 기존 미납(본인 + 대납 게스트분, 월무관).
	const existing = useMemo(() => (selectedId ? (unpaidByMember[selectedId] ?? []) : []), [selectedId, unpaidByMember]);
	const existingMonthly = useMemo(() => existing.find((c) => c.kind === "monthly_fee" && c.periodYm === depositYm), [existing, depositYm]);
	const existingCourt = useMemo(() => existing.filter((c) => c.kind === "court_fee"), [existing]);
	// 이번 달 세션 중 아직 대관비 부과가 없는 것 = 신규 생성 후보(즉석/커스텀).
	const newSessionCandidates = useMemo(() => {
		const charged = new Set(existingCourt.map((c) => c.sessionId));
		return monthSessions.filter((s) => !charged.has(s.id));
	}, [existingCourt, monthSessions]);

	// 함께 내주는 다른 사람들의 미납(대납) — 사람별 그룹으로 분리(칩에 이름 접두 대신 그룹 헤더로 구분).
	const extraGroups = useMemo(() => {
		if (!selectedId) return [] as { id: string; name: string; charges: UnpaidCharge[] }[];
		const seen = new Set(existing.map((c) => c.id));
		const groups: { id: string; name: string; charges: UnpaidCharge[] }[] = [];
		for (const eid of extraIds) {
			if (eid === selectedId) continue;
			const charges: UnpaidCharge[] = [];
			for (const c of unpaidByMember[eid] ?? []) {
				if (seen.has(c.id)) continue;
				seen.add(c.id);
				charges.push(c);
			}
			groups.push({ id: eid, name: memberById.get(eid)?.name ?? "회원", charges });
		}
		return groups;
	}, [selectedId, extraIds, unpaidByMember, existing, memberById]);
	// 전체 선택 대상 부과(본인 + 대납) — 합계·검증용.
	const chargeById = useMemo(() => {
		const m = new Map<number, UnpaidCharge>();
		for (const c of existing) m.set(c.id, c);
		for (const g of extraGroups) for (const c of g.charges) m.set(c.id, c);
		return m;
	}, [existing, extraGroups]);

	// 금액(§4) 기반 기본 선택: 기존 미납 우선(참가 세션 → 최근순), 회비는 없으면 신규 생성.
	const monthSessionIds = useMemo(() => new Set(monthSessions.map((s) => s.id)), [monthSessions]);
	const preselect = useMemo<Sel>(() => {
		const charges = new Set<number>();
		if (!selectedId) return { charges, monthly: false, sessions: new Set() };
		const afterFee = tx.amount - monthlyFee;
		let wantMonthly = false;
		let k = 0;
		if (afterFee >= 0 && courtFee > 0 && afterFee % courtFee === 0) {
			wantMonthly = true;
			k = afterFee / courtFee;
		} else if (courtFee > 0 && tx.amount % courtFee === 0) {
			k = tx.amount / courtFee;
		}
		if (selectedMember?.isGuest) wantMonthly = false;
		let monthly = false;
		if (wantMonthly) {
			if (existingMonthly) charges.add(existingMonthly.id);
			else monthly = true;
		}
		const courtSorted = [...existingCourt].sort((a, b) => {
			const pa = a.sessionId != null && monthSessionIds.has(a.sessionId) ? 1 : 0;
			const pb = b.sessionId != null && monthSessionIds.has(b.sessionId) ? 1 : 0;
			if (pa !== pb) return pb - pa; // 이번 달 참가분 우선
			return (b.sessionDate ?? "").localeCompare(a.sessionDate ?? ""); // 최근순
		});
		for (const c of courtSorted.slice(0, k)) charges.add(c.id);
		return { charges, monthly, sessions: new Set() };
	}, [selectedId, selectedMember, tx.amount, monthlyFee, courtFee, existingMonthly, existingCourt, monthSessionIds]);

	const active = override ?? preselect;
	const existingTotal = [...active.charges].reduce((s, id) => {
		const c = chargeById.get(id);
		return c ? s + remaining(c.amountDue, c.amountPaid) : s;
	}, 0);
	const total = existingTotal + (active.monthly ? monthlyFee : 0) + active.sessions.size * courtFee;

	const selectMember = (id: string) => {
		setSelectedId((prev) => (prev === id ? null : id));
		setExtraIds([]); // 납부자 바뀌면 대납 대상 초기화
		setOverride(null);
		setSearchOpen(false);
		setQuery("");
	};
	// 검색 결과 선택: 납부자 없으면 납부자 지정, 있으면 '함께 낼 사람'으로 추가.
	const pickResult = (id: string) => {
		if (!selectedId) {
			selectMember(id);
			return;
		}
		if (id !== selectedId) setExtraIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
		setSearchOpen(false);
		setQuery("");
	};
	const removeExtra = (id: string) => {
		setExtraIds((prev) => prev.filter((x) => x !== id));
		const removed = new Set((unpaidByMember[id] ?? []).map((c) => c.id));
		setOverride({ charges: new Set([...active.charges].filter((cid) => !removed.has(cid))), monthly: active.monthly, sessions: new Set(active.sessions) });
	};
	const toggleCharge = (id: number) => {
		const n: Sel = { charges: new Set(active.charges), monthly: active.monthly, sessions: new Set(active.sessions) };
		if (n.charges.has(id)) n.charges.delete(id);
		else n.charges.add(id);
		setOverride(n);
	};
	const toggleMonthly = () => setOverride({ charges: new Set(active.charges), monthly: !active.monthly, sessions: new Set(active.sessions) });
	const toggleSession = (sid: number) => {
		const n = new Set(active.sessions);
		if (n.has(sid)) n.delete(sid); // 온/오프 토글(비회원 대관과 동일, 1인분)
		else n.add(sid);
		setOverride({ charges: new Set(active.charges), monthly: active.monthly, sessions: n });
	};

	const q = query.trim().toLowerCase();
	const searchResults = q ? members.filter((m) => m.name.toLowerCase().includes(q) && m.id !== selectedId && !extraIds.includes(m.id)).slice(0, 6) : [];
	const chipMembers = useMemo(() => {
		const arr: MemberLite[] = [...candidates];
		if (selectedMember && !arr.some((c) => c.id === selectedMember.id)) arr.unshift(selectedMember);
		return arr.slice(0, 4);
	}, [candidates, selectedMember]);

	// 비회원 대관(회원 매칭 없이 대관비 배수일 때).
	const externalCourt = !selectedId && courtFee > 0 && tx.amount % courtFee === 0;

	const itemChip = (label: string, on: boolean, onClick: () => void, key: string) => (
		<button
			key={key}
			type="button"
			onClick={onClick}
			className={on ? "text-[#1c8a3b]" : "text-faint"}
			style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, padding: "5px 11px", borderRadius: 8, cursor: "pointer", border: "none", background: on ? "rgba(52,199,89,0.18)" : "rgba(120,120,128,0.1)" }}
		>
			{on ? "✓ " : ""}{label}
		</button>
	);
	// 미납 부과 칩(이름 접두 없이 — 사람 구분은 그룹 헤더로). 크로스먼스면 ↩.
	const chargeChip = (c: UnpaidCharge, key: string) => {
		const cross = c.kind === "monthly_fee" ? c.periodYm !== depositYm : c.sessionDate != null && ymOfIso(c.sessionDate) !== depositYm;
		return itemChip(`${c.label} ${won(remaining(c.amountDue, c.amountPaid))}${cross ? " ↩" : ""}`, active.charges.has(c.id), () => toggleCharge(c.id), key);
	};
	const payerHasItems = existing.length > 0 || (!selectedMember?.isGuest && !existingMonthly) || newSessionCandidates.length > 0;
	const groupLabel: CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: "0.02em" };

	return (
		<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 12, padding: "11px 13px", opacity: busy ? 0.5 : 1 }}>
			{/* 입금 정보 */}
			<div className="flex items-center gap-2">
				<span className="text-faint" style={{ fontSize: 12, width: 40 }}>{fmtMD(tx.occurredAt)}</span>
				<span className="text-strong" style={{ flex: 1, fontSize: 14, fontWeight: 600, minWidth: 0 }}>{tx.counterpartyName || "(적요 없음)"}</span>
				<span className="flex flex-col items-end" style={{ flexShrink: 0 }}>
					<span className="text-[#1c8a3b]" style={{ fontSize: 14, fontWeight: 800 }}>+{won(tx.amount)}</span>
					{tx.balanceAfter != null && <span className="text-faint" style={{ fontSize: 10.5 }}>잔액 {won(tx.balanceAfter)}</span>}
				</span>
			</div>

			{/* 납부자 (지정되면 🔍가 ＋로 바뀌어 '함께 낼 사람' 추가) */}
			<div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 9 }}>
				<span className="text-faint" style={{ fontSize: 11, fontWeight: 700, alignSelf: "center" }}>납부자</span>
				{chipMembers.length === 0 && !searchOpen && <span className="text-faint" style={{ fontSize: 12.5 }}>제안 없음 — 검색하세요</span>}
				{chipMembers.map((m) => {
					const on = m.id === selectedId;
					const gm = memberById.get(m.id);
					return (
						<button
							key={m.id}
							type="button"
							onClick={() => selectMember(m.id)}
							className={on ? "text-strong" : "text-muted"}
							style={{ fontSize: 13, fontWeight: 700, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: on ? "1.5px solid #0b84ff" : "1.5px solid transparent", background: on ? "rgba(11,132,255,0.12)" : "rgba(120,120,128,0.1)" }}
						>
							{m.name}
							<span className="text-faint" style={{ fontWeight: 500, marginLeft: 4 }}>{gm?.isGuest ? "게스트" : `${genderText(m.gender)}${m.birthYear ? String(m.birthYear % 100).padStart(2, "0") : ""}`}</span>
						</button>
					);
				})}
				{searchOpen ? (
					<span className="flex items-center gap-1" style={{ flex: 1, minWidth: 120 }}>
						{/* biome-ignore lint/a11y/noAutofocus: 검색 열면 바로 입력하도록 */}
						<input type="text" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={selectedId ? "함께 낼 사람 검색" : "이름 검색"} className={inputCls} style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 13 }} />
						<button type="button" onClick={() => { setSearchOpen(false); setQuery(""); }} aria-label="검색 닫기" className="text-faint" style={{ fontSize: 15, lineHeight: 1, padding: "0 4px", background: "none", cursor: "pointer" }}>✕</button>
					</span>
				) : (
					<button type="button" onClick={() => { setSearchOpen(true); setQuery(""); }} aria-label={selectedId ? "함께 낼 사람 추가" : "회원 검색"} className="text-faint flex items-center justify-center" style={{ width: 30, height: 28, borderRadius: 999, border: "1.5px solid transparent", background: "rgba(120,120,128,0.1)", cursor: "pointer" }}>
						{selectedId ? <Plus size={15} strokeWidth={2.4} /> : <Search size={13} strokeWidth={2.2} />}
					</button>
				)}
			</div>
			{searchOpen && query.trim() && (
				<div className="flex flex-wrap gap-1.5" style={{ marginTop: 6 }}>
					{searchResults.length === 0 ? (
						<span className="text-faint" style={{ fontSize: 12 }}>검색 결과 없음</span>
					) : (
						searchResults.map((m) => (
							<button key={m.id} type="button" onClick={() => pickResult(m.id)} className="text-muted" style={{ fontSize: 13, padding: "5px 11px", borderRadius: 999, border: "none", background: "rgba(120,120,128,0.1)", cursor: "pointer" }}>
								{m.name} <span className="text-faint">{m.isGuest ? "게스트" : `${genderText(m.gender)}${m.birthYear ? ` ${m.birthYear}` : ""}`}</span>
							</button>
						))
					)}
				</div>
			)}

			{/* 항목: 기존 미납 + 신규 회비/세션 */}
			{selectedId && (
				<div className="flex flex-col" style={{ gap: 10, marginTop: 9 }}>
					{/* 납부자 본인 항목 (대납 있을 때만 이름 헤더 표시) */}
					<div className="flex flex-col gap-1">
						{extraGroups.length > 0 && <span className="text-muted" style={groupLabel}>{selectedMember?.name}</span>}
						<div className="flex flex-wrap gap-1.5">
							{existing.map((c) => chargeChip(c, `c${c.id}`))}
							{!selectedMember?.isGuest && !existingMonthly && itemChip(`${Number(depositYm.slice(5))}월 회비 ${won(monthlyFee)}`, active.monthly, toggleMonthly, "newm")}
							{newSessionCandidates.map((s) => itemChip(`${sessionLabel(s)} 대관비`, active.sessions.has(s.id), () => toggleSession(s.id), `s${s.id}`))}
							{!payerHasItems && <span className="text-faint" style={{ fontSize: 12 }}>낼 항목 없음(완납/부과 없음)</span>}
						</div>
					</div>
					{/* 대납 대상별 항목 — 사람마다 영역 분리(칩엔 이름 안 붙임). 헤더 × 로 제거 */}
					{extraGroups.map((g) => (
						<div key={g.id} className="flex flex-col gap-1">
							<span className="flex items-center gap-1">
								<span className="text-muted" style={groupLabel}>{g.name}</span>
								<button type="button" onClick={() => removeExtra(g.id)} aria-label={`${g.name} 대납 제거`} className="text-faint" style={{ fontSize: 13, lineHeight: 1, padding: "0 2px", background: "none", cursor: "pointer" }}>×</button>
							</span>
							<div className="flex flex-wrap gap-1.5">
								{g.charges.length === 0 ? <span className="text-faint" style={{ fontSize: 12 }}>미납 없음</span> : g.charges.map((c) => chargeChip(c, `x${c.id}`))}
							</div>
						</div>
					))}
				</div>
			)}

			{/* 비회원 대관: 회원 매칭 없이 세션 귀속 */}
			{!selectedId && externalCourt && (
				<div className="flex flex-wrap gap-1.5" style={{ marginTop: 9 }}>
					<span className="text-faint" style={{ fontSize: 11.5, alignSelf: "center" }}>비회원 대관 →</span>
					{monthSessions.length === 0 ? (
						<span className="text-faint" style={{ fontSize: 11.5 }}>이 달 대관 세션이 없어요</span>
					) : (
						monthSessions.map((s) => itemChip(`${sessionLabel(s)} 대관비`, extSession === s.id, () => setExtSession((v) => (v === s.id ? null : s.id)), `ext${s.id}`))
					)}
				</div>
			)}

			{/* 상태 + 액션 */}
			<div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(120,120,128,0.16)" }}>
				<p className="text-muted" style={{ fontSize: 11.5, marginBottom: 7, minHeight: 15 }}>
					{selectedId ? (
						total > 0 ? (
							<>
								<b className="text-strong">{selectedMember?.name}</b> · 선택 {won(total)}
								{total !== tx.amount && <span className="text-[#c2670a]"> (입금 {won(tx.amount)})</span>}
							</>
						) : (
							""
						)
					) : externalCourt ? (
						extSession ? "비회원 대관비 — 확인하면 세션 수입으로" : "회원을 검색하거나, 비회원 대관비면 세션을 고르세요"
					) : (
						"납부한 회원을 검색·선택하세요"
					)}
				</p>
				<div className="flex items-center gap-2">
					{selectedId ? (
						<button
							type="button"
							onClick={() => total > 0 && onConfirm(selectedId, [...active.charges], active.monthly ? depositYm : "", [...active.sessions].map((id) => ({ id, units: 1 })))}
							disabled={busy || total <= 0}
							className="rounded-[9px] py-2 text-sm disabled:opacity-35"
							style={{ flex: 1, fontWeight: 800, color: total > 0 ? "#fff" : undefined, background: total > 0 ? "#1c8a3b" : "rgba(120,120,128,0.14)" }}
						>
							{total > 0 ? `확인 · ${won(total)}` : "항목 선택"}
						</button>
					) : (
						<button
							type="button"
							onClick={() => extSession && onConfirmCourtExternal(extSession)}
							disabled={busy || !extSession}
							className="rounded-[9px] py-2 text-sm disabled:opacity-35"
							style={{ flex: 1, fontWeight: 800, color: extSession ? "#fff" : undefined, background: extSession ? "#1c8a3b" : "rgba(120,120,128,0.14)" }}
						>
							{extSession ? `비회원 대관비 확인 · ${won(tx.amount)}` : "회원/세션 선택"}
						</button>
					)}
				</div>
				{/* 비회비 수입 분류(콕공구·이자·정모·기타). 코트대관은 카테고리가 아니라 위 비회원 세션 선택으로. */}
				<div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 8 }}>
					{categories.map((cat) => (
						<button key={cat.id} type="button" onClick={() => onCategorize(cat.id)} disabled={busy} className="text-muted" style={{ fontSize: 12, fontWeight: 600, padding: "4px 9px", borderRadius: 8, border: "none", background: "rgba(120,120,128,0.1)", cursor: "pointer" }}>
							{cat.name}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
