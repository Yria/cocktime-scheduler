import { supabase } from "./client";

// 회계(회비·대관비) 데이터 레이어. 권한 가드는 RPC(SECURITY DEFINER + is_admin) 및 RLS 가 강제.
// 설계서: docs/ACCOUNTING_DESIGN.md. RPC 결과는 {ok,error} 로 감싼다(adminMembers.ts 패턴).

export type ChargeStatus =
	| "unpaid"
	| "partial"
	| "paid"
	| "overpaid"
	| "waived"
	| "void";

export interface DuesSettings {
	monthlyFee: number;
	courtFeeDefault: number;
	offsetDays: number;
	bankName: string | null;
	bankAccount: string | null;
	accountHolder: string | null;
}

export interface MonthlyChargeRow {
	id: number;
	memberId: string;
	amountDue: number;
	amountPaid: number;
	status: ChargeStatus;
	periodYm: string | null; // 부과 원 월
	deferredTo: string | null; // 이월 대상 월(있으면 원 월에서 숨김·해당 월에 미정산)
}

export interface CourtChargeRow {
	id: number;
	memberId: string;
	sessionId: number;
	sessionTitle: string | null;
	scheduledAt: string | null;
	amountDue: number;
	amountPaid: number;
	status: ChargeStatus;
	payerHint: string | null;
}

/** 내 회비 화면용 통합 charge(회비 or 대관비). */
export interface MyChargeRow {
	id: number;
	kind: "monthly_fee" | "court_fee";
	periodYm: string | null;
	sessionId: number | null;
	sessionTitle: string | null;
	scheduledAt: string | null;
	amountDue: number;
	amountPaid: number;
	status: ChargeStatus;
	isProxy: boolean; // payer_hint=me 인데 member_id≠me → 게스트 대납분
}

export interface ClubAccount {
	bankName: string | null;
	accountMasked: string | null;
	accountHolder: string | null;
	monthlyFee: number | null;
}

interface RpcResult {
	ok: boolean;
	error?: string;
	data?: unknown;
}

// ── KST 월 경계(ISO with +09:00 offset) ───────────────────────────────
/** ym='YYYY-MM' → [해당 월 1일 00:00 KST, 다음 월 1일 00:00 KST) ISO 문자열. */
function ymRangeKst(ym: string): { start: string; end: string } {
	const [y, m] = ym.split("-").map(Number);
	const nextY = m === 12 ? y + 1 : y;
	const nextM = m === 12 ? 1 : m + 1;
	const pad = (n: number) => String(n).padStart(2, "0");
	return {
		start: `${y}-${pad(m)}-01T00:00:00+09:00`,
		end: `${nextY}-${pad(nextM)}-01T00:00:00+09:00`,
	};
}

// ── 설정(관리자) ─────────────────────────────────────────────────────
export async function fetchDuesSettings(): Promise<DuesSettings | null> {
	const { data, error } = await supabase
		.from("dues_settings")
		.select("monthly_fee, court_fee_default, offset_days, bank_name, bank_account, account_holder")
		.eq("id", 1)
		.maybeSingle();
	if (error) {
		console.error("fetchDuesSettings:", error);
		return null;
	}
	if (!data) return null;
	return {
		monthlyFee: data.monthly_fee,
		courtFeeDefault: data.court_fee_default,
		offsetDays: data.offset_days,
		bankName: data.bank_name,
		bankAccount: data.bank_account,
		accountHolder: data.account_holder,
	};
}

export async function updateDuesSettings(
	patch: Partial<DuesSettings>,
): Promise<boolean> {
	const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (patch.monthlyFee !== undefined) row.monthly_fee = patch.monthlyFee;
	if (patch.courtFeeDefault !== undefined) row.court_fee_default = patch.courtFeeDefault;
	if (patch.offsetDays !== undefined) row.offset_days = patch.offsetDays;
	if (patch.bankName !== undefined) row.bank_name = patch.bankName;
	if (patch.bankAccount !== undefined) row.bank_account = patch.bankAccount;
	if (patch.accountHolder !== undefined) row.account_holder = patch.accountHolder;
	const { data, error } = await supabase
		.from("dues_settings")
		.update(row)
		.eq("id", 1)
		.select("id"); // 0행이면 RLS(비관리자) 거부
	if (error || !data || data.length === 0) {
		if (error) console.error("updateDuesSettings:", error);
		return false;
	}
	return true;
}

