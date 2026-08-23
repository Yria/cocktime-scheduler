// 수동 부과(회식·공동구매 등) 데이터 레이어.
//
// 부과 행은 회비·대관비와 **같은 테이블**(dues_charges)에 산다. 다른 건 묶음 축 하나뿐:
//   회비=period_ym / 대관비=session_id / 수동=batch_key ('{type}:{scope}', 20260823010000).
// 그래서 미납·정산함·내 회비는 손댈 게 없고(같은 테이블을 이미 읽는다), 이 파일은 배치를 만들고
// 목록으로 묶어 보여주는 일만 한다.

import { supabase } from "./client";

/** 수동 부과 종류 — batch_key 접두. 종류를 늘려도 스키마·RPC 는 그대로다(라벨과 접두만 추가). */
export const MANUAL_TYPES = [
	{ id: "meal", label: "회식", hint: "정모 뒤풀이 엔빵" },
	{ id: "cock", label: "콕 공동구매", hint: "셔틀콕 나눠 사기" },
	{ id: "uniform", label: "유니폼", hint: "단체복·유니폼 공동구매" },
	{ id: "goods", label: "물품·상품", hint: "그립·용품·경품 등" },
	{ id: "etc", label: "기타", hint: "위에 없는 것" },
] as const;

export type ManualType = (typeof MANUAL_TYPES)[number]["id"];

export const manualTypeLabel = (type: string): string =>
	MANUAL_TYPES.find((t) => t.id === type)?.label ?? "기타";

/**
 * batch_key 의 scope 에서 회차 id 를 뽑는다(`'meal:228'` → 228).
 * 편집 화면이 '참고 회차'를 복원하는 데 쓴다 — 회차는 부과에 저장되지 않으므로(요청: 일정에 엮지
 * 않는다) 키가 유일한 흔적이다. 날짜 scope(`'cock:2026-08-23'`)면 null.
 */
export function parseBatchSessionId(batchKey: string): number | null {
	const scope = batchKey.split(":").slice(1).join(":").split("#")[0];
	return /^\d+$/.test(scope) ? Number(scope) : null;
}

/** batch_key 의 종류 접두. 관례를 벗어난 키(손으로 넣은 것)는 'etc' 로 본다. */
export function parseBatchType(batchKey: string): string {
	const type = batchKey.split(":")[0];
	return MANUAL_TYPES.some((t) => t.id === type) ? type : "etc";
}

/**
 * 묶음 키를 만든다. 회차에 붙는 부과(회식)는 `meal:228` 로 회차가 키가 되어 **한 회차에 하나**가
 * 자연히 보장되고, 회차와 무관한 부과는 발생일이 키가 된다(`cock:2026-08-23`).
 * 같은 키가 이미 있으면 `#2`, `#3` … 을 붙여 새 배치로 만든다(같은 날 두 번 부과하는 경우).
 */
export function buildBatchKey(
	type: ManualType | string,
	scope: { sessionId?: number | null; date?: string },
	taken: Iterable<string> = [],
): string {
	const base = `${type}:${scope.sessionId != null ? scope.sessionId : (scope.date ?? "")}`;
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let n = 2; n < 100; n++) {
		const k = `${base}#${n}`;
		if (!used.has(k)) return k;
	}
	return `${base}#${Date.now()}`;
}

/** 한 묶음 = 화면의 목록 한 줄. 부과 행들을 batch_key 로 묶어 만든다. */
export interface ManualBatch {
	batchKey: string;
	type: string;
	label: string;
	/** 발생일 'YYYY-MM-DD' (월 귀속 기준). */
	chargedOn: string;
	memberIds: string[];
	head: number;
	/** 인당 금액. 선납 시점이 달라 섞였으면 최솟값 + mixedAmount=true. */
	perHead: number;
	mixedAmount: boolean;
	/** 부과 합계(= 낼 돈, void/waived 제외). */
	dueSum: number;
	/** 받은 돈 합계. */
	receivedSum: number;
	unpaidCount: number;
	/** 부과삭제·면제된 건 수 — 있으면 목록에서 흐리게 표시한다. */
	deadCount: number;
}

interface RawManualCharge {
	batch_key: string;
	label: string;
	charged_on: string;
	member_id: string;
	amount_due: number;
	amount_paid: number;
	status: string;
}

/**
 * 발생일이 [fromDate, toDate) 인 수동 부과를 배치로 묶어 최근순으로 돌려준다.
 * @param fromDate 'YYYY-MM-DD' 포함
 * @param toDate   'YYYY-MM-DD' 제외
 */
