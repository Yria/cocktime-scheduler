import type {
	AccountingCommand,
	AccountingData,
	AccountingMode,
	CashLedger,
	ManagementAction,
	OperationResult,
} from "../dues/v2/types";
import { supabase } from "./client";
import type { AccountingParticipation } from "../dues/v2/participation";
import type { SessionFeeRow } from "./dues";

/** Attendance context only. Charges and paid amounts are read from the V2 ledger. */
export async function readAccountingParticipation(
	sessionIds: number[],
): Promise<AccountingParticipation> {
	if (!sessionIds.length) return { sessions: [], adminIds: [], flatFee: 0 };
	const [sessions, admins, settings] = await Promise.all([
		supabase
			.from("sessions")
			.select(
				"id,title,status,scheduled_at,court_fee,recurring_schedules(court_fee),attendances(member_id,status,confirmed_at,cancelled_at),session_players(member_id)",
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
	const { data, error } = await supabase.rpc("dues_v2_mode");
	// An old deployment is supported. Network/auth errors must not activate legacy writes.
	if (error?.code === "PGRST202" || error?.code === "42883")
		return {
			available: false,
			enabled: false,
			paused: false,
			revision: 0,
			epoch: "",
		};
	if (error) throw error;
	if (!data) throw new Error("회계 사용 상태를 확인할 수 없습니다");
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
export const readAccounting = () => rpc<AccountingData>("dues_v2_read");
export const readAccountingLedger = (ym: string) =>
	rpc<CashLedger>("dues_v2_ledger", { p_ym: ym });
export const previewAccounting = (
	payload: AccountingCommand,
	requestId: string,
	revision: number,
) =>
	rpc<OperationResult>("dues_v2_preview", {
		p_payload: payload,
		p_request_id: requestId,
		p_revision: revision,
	});
export const commitAccounting = (
	payload: AccountingCommand,
	requestId: string,
	revision: number,
) =>
	rpc<OperationResult>("dues_v2_command", {
		p_payload: payload,
		p_request_id: requestId,
		p_revision: revision,
	});
export const manageAccounting = (
	action: ManagementAction,
	reason: string,
	requestId: string,
	revision: number,
) =>
	rpc<AccountingMode>("dues_v2_manage", {
		p_action: action,
		p_reason: reason,
		p_request_id: requestId,
		p_revision: revision,
	});
export const exportAccounting = () =>
	rpc<Record<string, unknown>>("dues_v2_export");
export const accountingCandidates = (
	kind: "monthly" | "court",
	ym: string,
	sessionId: number | null = null,
) =>
	rpc<{ payload: AccountingCommand; hold_reason: string | null }>(
		"dues_v2_candidates",
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
	>("dues_v2_sessions");
export const accountingReferenceMembers = (sessionId: number, meal: boolean) =>
	rpc<string[]>("dues_v2_reference_members", {
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