// ── 부과/알림/납부 RPC ───────────────────────────────────────────────
async function callRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
	const { data, error } = await supabase.rpc(fn, args);
	if (error) {
		console.error(`${fn}:`, error);
		return { ok: false, error: error.message };
	}
	return { ok: true, data };
}

/** 선택 미납 알림: 특정 회원들에게 커스텀 문구로 발송(회비/세션별 대관비 그룹 발송). 중복방지 없음. */
export const duesNotifySelected = (memberIds: string[], msg: string) =>
	callRpc("dues_notify_selected", { p_member_ids: memberIds, p_msg: msg });

/** 은행 거래 대사 취소: 배분 되돌리고 미처리로. */
export const duesCancelMatch = (txId: number) =>
	callRpc("dues_cancel_match", { p_tx_id: txId });

/** 외부인(비회원) 대관비: 회원 없이 세션에만 귀속하고 matched 처리('대관비 수납'으로 집계). */
export const duesConfirmCourtExternal = (txId: number, sessionId: number) =>
	callRpc("dues_confirm_court_external", { p_tx_id: txId, p_session_id: sessionId });

/** 입금확인 통합 확정: 기존 미납(chargeIds, 본인+대납·월무관) 배분 + 회비(ym)/세션(sessions) 신규 생성·배분 한 트랜잭션. */
export const duesConfirmReconcile = (
	txId: number,
	payerMemberId: string,
	chargeIds: number[],
	ym: string,
	sessions: { id: number; units: number }[],
) =>
	callRpc("dues_confirm_reconcile", {
		p_tx_id: txId,
		p_payer_member_id: payerMemberId,
		p_charge_ids: chargeIds,
		p_ym: ym,
		p_sessions: sessions,
	});

/** 환불 연결(출금이 입금의 차액/전액을 환불) / 해제. */
export const duesLinkRefund = (outTxId: number, inTxId: number) =>
	callRpc("dues_link_refund", { p_out_tx_id: outTxId, p_in_tx_id: inTxId });
export const duesUnlinkRefund = (outTxId: number) =>
	callRpc("dues_unlink_refund", { p_out_tx_id: outTxId });

/** 회원 공개 회계(항목별 정산만). 개별 미납·원장·납부자 제외. */
export interface PublicLedger {
	ym: string;
	income: number;
	expense: number;
	net: number;
	feeCollected: number;
	courtUnassigned: number;
	sessions: { date: string; place: string | null; income: number; expense: number; net: number }[];
	categories: { name: string; in: number; out: number; net: number }[];
}
export async function fetchPublicLedger(ym: string): Promise<PublicLedger | null> {
	const { data, error } = await supabase.rpc("dues_public_ledger", { p_ym: ym });
	if (error || !data) {
		if (error) console.error("fetchPublicLedger:", error);
		return null;
	}
	const d = data as Record<string, unknown>;
	return {
		ym: d.ym as string,
		income: (d.income as number) ?? 0,
		expense: (d.expense as number) ?? 0,
		net: (d.net as number) ?? 0,
		feeCollected: (d.fee_collected as number) ?? 0,
		courtUnassigned: (d.court_unassigned as number) ?? 0,
		sessions: (d.sessions as PublicLedger["sessions"]) ?? [],
		categories: (d.categories as PublicLedger["categories"]) ?? [],
	};
}

// ── 은행 거래 조회(대사 화면) ─────────────────────────────────────────
export type BankTxnStatus = "unmatched" | "proposed" | "partial" | "matched" | "ignored";
export interface BankTxnRow {
	id: number;
	occurredAt: string;
	direction: "in" | "out";
	amount: number;
	counterpartyName: string;
	memo: string | null;
	status: BankTxnStatus;
	classifyNote: string | null;
	categoryId: number | null;
	categoryName: string | null;
	sessionId: number | null; // 매칭된 세션(대관비 지출·외부인 대관비 수납이 어느 날 것인지)
	sessionDate: string | null; // 매칭 세션 scheduled_at
	balanceAfter: number | null; // 거래 후 통장 잔액
	refundOfTxId: number | null; // 이 출금이 환불하는 입금 tx(환불 연결)
}

