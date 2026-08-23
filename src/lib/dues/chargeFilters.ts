// 수동 부과 대상 필터 — "정의를 배열에 한 줄 추가"로 늘어나는 구조.
//
// 왜 레지스트리인가: 부과 종류(회식·콕공구·유니폼·상품…)마다 대상을 고르는 방법이 다르고 앞으로 계속
// 늘어난다. 화면에 `if (filter === "meal")` 을 심으면 필터를 추가할 때마다 UI 를 고쳐야 하고, 정의(무엇을
// 거르나)와 표현(칩을 어떻게 그리나)이 엉킨다. 그래서 셋을 갈라놨다:
//   · 필터 하나        = ChargeFilter 객체 하나(순수함수 `apply` + 라벨 + 사용 가능 조건)
//   · 화면            = SOURCES/REFINES 를 렌더링만 한다 — 개별 필터 id 를 알지 못한다
//   · 필터가 보는 값   = FilterContext 한 곳으로만 들어온다(스토어를 직접 읽지 않는다)
//
// **필터 추가 방법**: 아래 SOURCES 또는 REFINES 배열에 정의 하나를 넣는다. 그게 전부다.
//   새 판단 재료가 필요하면 FilterContext 에 필드를 하나 더 붙이고(채우는 건 호출부), 못 쓰는 상황을
//   `unavailable` 로 알려주면 화면이 칩을 알아서 비활성으로 그린다. 값 선택이 필요한 필터는 `options` 를
//   주면 화면이 하위 선택을 붙인다(예: 지난 명단 재사용, 성별).
//
// 모든 `apply` 는 **순수함수**다 — 같은 입력이면 같은 집합. 그래서 테스트가 쉽고(chargeFilters.test.ts),
// "왜 이 사람이 들어갔지"를 화면 없이 재현할 수 있다. now()/Date.now() 를 쓰지 않고 `today` 를 주입받는
// 이유도 이것.

import type { Gender } from "../../types";

/** 필터가 보는 회원 최소 정보 — AdminMemberRow 가 구조적으로 그대로 만족한다. */
export interface FilterMember {
	id: string;
	name: string;
	gender: Gender | null;
	isActive: boolean;
	isAdmin: boolean;
	isGuest: boolean;
	isHonorary: boolean;
}

/** 필터가 보는 참석 행 최소 정보. */
export interface FilterAttendance {
	memberId: string;
	/** confirmed | late_pool | waitlisted | cancelled */
	status: string;
	/** 정모 식사(회식) 참여 체크. meal_enabled 회차에서만 의미 — 기본 true. */
	mealJoining: boolean;
}

/** 대상 후보를 뽑아올 회차. */
export interface FilterSession {
	id: number;
	scheduledAt: string | null;
	label: string;
	isRegular: boolean;
	mealEnabled: boolean;
	attendances: FilterAttendance[];
	/** 보드(session_players)에 올라간 회원 — 명단에 없어도 실제로 뛴 사람. */
	boardMemberIds: string[];
}

/** 지난 수동 부과 배치 — 같은 명단을 다시 쓰는 필터의 재료(콕공구처럼 반복되는 부과). */
export interface FilterPastBatch {
	batchKey: string;
	label: string;
	memberIds: string[];
}

/**
 * 필터가 판단에 쓰는 모든 값의 단일 입구. 필터는 이것 말고 아무것도 읽지 않는다
 * (스토어·시계·네트워크 금지) — 그래서 순수하고, 새 재료는 여기에만 추가된다.
 */
export interface FilterContext {
	members: FilterMember[];
	/** 선택된 회차. null 이면 회차 기반 필터가 전부 비활성이 된다. */
	session: FilterSession | null;
	/** 회원별 마지막 참석일(KST 'YYYY-MM-DD'). null 이면 '최근 참석' 필터 비활성. */
	lastAttendedOn: Map<string, string> | null;
	/** 최근순 지난 배치. 비어 있으면 '지난 명단' 필터 비활성. */
	pastBatches: FilterPastBatch[];
	/** 오늘(KST 'YYYY-MM-DD'). 순수함수를 유지하려고 주입받는다. */
	today: string;
}

