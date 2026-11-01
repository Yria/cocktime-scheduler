import { supabase } from "./client";
import type { SetSessionFeeResult } from "./dues";
import type { RecurringScheduleRow, SessionRow } from "./types";

/** 일정 추가 알림: 로그인 회원 전원(추가한 본인 제외)에게 'schedule_added' 알림 발송(운영진). */
export async function notifyScheduleAdded(
	sessionId: number | null,
	label: string,
): Promise<void> {
	const { error } = await supabase.rpc("notify_members_schedule_added", {
		p_session_id: sessionId,
		p_label: label,
	});
	if (error) console.error("notifyScheduleAdded:", error);
}

// ── 반복 규칙(recurring_schedules) CRUD ───────────────────────

export interface RecurringRuleInput {
	dayOfWeek: number; // 0=일 .. 6=토
	weekOrdinals: number[]; // 매주=[1,2,3,4,5]
	includeLast: boolean;
	startTime: string; // "19:00"
	endTime: string; // "22:00"
	carpoolEnabled: boolean;
	capacity: number | null;
	placeId: number | null;
	/** 엔빵 대관비 기본 총액(원). null=총액 없음(→정액 6천). 대관장소일 때만 의미. */
	courtFee: number | null;
}

export async function fetchRecurringRules(): Promise<RecurringScheduleRow[]> {
	const { data, error } = await supabase
		.from("recurring_schedules")
		.select("*")
		.order("day_of_week", { ascending: true })
		.order("start_time", { ascending: true });
	if (error) {
		console.error("fetchRecurringRules:", error);
		return [];
	}
	return (data ?? []) as RecurringScheduleRow[];
}

export async function createRecurringRule(
	input: RecurringRuleInput,
	createdBy: string | null,
): Promise<RecurringScheduleRow | null> {
	const { data, error } = await supabase
		.from("recurring_schedules")
		.insert({
			day_of_week: input.dayOfWeek,
			week_ordinals: input.weekOrdinals,
			include_last: input.includeLast,
			start_time: input.startTime,
			end_time: input.endTime,
			carpool_enabled: input.carpoolEnabled,
			capacity: input.capacity,
			place_id: input.placeId,
			court_fee: input.courtFee,
			created_by: createdBy,
		})
		.select()
		.single();
	if (error) {
		console.error("createRecurringRule:", error);
		return null;
	}
	return data as RecurringScheduleRow;
}

export async function updateRecurringRule(
	id: number,
	patch: Partial<RecurringRuleInput> & { isActive?: boolean },
): Promise<RecurringScheduleRow | null> {
	const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (patch.dayOfWeek != null) row.day_of_week = patch.dayOfWeek;
	if (patch.weekOrdinals != null) row.week_ordinals = patch.weekOrdinals;
	if (patch.includeLast != null) row.include_last = patch.includeLast;
	if (patch.startTime != null) row.start_time = patch.startTime;
	if (patch.endTime != null) row.end_time = patch.endTime;
	if (patch.carpoolEnabled != null) row.carpool_enabled = patch.carpoolEnabled;
	if (patch.capacity !== undefined) row.capacity = patch.capacity;
	if (patch.placeId !== undefined) row.place_id = patch.placeId;
	if (patch.courtFee !== undefined) row.court_fee = patch.courtFee;
	if (patch.isActive != null) row.is_active = patch.isActive;
	const { data, error } = await supabase
		.from("recurring_schedules")
		.update(row)
		.eq("id", id)
		.select()
		.single();
	if (error) {
		console.error("updateRecurringRule:", error);
		return null;
	}
	return data as RecurringScheduleRow;
}

export async function deleteRecurringRule(id: number): Promise<boolean> {
	const { error } = await supabase
		.from("recurring_schedules")
		.delete()
		.eq("id", id);
	if (error) {
		console.error("deleteRecurringRule:", error);
		return false;
	}
	return true;
}

// ── 회차(sessions) 조회/개별 편집 ─────────────────────────────

/**
 * 달력용(운영진): 기간 내 모든 회차(draft·cancelled 포함, scheduled_at 보유). 즉석 세션(NULL)은 제외.
 * cancelled tombstone 도 반환한다 — 되살리기(취소 취소) 진입점이 되도록. 달력 점(dot)에서는
 * closed 와 함께 숨기고 선택일 상세 목록에만 '취소됨' 배지로 표시(ScheduleCalendar). 회원용
 * fetchSchedules 는 여전히 open/active 만 노출하므로 cancelled 가 회원에게 새지 않는다.
 */
