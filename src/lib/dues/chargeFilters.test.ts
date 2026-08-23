import { describe, expect, it } from "vitest";
import {
	DEFAULT_REFINE_IDS,
	REFINES,
	SOURCES,
	type FilterContext,
	type FilterMember,
	type FilterSelection,
	emptySelection,
	filterById,
	previewCount,
	resolveSelection,
	runFilters,
} from "./chargeFilters";

// 필터는 전부 순수함수라 컨텍스트만 만들어 주면 화면 없이 전 조합을 검사할 수 있다.
// 이 테스트가 지키는 것: ① 각 필터의 술어 ② refine 이 교집합으로 겹쳐도 결과가 예측 가능 ③ 손 편집 우선.

const m = (id: string, over: Partial<FilterMember> = {}): FilterMember => ({
	id,
	name: id,
	gender: null,
	isActive: true,
	isAdmin: false,
	isGuest: false,
	isHonorary: false,
	...over,
});

const MEMBERS = [
	m("회원A", { gender: "M" }),
	m("회원B", { gender: "F" }),
	m("운영진", { isAdmin: true, gender: "M" }),
	m("게스트", { isGuest: true }),
	m("명예", { isHonorary: true }),
	m("탈퇴", { isActive: false }),
	m("안온사람"),
];

const att = (memberId: string, status: string, mealJoining = true) => ({ memberId, status, mealJoining });

const ctx = (over: Partial<FilterContext> = {}): FilterContext => ({
	members: MEMBERS,
	session: {
		id: 228,
		scheduledAt: "2026-08-22T00:00:00Z",
		label: "8/22 정모",
		isRegular: true,
		mealEnabled: true,
		attendances: [
			att("회원A", "confirmed"),
			att("회원B", "confirmed", false), // 식사 안 함
			att("운영진", "confirmed"),
			att("게스트", "late_pool"),
			att("명예", "waitlisted"), // 대기 — 자리를 잡은 적 없음
			att("탈퇴", "cancelled"),
		],
		boardMemberIds: ["회원A", "명예"], // 명예는 명단엔 대기인데 현장에서 보드에 넣어 뛰었다
	},
	lastAttendedOn: new Map([
		["회원A", "2026-08-22"],
		["회원B", "2026-07-01"], // 30일 밖
		["운영진", "2026-08-01"],
	]),
	pastBatches: [
		{ batchKey: "cock:2026-07", label: "7월 콕 공구", memberIds: ["회원A", "운영진"] },
		{ batchKey: "meal:100", label: "지난 회식", memberIds: ["회원B"] },
	],
	today: "2026-08-23",
	...over,
});

const sel = (over: Partial<FilterSelection> = {}): FilterSelection => ({
	...emptySelection(),
	refineIds: [], // 기본 refine 을 끄고 순수 술어만 본다(기본값은 따로 검사)
	...over,
});

const names = (s: Set<string>) => [...s].sort();

