import { Plus, Search } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import type { AdminMemberRow } from "../../../lib/supabase/adminMembers";
import type { BankTxnRow, SessionFeeRow, TxnCategory, UnpaidCharge, UpcomingSessionRow } from "../../../lib/supabase/dues";
import ConfirmDialog from "../../common/ConfirmDialog";
import { inputCls, inputStyle } from "../../common/fieldStyles";
import { genderText } from "../memberAdminText";
import { fmtMD, remaining, sessionLabel, won, ymOfIso } from "./duesText";
import { ToggleChip } from "./duesUi";
import { type MemberLite, nameMatches, suggestMembers } from "./matching";

interface Props {
	tx: BankTxnRow;
	members: AdminMemberRow[];
	unpaidByMember: Record<string, UnpaidCharge[]>;
	monthSessions: SessionFeeRow[]; // 이번 달 대관 세션(신규 대관비 생성 후보)
	upcomingSessions: UpcomingSessionRow[]; // 참가 예정(open) 세션 — 본인 참가분만 선납 후보
	categories: TxnCategory[];
	monthlyFee: number;
	courtFee: number;
	refunded: number; // 이 입금에 연결된 환불 합계(실효금액 = 입금 − 환불)
	busy: boolean;
	/** 통합 확정: 기존 미납(chargeIds) 배분 + 신규 회비(ym, 납부자)/세션(sessions, member=대상) 생성·배분. */
	onConfirm: (payerId: string, chargeIds: number[], ym: string, sessions: { member: string; id: number; units: number }[]) => void;
	onConfirmCourtExternal: (sessionId: number) => void;
	onCategorize: (categoryId: number, paidBy: string | null) => void;
}

// 칩(선택 항목) 단일 모델 — 목록 표시·디폴트 선택·합계·확정이 모두 이 하나만 공유(로직 분산 제거).
interface ChipItem {
	key: string; // 선택 키(고유): charge:{id} | monthly | session:{member}:{sid}
	label: string;
	amount: number; // 합계·디폴트 금액매칭용(기존=잔액, 신규=정액)
	role: "monthly" | "court" | "other"; // 디폴트 매칭용(회비/대관 구분)
	autoDefault: boolean; // 디폴트 자동선택 후보(기존 미납 + 참가확정 예정 — 신규 월세션은 제외)
	poolRank: number; // 대관 디폴트 정렬(작을수록 우선): 이번달 기존0 · 다른달 기존1 · 예정2
	poolDate: string; // 동순위 2차 정렬(세션일)
	chargeId?: number; // 기존 미납 → 배분
	sessionId?: number; // 신규/예정 세션 → 생성
	member?: string; // 세션 대상 회원
	ym?: string; // 신규 회비 → 생성 월
}
interface Person {
	id: string;
	name: string;
	isPayer: boolean;
	items: ChipItem[]; // 표시 순서: 기존미납 → (납부자)신규회비 → 신규세션 → 참가예정
}