export async function fetchOccurrences(
	fromISO: string,
	toISO: string,
): Promise<SessionRow[]> {
	const { data, error } = await supabase
		.from("sessions")
		.select("*")
		.not("scheduled_at", "is", null)
		.gte("scheduled_at", fromISO)
		.lte("scheduled_at", toISO)
		.order("scheduled_at", { ascending: true });
	if (error) {
		console.error("fetchOccurrences:", error);
		return [];
	}
	return (data ?? []) as SessionRow[];
}

export interface OccurrencePatch {
	scheduledAt?: string; // ISO
	endsAt?: string; // ISO
	carpoolEnabled?: boolean;
	placeId?: number | null;
	capacity?: number | null;
	courtFee?: number | null; // 이 회차 엔빵 대관비 총액(원). null=규칙 기본값 사용. 부과 시점 coalesce(세션,규칙)
	isRegular?: boolean; // 정모 여부
	noticeMd?: string | null; // 정모 안내/대진표 본문(마크다운)
	mealEnabled?: boolean; // 정모 식사(회식) 참여 체크 노출 — 정모일 때만 의미
	mealPlace?: string | null; // 회식 가게 이름(null=미지정)
	mealPlaceLat?: number | null; // 가게 좌표(카카오 검색 선택 시). null=좌표 없음 → 이름 검색 폴백
	mealPlaceLng?: number | null;
}

/** OccurrencePatch → sessions 컬럼(있는 키만). */
function occurrenceColumns(patch: OccurrencePatch): Record<string, unknown> {
	const row: Record<string, unknown> = {};
	if (patch.scheduledAt != null) row.scheduled_at = patch.scheduledAt;
	if (patch.endsAt != null) row.ends_at = patch.endsAt;
	if (patch.carpoolEnabled != null) row.carpool_enabled = patch.carpoolEnabled;
	if (patch.placeId !== undefined) row.place_id = patch.placeId;
	if (patch.capacity !== undefined) row.capacity = patch.capacity;
	if (patch.courtFee !== undefined) row.court_fee = patch.courtFee;
	if (patch.isRegular != null) row.is_regular = patch.isRegular;
	if (patch.noticeMd !== undefined) row.notice_md = patch.noticeMd;
	if (patch.mealEnabled != null) row.meal_enabled = patch.mealEnabled;
	if (patch.mealPlace !== undefined) row.meal_place = patch.mealPlace;
	if (patch.mealPlaceLat !== undefined) row.meal_place_lat = patch.mealPlaceLat;
	if (patch.mealPlaceLng !== undefined) row.meal_place_lng = patch.mealPlaceLng;
	return row;
}

/**
 * 반복 규칙 회차 삭제(tombstone): status='cancelled'. 행 자체는 남겨 sync 의 재생성을 막는다.
 * (그냥 delete 하면 sync_schedule_occurrences B단계가 56일 창 안에서 다시 생성함)
 * 회원 화면(fetchSchedules=open/active)엔 안 뜨고, 운영진 달력에선 점(dot)에서 숨되 선택일
 * 상세 목록에 '취소됨' 으로 남아 되살리기(reopenOccurrence) 진입점이 된다.
 * 일회성 회차는 규칙이 없어 deleteSchedule 로 완전 삭제한다.
 */
export async function cancelOccurrence(
	sessionId: number,
): Promise<SessionRow | null> {
	const { data, error } = await supabase
		.from("sessions")
		.update({ status: "cancelled", is_active: false, is_overridden: true })
		.eq("id", sessionId)
		.select()
		.single();
	if (error) {
		console.error("cancelOccurrence:", error);
		return null;
	}
	return data as SessionRow;
}

/**
 * 취소(tombstone) 되살리기 — cancelOccurrence 의 역연산. `cancelled` 회차를 `draft` 로
 * 되돌리고 `is_overridden=false` 로 규칙 관리에 재편입한다.
 * 노출(draft→open, 'session_open' 알림) 판정은 호출부(adminScheduleActions.reopenOccurrence)가
 * 직후 sync_schedule_occurrences E단계에 위임 — 공개 창 안이면 즉시 open + 알림(이미 알림이
 * 나갔던 회차는 E단계 멱등 가드로 중복 발송하지 않는다).
 */
export async function reopenOccurrence(
	sessionId: number,
): Promise<SessionRow | null> {
	const { data, error } = await supabase
		.from("sessions")
		.update({ status: "draft", is_active: false, is_overridden: false })
		.eq("id", sessionId)
		.select()
		.single();
	if (error) {
		console.error("reopenOccurrence:", error);
		return null;
	}
	return data as SessionRow;
}