describe("SOURCES — 시작 목록", () => {
	it("식사 체크: 자리를 잡은 참석자 중 meal_joining 만(대기·취소는 애초에 제외)", () => {
		const got = runFilters(sel({ sourceId: "session-meal" }), ctx());
		expect(names(got)).toEqual(["게스트", "운영진", "회원A"]);
	});

	it("식사 체크: 식사 체크를 끈 회차에선 쓸 수 없다", () => {
		const c = ctx();
		c.session!.mealEnabled = false;
		expect(filterById("session-meal")!.unavailable!(c)).toBe("이 회차는 식사 체크를 쓰지 않았어요");
		expect(runFilters(sel({ sourceId: "session-meal" }), c).size).toBe(0);
	});

	it("참석: 확정 + 정원 외 늦참(식사 체크 여부 무관)", () => {
		expect(names(runFilters(sel({ sourceId: "session-attended" }), ctx()))).toEqual([
			"게스트",
			"운영진",
			"회원A",
			"회원B",
		]);
	});

	it("실제로 뛴 사람: 참석 ∪ 보드 추가(명단이 대기여도 보드에 있으면 포함)", () => {
		expect(names(runFilters(sel({ sourceId: "session-played" }), ctx()))).toEqual(
			["게스트", "명예", "운영진", "회원A", "회원B"].sort(),
		);
	});

	it("최근 30일 참석: 컷오프 밖은 빠진다", () => {
		expect(names(runFilters(sel({ sourceId: "recent-attended" }), ctx()))).toEqual([
			"운영진",
			"회원A",
		]);
	});

	it("회차 기반 필터는 회차가 없으면 전부 비활성", () => {
		const c = ctx({ session: null });
		for (const id of ["session-meal", "session-attended", "session-played"]) {
			expect(filterById(id)!.unavailable!(c)).toBe("회차를 먼저 고르세요");
		}
		// 회차와 무관한 source 는 그대로 동작한다.
		expect(runFilters(sel({ sourceId: "all-members" }), c).size).toBe(MEMBERS.length);
	});

	it("지난 명단 재사용: 고른 배치의 명단을 그대로 가져온다", () => {
		const got = runFilters(
			sel({ sourceId: "past-batch", params: { "past-batch": "cock:2026-07" } }),
			ctx(),
		);
		expect(names(got)).toEqual(["운영진", "회원A"]);
	});

	it("지난 명단 재사용: 값을 안 고르면 가장 최근 배치를 쓴다", () => {
		expect(names(runFilters(sel({ sourceId: "past-batch" }), ctx()))).toEqual(["운영진", "회원A"]);
	});

	it("직접 고르기: 빈 집합에서 시작한다(손 추가만 반영 — 배치 편집이 이걸 쓴다)", () => {
		expect(runFilters(sel({ sourceId: "none" }), ctx()).size).toBe(0);
		const s = sel({ sourceId: "none", added: new Set(["회원A", "탈퇴"]) });
		// refine 은 필터 결과에만 걸린다 → 손으로 넣은 사람은 비활성이어도 살아남는다(저장된 명단이 진실).
		expect(names(resolveSelection({ ...s, refineIds: ["no-inactive"] }, ctx()))).toEqual(["탈퇴", "회원A"].sort());
	});

	it("지난 배치가 없으면 비활성", () => {
		expect(filterById("past-batch")!.unavailable!(ctx({ pastBatches: [] }))).toBe(
			"지난 수동 부과가 없어요",
		);
	});
});

describe("REFINES — 걸러내기", () => {
	const all = sel({ sourceId: "all-members" });

	it("각 제외 필터가 자기 속성만 걸러낸다", () => {
		const cases: [string, string][] = [
			["no-inactive", "탈퇴"],
			["no-guest", "게스트"],
			["no-admin", "운영진"],
			["no-honorary", "명예"],
		];
		for (const [id, dropped] of cases) {
			const got = runFilters({ ...all, refineIds: [id] }, ctx());
			expect(got.has(dropped), `${id} 는 ${dropped} 를 빼야 한다`).toBe(false);
			expect(got.size).toBe(MEMBERS.length - 1);
		}
	});

	it("여러 refine 은 교집합으로 겹쳐 적용된다", () => {
		const got = runFilters({ ...all, refineIds: ["no-inactive", "no-guest", "no-admin", "no-honorary"] }, ctx());
		expect(names(got)).toEqual(["안온사람", "회원A", "회원B"]);
	});

	it("refine 순서는 결과를 바꾸지 않는다(교집합)", () => {
		const a = runFilters({ ...all, refineIds: ["no-guest", "no-admin"] }, ctx());
		const b = runFilters({ ...all, refineIds: ["no-admin", "no-guest"] }, ctx());
		expect(names(a)).toEqual(names(b));
	});

	it("성별: 값을 고르면 그 성별만, 안 고르면 그대로 통과", () => {
		expect(names(runFilters({ ...all, refineIds: ["gender"], params: { gender: "F" } }, ctx()))).toEqual(["회원B"]);
		expect(runFilters({ ...all, refineIds: ["gender"] }, ctx()).size).toBe(MEMBERS.length);
	});

	it("지난 명단 제외: 중복 부과를 막는다", () => {
		const got = runFilters(
			{ ...all, refineIds: ["not-in-past-batch"], params: { "not-in-past-batch": "cock:2026-07" } },
			ctx(),
		);
		expect(got.has("회원A")).toBe(false);
		expect(got.has("운영진")).toBe(false);
		expect(got.has("회원B")).toBe(true);
	});

	it("명단에 없는 id 는 조용히 빠지지 않는다(판단 근거가 없으므로 남긴다)", () => {
		// 보드에만 있는 삭제된 회원처럼, members 에 없는 id 가 섞여 들어온 경우.
		const c = ctx();
		c.session!.boardMemberIds = ["유령"];
		const got = runFilters(sel({ sourceId: "session-played", refineIds: ["no-guest", "no-inactive"] }), c);
		expect(got.has("유령")).toBe(true);
	});

	it("기본 refine 은 비활성·게스트를 뺀다", () => {
		const got = runFilters(emptySelection("all-members"), ctx());
		expect(DEFAULT_REFINE_IDS).toEqual(["no-inactive", "no-guest"]);
		expect(got.has("탈퇴")).toBe(false);
		expect(got.has("게스트")).toBe(false);
		expect(got.has("운영진")).toBe(true);
	});
});

