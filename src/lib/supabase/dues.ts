import type { SessionAttendanceLog } from "../dues/attendanceLog";
import { ymRangeKst } from "../dues/duesText";
import type { AccountingParticipation } from "../dues/participation";
import type { SessionChoice } from "../dues/selection";
import type { SessionFeeRow } from "../dues/sessionTypes";
import type {
	AccountingCommand,
	AccountingData,
	AccountingMode,
	CashLedger,
	OperationResult,
} from "../dues/types";
import { supabase } from "./client";

/** One calendar month in KST; the small cursor lookup skips empty older months. */
export async function readAccountingReferenceSessions(ym: string): Promise<{
	sessions: (SessionChoice & { mealEnabled: boolean })[];
	previousYm: string | null;
}> {
	const { start, end } = ymRangeKst(ym);
	const [month, previous] = await Promise.all([
		supabase
			.from("sessions")
			.select(
				"id,title,scheduled_at,ends_at,is_regular,meal_enabled,places(name)",
			)
			.in("status", ["open", "active", "closed"])
			.gte("scheduled_at", start)
			.lt("scheduled_at", end)
			.order("scheduled_at", { ascending: false })
			.order("id"),
		supabase
			.from("sessions")
			.select("scheduled_at")
			.in("status", ["open", "active", "closed"])
			.lt("scheduled_at", start)
			.order("scheduled_at", { ascending: false })
			.limit(1),
	]);
	if (month.error) throw month.error;
	if (previous.error) throw previous.error;
	const older = previous.data?.[0]?.scheduled_at as string | undefined;
	return {
		sessions: (
			(month.data ?? []) as unknown as (Omit<SessionChoice, "place"> & {
				places: { name: string | null } | null;
				is_regular: boolean;
				meal_enabled: boolean;
			})[]
		).map(({ places, is_regular, meal_enabled, ...session }) => ({
			...session,
			place: places?.name ?? null,
			mealEnabled: is_regular === true && meal_enabled === true,
		})),
		previousYm: older
			? new Date(new Date(older).getTime() + 9 * 3600000)
					.toISOString()
					.slice(0, 7)
			: null,
	};
}

/** Shared by the monthly balance and transaction details; no legacy joins. */
export async function readAccountingBankBalances(ym: string) {
	const { start, end } = ymRangeKst(ym);
	const { data, error } = await supabase
		.from("bank_transactions")
		.select("id,occurred_at,balance_after")
		.gte("occurred_at", start)
		.lt("occurred_at", end)
		.order("occurred_at", { ascending: false })
		.order("id", { ascending: false });
	if (error) throw error;
	return (data ?? []) as {
		id: number;
		occurred_at: string;
		balance_after: number | null;
	}[];
}

/** Attendance context only. Charges and paid amounts are read from the canonical ledger. */
export async function readAccountingParticipation(
	sessionIds: number[],
): Promise<AccountingParticipation> {
	if (!sessionIds.length) return { sessions: [], adminIds: [], flatFee: 0 };
	const [sessions, admins, settings] = await Promise.all([
		supabase
			.from("sessions")
			.select(
				"id,title,status,scheduled_at,court_fee,recurring_schedules(court_fee),attendances(member_id,status,confirmed_at,cancelled_at,invited_by),session_players(member_id)",
			)
			.in("id", sessionIds),
		supabase.from("user_roles").select("member_id").eq("role", "admin"),
		supabase
			.from("dues_settings")
			.select("court_fee_default")
			.eq("id", 1)
			.single(),
	]);
	if (sessions.error) throw sessions.error;
	if (admins.error) throw admins.error;
	if (settings.error) throw settings.error;
	type RawSession = {
		id: number;
		title: string | null;
		status: SessionFeeRow["status"];
		scheduled_at: string | null;
		court_fee: number | null;
		recurring_schedules: { court_fee: number | null } | null;
		attendances: {
			member_id: string;
			status: string;
			confirmed_at: string | null;
			cancelled_at: string | null;
			invited_by: string | null;
		}[];
		session_players: { member_id: string | null }[];
	};
	return {
		adminIds: (admins.data ?? []).map((m) => m.member_id),
		flatFee: settings.data.court_fee_default,
		sessions: ((sessions.data ?? []) as unknown as RawSession[]).map((s) => ({
			id: s.id,
			title: s.title,
			status: s.status,
			scheduledAt: s.scheduled_at,
			courtFee: s.court_fee,
			ruleCourtFee: s.recurring_schedules?.court_fee ?? null,
			courtCount: null,
			hours: null,
			placeName: null,
			attendeeIds: (s.attendances ?? [])
				.filter((a) => ["confirmed", "late_pool"].includes(a.status))
				.map((a) => a.member_id),
			attendances: (s.attendances ?? []).map((a) => ({
				memberId: a.member_id,
				status: a.status,
				confirmedAt: a.confirmed_at,
				cancelledAt: a.cancelled_at,
				invitedBy: a.invited_by,
			})),
			boardMemberIds: [
				...new Set(
					(s.session_players ?? [])
						.map((p) => p.member_id)
						.filter((id): id is string => !!id),
				),
			],
		})),
	};
}

export async function accountingMode(): Promise<AccountingMode> {
	const { data, error } = await supabase.rpc("dues_mode");
	if (error) throw error;
	if (!data?.enabled)
		throw new Error(
			"회계 사용 상태를 확인할 수 없습니다. 잠시 후 다시 확인해 주세요.",
		);
	return { ...data, available: true } as AccountingMode;
}
async function rpc<T>(
	name: string,
	args?: Record<string, unknown>,
): Promise<T> {
	const { data, error } = await supabase.rpc(name, args);
	if (error) throw error;
	if (data == null) throw new Error("회계 응답이 없습니다");
	return data as T;
}
export const readAccounting = () => rpc<AccountingData>("dues_read");
export const readAccountingLedger = (ym: string) =>
	rpc<CashLedger>("dues_ledger", { p_ym: ym });