export async function fetchManualBatches(
	fromDate: string,
	toDate: string,
): Promise<ManualBatch[]> {
	const { data, error } = await supabase
		.from("dues_charges")
		.select("batch_key, label, charged_on, member_id, amount_due, amount_paid, status")
		.eq("kind", "manual")
		.gte("charged_on", fromDate)
		.lt("charged_on", toDate)
		.order("charged_on", { ascending: false });
	if (error) {
		console.error("fetchManualBatches:", error);
		return [];
	}

	const byKey = new Map<string, RawManualCharge[]>();
	for (const row of (data ?? []) as unknown as RawManualCharge[]) {
		const arr = byKey.get(row.batch_key);
		if (arr) arr.push(row);
		else byKey.set(row.batch_key, [row]);
	}

	const batches = [...byKey.entries()].map(([batchKey, rows]) => {
		// void/waived 는 낼 돈이 아니다(대관비 집계와 같은 기준).
		const live = rows.filter((r) => r.status !== "void" && r.status !== "waived");
		const amounts = [...new Set(live.map((r) => r.amount_due))];
		return {
			batchKey,
			type: parseBatchType(batchKey),
			label: rows[0].label,
			chargedOn: rows[0].charged_on,
			memberIds: rows.map((r) => r.member_id),
			head: rows.length,
			perHead: amounts.length > 0 ? Math.min(...amounts) : 0,
			mixedAmount: amounts.length > 1,
			dueSum: live.reduce((s, r) => s + r.amount_due, 0),
			receivedSum: rows.reduce((s, r) => s + r.amount_paid, 0),
			unpaidCount: live.filter((r) => r.amount_paid < r.amount_due).length,
			deadCount: rows.length - live.length,
		} satisfies ManualBatch;
	});
	// 같은 날이면 키 순으로 안정 정렬(목록이 새로고침마다 흔들리지 않게).
	return batches.sort(
		(a, b) => b.chargedOn.localeCompare(a.chargedOn) || a.batchKey.localeCompare(b.batchKey),
	);
}

/** 대상 후보를 뽑아올 회차 — 필터 컨텍스트의 재료. 대관 세션에 한정하지 않는다(정모 장소가 무부과일 수도). */
export interface ChargeSourceSession {
	id: number;
	scheduledAt: string | null;
	title: string | null;
	placeName: string | null;
	isRegular: boolean;
	mealEnabled: boolean;
	attendances: { memberId: string; status: string; mealJoining: boolean }[];
	boardMemberIds: string[];
}

interface RawSourceSession {
	id: number;
	scheduled_at: string | null;
	title: string | null;
	is_regular: boolean;
	meal_enabled: boolean;
	places: { name: string | null } | null;
	attendances: { member_id: string; status: string; meal_joining: boolean }[] | null;
	session_players: { member_id: string | null }[] | null;
}

/**
 * 이미 열린(진행/종료) 회차 + 참석행(식사 체크 포함) + 보드 명단.
 * `queryCourtSessions`(정산용)와 **따로 둔다** — 저쪽은 대관장소만 보고(`places!inner`) 대관비 계산용
 * 필드를 끌고 오는데, 여기는 무부과 장소의 정모도 필요하고 식사 체크가 필요하다. 한 쿼리로 합치면
 * 두 화면이 서로의 필드를 끌고 다니게 된다.
 */
export async function fetchChargeSourceSessions(
	fromISO: string,
	toISO: string,
): Promise<ChargeSourceSession[]> {
	const { data, error } = await supabase
		.from("sessions")
		.select(
			"id, scheduled_at, title, is_regular, meal_enabled, places(name), attendances(member_id, status, meal_joining), session_players(member_id)",
		)
		.in("status", ["active", "closed"])
		.not("scheduled_at", "is", null)
		.gte("scheduled_at", fromISO)
		.lt("scheduled_at", toISO)
		.order("scheduled_at", { ascending: false });
	if (error) {
		console.error("fetchChargeSourceSessions:", error);
		return [];
	}
	return ((data ?? []) as unknown as RawSourceSession[]).map((s) => ({
		id: s.id,
		scheduledAt: s.scheduled_at,
		title: s.title,
		placeName: s.places?.name ?? null,
		isRegular: s.is_regular,
		mealEnabled: s.meal_enabled,
		attendances: (s.attendances ?? [])
			.filter((a) => a.status !== "cancelled")
			.map((a) => ({
				memberId: a.member_id,
				status: a.status,
				// 기본 참여 모델이라 null 은 참여로 읽는다(서버 default true).
				mealJoining: a.meal_joining !== false,
			})),
		boardMemberIds: (s.session_players ?? [])
			.map((p) => p.member_id)
			.filter((id): id is string => !!id),
	}));
}

export interface UpsertManualBatchInput {
	batchKey: string;
	label: string;
	/** 'YYYY-MM-DD' */
	chargedOn: string;
	/** 인당 금액(원, > 0). */
	amount: number;
	memberIds: string[];
	/** 엔빵 원본 총액(원). 인당 직접 입력이면 null — 편집 시 맥락 복원용으로 저장한다. */
	total?: number | null;
}

export interface UpsertManualBatchResult {
	charged: number;
	removed: number;
	/** 명단에서 뺐지만 이미 낸 사람 — 지우지 못한 건 수(운영진이 개별 처리). */
	locked: number;
}

export async function upsertManualBatch(
	input: UpsertManualBatchInput,
): Promise<{ ok: true; result: UpsertManualBatchResult } | { ok: false; error: string }> {
	const { data, error } = await supabase.rpc("dues_upsert_manual_batch", {
		p_batch_key: input.batchKey,
		p_label: input.label,
		p_charged_on: input.chargedOn,
		p_amount: input.amount,
		p_member_ids: input.memberIds,
		p_total: input.total ?? null,
	});
	if (error) {
		console.error("upsertManualBatch:", error);
		return { ok: false, error: error.message };
	}
	return { ok: true, result: data as UpsertManualBatchResult };
}

export async function deleteManualBatch(
	batchKey: string,
): Promise<{ ok: true; removed: number; keptPaid: number } | { ok: false; error: string }> {
	const { data, error } = await supabase.rpc("dues_delete_manual_batch", {
		p_batch_key: batchKey,
	});
	if (error) {
		console.error("deleteManualBatch:", error);
		return { ok: false, error: error.message };
	}
	const r = data as { removed: number; kept_paid: number };
	return { ok: true, removed: r.removed, keptPaid: r.kept_paid };
}