describe("손 편집(added/removed)", () => {
	it("필터 결과에 더하고 뺀 것이 최종 명단에 반영된다", () => {
		const s = sel({
			sourceId: "session-meal",
			added: new Set(["회원B"]), // 체크 안 했는데 회식에 온 사람
			removed: new Set(["운영진"]), // 체크했는데 안 간 사람
		});
		expect(names(resolveSelection(s, ctx()))).toEqual(["게스트", "회원A", "회원B"]);
	});

	it("필터를 바꿔도 손 편집은 살아남는다", () => {
		const s = sel({ sourceId: "session-meal", removed: new Set(["운영진"]) });
		const switched = { ...s, sourceId: "session-attended" };
		expect(resolveSelection(switched, ctx()).has("운영진")).toBe(false);
	});

	it("빼기가 더하기보다 우선한다(같은 사람이 양쪽에 있으면 제외)", () => {
		const s = sel({ sourceId: "all-members", added: new Set(["X"]), removed: new Set(["X"]) });
		expect(resolveSelection(s, ctx()).has("X")).toBe(false);
	});
});

describe("previewCount — 칩에 붙는 인원수", () => {
	it("source 는 '그걸 고르면 몇 명'을 돌려준다(현재 선택과 무관)", () => {
		const s = sel({ sourceId: "all-members" });
		expect(previewCount(filterById("session-meal")!, s, ctx())).toBe(3);
	});

	it("refine 은 '토글하면 몇 명'을 돌려준다(켜져 있으면 끈 결과)", () => {
		const s = sel({ sourceId: "all-members", refineIds: [] });
		expect(previewCount(filterById("no-admin")!, s, ctx())).toBe(MEMBERS.length - 1);
		const on = { ...s, refineIds: ["no-admin"] };
		expect(previewCount(filterById("no-admin")!, on, ctx())).toBe(MEMBERS.length);
	});

	it("못 쓰는 필터는 null(화면이 비활성으로 그린다)", () => {
		expect(previewCount(filterById("past-batch")!, sel(), ctx({ pastBatches: [] }))).toBeNull();
	});
});

describe("레지스트리 규약", () => {
	it("id 가 중복되지 않는다", () => {
		const ids = [...SOURCES, ...REFINES].map((f) => f.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("role 이 배열과 일치한다(화면이 두 줄로 나눠 그리는 근거)", () => {
		expect(SOURCES.every((f) => f.role === "source")).toBe(true);
		expect(REFINES.every((f) => f.role === "refine")).toBe(true);
	});

	it("모든 필터가 라벨과 apply 를 갖는다", () => {
		for (const f of [...SOURCES, ...REFINES]) {
			expect(f.label.length, f.id).toBeGreaterThan(0);
			expect(typeof f.apply, f.id).toBe("function");
		}
	});

	it("options 를 주는 필터는 값 없이 불러도 터지지 않는다", () => {
		for (const f of [...SOURCES, ...REFINES]) {
			if (!f.options) continue;
			expect(() => f.apply(new Set(["회원A"]), ctx(), undefined), f.id).not.toThrow();
		}
	});

	it("잘못된 sourceId 는 빈 집합(화면 초기 상태 방어)", () => {
		expect(runFilters(sel({ sourceId: "없는필터" }), ctx()).size).toBe(0);
		// refine 을 source 자리에 넣어도 빈 집합
		expect(runFilters(sel({ sourceId: "no-guest" }), ctx()).size).toBe(0);
	});
});