export interface OneOffInput {
	scheduledAt: string; // ISO
	endsAt: string; // ISO
	carpoolEnabled: boolean;
	occurrenceDate: string; // YYYY-MM-DD (Asia/Seoul 달력 날짜)
	placeId: number | null;
	capacity: number | null;
	courtCount?: number;
	courtFee?: number | null; // 엔빵 대관비 총액(원). null=총액 없음(→정액 6천)
	isRegular?: boolean; // 정모 여부
	noticeMd?: string | null; // 정모 안내/대진표 본문(마크다운)
	mealEnabled?: boolean; // 정모 식사(회식) 참여 체크 노출 — 정모일 때만 의미
	mealPlace?: string | null; // 회식 가게 이름
	mealPlaceLat?: number | null; // 가게 좌표(카카오 검색 선택 시)
	mealPlaceLng?: number | null;
}

/**
 * 규칙 없는 일회성 회차 추가(달력에서 직접). draft 로 만들고 노출(draft→open) 판정은
 * sync_schedule_occurrences 의 E 단계에 단일 위임 — 클라/서버 노출 기준 불일치 방지.
 * 일회성(recurring_schedule_id=null)은 E 단계가 공개 상한(일요일 18:00 일괄 공개)을 건너뛰고
 * 즉시 open 시키므로, 호출부 adminScheduleActions.addOneOff 의 직후 sync 로 등록 즉시 노출된다.
 */
export async function createOneOffOccurrence(
	input: OneOffInput,
	createdBy: string | null,
): Promise<SessionRow | null> {
	const { data, error } = await supabase
		.from("sessions")
		.insert({
			scheduled_at: input.scheduledAt,
			ends_at: input.endsAt,
			carpool_enabled: input.carpoolEnabled,
			occurrence_date: input.occurrenceDate,
			place_id: input.placeId,
			capacity: input.capacity,
			court_count: input.courtCount ?? 4,
			court_fee: input.courtFee ?? null,
			status: "draft",
			is_active: false,
			is_overridden: false,
			recurring_schedule_id: null,
			is_regular: input.isRegular ?? false,
			notice_md: input.noticeMd ?? null,
			meal_enabled: input.mealEnabled ?? false,
			meal_place: input.mealPlace ?? null,
			meal_place_lat: input.mealPlaceLat ?? null,
			meal_place_lng: input.mealPlaceLng ?? null,
			created_by: createdBy,
		})
		.select()
		.single();
	if (error) {
		console.error("createOneOffOccurrence:", error);
		return null;
	}
	return data as SessionRow;
}

/**
 * 회차 수정 결과(session_edit). recharged=총액·대관장소 여부가 바뀌어 부과를 다시 맞췄음 —
 * 그때 나머지 키는 dues_set_session_fee 결과(취소·재발행 수 등)다. promoted/demoted=정원 변경 재조정.
 */
export interface OccurrenceEditResult
	extends Partial<Omit<SetSessionFeeResult, "held">> {
	/** 재계산하지 않았으면 0 으로 채운다(확인창·토스트 공용 타입과 맞춤). */
	held: number;
	recharged: boolean;
	was_rental: boolean;
	is_rental: boolean;
	promoted: number;
	demoted: number;
	preview?: boolean;
}

/**
 * 기존 회차 수정(취소 회차 제외) — 회차 변경 + 정원 재조정 + 부과 재계산(취소·재발행)을 한 트랜잭션으로.
 * is_overridden=true 로 sync 덮어쓰기 방지. 진행·종료 회차의 날짜 변경은 서버가 거부(시간만).
 * 실패는 throw — 폼이 사유를 보여준다(부분 적용을 성공으로 위장하지 않는다).
 */
export async function editOccurrence(
	sessionId: number,
	patch: OccurrencePatch,
): Promise<OccurrenceEditResult> {
	const { data, error } = await supabase.rpc("session_edit", {
		p_session_id: sessionId,
		p_patch: occurrenceColumns(patch),
	});
	if (error) {
		console.error("editOccurrence:", error);
		throw new Error(error.message);
	}
	return { held: 0, ...(data as Omit<OccurrenceEditResult, "held">) };
}

/** 위 수정을 실제로 돌려 본 결과만 받는다(서버가 롤백). 확인창 숫자용. */
export async function previewOccurrenceEdit(
	sessionId: number,
	patch: OccurrencePatch,
): Promise<OccurrenceEditResult> {
	const { data, error } = await supabase.rpc("session_edit_preview", {
		p_session_id: sessionId,
		p_patch: occurrenceColumns(patch),
	});
	if (error) {
		console.error("previewOccurrenceEdit:", error);
		throw new Error(error.message);
	}
	return { held: 0, ...(data as Omit<OccurrenceEditResult, "held">) };
}