// 미처리 입금 1건 처리. 납부자 지정 → 그 회원의 기존 미납(본인+대납·월무관) 배분 + 신규(회비/세션) 생성을
// 함께 골라 [확인] 1회로. 금액(§4)으로 기본 선택 제안. 비회원 대관·비회비 수입 분류도 여기서.
export default function ReconcileInRow({ tx, members, unpaidByMember, monthSessions, upcomingSessions, categories, monthlyFee, courtFee, refunded, busy, onConfirm, onConfirmCourtExternal, onCategorize }: Props) {
	const effectiveAmount = tx.amount - refunded; // 부분 환불 반영: 정산 대상 금액
	const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
	const candidates = useMemo(() => suggestMembers(tx.counterpartyName, members), [tx.counterpartyName, members]);
	const [selectedId, setSelectedId] = useState<string | null>(candidates[0]?.id ?? null);
	const [extraIds, setExtraIds] = useState<string[]>([]); // 이 입금으로 함께 내주는 다른 사람(회원·게스트)
	const [searchOpen, setSearchOpen] = useState(false); // 사람 검색(납부자 없으면 납부자 지정, 있으면 대납 추가)
	const [query, setQuery] = useState("");
	const [override, setOverride] = useState<Set<string> | null>(null); // null = 디폴트(defaultKeys) 사용
	const [extSession, setExtSession] = useState<number | null>(null); // 비회원 대관 세션
	const [catSel, setCatSel] = useState<number | null>(null); // 비회비 수입 분류(선택 후 확인)
	const [showMismatch, setShowMismatch] = useState(false); // 선택≠입금 확인 다이얼로그

	const depositYm = ymOfIso(tx.occurredAt) ?? "";
	const selectedMember = selectedId ? memberById.get(selectedId) : undefined;

	const monthSessionIds = useMemo(() => new Set(monthSessions.map((s) => s.id)), [monthSessions]);

	// 단일 소스: 납부자 + 대납 대상 각각의 '낼 항목(칩)'을 한 로직으로 만들어, 표시·디폴트·합계·확정이 전부 이걸 공유.
	//  - 기존 미납(unpaidByMember, 사람 간 중복 제거) → 배분
	//  - (납부자·비게스트·이번달 미부과) 신규 회비 → 생성
	//  - 신규 세션(이번 달 열린·미부과) → 생성 (표시만, 참석 필터 없어 디폴트 자동선택 제외)
	//  - 참가 예정(open·본인 참가확정·미부과) → 생성 (디폴트 자동선택 후보)
	const people = useMemo<Person[]>(() => {
		if (!selectedId) return [];
		const seen = new Set<number>(); // 미납 charge 중복(게스트분이 두 사람에게 잡히는 것) 제거 — 먼저 나온 사람에게.
		const ids = [selectedId, ...extraIds.filter((e) => e !== selectedId)];
		return ids.map((mid) => {
			const m = memberById.get(mid);
			const unpaid = (unpaidByMember[mid] ?? []).filter((c) => !seen.has(c.id));
			for (const c of unpaid) seen.add(c.id);
			const hasMonthly = unpaid.some((c) => c.kind === "monthly_fee" && c.periodYm === depositYm);
			const chargedSess = new Set(unpaid.filter((c) => c.kind === "court_fee").map((c) => c.sessionId));
			const items: ChipItem[] = [];
			for (const c of unpaid) {
				const court = c.kind === "court_fee";
				items.push({
					key: `charge:${c.id}`,
					label: `${c.label} ${won(remaining(c.amountDue, c.amountPaid))}`,
					amount: remaining(c.amountDue, c.amountPaid),
					role: court ? "court" : c.kind === "monthly_fee" ? "monthly" : "other",
					autoDefault: true,
					poolRank: court && c.sessionId != null && monthSessionIds.has(c.sessionId) ? 0 : 1,
					poolDate: c.sessionDate ?? "",
					chargeId: c.id,
					ym: c.periodYm ?? undefined, // 회비 charge의 부과 월(디폴트 회비 매칭용 — 대관은 null)
				});
			}
			if (mid === selectedId && !m?.isGuest && !hasMonthly) {
				items.push({ key: "monthly", label: `${Number(depositYm.slice(5))}월 회비 ${won(monthlyFee)}`, amount: monthlyFee, role: "monthly", autoDefault: false, poolRank: 9, poolDate: "", ym: depositYm });
			}
			for (const s of monthSessions) {
				if (chargedSess.has(s.id)) continue;
				items.push({ key: `session:${mid}:${s.id}`, label: `${sessionLabel(s)} 대관비`, amount: courtFee, role: "court", autoDefault: false, poolRank: 8, poolDate: s.scheduledAt ?? "", sessionId: s.id, member: mid });
			}
			for (const s of upcomingSessions) {
				if (!s.attendeeIds.includes(mid) || s.chargedMemberIds.includes(mid) || monthSessionIds.has(s.id)) continue;
				items.push({ key: `session:${mid}:${s.id}`, label: `${sessionLabel(s)} 대관비(예정)`, amount: courtFee, role: "court", autoDefault: true, poolRank: 2, poolDate: s.scheduledAt ?? "", sessionId: s.id, member: mid });
			}
			return { id: mid, name: m?.name ?? "회원", isPayer: mid === selectedId, items };
		});
	}, [selectedId, extraIds, unpaidByMember, memberById, monthSessions, upcomingSessions, monthSessionIds, depositYm, monthlyFee, courtFee]);

	const itemByKey = useMemo(() => {
		const map = new Map<string, ChipItem>();
		for (const p of people) for (const it of p.items) map.set(it.key, it);
		return map;
	}, [people]);

	// 디폴트 선택(금액 자동매칭) — 위 people(단일 소스)에서 파생.
	//  회비(납부자·입금월, 있으면 기존/없으면 신규) + 대관 k개(전원=납부자+대납의 기존미납·참가확정 예정 풀에서 우선순위대로).
	//  대관 풀을 전원으로 → 한 사람이 여러 명분 낼 때 대납 대상 세션도 디폴트로 잡힘. 신규 월세션(참석필터 없음)은 제외(수동).
	const defaultKeys = useMemo<Set<string>>(() => {
		const sel = new Set<string>();
		const payer = people.find((p) => p.isPayer);
		if (!payer) return sel;
		const afterFee = effectiveAmount - monthlyFee;
		let wantMonthly = false;
		let k = 0;
		if (afterFee >= 0 && courtFee > 0 && afterFee % courtFee === 0) { wantMonthly = true; k = afterFee / courtFee; }
		else if (courtFee > 0 && effectiveAmount % courtFee === 0) { k = effectiveAmount / courtFee; }
		if (selectedMember?.isGuest) wantMonthly = false;
		if (wantMonthly) {
			// 회비는 납부자 개인 귀속. 입금 월 회비만(기존 그 달 미납 or 신규) — 이전 달 미납 회비 오선택 방지.
			const monthly = payer.items.find((it) => it.role === "monthly" && it.ym === depositYm);
			if (monthly) sel.add(monthly.key);
		}
		// 대관 풀 = 전원(납부자+대납)의 기존 미납 court + 참가확정 예정. 우선순위: 이번달기존0 · 다른달기존1 · 예정2.
		const courtPool = people
			.flatMap((p) => p.items)
			.filter((it) => it.role === "court" && it.autoDefault)
			.sort((a, b) => a.poolRank - b.poolRank || b.poolDate.localeCompare(a.poolDate));
		for (const it of courtPool.slice(0, k)) sel.add(it.key);
		return sel;
	}, [people, selectedMember, effectiveAmount, monthlyFee, courtFee, depositYm]);

	const selected = override ?? defaultKeys;
	const total = [...selected].reduce((s, key) => s + (itemByKey.get(key)?.amount ?? 0), 0);

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
		const removedKeys = new Set(people.find((p) => p.id === id)?.items.map((it) => it.key) ?? []); // 그 사람의 모든 칩 키
		setExtraIds((prev) => prev.filter((x) => x !== id));
		setOverride((ov) => (ov ? new Set([...ov].filter((k) => !removedKeys.has(k))) : null)); // 수동선택 중이면 그 사람 선택 해제, 디폴트면 그대로 재계산
	};
	// 칩 토글(기존미납·신규회비·신규/예정세션 공통). 회원 항목 선택 = 분류 해제(상호배타).
	const toggle = (key: string) => {
		setCatSel(null);
		const n = new Set(selected);
		if (n.has(key)) n.delete(key);
		else n.add(key);
		setOverride(n);
	};
	// 비회비 수입 분류(선택 후 확인). 선택 시 회원 항목 선택은 비움(상호배타).
	const toggleCategory = (id: number) => {
		if (catSel === id) { setCatSel(null); setOverride(null); }
		else { setCatSel(id); setOverride(new Set()); }
	};

	const q = query.trim();
	const searchResults = q ? members.filter((m) => nameMatches(m.name, q) && m.id !== selectedId && !extraIds.includes(m.id)).slice(0, 6) : [];
	const chipMembers = useMemo(() => {
		const arr: MemberLite[] = [...candidates];
		if (selectedMember && !arr.some((c) => c.id === selectedMember.id)) arr.unshift(selectedMember);
		return arr.slice(0, 4);
	}, [candidates, selectedMember]);

	// 비회원 대관(회원 매칭 없이 대관비 배수일 때).
	const externalCourt = !selectedId && courtFee > 0 && effectiveAmount > 0 && effectiveAmount % courtFee === 0;

	// 확인 결정: 분류(catSel) > 회원 배분(total) > 비회원 대관(extSession). 상호배타.
	const catName = catSel != null ? categories.find((c) => c.id === catSel)?.name : null;
	const catMode = catSel != null;
	const memberMode = !catMode && selectedId != null && total > 0;
	const extMode = !catMode && !selectedId && externalCourt && extSession != null;
	const mismatch = memberMode && total !== effectiveAmount; // 선택 금액 ≠ 정산 대상(입금−환불)
	const ready = catMode || memberMode || extMode;
	const doConfirm = () => {
		if (catMode && catSel != null) { onCategorize(catSel, selectedId); return; } // 납부자 지정 시 그 회원 이력에 귀속
		if (extMode && extSession != null) { onConfirmCourtExternal(extSession); return; }
		if (!memberMode || !selectedId) return;
		// 선택 키(단일 소스) → 확정 payload로 분해: 기존 배분(chargeIds) / 신규 회비(ym) / 신규·예정 세션(sessions).
		const chargeIds: number[] = [];
		let ym = "";
		const sessions: { member: string; id: number; units: number }[] = [];
		for (const key of selected) {
			const it = itemByKey.get(key);
			if (!it) continue;
			if (it.chargeId != null) chargeIds.push(it.chargeId);
			else if (it.role === "monthly" && it.ym) ym = it.ym;
			else if (it.sessionId != null && it.member) sessions.push({ member: it.member, id: it.sessionId, units: 1 });
		}
		onConfirm(selectedId, chargeIds, ym, sessions);
	};

	const groupLabel: CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: "0.02em" };

	return (
		<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]" style={{ borderRadius: 12, padding: "11px 13px", opacity: busy ? 0.5 : 1 }}>
			{/* 입금 정보 */}
			<div className="flex items-center gap-2">
				<span className="text-faint" style={{ fontSize: 12, width: 40 }}>{fmtMD(tx.occurredAt)}</span>
				<span className="text-strong" style={{ flex: 1, fontSize: 14, fontWeight: 600, minWidth: 0 }}>{tx.counterpartyName || "(적요 없음)"}</span>
				<span className="flex flex-col items-end" style={{ flexShrink: 0 }}>
					<span className="text-[#1c8a3b]" style={{ fontSize: 14, fontWeight: 800 }}>+{won(tx.amount)}</span>
					{refunded > 0 && <span className="text-[#c2670a]" style={{ fontSize: 10.5, fontWeight: 700 }}>환불 −{won(refunded)} · 대상 {won(effectiveAmount)}</span>}
					{tx.balanceAfter != null && <span className="text-faint" style={{ fontSize: 10.5 }}>잔액 {won(tx.balanceAfter)}</span>}
				</span>
			</div>

			{/* 납부자 (지정되면 🔍가 ＋로 바뀌어 '함께 낼 사람' 추가) */}
			<div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 9 }}>
				<span className="text-faint" style={{ fontSize: 11, fontWeight: 700, alignSelf: "center" }}>납부자</span>
				{chipMembers.length === 0 && !searchOpen && <span className="text-faint" style={{ fontSize: 12.5 }}>제안 없음 — 검색하세요</span>}
				{chipMembers.filter((m) => !extraIds.includes(m.id)).map((m) => {
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
				{/* 함께 낼 사람(대납 대상) 버블 — 납부자 옆에, × 로 제거 */}
				{selectedId && extraIds.map((eid) => {
					const em = memberById.get(eid);
					return (
						<span key={`x-${eid}`} className="flex items-center text-strong" style={{ fontSize: 13, fontWeight: 700, padding: "5px 5px 5px 11px", borderRadius: 999, border: "1.5px solid rgba(52,199,89,0.55)", background: "rgba(52,199,89,0.14)" }}>
							{em?.name ?? "회원"}
							<span className="text-faint" style={{ fontWeight: 500, margin: "0 5px 0 4px" }}>{em?.isGuest ? "게스트" : `${genderText(em?.gender ?? null)}${em?.birthYear ? String(em.birthYear % 100).padStart(2, "0") : ""}`}</span>
							<button type="button" onClick={() => removeExtra(eid)} aria-label={`${em?.name ?? "회원"} 제거`} className="text-faint flex items-center justify-center" style={{ width: 17, height: 17, borderRadius: 999, background: "rgba(120,120,128,0.22)", cursor: "pointer", fontSize: 12, lineHeight: 1 }}>×</button>
						</span>
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

			{/* 항목: 사람(납부자+대납)별 기존 미납 + 신규 세션 + 참가 예정 (+ 납부자는 신규 회비). 한 로직으로 통일. */}
			{selectedId && (
				<div className="flex flex-col" style={{ gap: 10, marginTop: 9 }}>
					{people.map((p) => (
						<div key={p.id} className="flex flex-col gap-1">
							{/* 이름 헤더 — 대납 대상이 있을 때만(칩 그룹 구분). 제거 ×는 위 납부자 행의 버블에 있음 */}
							{people.length > 1 && <span className="text-muted" style={groupLabel}>{p.name}</span>}
							<div className="flex flex-wrap gap-1.5">
								{p.items.map((it) => <ToggleChip key={it.key} label={it.label} on={selected.has(it.key)} onClick={() => toggle(it.key)} />)}
								{p.items.length === 0 && <span className="text-faint" style={{ fontSize: 12 }}>{p.isPayer ? "낼 항목 없음(완납/부과 없음)" : "미납 없음"}</span>}
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
						monthSessions.map((s) => <ToggleChip key={`ext${s.id}`} label={`${sessionLabel(s)} 대관비`} on={extSession === s.id} onClick={() => setExtSession((v) => (v === s.id ? null : s.id))} />)
					)}
				</div>
			)}

			{/* 그 외 분류(콕공구·이자 등) — 선택 후 확인(지출과 동일). 코트대관은 위 비회원 세션으로. */}
			<div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 9 }}>
				<span className="text-faint" style={{ fontSize: 11, fontWeight: 700, alignSelf: "center" }}>그 외</span>
				{categories.map((cat) => <ToggleChip key={`cat${cat.id}`} label={cat.name} on={catSel === cat.id} onClick={() => toggleCategory(cat.id)} />)}
			</div>

			{/* 확인 */}
			<div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(120,120,128,0.16)" }}>
				{mismatch && (
					<p className="text-[#d1362c]" style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 7 }}>
						선택 {won(total)} · 대상 {won(effectiveAmount)} — 금액이 안 맞아요
					</p>
				)}
				<button
					type="button"
					onClick={() => { if (!ready) return; if (mismatch) setShowMismatch(true); else doConfirm(); }}
					disabled={busy || !ready}
					className="rounded-[9px] py-2 text-sm disabled:opacity-35"
					style={{ width: "100%", fontWeight: 800, color: ready ? "#fff" : undefined, background: !ready ? "rgba(120,120,128,0.14)" : mismatch ? "#d1362c" : "#1c8a3b" }}
				>
					{catMode ? `확인 · ${catName}${selectedMember ? ` · ${selectedMember.name} 납부` : ""}` : memberMode ? `확인 · ${won(total)}` : extMode ? `비회원 대관비 · ${won(effectiveAmount)}` : "항목 선택"}
				</button>
			</div>

			{showMismatch && (
				<ConfirmDialog
					title="금액이 안 맞아요"
					message={`선택한 금액(${won(total)})이 정산 대상(${won(effectiveAmount)})과 달라요. 정산이 맞지 않는데 이대로 확인할까요?`}
					confirmLabel="그래도 확인"
					tone="danger"
					maxWidth="xs"
					onCancel={() => setShowMismatch(false)}
					onDismiss={() => setShowMismatch(false)}
					onConfirm={() => { setShowMismatch(false); doConfirm(); }}
				/>
			)}
		</div>
	);
}