export const previewAccounting = (
	payload: AccountingCommand,
	requestId: string,
	revision: number,
) =>
	rpc<OperationResult>("dues_preview", {
		p_payload: payload,
		p_request_id: requestId,
		p_revision: revision,
	});
export const commitAccounting = (
	payload: AccountingCommand,
	requestId: string,
	revision: number,
) =>
	rpc<OperationResult>("dues_command", {
		p_payload: payload,
		p_request_id: requestId,
		p_revision: revision,
	});
export const accountingCandidates = (
	kind: "monthly" | "court",
	ym: string,
	sessionId: number | null = null,
) =>
	rpc<{ payload: AccountingCommand; hold_reason: string | null }>(
		"dues_candidates",
		{ p_kind: kind, p_ym: ym, p_session_id: sessionId },
	);
export const accountingSessions = () =>
	rpc<
		{
			id: number;
			title: string;
			scheduled_at: string;
			ends_at: string | null;
			place: string | null;
			court: boolean;
		}[]
	>("dues_sessions");
export const accountingReferenceMembers = (sessionId: number, meal: boolean) =>
	rpc<string[]>("dues_reference_members", {
		p_session_id: sessionId,
		p_meal: meal,
	});
export function accountingError(error: unknown): string {
	return error instanceof Error
		? error.message
		: typeof error === "object" && error !== null && "message" in error
			? String(error.message)
			: "처리하지 못했습니다. 다시 확인해 주세요.";
}

/**
 * 회차 총액 변경 결과(dues_set_session_fee / dues_session_fee_preview).
 * 발행분이 있으면 전부 취소 후 재발행한다 — 20261019000000_session_fee_reissue.sql.
 * freed/removed/issued 는 이전 클라이언트 호환 키.
 */
export interface SetSessionFeeResult {
	court_fee: number | null;
	/** 새 인당 금액. 총액 0(안 걷음)이면 null */
	per_head?: number | null;
	head?: number | null;
	/** 같은 값이라 아무것도 바꾸지 않음 */
	unchanged?: boolean;
	preview?: boolean;
	/** 취소한 기존 부과 수 / 그중 납부가 있던 수 / 해제한 납부 합 */
	cancelled?: number;
	paid_cancelled?: number;
	released_amount?: number;
	/** 해제한 돈 중 같은 회원 새 부과에 다시 연결한 합 / 회원 잔액으로 남은 합 */
	reused_amount?: number;
	left_as_balance?: number;
	/** 같은 회원 재발행 수 / 새 대상 발행 수 / 발행 대기 수 */
	reissued?: number;
	issued_new?: number;
	held: number;
	freed: number;
	removed: number;
	issued: number;
}

/**
 * 엔빵 재분배: 남은 유효 대관비를 총액 ÷ 현재 인원으로 서버에서 재발행한다(선납 표식·당일취소 표시 유지).
 * revision 은 화면이 재분배 금액을 계산한 장부 기준 — 그 사이 다른 변경이 있으면 서버가 거부한다.
 */
export async function respreadCourtGroup(groupId: string, revision: number) {
	return rpc<{
		per_head: number;
		head: number;
		reissued?: number;
		unchanged?: boolean;
	}>("dues_respread_court_group", {
		p_group_id: groupId,
		p_revision: revision,
	});
}

export async function sessionDeletionInfo(sessionId: number) {
	return rpc<{ preserve: boolean; paid_count: number }>(
		"dues_session_deletion",
		{ p_session_id: sessionId },
	);
}

/**
 * 회차의 참석 변경 이력(ops_audit, 운영진만 읽힘). 부과 명단에서 '왜 부과됐나/취소됐나'를
 * 시점과 함께 보여주는 근거다. attendances 는 마지막 상태만 들고 있어 취소→재참가가 지워진다.
 */
export async function readSessionAttendanceLog(
	sessionId: number,
): Promise<SessionAttendanceLog> {
	const [session, events] = await Promise.all([
		supabase
			.from("sessions")
			.select("scheduled_at,started_at,ended_at,capacity")
			.eq("id", sessionId)
			.single(),
		supabase
			.from("ops_audit")
			.select("at,member_id,actor,req_path,detail")
			.eq("session_id", sessionId)
			.eq("kind", "attendance")
			.order("at")
			.order("id"),
	]);
	if (session.error) throw session.error;
	if (events.error) throw events.error;
	type Raw = {
		at: string;
		member_id: string | null;
		actor: string | null;
		req_path: string | null;
		detail: {
			op?: string;
			old_status?: string;
			new_status?: string;
			actual_now?: number;
		} | null;
	};
	return {
		scheduledAt: session.data.scheduled_at,
		startedAt: session.data.started_at,
		endedAt: session.data.ended_at,
		capacity: session.data.capacity,
		events: ((events.data ?? []) as Raw[]).flatMap((e) =>
			e.member_id && typeof e.detail?.actual_now === "number"
				? [
						{
							at: e.at,
							memberId: e.member_id,
							op: e.detail.op ?? "",
							from: e.detail.old_status ?? null,
							to:
								e.detail.op === "DELETE" ? null : (e.detail.new_status ?? null),
							count: e.detail.actual_now,
							actor: e.actor,
							path: e.req_path,
						},
					]
				: [],
		),
	};
}