interface RawBankTxn {
	id: number;
	occurred_at: string;
	direction: "in" | "out";
	amount: number;
	counterparty_name: string | null;
	memo: string | null;
	status: string;
	classify_note: string | null;
	category_id: number | null;
	txn_categories: { name: string } | null;
	session_id: number | null;
	sessions: { scheduled_at: string | null } | null;
	balance_after: number | null;
	refund_of_tx_id: number | null;
}

export async function fetchBankTransactions(ym: string): Promise<BankTxnRow[]> {
	const { start, end } = ymRangeKst(ym);
	const { data, error } = await supabase
		.from("bank_transactions")
		.select("id, occurred_at, direction, amount, counterparty_name, memo, status, classify_note, category_id, txn_categories(name), session_id, sessions(scheduled_at), balance_after, refund_of_tx_id")
		.gte("occurred_at", start)
		.lt("occurred_at", end)
		.order("occurred_at", { ascending: false });
	if (error) {
		console.error("fetchBankTransactions:", error);
		return [];
	}
	return ((data ?? []) as unknown as RawBankTxn[]).map((t) => ({
		id: t.id,
		occurredAt: t.occurred_at,
		direction: t.direction,
		amount: t.amount,
		counterpartyName: t.counterparty_name ?? "",
		memo: t.memo,
		status: t.status as BankTxnStatus,
		classifyNote: t.classify_note,
		categoryId: t.category_id,
		categoryName: t.txn_categories?.name ?? null,
		sessionId: t.session_id,
		sessionDate: t.sessions?.scheduled_at ?? null,
		balanceAfter: t.balance_after,
		refundOfTxId: t.refund_of_tx_id,
	}));
}

// ── 거래 카테고리(수지 분류) ───────────────────────────────────────────
export interface TxnCategory {
	id: number;
	name: string;
}
export async function fetchCategories(): Promise<TxnCategory[]> {
	const { data, error } = await supabase
		.from("txn_categories")
		.select("id, name")
		.order("name", { ascending: true });
	if (error) {
		console.error("fetchCategories:", error);
		return [];
	}
	return data ?? [];
}
export const addCategory = (name: string) => callRpc("dues_add_category", { p_name: name });
export const deleteCategory = (id: number) => callRpc("dues_delete_category", { p_id: id });
export const setTxnCategory = (txId: number, categoryId: number | null) =>
	callRpc("dues_set_txn_category", { p_tx_id: txId, p_category_id: categoryId });
/** 거래를 세션에 매칭(대관비 지출이 어느 날 대관인지). null=해제. */
export const setTxnSession = (txId: number, sessionId: number | null) =>
	callRpc("dues_set_txn_session", { p_tx_id: txId, p_session_id: sessionId });

interface RawTxAlloc {
	bank_tx_id: number;
	amount: number;
	member_id: string;
	dues_charges: {
		kind: string;
		period_ym: string | null;
		member_id: string;
		session_id: number | null;
		sessions: { scheduled_at: string | null; title: string | null } | null;
	} | null;
	members: { name: string } | null;
}
/** 거래별 처리 내역. sessionIds=그 거래가 배분된 대관 부과의 세션(입금을 세션 필터에 잡히게). */
export interface TxAllocation {
	label: string;
	key: string;
	names: string[];
	sessionIds: number[];
	feeAmount: number; // 이 거래가 회비(monthly_fee) 부과에 배분한 금액 합(월 통장 기준 회계 분해용)
	courtBySession: Record<number, number>; // 세션별 대관(court_fee) 배분 금액 합
}
/**
 * 거래별 처리 내역(무엇으로 배분됐는지) — 확인됨 라벨·정렬·세션 필터용.
 * txIds 를 주면 그 거래들로만 스코프(표시 대상=이번 달 거래) — 전역 배분 누적 조회 회피(§10.2).
 * txIds=[] → 빈 결과. 미지정 → 전체(하위호환).
 */