/** 필터가 값을 골라야 할 때 화면이 붙일 하위 선택지. */
export interface FilterOption {
	value: string;
	label: string;
}

/**
 * `source` = 후보 집합을 **만든다**(하나만 고름, 라디오).
 * `refine` = 들어온 집합을 **줄인다**(여러 개 켤 수 있음, 토글).
 */
export type FilterRole = "source" | "refine";

export interface ChargeFilter {
	id: string;
	label: string;
	role: FilterRole;
	/** 칩 아래 한 줄 설명(선택). */
	hint?: string;
	/**
	 * 지금 쓸 수 없으면 그 이유를, 쓸 수 있으면 null.
	 * 화면은 이유가 있으면 칩을 비활성으로 그리고 그 문구를 그대로 보여준다.
	 */
	unavailable?: (ctx: FilterContext) => string | null;
	/** 값 선택이 필요한 필터만. 비면(길이 0) 화면이 칩을 감춘다. */
	options?: (ctx: FilterContext) => FilterOption[];
	/** source 는 ids 를 무시하고 새 집합을, refine 은 ids 를 줄여서 돌려준다. 순수함수. */
	apply: (ids: ReadonlySet<string>, ctx: FilterContext, param?: string) => Set<string>;
}

// ── 공용 술어 ────────────────────────────────────────────────────────
/** 자리를 잡은 참석(확정 + 정원 외 늦참). 대관비 부과 기준과 같은 술어. */
const ATTENDING = new Set(["confirmed", "late_pool"]);
const isAttending = (a: FilterAttendance) => ATTENDING.has(a.status);

