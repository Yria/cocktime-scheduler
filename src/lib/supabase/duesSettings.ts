import { supabase } from "./client";

export interface DuesSettings {
	monthlyFee: number;
	courtFeeDefault: number;
	offsetDays: number;
	/** 합류 컷오프일(1~31). 실제 합류일이 그 달 이 날짜 이후면 그 달 회비는 미부과 — dues_generate_monthly 하한. */
	joinCutoffDay: number;
	bankName: string | null;
	bankAccount: string | null;
	accountHolder: string | null;
}

export interface ClubAccount {
	bankName: string | null;
	account: string | null; // 전체 계좌번호(로그인 회원 전용)
	accountHolder: string | null;
	monthlyFee: number | null;
}

interface RpcResult {
	ok: boolean;
	error?: string;
	data?: unknown;
}

export async function fetchDuesSettings(): Promise<DuesSettings | null> {
	const { data, error } = await supabase
		.from("dues_settings")
		.select(
			"monthly_fee, court_fee_default, offset_days, join_cutoff_day, bank_name, bank_account, account_holder",
		)
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
		joinCutoffDay: data.join_cutoff_day,
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
	if (patch.courtFeeDefault !== undefined)
		row.court_fee_default = patch.courtFeeDefault;
	if (patch.offsetDays !== undefined) row.offset_days = patch.offsetDays;
	if (patch.joinCutoffDay !== undefined)
		row.join_cutoff_day = patch.joinCutoffDay;
	if (patch.bankName !== undefined) row.bank_name = patch.bankName;
	if (patch.bankAccount !== undefined) row.bank_account = patch.bankAccount;
	if (patch.accountHolder !== undefined)
		row.account_holder = patch.accountHolder;
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

async function callRpc(
	fn: string,
	args: Record<string, unknown>,
): Promise<RpcResult> {
	const { data, error } = await supabase.rpc(fn, args);
	if (error) {
		console.error(`${fn}:`, error);
		return { ok: false, error: error.message };
	}
	return { ok: true, data };
}

export const duesSetHonorary = (
	memberId: string,
	honorary: boolean,
	reason: string | null = null,
) =>
	callRpc("dues_set_honorary", {
		p_member_id: memberId,
		p_honorary: honorary,
		p_reason: reason,
	});

export async function fetchHonoraryReasons(): Promise<Record<string, string>> {
	const { data, error } = await supabase
		.from("member_honorary")
		.select("member_id, reason");
	if (error) {
		console.error("fetchHonoraryReasons:", error);
		return {};
	}
	const out: Record<string, string> = {};
	for (const r of (data ?? []) as {
		member_id: string;
		reason: string | null;
	}[]) {
		if (r.reason) out[r.member_id] = r.reason;
	}
	return out;
}

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
	trashed: number; // 적재 성공 후 Gmail 휴지통으로 이동한 메일 수
	deposits: IngestDeposit[]; // 신규 입금 샘플
	errors?: string[];
}

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

export async function fetchClubAccount(): Promise<ClubAccount | null> {
	const { data, error } = await supabase.rpc("dues_club_account");
	if (error || !data) {
		if (error) console.error("fetchClubAccount:", error);
		return null;
	}
	const d = data as Record<string, unknown>;
	return {
		bankName: (d.bank_name as string | null) ?? null,
		account: (d.account as string | null) ?? null,
		accountHolder: (d.account_holder as string | null) ?? null,
		monthlyFee: (d.monthly_fee as number | null) ?? null,
	};
}

export interface PlaceFeeRow {
	id: number;
	name: string;
	chargesCourtFee: boolean; // 대관장소 여부(대관비 부과 대상 게이트)
}

export async function fetchPlaceFees(): Promise<PlaceFeeRow[]> {
	const { data, error } = await supabase
		.from("places")
		.select("id, name, charges_court_fee")
		.eq("is_active", true)
		.order("name", { ascending: true });
	if (error) {
		console.error("fetchPlaceFees:", error);
		return [];
	}
	return (data ?? []).map((p) => ({
		id: p.id,
		name: p.name,
		chargesCourtFee: p.charges_court_fee,
	}));
}

export async function updatePlaceFee(
	placeId: number,
	chargesCourtFee: boolean,
): Promise<boolean> {
	const { data, error } = await supabase
		.from("places")
		.update({ charges_court_fee: chargesCourtFee })
		.eq("id", placeId)
		.select("id");
	if (error || !data || data.length === 0) {
		if (error) console.error("updatePlaceFee:", error);
		return false;
	}
	return true;
}