export async function fetchTxAllocations(txIds?: number[]): Promise<Record<number, TxAllocation>> {
	if (txIds && txIds.length === 0) return {};
	let query = supabase
		.from("dues_allocations")
		// members 임베드는 member_id·matched_by 두 FK가 있어 모호 → 납부자(member_id) FK 명시(PGRST201 회피).
		.select("bank_tx_id, amount, member_id, dues_charges(kind, period_ym, member_id, session_id, sessions(scheduled_at, title)), members!dues_allocations_member_id_fkey(name)")
		.not("bank_tx_id", "is", null);
	if (txIds) query = query.in("bank_tx_id", txIds);
	const { data, error } = await query;
	if (error) {
		console.error("fetchTxAllocations:", error);
		return {};
	}
	const map: Record<number, { label: string; key: string; names: Set<string>; sessionIds: Set<number>; feeAmount: number; courtBySession: Record<number, number> }> = {};
	for (const a of (data ?? []) as unknown as RawTxAlloc[]) {
		const c = a.dues_charges;
		let label: string;
		let key: string;
		if (!c) {
			label = "기타";
			key = "z-기타";
		} else if (c.kind === "monthly_fee") {
			label = `${c.period_ym?.slice(5) ?? ""}월 회비`;
			key = `a-회비-${c.period_ym ?? ""}`;
		} else {
			const d = c.sessions?.scheduled_at
				? new Date(c.sessions.scheduled_at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" })
				: (c.sessions?.title ?? "세션");
			label = `${d} 대관비`;
			key = `b-대관-${c.sessions?.scheduled_at ?? c.kind}`;
		}
		const e = map[a.bank_tx_id] ?? { label, key, names: new Set<string>(), sessionIds: new Set<number>(), feeAmount: 0, courtBySession: {} };
		// 여러 charge면 primary(첫) 라벨 유지, 이름·세션·금액은 누적
		if (a.members?.name) e.names.add(a.members.name);
		if (c?.session_id != null) e.sessionIds.add(c.session_id); // 대관비 배분 → 그 세션(입금도 세션 필터에)
		if (c?.kind === "monthly_fee") e.feeAmount += a.amount ?? 0; // 월 통장 기준 회계: 회비 배분액
		else if (c?.session_id != null) e.courtBySession[c.session_id] = (e.courtBySession[c.session_id] ?? 0) + (a.amount ?? 0); // 세션별 대관 배분액
		map[a.bank_tx_id] = e;
	}
	const out: Record<number, TxAllocation> = {};
	for (const [k, v] of Object.entries(map)) out[Number(k)] = { label: v.label, key: v.key, names: [...v.names], sessionIds: [...v.sessionIds], feeAmount: v.feeAmount, courtBySession: v.courtBySession };
	return out;
}

// 회원의 미납/부분납 부과(본인 + 게스트 대납분) — 대사 확정 시 배분 대상.
interface RawUnpaid {
	id: number;
	kind: string;
	member_id: string;
	period_ym: string | null;
	session_id: number | null;
	amount_due: number;
	amount_paid: number;
	status: string;
	payer_hint: string | null;
	sessions: { title: string | null; scheduled_at: string | null; places: { name: string | null } | null } | null;
}
export interface UnpaidCharge {
	id: number;
	kind: "monthly_fee" | "court_fee";
	sessionId: number | null;
	periodYm: string | null; // 회비 대상 월(크로스먼스 판별·프리셀렉트용)
	sessionDate: string | null; // 대관 세션 일시
	label: string;
	amountDue: number;
	amountPaid: number;
	isProxy: boolean;
}
function unpaidLabel(kind: string, periodYm: string | null, session: { title: string | null; scheduled_at: string | null; places: { name: string | null } | null } | null, proxy: boolean): string {
	// 회비: 'N월 회비'로 통일(거래내역 라벨·신규회비 칩과 동일 형식). 예: 2026-07 → 7월 회비.
	if (kind === "monthly_fee") return periodYm ? `${Number(periodYm.slice(5))}월 회비` : "회비";
	// 세션 칩(sessionLabel)과 동일 형식으로 통일: "{월.일} {장소} 대관비". 장소 없으면 날짜만.
	const d = session?.scheduled_at
		? new Date(session.scheduled_at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" })
		: (session?.title ?? "세션");
	const place = session?.places?.name;
	return `${d}${place ? ` ${place}` : ""} 대관비${proxy ? " (게스트)" : ""}`;
}

/** 전체 미납/부분납 부과를 회원별로 인덱싱(member_id + payer_hint 대납분 포함). 대사 인라인 제안용. */
export async function fetchUnpaidByMember(): Promise<Record<string, UnpaidCharge[]>> {
	const { data, error } = await supabase
		.from("dues_charges")
		.select("id, kind, member_id, period_ym, session_id, amount_due, amount_paid, status, payer_hint, sessions(title, scheduled_at, places(name))")
		.in("status", ["unpaid", "partial"])
		.order("created_at", { ascending: true });
	if (error) {
		console.error("fetchUnpaidByMember:", error);
		return {};
	}
	const map: Record<string, UnpaidCharge[]> = {};
	for (const c of (data ?? []) as unknown as RawUnpaid[]) {
		const owners = [c.member_id, c.payer_hint].filter((x): x is string => !!x);
		for (const owner of new Set(owners)) {
			const proxy = owner !== c.member_id;
			(map[owner] ??= []).push({
				id: c.id,
				kind: c.kind as "monthly_fee" | "court_fee",
				sessionId: c.session_id,
				periodYm: c.period_ym,
				sessionDate: c.sessions?.scheduled_at ?? null,
				label: unpaidLabel(c.kind, c.period_ym, c.sessions, proxy),
				amountDue: c.amount_due,
				amountPaid: c.amount_paid,
				isProxy: proxy,
			});
		}
	}
	return map;
}

// ── 은행 입금메일 수집 (회계 §4, Edge Function ingest-bank-email) ──────────
export interface IngestDeposit {
	occurredAt: string;
	name: string;
	amount: number;
}
export interface IngestResult {
	fetched: number; // 메일 건수
	parsed: number; // 파싱된 거래 수
	inserted: number; // 신규 적재
	skipped: number; // 중복
	deposits: IngestDeposit[]; // 신규 입금 샘플
	errors?: string[];
}

/** Gmail에서 토스 거래내역 메일 수집(현재 2단계-a: 파싱 없이 요약만). admin JWT 자동 첨부. */
export async function ingestBankEmail(): Promise<
	{ ok: true; data: IngestResult } | { ok: false; error: string }
> {
	const { data, error } = await supabase.functions.invoke("ingest-bank-email", {
		body: {},
	});
	if (error) {
		// 비2xx 응답은 FunctionsHttpError → 본문의 error 메시지를 최대한 꺼낸다.
		let msg = error.message;
		try {
			const ctx = (error as { context?: Response }).context;
			if (ctx && typeof ctx.json === "function") {
				const b = await ctx.json();
				if (b?.error) msg = b.error;
			}
		} catch {
			/* noop */
		}
		console.error("ingestBankEmail:", error);
		return { ok: false, error: msg };
	}
	return { ok: true, data: data as IngestResult };
}

// ── 월별 부과 조회(관리자) ────────────────────────────────────────────
// 그 달 회비 = 원 월(period_ym=ym) + 다른 달에서 이월돼 온 것(deferred_to=ym).
export async function fetchMonthlyCharges(ym: string): Promise<MonthlyChargeRow[]> {
	const { data, error } = await supabase
		.from("dues_charges")
		.select("id, member_id, amount_due, amount_paid, status, period_ym, deferred_to")
		.eq("kind", "monthly_fee")
		.or(`period_ym.eq.${ym},deferred_to.eq.${ym}`);
	if (error) {
		console.error("fetchMonthlyCharges:", error);
		return [];
	}
	return (data ?? []).map((c) => ({
		id: c.id,
		memberId: c.member_id,
		amountDue: c.amount_due,
		amountPaid: c.amount_paid,
		status: c.status as ChargeStatus,
		periodYm: c.period_ym,
		deferredTo: c.deferred_to,
	}));
}

/** 회비 이월(다음 달로) / 이월 취소 / 이월분 수동 정산(미납 해제). */
export const duesDeferCharge = (chargeId: number) => callRpc("dues_defer_charge", { p_charge_id: chargeId });
export const duesUndeferCharge = (chargeId: number) => callRpc("dues_undefer_charge", { p_charge_id: chargeId });
export const duesSettleDeferred = (chargeId: number) => callRpc("dues_settle_deferred", { p_charge_id: chargeId });

interface RawCourtCharge {
	id: number;
	member_id: string;
	session_id: number;
	amount_due: number;
	amount_paid: number;
	status: string;
	payer_hint: string | null;
	sessions: { id: number; title: string | null; scheduled_at: string | null } | null;
}

export async function fetchCourtCharges(ym: string): Promise<CourtChargeRow[]> {
	const { start, end } = ymRangeKst(ym);
	// court_fee 는 period_ym 이 없어 세션 시각으로 월 필터(embedded !inner + 범위).
	const { data, error } = await supabase
		.from("dues_charges")
		.select(
			"id, member_id, session_id, amount_due, amount_paid, status, payer_hint, sessions!inner(id, title, scheduled_at)",
		)
		.eq("kind", "court_fee")
		.gte("sessions.scheduled_at", start)
		.lt("sessions.scheduled_at", end);
	if (error) {
		console.error("fetchCourtCharges:", error);
		return [];
	}
	return ((data ?? []) as unknown as RawCourtCharge[]).map((c) => ({
		id: c.id,
		memberId: c.member_id,
		sessionId: c.session_id,
		sessionTitle: c.sessions?.title ?? null,
		scheduledAt: c.sessions?.scheduled_at ?? null,
		amountDue: c.amount_due,
		amountPaid: c.amount_paid,
		status: c.status as ChargeStatus,
		payerHint: c.payer_hint,
	}));
}

// ── 내 회비(회원) ────────────────────────────────────────────────────
interface RawMyCharge {
	id: number;
	kind: string;
	member_id: string;
	period_ym: string | null;
	session_id: number | null;
	amount_due: number;
	amount_paid: number;
	status: string;
	payer_hint: string | null;
	sessions: { title: string | null; scheduled_at: string | null } | null;
}

/** 내 회비/대관비 전체(RLS 로 본인+대납분만). meMemberId 로 대납 여부 판정. */
export async function fetchMyCharges(meMemberId: string): Promise<MyChargeRow[]> {
	const { data, error } = await supabase
		.from("dues_charges")
		.select(
			"id, kind, member_id, period_ym, session_id, amount_due, amount_paid, status, payer_hint, sessions(title, scheduled_at)",
		)
		// 본인 부과 + 대납분(게스트 초대자)만. RLS가 관리자에겐 전체를 허용하므로 명시 필터 필수
		// (없으면 관리자 계정의 /my-dues 에 전 회원 부과가 노출됨).
		.or(`member_id.eq.${meMemberId},payer_hint.eq.${meMemberId}`)
		.order("created_at", { ascending: false });
	if (error) {
		console.error("fetchMyCharges:", error);
		return [];
	}
	return ((data ?? []) as unknown as RawMyCharge[]).map((c) => ({
		id: c.id,
		kind: c.kind as "monthly_fee" | "court_fee",
		periodYm: c.period_ym,
		sessionId: c.session_id,
		sessionTitle: c.sessions?.title ?? null,
		scheduledAt: c.sessions?.scheduled_at ?? null,
		amountDue: c.amount_due,
		amountPaid: c.amount_paid,
		status: c.status as ChargeStatus,
		isProxy: c.member_id !== meMemberId && c.payer_hint === meMemberId,
	}));
}

export async function fetchClubAccount(): Promise<ClubAccount | null> {
	const { data, error } = await supabase.rpc("dues_club_account");
	if (error || !data) {
		if (error) console.error("fetchClubAccount:", error);
		return null;
	}
	const d = data as Record<string, unknown>;
	return {
		bankName: (d.bank_name as string | null) ?? null,
		accountMasked: (d.account_masked as string | null) ?? null,
		accountHolder: (d.account_holder as string | null) ?? null,
		monthlyFee: (d.monthly_fee as number | null) ?? null,
	};
}

// ── 장소 대관비(관리자) ───────────────────────────────────────────────
export interface PlaceFeeRow {
	id: number;
	name: string;
	courtFeePerHour: number | null;
}

export async function fetchPlaceFees(): Promise<PlaceFeeRow[]> {
	const { data, error } = await supabase
		.from("places")
		.select("id, name, court_fee_per_hour")
		.eq("is_active", true)
		.order("name", { ascending: true });
	if (error) {
		console.error("fetchPlaceFees:", error);
		return [];
	}
	return (data ?? []).map((p) => ({
		id: p.id,
		name: p.name,
		courtFeePerHour: p.court_fee_per_hour,
	}));
}

// ── 세션별 실지출 대관비(수지 §10) ───────────────────────────────────
interface RawSessionFee {
	id: number;
	title: string | null;
	scheduled_at: string | null;
	ends_at: string | null;
	court_count: number | null;
	court_fee: number | null;
	places: { name: string | null; court_fee_per_hour: number | null } | null;
}
export interface SessionFeeRow {
	id: number;
	title: string | null;
	scheduledAt: string | null;
	courtCount: number | null;
	hours: number | null;
	placeName: string | null;
	suggested: number | null; // 코트요금 × 코트수 × 시간(할인 전 참고값)
	courtFee: number | null; // 실제 입력 지출
}

async function queryCourtSessions(start: string, end: string): Promise<SessionFeeRow[]> {
	// '실제 열린 대관 세션'의 단일 기준(generate_dues_charges와 동일): 대관 장소 + active/closed + 경기기록(matches) 있음.
	// matches!inner 로 경기 없는 세션(무산)을 원천 제외 → 정산함·회계·현황 모든 세션 목록이 일괄로 열린 경기만.
	const { data, error } = await supabase
		.from("sessions")
		.select("id, title, scheduled_at, ends_at, court_count, court_fee, places!inner(name, court_fee_per_hour), matches!inner(id)")
		.gte("scheduled_at", start)
		.lt("scheduled_at", end)
		.in("status", ["active", "closed"])
		.not("places.court_fee_per_hour", "is", null) // 코트 요금 설정된(대관) 장소 세션만
		.order("scheduled_at", { ascending: false });
	if (error) {
		console.error("queryCourtSessions:", error);
		return [];
	}
	return ((data ?? []) as unknown as RawSessionFee[]).map((s) => {
		const hours =
			s.scheduled_at && s.ends_at
				? Math.round((new Date(s.ends_at).getTime() - new Date(s.scheduled_at).getTime()) / 3600000)
				: null;
		const rate = s.places?.court_fee_per_hour ?? null;
		const suggested = rate != null && s.court_count != null && hours != null ? rate * s.court_count * hours : null;
		return {
			id: s.id,
			title: s.title,
			scheduledAt: s.scheduled_at,
			courtCount: s.court_count,
			hours,
			placeName: s.places?.name ?? null,
			suggested,
			courtFee: s.court_fee,
		};
	});
}

/** ym 전후(±1개월) 대관 세션 — 지출-세션 링크 + 이번 달 세션(상위집합에서 파생). 대관비는 다른 달에 지급될 수 있음. */
export function fetchLedgerSessions(ym: string): Promise<SessionFeeRow[]> {
	const shift = (base: string, delta: number) => {
		const [y, m] = base.split("-").map(Number);
		const total = (y * 12 + (m - 1)) + delta;
		return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
	};
	const { start } = ymRangeKst(shift(ym, -1));
	const { end } = ymRangeKst(shift(ym, 1));
	return queryCourtSessions(start, end);
}

/** 세션에 링크된 은행거래(발생월 무관) — 세션 순액을 세션 기준으로 계산(전월 지급 등 포함). */
export async function fetchSessionTxns(
	sessionIds: number[],
): Promise<{ sessionId: number; direction: "in" | "out"; amount: number }[]> {
	if (sessionIds.length === 0) return [];
	const { data, error } = await supabase
		.from("bank_transactions")
		.select("session_id, direction, amount")
		.in("session_id", sessionIds);
	if (error) {
		console.error("fetchSessionTxns:", error);
		return [];
	}
	return ((data ?? []) as { session_id: number; direction: "in" | "out"; amount: number }[]).map((t) => ({
		sessionId: t.session_id,
		direction: t.direction,
		amount: t.amount,
	}));
}

/** 장소 코트 시간당 요금 설정(NULL=대관비 없는 장소, 수지용). members_admin_write 격 RLS(places). */
export async function updatePlaceFee(
	placeId: number,
	fee: number | null,
): Promise<boolean> {
	const { data, error } = await supabase
		.from("places")
		.update({ court_fee_per_hour: fee })
		.eq("id", placeId)
		.select("id");
	if (error || !data || data.length === 0) {
		if (error) console.error("updatePlaceFee:", error);
		return false;
	}
	return true;
}