/** 'YYYY-MM-DD' 에서 n일 전 날짜 문자열. KST 날짜 문자열끼리만 비교하므로 시간대 문제가 없다. */
function daysBefore(today: string, n: number): string {
	const d = new Date(`${today}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}

const need = (ctx: FilterContext) => (ctx.session ? null : "회차를 먼저 고르세요");

// ── 시작 목록(source) ────────────────────────────────────────────────
export const SOURCES: ChargeFilter[] = [
	{
		id: "session-meal",
		label: "🍽 식사 체크",
		hint: "그 회차에서 회식 참여로 체크한 참석자",
		role: "source",
		unavailable: (ctx) =>
			need(ctx) ??
			(ctx.session?.mealEnabled ? null : "이 회차는 식사 체크를 쓰지 않았어요"),
		apply: (_ids, ctx) =>
			new Set(
				(ctx.session?.attendances ?? [])
					.filter((a) => isAttending(a) && a.mealJoining)
					.map((a) => a.memberId),
			),
	},
	{
		id: "session-attended",
		label: "참석",
		hint: "그 회차 확정 참석 + 정원 외 늦참",
		role: "source",
		unavailable: need,
		apply: (_ids, ctx) =>
			new Set((ctx.session?.attendances ?? []).filter(isAttending).map((a) => a.memberId)),
	},
	{
		id: "session-played",
		label: "실제로 뛴 사람",
		hint: "참석 명단 + 보드에 직접 넣은 사람(합집합)",
		role: "source",
		unavailable: need,
		apply: (_ids, ctx) => {
			const out = new Set(
				(ctx.session?.attendances ?? []).filter(isAttending).map((a) => a.memberId),
			);
			for (const id of ctx.session?.boardMemberIds ?? []) out.add(id);
			return out;
		},
	},
	{
		id: "recent-attended",
		label: "최근 30일 참석",
		hint: "활동 중인 회원만 — 오래 안 온 사람을 빼고 시작한다",
		role: "source",
		unavailable: (ctx) => (ctx.lastAttendedOn ? null : "참석 이력을 아직 불러오지 못했어요"),
		apply: (_ids, ctx) => {
			const cut = daysBefore(ctx.today, 30);
			const out = new Set<string>();
			for (const [id, on] of ctx.lastAttendedOn ?? []) if (on >= cut) out.add(id);
			return out;
		},
	},
	{
		id: "all-members",
		label: "전체 회원",
		hint: "명단 전체에서 손으로 고른다",
		role: "source",
		apply: (_ids, ctx) => new Set(ctx.members.map((m) => m.id)),
	},
	{
		id: "none",
		label: "직접 고르기",
		hint: "빈 목록에서 검색으로 한 명씩 추가 — 명단을 밖에서 받아왔을 때",
		role: "source",
		// 기존 배치를 편집할 때도 이걸 쓴다: 저장된 명단이 진실이므로 필터를 다시 돌리지 않고
		// added 로만 얹는다(all-members 로 시작하면 전 회원이 선택돼 버린다).
		apply: () => new Set(),
	},
	{
		id: "past-batch",
		label: "지난 명단 재사용",
		hint: "같은 사람들에게 또 부과할 때(콕 공동구매 등)",
		role: "source",
		unavailable: (ctx) => (ctx.pastBatches.length > 0 ? null : "지난 수동 부과가 없어요"),
		options: (ctx) => ctx.pastBatches.map((b) => ({ value: b.batchKey, label: b.label })),
		apply: (_ids, ctx, param) => {
			const b = ctx.pastBatches.find((x) => x.batchKey === param) ?? ctx.pastBatches[0];
			return new Set(b?.memberIds ?? []);
		},
	},
];

// ── 걸러내기(refine) ─────────────────────────────────────────────────
/** 회원 속성 하나로 걸러내는 refine 을 만든다(정의가 한 줄로 끝나게). */
function byMember(
	id: string,
	label: string,
	keep: (m: FilterMember) => boolean,
	hint?: string,
): ChargeFilter {
	return {
		id,
		label,
		role: "refine",
		hint,
		apply: (ids, ctx) => {
			const ok = new Map(ctx.members.map((m) => [m.id, keep(m)]));
			// 명단에 없는 id(삭제된 회원 등)는 판단 근거가 없으므로 남긴다 — 조용히 빠지는 것보다 낫다.
			return new Set([...ids].filter((x) => ok.get(x) !== false));
		},
	};
}

export const REFINES: ChargeFilter[] = [
	byMember("no-inactive", "비활성 제외", (m) => m.isActive, "탈퇴·정지 회원을 뺀다"),
	byMember("no-guest", "게스트 제외", (m) => !m.isGuest, "게스트는 초대 회원이 대납한다"),
	byMember("no-admin", "운영진 제외", (m) => !m.isAdmin),
	byMember("no-honorary", "명예회원 제외", (m) => !m.isHonorary),
	{
		id: "gender",
		label: "성별만",
		role: "refine",
		hint: "성별로 갈리는 공동구매 등",
		options: () => [
			{ value: "M", label: "남성만" },
			{ value: "F", label: "여성만" },
		],
		apply: (ids, ctx, param) => {
			if (param !== "M" && param !== "F") return new Set(ids);
			const ok = new Map(ctx.members.map((m) => [m.id, m.gender === param]));
			return new Set([...ids].filter((x) => ok.get(x) === true));
		},
	},
	{
		id: "not-in-past-batch",
		label: "지난 명단 제외",
		role: "refine",
		hint: "지난번에 이미 부과한 사람을 뺀다(중복 부과 방지)",
		unavailable: (ctx) => (ctx.pastBatches.length > 0 ? null : "지난 수동 부과가 없어요"),
		options: (ctx) => ctx.pastBatches.map((b) => ({ value: b.batchKey, label: b.label })),
		apply: (ids, ctx, param) => {
			const b = ctx.pastBatches.find((x) => x.batchKey === param) ?? ctx.pastBatches[0];
			if (!b) return new Set(ids);
			const seen = new Set(b.memberIds);
			return new Set([...ids].filter((x) => !seen.has(x)));
		},
	},
];

/** 화면이 순회하는 전체 목록(정의 순서 = 칩 순서). */
export const CHARGE_FILTERS: ChargeFilter[] = [...SOURCES, ...REFINES];

/** 대부분의 수동 부과에서 켜둘 만한 기본값 — 안 낸 사람이 조용히 섞이지 않게. */
export const DEFAULT_REFINE_IDS = ["no-inactive", "no-guest"] as const;

export const filterById = (id: string): ChargeFilter | undefined =>
	CHARGE_FILTERS.find((f) => f.id === id);

/** 화면이 들고 있는 선택 상태 — 이 값만 있으면 대상 명단이 결정된다(재현 가능). */
export interface FilterSelection {
	sourceId: string;
	/** source·refine 별 하위 선택값(옵션 있는 필터만). key = 필터 id */
	params: Record<string, string | undefined>;
	refineIds: string[];
	/** 필터 결과에 사람이 손으로 더한 id */
	added: ReadonlySet<string>;
	/** 필터 결과에서 사람이 손으로 뺀 id */
	removed: ReadonlySet<string>;
}

/** 필터만 적용한 결과(손 편집 전). 칩 미리보기 인원수에도 쓴다. */
export function runFilters(sel: FilterSelection, ctx: FilterContext): Set<string> {
	const source = filterById(sel.sourceId);
	if (!source || source.role !== "source") return new Set();
	if (source.unavailable?.(ctx)) return new Set();
	let ids: Set<string> = source.apply(new Set(), ctx, sel.params[source.id]);
	// refine 은 정의 순서로 적용한다 — 교집합이라 순서가 결과를 바꾸지 않지만, 순서를 고정해 두면
	// 디버깅할 때 "어느 단계에서 빠졌나"를 항상 같은 순서로 따라갈 수 있다.
	for (const f of REFINES) {
		if (!sel.refineIds.includes(f.id)) continue;
		if (f.unavailable?.(ctx)) continue;
		ids = f.apply(ids, ctx, sel.params[f.id]);
	}
	return ids;
}

/**
 * 최종 대상 = 필터 결과 ∪ 손으로 더한 사람 − 손으로 뺀 사람.
 * 손 편집을 결과에 병합하지 않고 따로 들고 있는 이유: 필터를 바꿔도 "현장에서 확인한 예외"가 살아남는다
 * (식사 체크를 안 했는데 온 사람 / 체크했는데 안 간 사람은 매번 생긴다).
 */
export function resolveSelection(sel: FilterSelection, ctx: FilterContext): Set<string> {
	const ids = runFilters(sel, ctx);
	for (const id of sel.added) ids.add(id);
	for (const id of sel.removed) ids.delete(id);
	return ids;
}

/** 칩에 붙일 인원수 미리보기 — 그 필터를 켰을 때 몇 명이 되는지. 못 쓰는 필터는 null. */
export function previewCount(
	filter: ChargeFilter,
	sel: FilterSelection,
	ctx: FilterContext,
): number | null {
	if (filter.unavailable?.(ctx)) return null;
	if (filter.role === "source") {
		return runFilters({ ...sel, sourceId: filter.id }, ctx).size;
	}
	const on = sel.refineIds.includes(filter.id);
	const next = on
		? sel.refineIds.filter((x) => x !== filter.id)
		: [...sel.refineIds, filter.id];
	return runFilters({ ...sel, refineIds: next }, ctx).size;
}

export function emptySelection(sourceId = SOURCES[0].id): FilterSelection {
	return {
		sourceId,
		params: {},
		refineIds: [...DEFAULT_REFINE_IDS],
		added: new Set(),
		removed: new Set(),
	};
}
