import { vi, describe, it, expect, beforeEach } from "vitest";
import type { SessionPlayer, Court, GroupHistory, GameType } from "../types";
import type { DraftTeam, MagnetPosition, Reservation } from "../types/board";
import { DEFAULT_VIEWPORT } from "../lib/board/geometry";

// ── sessionStore / appStore 모킹 (Supabase 미로드) ───────────
const h = vi.hoisted(() => ({
	handleAssign: vi.fn(),
	handleComplete: vi.fn(),
	courts: [] as Court[],
	players: new Map<string, SessionPlayer>(),
	singleWomanIds: [] as string[],
	groupHistory: [] as GroupHistory,
	lastGameType: {} as Record<string, GameType>,
	matchAssignCount: 0,
	myName: undefined as string | undefined, // currentEditorName() 폴백("익명") 검증 겸 편집자 전환 시뮬레이션
	restingIds: [] as string[],
	setResting: vi.fn(),
}));

vi.mock("./sessionStore", () => ({
	useSessionStore: {
		getState: () => ({
			courts: h.courts,
			sessionPlayers: h.players,
			handleAssign: h.handleAssign,
			handleComplete: h.handleComplete,
			groupHistory: h.groupHistory,
			lastGameType: h.lastGameType,
			matchAssignCount: h.matchAssignCount,
			isEditor: true, // 편집 락: 테스트는 편집자 관점에서 동작 검증
			_myName: h.myName,
			restingIds: h.restingIds,
			setResting: h.setResting,
		}),
	},
}));
vi.mock("./appStore", () => ({
	useAppStore: { getState: () => ({ sessionMeta: { singleWomanIds: h.singleWomanIds } }) },
}));

import { useBoardStore } from "./boardStore";
import { teamMembers } from "../lib/board/membership";
import { TEAM_BOX_ABOVE, TEAM_BOX_BELOW, TEAM_W, MAGNET_SIZE } from "../lib/board/constants";

// ── 픽스처 ───────────────────────────────────────────────
function player(id: string, gender: "M" | "F" = "M"): SessionPlayer {
	return {
		id,
		playerId: id,
		memberId: null,
		name: id,
		gender,
		skills: { grade: 5 },
		allowMixedSingle: false,
		status: "waiting",
		gameCount: 0,
		mixedCount: 0,
		waitSince: null,
		joinedAtMatch: 0,
		cockChecked: true,
	};
}
function mag(playerId: string, teamId: string | null, x = 0, y = 0): MagnetPosition {
	return { playerId, x, y, teamId };
}
function draft(id: string, anchorMemberIds: string[], x = 300, y = 500): DraftTeam {
	return { id, anchorMemberIds, anchor: { x, y }, createdAt: 0 };
}
function res(id: string, playerId: string, teamId: string, createdAt = 0): Reservation {
	return { id, playerId, teamId, createdAt };
}
function seed(opts: {
	magnets?: MagnetPosition[];
	drafts?: DraftTeam[];
	reservations?: Reservation[];
}) {
	useBoardStore.setState({
		magnets: new Map((opts.magnets ?? []).map((m) => [m.playerId, m])),
		drafts: new Map((opts.drafts ?? []).map((d) => [d.id, d])),
		reservations: new Map((opts.reservations ?? []).map((r) => [r.id, r])),
		assigningTeamIds: new Set<string>(),
	});
}

beforeEach(() => {
	h.handleAssign.mockReset();
	h.handleComplete.mockReset();
	h.courts = [];
	h.players = new Map();
	h.singleWomanIds = [];
	h.groupHistory = [];
	h.lastGameType = {};
	h.matchAssignCount = 0;
	h.myName = undefined;
	h.restingIds = [];
	h.setResting.mockReset();
	useBoardStore.getState().reset();
});

// ── 요구1: 자유 자석 드래그로 팀 생성 ──────────────────────
describe("요구1 — 자유 자석 두 개로 팀 생성(createPair)", () => {
	it("근접한 두 자유 자석을 겹치면 2인 forming 팀이 생긴다", () => {
		seed({ magnets: [mag("a", null, 100, 400), mag("b", null, 130, 400)] });
		useBoardStore.getState().handleDrop("a", { x: 128, y: 400 }); // b(130,400)와 거리<PAIR_RADIUS
		const drafts = useBoardStore.getState().drafts;
		expect(drafts.size).toBe(1);
		const team = [...drafts.values()][0];
		expect([...team.anchorMemberIds].sort()).toEqual(["a", "b"]);
		expect(useBoardStore.getState().magnets.get("a")!.teamId).toBe(team.id);
		expect(useBoardStore.getState().magnets.get("b")!.teamId).toBe(team.id);
	});
});

// ── 그룹 생성 시 겹치는 자석 흩어짐 + 화면 바운더리 ──────────
describe("그룹 생성 — 겹치는 자유 자석을 화면 안에서 흩어지게", () => {
	it("createPair로 팀이 생기면 팀 박스와 겹치던 자유 자석이 이동하고 바운더리 안에 머문다", () => {
		// a,b는 팀이 되고, c는 그 팀 위치에 겹쳐 있다 → 흩어져야 함
		seed({
			magnets: [mag("a", null, 100, 400), mag("b", null, 138, 400), mag("c", null, 120, 400)],
		});
		useBoardStore.getState().handleDrop("a", { x: 136, y: 400 });

		expect(useBoardStore.getState().drafts.size).toBe(1); // a+b 팀
		expect(useBoardStore.getState().magnets.get("a")!.teamId).not.toBeNull();

		const c = useBoardStore.getState().magnets.get("c")!;
		// 겹쳐 있던 c는 밀려나 위치가 바뀜
		expect(c.x === 120 && c.y === 400).toBe(false);
		// 화면 바운더리 바깥으로 나가지 않음 — stage 미설정 시 store의 기본 뷰포트(DEFAULT_VIEWPORT) 기준
		expect(c.x).toBeGreaterThanOrEqual(0);
		expect(c.x).toBeLessThanOrEqual(DEFAULT_VIEWPORT.vw);
		expect(c.y).toBeGreaterThanOrEqual(0);
		expect(c.y).toBeLessThanOrEqual(DEFAULT_VIEWPORT.vh);
	});
});

// ── 요구5: 다중 예약 ──────────────────────────────────────
describe("요구5 — 다중 예약(한 선수 여러 팀 동시 소속)", () => {
	it("팀구성중 멤버를 다른 팀에 겹치면 그 팀으로 이동(예약 아님, 원본에서 제거)", () => {
		seed({
			magnets: [
				mag("a", "T1", 300, 500),
				mag("b", "T1", 300, 500),
				mag("x", "T2", 700, 500),
				mag("y", "T2", 700, 500),
				mag("p", "T3", 1100, 500),
				mag("q", "T3", 1100, 500),
			],
			drafts: [draft("T1", ["a", "b"], 300, 500), draft("T2", ["x", "y"], 700, 500), draft("T3", ["p", "q"], 1100, 500)],
		});
		const store = useBoardStore.getState();

		// a를 T2 빈 슬롯 위로 → 이동(T1에서 제거, T2 anchor로 합류). T2(700,500) 2명 → 빈 슬롯 (735,535)
		store.handleDrop("a", { x: 735, y: 535 });
		expect(useBoardStore.getState().magnets.get("a")!.teamId).toBe("T2"); // 이동됨
		const t2 = teamMembers("T2", useBoardStore.getState().drafts, useBoardStore.getState().reservations);
		expect(t2.find((m) => m.playerId === "a")).toMatchObject({ kind: "anchor" }); // ghost 아님
		// T1은 a가 빠져 1명(b)만 남아 해체 → b는 자유 자석
		expect(useBoardStore.getState().drafts.get("T1")).toBeUndefined();
		expect(useBoardStore.getState().magnets.get("b")!.teamId).toBeNull();

		// a를 다시 T3 빈 슬롯 위로 → 또 이동(T2에서 제거). T3(1100,500) → (1135,535)
		store.handleDrop("a", { x: 1135, y: 535 });
		expect(useBoardStore.getState().magnets.get("a")!.teamId).toBe("T3");
		// 예약은 일절 생기지 않음(팀구성중 이동이므로)
		const aRes = [...useBoardStore.getState().reservations.values()].filter((r) => r.playerId === "a");
		expect(aRes).toHaveLength(0);
	});
});

// ── R5/R4: 정확 슬롯 배치(가운데 빈칸 허용) + 점유 슬롯 교체 ──
describe("슬롯 단위 드롭 — 정확 배치(R5) + 점유 슬롯 교체(R4)", () => {
	it("빈 슬롯에 드롭하면 그 칸에 정확히 배치 — 가운데 빈칸 유지(스택 아님)", () => {
		// T: a 1명(슬롯0). b를 슬롯3(anchor+35,+35=335,535)에 드롭 → b는 슬롯3, 슬롯1·2는 빈칸.
		seed({
			magnets: [mag("a", "T", 300, 500), mag("b", null, 900, 900)],
			drafts: [draft("T", ["a"], 300, 500)],
		});
		useBoardStore.getState().handleDrop("b", { x: 335, y: 535 });
		const drafts = useBoardStore.getState().drafts;
		const team = drafts.get("T")!;
		expect(team.slots?.b).toBe(3);
		const members = teamMembers("T", drafts, useBoardStore.getState().reservations);
		expect(members.find((m) => m.playerId === "a")!.slot).toBe(0);
		expect(members.find((m) => m.playerId === "b")!.slot).toBe(3); // 끝칸에 정확히(다음칸으로 당겨지지 않음)
	});

	it("같은 팀 멤버를 다른 멤버 슬롯 위로 드롭 → 둘의 슬롯만 스왑(둘 다 유지)", () => {
		// T=[a,b] (a@0, b@1, anchor 300,500). a를 b의 슬롯1(335,465) 위로 → 스왑
		seed({
			magnets: [mag("a", "T", 300, 500), mag("b", "T", 300, 500)],
			drafts: [draft("T", ["a", "b"], 300, 500)],
		});
		useBoardStore.getState().handleDrop("a", { x: 335, y: 465 });
		const st = useBoardStore.getState();
		const team = st.drafts.get("T")!;
		expect([...team.anchorMemberIds].sort()).toEqual(["a", "b"]); // 둘 다 팀 유지
		expect(st.magnets.get("a")!.teamId).toBe("T");
		expect(st.magnets.get("b")!.teamId).toBe("T");
		const members = teamMembers("T", st.drafts, st.reservations);
		expect(members.find((m) => m.playerId === "a")!.slot).toBe(1); // a↔b 슬롯 스왑
		expect(members.find((m) => m.playerId === "b")!.slot).toBe(0);
	});

	it("정원 4명 팀의 점유 슬롯에 드롭 → 그 자리 멤버 교체(점유자는 자유 자석)", () => {
		// T: a,b,c,d(슬롯0..3). e를 슬롯0(265,465)에 드롭 → a 교체, e가 슬롯0, a는 자유.
		seed({
			magnets: [
				mag("a", "T", 300, 500),
				mag("b", "T", 300, 500),
				mag("c", "T", 300, 500),
				mag("d", "T", 300, 500),
				mag("e", null, 900, 900),
			],
			drafts: [draft("T", ["a", "b", "c", "d"], 300, 500)],
		});
		useBoardStore.getState().handleDrop("e", { x: 265, y: 465 });
		const st = useBoardStore.getState();
		const team = st.drafts.get("T")!;
		expect(team.anchorMemberIds).toContain("e");
		expect(team.anchorMemberIds).not.toContain("a");
		expect(st.magnets.get("e")!.teamId).toBe("T");
		expect(st.magnets.get("a")!.teamId).toBeNull(); // 교체된 점유자는 자유 자석
		const members = teamMembers("T", st.drafts, st.reservations);
		expect(members).toHaveLength(4); // 정원 유지
		expect(members.find((m) => m.playerId === "e")!.slot).toBe(0); // 그 자리에
	});
});

// ── 요구3: 경기시작 → DB 코트 배치 ─────────────────────────
describe("요구3 — 경기시작(startMatch → handleAssign DB 연동)", () => {
	function seed4Free() {
		h.players = new Map(["a", "b", "c", "d"].map((id) => [id, player(id)]));
		seed({
			magnets: ["a", "b", "c", "d"].map((id) => mag(id, "T")),
			drafts: [draft("T", ["a", "b", "c", "d"])],
		});
	}

	it("4명 + 빈 코트 → handleAssign(team, courtId) 호출 후 예비팀 해체, 4명 playing", async () => {
		seed4Free();
		h.courts = [{ id: 1, match: null }];
		h.handleAssign.mockImplementation(async (team, courtId: number) => {
			const c = h.courts.find((c) => c.id === courtId);
			if (c) c.match = { id: "m1", courtId, gameType: team.gameType, teamA: team.teamA, teamB: team.teamB, startedAt: "" };
		});

		await useBoardStore.getState().startMatch("T");

		expect(h.handleAssign).toHaveBeenCalledTimes(1);
		const [team, courtId] = h.handleAssign.mock.calls[0];
		expect(courtId).toBe(1);
		expect([...team.teamA, ...team.teamB].sort()).toEqual(["a", "b", "c", "d"]);
		// 예비팀 해체 + 멤버 teamId 해제(=playing)
		expect(useBoardStore.getState().drafts.size).toBe(0);
		for (const id of ["a", "b", "c", "d"]) {
			expect(useBoardStore.getState().magnets.get(id)!.teamId).toBeNull();
		}
		expect(h.courts[0].match).not.toBeNull();
		// 새 코트 카드는 좌상단 기본 위치가 아니라 "그 그룹이 있던 자리"를 물려받는다
		expect(useBoardStore.getState().courtAnchors.get(1)).toEqual({ x: 300, y: 500 });
	});

	it("빈 코트 없으면 handleAssign 미호출 + 예비팀 유지", async () => {
		seed4Free();
		h.courts = [{ id: 1, match: { id: "m0", courtId: 1, gameType: "남복", teamA: ["w", "x"], teamB: ["y", "z"], startedAt: "" } }];

		await useBoardStore.getState().startMatch("T");

		expect(h.handleAssign).not.toHaveBeenCalled();
		expect(useBoardStore.getState().drafts.size).toBe(1);
	});

	it("멤버가 경기중이면 시작 불가(startable false) → handleAssign 미호출", async () => {
		seed4Free();
		// a가 다른 코트에서 경기중, 빈 코트도 존재
		h.courts = [
			{ id: 1, match: { id: "m0", courtId: 1, gameType: "남복", teamA: ["a", "w"], teamB: ["y", "z"], startedAt: "" } },
			{ id: 2, match: null },
		];

		await useBoardStore.getState().startMatch("T");

		expect(h.handleAssign).not.toHaveBeenCalled();
		expect(useBoardStore.getState().drafts.size).toBe(1);
	});

	it("RPC 실패(코트 미배치) → 예비팀 유지(낙관적 dissolve 금지)", async () => {
		seed4Free();
		h.courts = [{ id: 1, match: null }];
		h.handleAssign.mockImplementation(async () => {
			/* DB 실패 시뮬레이션: court.match를 설정하지 않음 */
		});

		await useBoardStore.getState().startMatch("T");

		expect(h.handleAssign).toHaveBeenCalledTimes(1);
		expect(useBoardStore.getState().drafts.size).toBe(1); // 해체 안 됨
		expect(useBoardStore.getState().magnets.get("a")!.teamId).toBe("T");
	});
});

// ── 자유 이동 + 드래그-엔드 흩어짐(settle) ──
describe("자유 이동 — handleDrop move는 드롭 위치 유지(겹치지 않으면 다른 자석 불변)", () => {
	it("겹치지 않는 빈 곳에 드롭하면 그 좌표 유지, 멀리 떨어진 자석도 불변", () => {
		useBoardStore.getState().setStageSize(2000, 2000); // 충분히 큰 stage → 경계 클램프 영향 없음
		seed({ magnets: [mag("a", null, 100, 400), mag("b", null, 900, 900)] });
		useBoardStore.getState().handleDrop("a", { x: 600, y: 650 });
		expect(useBoardStore.getState().magnets.get("a")).toMatchObject({ x: 600, y: 650, teamId: null });
		// 멀리 떨어져 겹치지 않으므로 b는 흩어짐 영향 없음
		expect(useBoardStore.getState().magnets.get("b")).toMatchObject({ x: 900, y: 900 });
		expect(useBoardStore.getState().drafts.size).toBe(0);
	});

	it("화면 상단(옛 코트 레인 영역)에 놓아도 그 자리에 그대로 — 레인 클램프 없음", () => {
		useBoardStore.getState().setStageSize(2000, 2000);
		seed({ magnets: [mag("a", null, 100, 400)] });
		// y=100 은 옛 COURT_LANE_H(약 248) 위. 예전엔 레인 아래로 끌려갔지만 이제 그대로 유지.
		useBoardStore.getState().handleDrop("a", { x: 130, y: 100 });
		expect(useBoardStore.getState().magnets.get("a")).toMatchObject({ x: 130, y: 100, teamId: null });
	});

	it("드래그-엔드(move) 시 겹친 자석은 소스에서 흩어진다", () => {
		useBoardStore.getState().setStageSize(2000, 2000);
		seed({ magnets: [mag("a", null, 100, 400), mag("b", null, 500, 500)] });
		// a를 b와 60px 거리(PAIR_RADIUS(57.6)<60<MIN_MAG_DIST(64))로 드롭 → 그룹 X(move) + 겹쳐서 b 밀림
		useBoardStore.getState().handleDrop("a", { x: 500, y: 440 });
		const a = useBoardStore.getState().magnets.get("a")!;
		const b = useBoardStore.getState().magnets.get("b")!;
		expect(a).toMatchObject({ x: 500, y: 440, teamId: null }); // 드롭한 자석(소스)은 그 자리
		expect(b.y).not.toBe(500); // b는 밀려남
		expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(MAGNET_SIZE - 1);
	});

	it("드래그-엔드 흩어짐은 stage 경계를 넘지 않는다", () => {
		useBoardStore.getState().setStageSize(400, 800);
		seed({ magnets: [mag("a", null, 100, 400)] });
		useBoardStore.getState().handleDrop("a", { x: 9999, y: 9999 }); // 화면 밖으로 드롭 시도
		const a = useBoardStore.getState().magnets.get("a")!;
		expect(a.x).toBeLessThanOrEqual(400);
		expect(a.y).toBeLessThanOrEqual(800);
		expect(a.x).toBeGreaterThanOrEqual(0);
		expect(a.y).toBeGreaterThanOrEqual(0);
	});
});

// ── 요구3(드래그): 경기중 선수를 끌어내 예약 생성 ───────────
describe("경기중 선수 → 예약(handlePlayingMagnetDrop)", () => {
	beforeEach(() => {
		// p,q,r,s 경기중
		h.courts = [{ id: 1, match: { id: "m1", courtId: 1, gameType: "남복", teamA: ["p", "q"], teamB: ["r", "s"], startedAt: "" } }];
	});

	it("forming 팀 위로 드롭 → 그 팀에 예약(ghost) 추가, 원본은 코트 유지", () => {
		seed({
			magnets: [mag("p", null), mag("a", "T", 300, 500), mag("b", "T", 300, 500)],
			drafts: [draft("T", ["a", "b"], 300, 500)],
		});
		// T(300,500) 2명 → 빈 슬롯 (335,535)에 드롭
		useBoardStore.getState().handlePlayingMagnetDrop("p", { x: 335, y: 535 });
		const res = [...useBoardStore.getState().reservations.values()];
		expect(res).toHaveLength(1);
		expect(res[0]).toMatchObject({ playerId: "p", teamId: "T" });
		// 원본 p는 어떤 팀의 anchor도 아님(코트 유지)
		expect(useBoardStore.getState().magnets.get("p")!.teamId).toBeNull();
		const members = teamMembers("T", useBoardStore.getState().drafts, useBoardStore.getState().reservations);
		expect(members.find((m) => m.playerId === "p")).toMatchObject({ kind: "ghost" });
	});

	it("자유 자석 위로 드롭 → 새 예비팀(파트너 anchor + 경기중 선수 ghost)", () => {
		seed({ magnets: [mag("p", null), mag("f", null, 200, 400)] });
		useBoardStore.getState().handlePlayingMagnetDrop("p", { x: 205, y: 400 });
		const drafts = useBoardStore.getState().drafts;
		expect(drafts.size).toBe(1);
		const team = [...drafts.values()][0];
		expect(team.anchorMemberIds).toEqual(["f"]); // 자유 자석이 anchor
		expect(useBoardStore.getState().magnets.get("f")!.teamId).toBe(team.id);
		const res = [...useBoardStore.getState().reservations.values()];
		expect(res[0]).toMatchObject({ playerId: "p", teamId: team.id }); // 경기중 선수는 ghost
	});

	it("빈 공간에 드롭 → 아무 일도 안 함(예약/팀 미생성)", () => {
		seed({ magnets: [mag("p", null), mag("f", null, 200, 400)] });
		useBoardStore.getState().handlePlayingMagnetDrop("p", { x: 5000, y: 5000 });
		expect(useBoardStore.getState().drafts.size).toBe(0);
		expect(useBoardStore.getState().reservations.size).toBe(0);
	});
});

// ── 코트 카드 드래그 위치 ──────────────────────────────────
describe("코트 카드 드래그(setCourtAnchor)", () => {
	it("setCourtAnchor가 courtAnchors를 갱신", () => {
		useBoardStore.getState().setCourtAnchor(2, 123, 456);
		expect(useBoardStore.getState().courtAnchors.get(2)).toEqual({ x: 123, y: 456 });
	});
});

// ── 정렬(rearrangeAll): 팀 먼저, 자석 나중 ──────────────────
describe("정렬(rearrangeAll) — 이미 구성된 팀부터, 자석은 그 아래", () => {
	it("완성 팀(4명)이 부분 팀보다 먼저 배치되고, 자유 자석은 팀 영역 아래", () => {
		h.courts = [];
		seed({
			magnets: [
				mag("a", "T2"), mag("b", "T2"), mag("c", "T2"), mag("d", "T2"), // 4명
				mag("x", "T1"), mag("y", "T1"), // 2명
				mag("f1", null, 5, 5),
				mag("f2", null, 9, 9),
			],
			drafts: [draft("T1", ["x", "y"]), draft("T2", ["a", "b", "c", "d"])],
		});

		useBoardStore.getState().rearrangeAll(400, 800);

		const T1 = useBoardStore.getState().drafts.get("T1")!;
		const T2 = useBoardStore.getState().drafts.get("T2")!;
		// 완성 팀 T2가 부분 팀 T1보다 먼저(위 행이거나 같은 행이면 더 왼쪽)
		expect(T2.anchor.y < T1.anchor.y || (T2.anchor.y === T1.anchor.y && T2.anchor.x < T1.anchor.x)).toBe(true);
		// 팀 박스가 화면 위쪽 경계 안(box top >= 0)
		expect(T2.anchor.y - TEAM_BOX_ABOVE).toBeGreaterThanOrEqual(0);
		// 자유 자석은 팀(그룹) 영역 아래
		const f1 = useBoardStore.getState().magnets.get("f1")!;
		expect(f1.y).toBeGreaterThan(T2.anchor.y);
	});

	it("자유 자석은 경기수 적은 사람 순으로 배치된다", () => {
		h.courts = [];
		// 경기수: a=5, b=1, c=3 → 배치 순서 b → c → a
		h.players = new Map([
			["a", { ...player("a"), gameCount: 5 }],
			["b", { ...player("b"), gameCount: 1 }],
			["c", { ...player("c"), gameCount: 3 }],
		]);
		seed({ magnets: [mag("a", null, 5, 5), mag("b", null, 9, 9), mag("c", null, 13, 13)] });

		useBoardStore.getState().rearrangeAll(400, 800);

		const a = useBoardStore.getState().magnets.get("a")!;
		const b = useBoardStore.getState().magnets.get("b")!;
		const c = useBoardStore.getState().magnets.get("c")!;
		// 한 줄(같은 y)에 경기수 오름차순으로 좌→우 배치
		const order = [a, b, c].sort((p, q) => p.y - q.y || p.x - q.x).map((m) =>
			m === a ? "a" : m === b ? "b" : "c",
		);
		expect(order).toEqual(["b", "c", "a"]); // gameCount 1, 3, 5 순
	});
});

// ── 정렬: 팀이 많아도 화면 밖으로 넘어가지 않음 ──────────────
describe("정렬(rearrangeAll) — 팀이 많아도 화면 바운더리 안에 머문다", () => {
	it("팀 12개를 좁은 화면에 정렬해도 모든 팀 박스가 viewH 안에 있다", () => {
		h.courts = [];
		const ds: DraftTeam[] = [];
		const ms: MagnetPosition[] = [];
		for (let i = 0; i < 12; i++) {
			const id = `T${i}`;
			ds.push(draft(id, [`p${i}a`, `p${i}b`]));
			ms.push(mag(`p${i}a`, id), mag(`p${i}b`, id));
		}
		seed({ magnets: ms, drafts: ds });

		const viewW = 400;
		const viewH = 800;
		useBoardStore.getState().rearrangeAll(viewW, viewH);

		const halfW = TEAM_W / 2;
		for (const d of useBoardStore.getState().drafts.values()) {
			// 박스 상단/하단 모두 화면 안
			expect(d.anchor.y - TEAM_BOX_ABOVE).toBeGreaterThanOrEqual(0);
			expect(d.anchor.y + TEAM_BOX_BELOW).toBeLessThanOrEqual(viewH);
			// 좌우도 화면 안
			expect(d.anchor.x - halfW).toBeGreaterThanOrEqual(0);
			expect(d.anchor.x + halfW).toBeLessThanOrEqual(viewW);
		}
	});

	it("코트 카드(경기중)도 정렬 시 격자로 줄바꿈되어 화면 밖으로 넘지 않는다", () => {
		// 코트 3개 경기중 — 좁은 화면(384)에선 한 줄에 2개만 들어가므로 3번째는 줄바꿈돼야
		h.courts = [1, 2, 3].map((id) => ({
			id,
			match: { id: `m${id}`, courtId: id, gameType: "남복", teamA: ["a", "b"], teamB: ["c", "d"], startedAt: "" },
		}));
		seed({ magnets: [], drafts: [] });

		const viewW = 384;
		const viewH = 1023;
		useBoardStore.getState().rearrangeAll(viewW, viewH);

		const halfW = TEAM_W / 2;
		const anchors = useBoardStore.getState().courtAnchors;
		expect(anchors.size).toBe(3);
		for (const a of anchors.values()) {
			expect(a.x - halfW).toBeGreaterThanOrEqual(0);
			expect(a.x + halfW).toBeLessThanOrEqual(viewW);
			expect(a.y - TEAM_BOX_ABOVE).toBeGreaterThanOrEqual(0);
			expect(a.y + TEAM_BOX_BELOW).toBeLessThanOrEqual(viewH);
		}
		// 3번 코트는 둘째 줄(첫째 줄 두 코트보다 아래)에 위치
		const ys = [...anchors.values()].map((a) => a.y).sort((p, q) => p - q);
		expect(ys[2]).toBeGreaterThan(ys[0]);
	});
});

// ── 추천 다이얼로그 다중 커밋(commitTeammates) ────────────────
describe("commitTeammates — 다중 선택 커밋", () => {
	it("시드 모드: 대기 선수 3명 선택 → 시드+3명 = 4인 팀(전원 anchor)", () => {
		h.courts = [];
		seed({
			magnets: [
				mag("seed", null, 100, 400),
				mag("p1", null, 500, 400),
				mag("p2", null, 520, 400),
				mag("p3", null, 540, 400),
			],
		});
		useBoardStore.getState().commitTeammates({ seedId: "seed" }, ["p1", "p2", "p3"]);

		const drafts = useBoardStore.getState().drafts;
		expect(drafts.size).toBe(1);
		const team = [...drafts.values()][0];
		expect([...team.anchorMemberIds].sort()).toEqual(["p1", "p2", "p3", "seed"]);
		expect(useBoardStore.getState().reservations.size).toBe(0);
	});

	it("확인(커밋) 시 새 그룹과 겹친 자유 자석은 흩어진다", () => {
		h.courts = [];
		useBoardStore.getState().setStageSize(2000, 2000);
		// seed/p1으로 팀 생성, victim은 seed 위치(겹침)에 둔 자유 자석
		seed({
			magnets: [mag("seed", null, 400, 500), mag("p1", null, 410, 500), mag("victim", null, 400, 500)],
		});
		useBoardStore.getState().commitTeammates({ seedId: "seed" }, ["p1"]);

		const team = [...useBoardStore.getState().drafts.values()][0];
		const victim = useBoardStore.getState().magnets.get("victim")!;
		expect(victim.teamId).toBeNull(); // 팀 멤버 아님(자유 자석)
		// 새 팀 박스(anchor) 밖으로 밀려남 — keep-out(좌우 111/위 133/아래 149) 밖
		const inside =
			Math.abs(victim.x - team.anchor.x) < 111 &&
			victim.y - team.anchor.y > -133 &&
			victim.y - team.anchor.y < 149;
		expect(inside).toBe(false);
	});

	it("시드 모드: 경기중 파트너는 예약(ghost), 대기 파트너는 anchor", () => {
		h.courts = [{ id: 1, match: { id: "m1", courtId: 1, gameType: "남복", teamA: ["pp", "w"], teamB: ["y", "z"], startedAt: "" } }];
		seed({ magnets: [mag("seed", null, 100, 400), mag("pp", null, 500, 400), mag("free", null, 520, 400)] });
		useBoardStore.getState().commitTeammates({ seedId: "seed" }, ["pp", "free"]);

		const team = [...useBoardStore.getState().drafts.values()][0];
		expect([...team.anchorMemberIds].sort()).toEqual(["free", "seed"]);
		const ress = [...useBoardStore.getState().reservations.values()];
		expect(ress).toHaveLength(1);
		expect(ress[0]).toMatchObject({ playerId: "pp", teamId: team.id });
	});

	it("팀 모드: 기존 팀에 여러 명 추가(4명 상한 준수)", () => {
		h.courts = [];
		seed({
			magnets: [mag("a", "T"), mag("b", "T"), mag("c", null), mag("d", null), mag("e", null)],
			drafts: [draft("T", ["a", "b"])],
		});
		// 2인 팀에 c,d,e 추가 시도 → 4명까지만(c,d)
		useBoardStore.getState().commitTeammates({ teamId: "T" }, ["c", "d", "e"]);
		const team = useBoardStore.getState().drafts.get("T")!;
		expect(team.anchorMemberIds).toEqual(["a", "b", "c", "d"]);
	});

	it("이미 팀에 속한 시드는 무시(중복 팀 생성 안 함)", () => {
		h.courts = [];
		seed({
			magnets: [mag("seed", "T", 100, 400), mag("partner", null, 500, 400)],
			drafts: [draft("T", ["seed"], 100, 400)],
		});
		useBoardStore.getState().commitTeammates({ seedId: "seed" }, ["partner"]);
		expect(useBoardStore.getState().drafts.size).toBe(1); // 새 팀 생성 안 됨
	});

	// 회귀(2026-08-01): 해체 규칙이 "인원이 줄 때"만 걸려 있어 **팀이 태어날 때** 바닥은 아무도 안 지켰다.
	// 새 그룹 만들기에서 1명만 고르면 유효 인원 1인 팀이 생기고 → 팀 박스는 렌더 게이팅으로 안 그려지는데
	// 자석 teamId 는 그 팀을 가리켜 자유 자석에서도 빠져 그 선수가 화면에서 사라진다(서버로도 퍼진다).
	it("새 팀 모드: 1명만 선택하면 팀을 만들지 않는다(자석은 자유 유지)", () => {
		h.courts = [];
		h.players = new Map(["solo"].map((id) => [id, player(id)]));
		seed({ magnets: [mag("solo", null, 200, 400)] });
		useBoardStore.getState().commitTeammates({ newTeam: true }, ["solo"]);
		const s = useBoardStore.getState();
		expect(s.drafts.size).toBe(0);
		expect(s.magnets.get("solo")!.teamId).toBeNull();
	});

	it("새 팀 모드: 2명이면 정상 생성", () => {
		h.courts = [];
		h.players = new Map(["a", "b"].map((id) => [id, player(id)]));
		seed({ magnets: [mag("a", null, 200, 400), mag("b", null, 400, 400)] });
		useBoardStore.getState().commitTeammates({ newTeam: true }, ["a", "b"]);
		const s = useBoardStore.getState();
		expect(s.drafts.size).toBe(1);
		expect([...[...s.drafts.values()][0].anchorMemberIds].sort()).toEqual(["a", "b"]);
	});
});

// ── 자동편성(autoFillTeam) ───────────────────────────────────
describe("autoFillTeam — 구성 중 팀의 빈 슬롯을 추천도순으로 채움", () => {
	it("2인 팀을 대기 선수로 4명까지 채운다(전원 anchor → 경기시작 가능 상태)", () => {
		h.players = new Map(["a", "b", "c", "d", "e"].map((id) => [id, player(id)]));
		seed({
			magnets: [
				mag("a", "T"), mag("b", "T"),
				mag("c", null), mag("d", null), mag("e", null),
			],
			drafts: [draft("T", ["a", "b"])],
		});
		useBoardStore.getState().autoFillTeam("T");
		const { drafts, reservations } = useBoardStore.getState();
		const members = teamMembers("T", drafts, reservations);
		expect(members).toHaveLength(4);
		// 대기 선수만 채웠으므로 ghost(예약) 없이 전원 anchor
		expect(members.every((m) => m.kind === "anchor")).toBe(true);
		expect(reservations.size).toBe(0);
	});

	it("경기중 선수도 팀당 1명까지 ghost 예약으로 채운다(2026-07 개편)", () => {
		h.players = new Map(["a", "b", "c", "d", "e"].map((id) => [id, player(id)]));
		// d·e는 코트에서 경기중 → 대기(c)로 먼저 채우고, 남은 1슬롯은 경기중 1명만 ghost 예약(상한 1).
		h.courts = [{ id: 1, match: { teamA: ["d", "e"], teamB: ["y", "z"] } } as unknown as Court];
		seed({
			magnets: [mag("a", "T"), mag("b", "T"), mag("c", null), mag("d", null), mag("e", null)],
			drafts: [draft("T", ["a", "b"])],
		});
		useBoardStore.getState().autoFillTeam("T");
		const { drafts, reservations } = useBoardStore.getState();
		const team = drafts.get("T")!;
		const ids = teamMembers("T", drafts, reservations).map((m) => m.playerId);
		expect(ids).toHaveLength(4);
		expect(ids.slice(0, 3)).toEqual(["a", "b", "c"]);
		// 경기중에서 정확히 1명만, anchor가 아닌 ghost 예약으로 합류
		const ghost = ids[3];
		expect(["d", "e"]).toContain(ghost);
		expect(team.anchorMemberIds).toEqual(["a", "b", "c"]);
		expect([...reservations.values()].filter((r) => r.teamId === "T")).toHaveLength(1);
	});

	it("이미 ghost가 있는 팀에 자동편성을 다시 돌려도 ghost가 2명이 되지 않는다(팀 단위 상한)", () => {
		h.players = new Map(["a", "b", "c", "d", "e"].map((id) => [id, player(id)]));
		// d·e 경기중. 팀 T = anchor[a,b] + 기존 ghost 예약 d(3명) → 남은 1슬롯.
		h.courts = [{ id: 1, match: { teamA: ["d", "e"], teamB: ["y", "z"] } } as unknown as Court];
		seed({
			magnets: [mag("a", "T"), mag("b", "T"), mag("c", null), mag("d", null), mag("e", null)],
			drafts: [draft("T", ["a", "b"])],
			reservations: [{ id: "r1", playerId: "d", teamId: "T", createdAt: 1 }],
		});
		useBoardStore.getState().autoFillTeam("T");
		const { drafts, reservations } = useBoardStore.getState();
		// 상한 1이 이미 소진(d) → 마지막 슬롯은 경기중 e가 아니라 대기 c로 채워진다.
		expect(drafts.get("T")!.anchorMemberIds).toEqual(["a", "b", "c"]);
		expect([...reservations.values()].filter((r) => r.teamId === "T").map((r) => r.playerId)).toEqual(["d"]);
	});

	it("추천 가능한 대기 선수가 없으면 멤버를 바꾸지 않는다", () => {
		h.players = new Map(["a", "b"].map((id) => [id, player(id)]));
		seed({ magnets: [mag("a", "T"), mag("b", "T")], drafts: [draft("T", ["a", "b"])] });
		useBoardStore.getState().autoFillTeam("T");
		const team = useBoardStore.getState().drafts.get("T")!;
		expect(team.anchorMemberIds).toEqual(["a", "b"]);
	});

	it("이미 4명이면 아무 동작 안 함(no-op)", () => {
		h.players = new Map(["a", "b", "c", "d", "e"].map((id) => [id, player(id)]));
		seed({
			magnets: [mag("a", "T"), mag("b", "T"), mag("c", "T"), mag("d", "T"), mag("e", null)],
			drafts: [draft("T", ["a", "b", "c", "d"])],
		});
		useBoardStore.getState().autoFillTeam("T");
		const team = useBoardStore.getState().drafts.get("T")!;
		expect(team.anchorMemberIds).toEqual(["a", "b", "c", "d"]); // e 미추가
	});
});

// ── 새 팀(+ 버튼) commitTeammates({ newTeam }) ────────────────
describe("commitTeammates — 새 팀(newTeam) 생성", () => {
	it("선택분으로 새 팀 생성 — 첫 비경기중 자유 선수가 anchor, 나머지 합류", () => {
		h.players = new Map(["a", "b", "c"].map((id) => [id, player(id)]));
		seed({ magnets: [mag("a", null, 100, 100), mag("b", null, 200, 200), mag("c", null, 300, 300)] });
		useBoardStore.getState().commitTeammates({ newTeam: true }, ["a", "b", "c"]);
		const { drafts, reservations } = useBoardStore.getState();
		expect(drafts.size).toBe(1);
		const t = [...drafts.values()][0];
		expect(t.anchorMemberIds[0]).toBe("a"); // 첫 선택이 anchor
		const ids = teamMembers(t.id, drafts, reservations).map((m) => m.playerId).sort();
		expect(ids).toEqual(["a", "b", "c"]);
	});

	it("anchor 가능한 선수(비경기중 자유)가 없으면 팀을 만들지 않음", () => {
		h.players = new Map([["p", player("p")]]);
		h.courts = [{ id: 1, match: { id: "m", courtId: 1, gameType: "남복", teamA: ["p", "x"], teamB: ["y", "z"], startedAt: "" } }];
		seed({ magnets: [mag("p", null)] }); // p는 경기중
		useBoardStore.getState().commitTeammates({ newTeam: true }, ["p"]);
		expect(useBoardStore.getState().drafts.size).toBe(0);
	});
});

// ── 드롭존: 팀에서 빼기(detachMember) / 예약 취소(cancelReservation) ──
describe("detachMember / cancelReservation — 드롭존", () => {
	it("detachMember: 3인 팀에서 한 명 빼면 자유 자석(teamId=null)이 되고 팀은 유지", () => {
		h.players = new Map(["a", "b", "c"].map((id) => [id, player(id)]));
		seed({
			magnets: [mag("a", "T"), mag("b", "T"), mag("c", "T")],
			drafts: [draft("T", ["a", "b", "c"])],
		});
		useBoardStore.getState().detachMember("a", { x: 200, y: 30 });
		const { drafts, magnets } = useBoardStore.getState();
		expect(drafts.get("T")!.anchorMemberIds).toEqual(["b", "c"]);
		expect(magnets.get("a")!.teamId).toBeNull();
	});

	it("detachMember: 2인 팀에서 빼면 남은 인원<2 → 팀 해체", () => {
		h.players = new Map(["a", "b"].map((id) => [id, player(id)]));
		seed({ magnets: [mag("a", "T"), mag("b", "T")], drafts: [draft("T", ["a", "b"])] });
		useBoardStore.getState().detachMember("a", { x: 200, y: 30 });
		expect(useBoardStore.getState().drafts.has("T")).toBe(false);
		expect(useBoardStore.getState().magnets.get("a")!.teamId).toBeNull();
	});

	it("cancelReservation: 예약(ghost)을 삭제한다", () => {
		h.players = new Map(["a", "p"].map((id) => [id, player(id)]));
		seed({
			magnets: [mag("a", "T"), mag("p", null)],
			drafts: [draft("T", ["a"])],
			reservations: [{ id: "r1", playerId: "p", teamId: "T", createdAt: 0 }],
		});
		useBoardStore.getState().cancelReservation("r1");
		expect(useBoardStore.getState().reservations.has("r1")).toBe(false);
		// 남은 인원 1명 → 팀 해체. 안 하면 a 의 자석 teamId 가 렌더되지 않는 팀을 가리켜 a 가 화면에서 사라진다.
		expect(useBoardStore.getState().drafts.has("T")).toBe(false);
		expect(useBoardStore.getState().magnets.get("a")!.teamId).toBeNull();
	});
});

// ── 1인 팀 금지(선수 실종 방지) — ghost 가 빠지는 로컬 편집 경로 전수 ──────────
// 2026-07-31 사고: 유효 인원 1명인 팀이 남으면 팀 박스는 렌더 게이팅(wouldDissolveByPlaying)으로 사라지는데
// 남은 anchor 의 자석 teamId 는 그 팀을 가리켜 자유 자석 필터에서도 빠져 선수가 화면에서 통째로 사라진다.
// 정렬·새로고침·워치독 모두 복구 불가였고, 편집자면 그 상태가 서버 board_drafts 로 저장됐다.
// I3(reconcileMembership)는 원격→로컬 경계만 막으므로 로컬 뮤테이션은 dissolveIfUnderTwo 로 같은 바닥을 지켜야 한다.
describe("1인 팀 금지 — ghost가 빠지는 로컬 경로", () => {
	// 경기중 선수를 빌려 만든 2인 팀(anchor 1 + ghost 1) 픽스처
	function seedBorrowed() {
		h.players = new Map(["a", "g"].map((id) => [id, player(id)]));
		seed({
			magnets: [mag("a", "T", 300, 400), mag("g", null, 500, 400)],
			drafts: [draft("T", ["a"], 300, 400)],
			reservations: [res("r1", "g", "T")],
		});
	}
	function expectDissolved() {
		const s = useBoardStore.getState();
		expect(s.drafts.has("T")).toBe(false);
		expect(s.magnets.get("a")!.teamId).toBeNull(); // 자유 자석으로 렌더됨
	}

	it("빼기존 드롭(cancelReservation)", () => {
		seedBorrowed();
		useBoardStore.getState().cancelReservation("r1");
		expectDissolved();
	});

	it("보드에서 제거(removeMemberFromBoard, ghost 분기)", () => {
		seedBorrowed();
		useBoardStore.getState().removeMemberFromBoard("g");
		expectDissolved();
	});

	it("휴식 처리(restPlayer — ghost 를 휴식으로)", () => {
		seedBorrowed();
		useBoardStore.getState().restPlayer("g");
		expectDissolved();
	});

	it("ghost 를 빈 공간에 드롭(handleGhostDrop 예약 취소 분기)", () => {
		seedBorrowed();
		useBoardStore.getState().handleGhostDrop("r1", { x: 50, y: 700 }); // 어느 팀 박스와도 무관한 좌표
		expectDissolved();
	});

	it("ghost 를 다른 팀으로 재예약(handleGhostDrop reReserve — 원 팀이 1명으로 줄어듦)", () => {
		h.players = new Map(["a", "g", "x", "y"].map((id) => [id, player(id)]));
		seed({
			magnets: [mag("a", "T", 300, 400), mag("g", null, 500, 400), mag("x", "U", 300, 100), mag("y", "U", 340, 100)],
			drafts: [draft("T", ["a"], 300, 400), draft("U", ["x", "y"], 300, 100)],
			reservations: [res("r1", "g", "T")],
		});
		useBoardStore.getState().handleGhostDrop("r1", { x: 300, y: 100 }); // 팀 U 박스 안
		const s = useBoardStore.getState();
		expect([...s.reservations.values()][0]?.teamId).toBe("U"); // 재예약 성공
		expect(s.drafts.has("T")).toBe(false); // 원 팀은 1명만 남아 해체
		expect(s.magnets.get("a")!.teamId).toBeNull();
	});

	// 촘촘한 고정 자석(정렬 격자 간격 74 < MIN_MAG_DIST*2=128) 사이로 풀려난 자석은 밀어내기만으로는
	// 원리적으로 겹침이 해소되지 않는다(밀려난 자리가 곧 다른 고정 자석 반경 안) → 빈자리 재배치가 필요.
	it("1인 팀 드롭으로 풀려난 자석이 촘촘한 기존 자석 2개 사이에서도 겹치지 않게 재배치된다", () => {
		h.courts = [];
		useBoardStore.getState().setStageSize(2000, 2000);
		h.players = new Map(["x", "f1", "f2"].map((id) => [id, player(id)]));
		seed({
			magnets: [mag("x", "SOLO", 337, 400), mag("f1", null, 300, 400), mag("f2", null, 374, 400)],
			drafts: [draft("SOLO", ["x"], 337, 400)],
		});
		useBoardStore.getState().applyRemoteDrafts({
			teams: [{ id: "SOLO", memberIds: ["x"], createdMs: 1 }],
			reservations: [],
		});

		const s = useBoardStore.getState();
		const x = s.magnets.get("x")!;
		const f1 = s.magnets.get("f1")!;
		const f2 = s.magnets.get("f2")!;
		expect(s.drafts.has("SOLO")).toBe(false);
		expect(x.teamId).toBeNull();
		// 기존(사용자 배치) 자석은 제자리
		expect([f1.x, f1.y]).toEqual([300, 400]);
		expect([f2.x, f2.y]).toEqual([374, 400]);
		// 풀려난 자석은 양쪽 모두와 겹치지 않는다(MIN_MAG_DIST=64)
		expect(Math.hypot(x.x - f1.x, x.y - f1.y)).toBeGreaterThanOrEqual(64);
		expect(Math.hypot(x.x - f2.x, x.y - f2.y)).toBeGreaterThanOrEqual(64);
	});

	// 세션 설정에서 선수가 빠지면(경기중 게스트 삭제 등) 그를 빌려 쓰던 팀의 예약이 사라진다 —
	// 원래 확정 해제조차 없던 자리라 call-site 열거에서 구조적으로 누락됐던 7번째 경로.
	it("세션에서 선수 이탈(initializeFromPool)로 ghost 가 사라져도 1인 팀은 안 남는다", () => {
		h.players = new Map(["a", "g"].map((id) => [id, player(id)]));
		seed({
			magnets: [mag("a", "T", 300, 400), mag("g", null, 500, 400)],
			drafts: [draft("T", ["a"], 300, 400)],
			reservations: [res("r1", "g", "T")],
		});
		// 풀에서 g 가 빠짐 → g 자석·예약 삭제
		useBoardStore.getState().initializeFromPool([player("a")]);
		const s = useBoardStore.getState();
		expect(s.magnets.has("g")).toBe(false);
		expect(s.drafts.has("T")).toBe(false); // 남은 a 가 실종되지 않도록 해체
		expect(s.magnets.get("a")!.teamId).toBeNull();
	});

	it("과잉 해체 방지 — 3인 팀은 ghost 가 빠져도 유지된다", () => {
		h.players = new Map(["a", "b", "g"].map((id) => [id, player(id)]));
		seed({
			magnets: [mag("a", "T", 300, 400), mag("b", "T", 340, 400), mag("g", null, 500, 400)],
			drafts: [draft("T", ["a", "b"], 300, 400)],
			reservations: [res("r1", "g", "T")],
		});
		useBoardStore.getState().cancelReservation("r1");
		const s = useBoardStore.getState();
		expect([...s.drafts.get("T")!.anchorMemberIds].sort()).toEqual(["a", "b"]);
		expect(s.magnets.get("a")!.teamId).toBe("T");
	});
});

// ── 보드 배율 — 수동 조정만 기억하고, 넘칠 때 자동 축소는 막지 않는다 ──────────
// 잠금을 "배율 고정"으로 구현하면 로스터가 커진 세션에서 자유 자석이 그룹 밴드 아래로 밀려 화면 밖으로
// 나가 통째로 안 보인다(실측 y=744 > stageH=700). 그래서 userScale 은 자동 fit 의 **상한**으로만 쓴다.
describe("보드 배율(userScale) — 수동 조정 기억 vs 자동 축소", () => {
	beforeEach(() => {
		useBoardStore.setState({ scale: 1, userScale: null }); // reset()은 기기 설정인 배율을 건드리지 않으므로 명시 초기화
	});

	it("수동 setScale 은 사용자 배율로 기억된다", () => {
		useBoardStore.getState().setScale(0.7);
		expect(useBoardStore.getState().scale).toBe(0.7);
		expect(useBoardStore.getState().userScale).toBe(0.7);
	});

	it("값이 안 바뀌는 조작(최대에서 ＋)은 잠그지 않는다", () => {
		useBoardStore.getState().setScale((s) => s + 0.1); // ZOOM_MAX=1 클램프 → no-op
		expect(useBoardStore.getState().scale).toBe(1);
		expect(useBoardStore.getState().userScale).toBeNull(); // 아무 변화도 없었으므로 자동 fit 유지
	});

	it("자동 fit(setAutoScale)은 사용자 배율을 덮지 않는다 — 여유가 생기면 복귀할 수 있어야 한다", () => {
		useBoardStore.getState().setScale(0.9);
		useBoardStore.getState().setAutoScale(0.6); // 내용이 넘쳐 축소된 상황
		expect(useBoardStore.getState().scale).toBe(0.6);
		expect(useBoardStore.getState().userScale).toBe(0.9);
	});
});

// ── 요구4: 경기완료 → 프리 ─────────────────────────────────
describe("요구4 — 경기완료(completeMatch → handleComplete DB 연동)", () => {
	it("경기완료 클릭 → handleComplete(courtId) 호출", async () => {
		h.players = new Map(["a", "b", "c", "d"].map((id) => [id, player(id)]));
		// 경기중: draft 없음, 코트에 match, 멤버 자석 teamId null
		seed({ magnets: ["a", "b", "c", "d"].map((id) => mag(id, null)) });
		h.courts = [{ id: 1, match: { id: "m1", courtId: 1, gameType: "남복", teamA: ["a", "b"], teamB: ["c", "d"], startedAt: "" } }];
		h.handleComplete.mockImplementation(async (courtId: number) => {
			const c = h.courts.find((c) => c.id === courtId);
			if (c) c.match = null;
		});

		await useBoardStore.getState().completeMatch(1);

		expect(h.handleComplete).toHaveBeenCalledWith(1);
		expect(h.courts[0].match).toBeNull();
	});

	it("경기완료: 끝난 선수가 다른 팀 예약(ghost)이었으면 그 팀 anchor로 승격 + 예약 삭제", async () => {
		// abc 팀 + 경기중 4를 예약(ghost)으로 잡아 abc4 구성·고정. 4의 경기가 끝나면 4가 abc 정식 멤버로.
		h.players = new Map(["1", "2", "3", "4", "a", "b", "c"].map((id) => [id, player(id)]));
		seed({
			magnets: [
				mag("1", null), mag("2", null), mag("3", null), mag("4", null),
				mag("a", "T"), mag("b", "T"), mag("c", "T"),
			],
			drafts: [draft("T", ["a", "b", "c"], 300, 500)],
			reservations: [res("r1", "4", "T")],
		});
		h.courts = [{ id: 1, match: { id: "m1", courtId: 1, gameType: "남복", teamA: ["1", "2"], teamB: ["3", "4"], startedAt: "" } }];
		h.handleComplete.mockImplementation(async (courtId: number) => {
			const c = h.courts.find((c) => c.id === courtId);
			if (c) c.match = null;
		});

		await useBoardStore.getState().completeMatch(1);

		const st = useBoardStore.getState();
		expect(st.drafts.get("T")!.anchorMemberIds).toContain("4"); // 4 → anchor 승격
		expect(st.magnets.get("4")!.teamId).toBe("T");
		expect([...st.reservations.values()].filter((r) => r.playerId === "4")).toHaveLength(0); // 예약 삭제
		expect(teamMembers("T", st.drafts, st.reservations)).toHaveLength(4); // 정식 4인 팀
	});
});

// ── 예약(ghost) 정합 — 원본 상태변경 시 복사본 정리 ──
describe("예약(ghost) 구조 정합 — anchor xor ghost / 중복 / 동기화 정제", () => {
	it("attachAnchor: 선수가 anchor로 합류하면 다른 팀에 남은 그 선수의 ghost도 정리(cross-team)", () => {
		h.players = new Map(["p", "x", "a"].map((id) => [id, player(id)]));
		// T1=[x] + p의 ghost(예약), T2=[a]. p를 T2 빈 슬롯에 드롭 → T2 anchor 합류 + T1 ghost 제거.
		seed({
			magnets: [mag("p", null, 900, 900), mag("x", "T1", 300, 500), mag("a", "T2", 700, 500)],
			drafts: [draft("T1", ["x"], 300, 500), draft("T2", ["a"], 700, 500)],
			reservations: [res("r1", "p", "T1")],
		});
		useBoardStore.getState().handleDrop("p", { x: 735, y: 465 }); // T2 anchor(700,500) 슬롯1=(735,465)
		const st = useBoardStore.getState();
		expect(st.drafts.get("T2")!.anchorMemberIds).toContain("p"); // T2 anchor 합류
		expect([...st.reservations.values()].filter((r) => r.playerId === "p")).toHaveLength(0); // T1 ghost 제거
	});

	it("reconcile: anchor로 확정된 선수의 ghost는 버리고(anchor xor ghost), 같은 (선수,팀) 중복 예약은 하나만", () => {
		useBoardStore.getState().setStageSize(2000, 2000);
		seed({
			magnets: [mag("a", null, 100, 300), mag("p", null, 130, 300), mag("b", null, 900, 900), mag("g", null, 500, 500)],
		});
		useBoardStore.getState().applyRemoteDrafts({
			teams: [
				{ id: "T1", memberIds: ["a", "p"], createdMs: 1 },
				{ id: "T2", memberIds: ["b"], createdMs: 2 },
			],
			reservations: [
				{ id: "r1", playerId: "p", teamId: "T2", createdMs: 3 }, // p는 T1 anchor → ghost 버려야
				{ id: "r2", playerId: "g", teamId: "T2", createdMs: 4 }, // g:T2 (유지될 것)
				{ id: "r3", playerId: "g", teamId: "T2", createdMs: 5 }, // g:T2 중복 → 버려야
			],
		});
		const st = useBoardStore.getState();
		expect([...st.reservations.values()].filter((r) => r.playerId === "p")).toHaveLength(0); // anchor라 ghost 없음
		const gRes = [...st.reservations.values()].filter((r) => r.playerId === "g");
		expect(gRes).toHaveLength(1); // 중복 제거 → 하나만
		expect(gRes[0].id).toBe("r2"); // 가장 오래된 것 유지
	});
});

// ── 공유 멤버십 적용(applyRemoteDrafts) ─────────────────────
describe("applyRemoteDrafts — 공유된 보드 멤버십을 로컬에 반영(위치는 로컬)", () => {
	it("payload의 팀/예약을 반영하고 멤버 자석 teamId를 설정", () => {
		h.courts = [];
		useBoardStore.getState().setStageSize(2000, 2000);
		seed({
			magnets: [mag("a", null, 100, 300), mag("b", null, 130, 300), mag("c", null, 900, 900), mag("d", null, 500, 500)],
		});
		useBoardStore.getState().applyRemoteDrafts({
			teams: [{ id: "T1", memberIds: ["a", "b"], createdMs: 1 }],
			reservations: [{ id: "r1", playerId: "c", teamId: "T1", createdMs: 2 }],
		});

		const s = useBoardStore.getState();
		expect(s.drafts.size).toBe(1);
		expect([...s.drafts.get("T1")!.anchorMemberIds].sort()).toEqual(["a", "b"]);
		expect(s.magnets.get("a")!.teamId).toBe("T1");
		expect(s.magnets.get("b")!.teamId).toBe("T1");
		expect(s.magnets.get("d")!.teamId).toBeNull(); // payload에 없음 → 자유
		const res = [...s.reservations.values()];
		expect(res).toHaveLength(1);
		expect(res[0]).toMatchObject({ playerId: "c", teamId: "T1" });
	});

	it("payload에서 빠진 기존 팀은 제거되고 멤버는 자유로 풀린다", () => {
		h.courts = [];
		useBoardStore.getState().setStageSize(2000, 2000);
		seed({
			magnets: [mag("a", "OLD", 100, 300), mag("b", "OLD", 130, 300), mag("c", null, 700, 700)],
			drafts: [draft("OLD", ["a", "b"], 100, 300)],
		});
		// 원격에는 OLD가 없고 a·c 를 가진 NEW 팀(2명 — 1명이면 I3 로 드롭되므로 팀 교체 검증이 안 된다)
		useBoardStore.getState().applyRemoteDrafts({
			teams: [{ id: "NEW", memberIds: ["a", "c"], createdMs: 5 }],
			reservations: [],
		});

		const s = useBoardStore.getState();
		expect(s.drafts.has("OLD")).toBe(false);
		expect(s.drafts.has("NEW")).toBe(true);
		expect(s.magnets.get("a")!.teamId).toBe("NEW");
		expect(s.magnets.get("b")!.teamId).toBeNull(); // OLD 해체로 자유
	});

	it("같은 id 팀은 위치(anchor)를 유지한다", () => {
		h.courts = [];
		useBoardStore.getState().setStageSize(2000, 2000);
		seed({
			magnets: [mag("a", "T1", 200, 500), mag("b", "T1", 230, 500)],
			drafts: [draft("T1", ["a"], 300, 500)], // 화면(400x800) 클램프 경계 안
		});
		useBoardStore.getState().applyRemoteDrafts({
			teams: [{ id: "T1", memberIds: ["a", "b"], createdMs: 9 }],
			reservations: [],
		});
		const t = useBoardStore.getState().drafts.get("T1")!;
		expect(t.anchor).toEqual({ x: 300, y: 500 }); // 기존 위치 유지
		expect([...t.anchorMemberIds].sort()).toEqual(["a", "b"]); // 멤버십은 갱신
	});

	it("원격으로 팀에서 빠져 새로 필드에 들어온 자석은 겹친 자석과 흩어진다", () => {
		h.courts = [];
		useBoardStore.getState().setStageSize(2000, 2000);
		// a,b,d: 팀 T1 멤버. c: 자유 자석으로 a와 정확히 같은 좌표(빠지면 즉시 겹침)
		seed({
			magnets: [
				mag("a", "T1", 300, 400),
				mag("b", "T1", 320, 400),
				mag("d", "T1", 340, 400),
				mag("c", null, 300, 400),
			],
			drafts: [draft("T1", ["a", "b", "d"], 310, 400)],
		});
		// 원격: T1에서 a 제거(b·d 2명 남아 팀 유지) → a가 자유로 필드에 들어옴
		useBoardStore.getState().applyRemoteDrafts({
			teams: [{ id: "T1", memberIds: ["b", "d"], createdMs: 1 }],
			reservations: [],
		});

		const s = useBoardStore.getState();
		const a = s.magnets.get("a")!;
		const c = s.magnets.get("c")!;
		expect(a.teamId).toBeNull(); // 필드로 진입
		const dist = Math.hypot(a.x - c.x, a.y - c.y);
		expect(dist).toBeGreaterThan(60); // 흩어져 겹치지 않음(MIN_MAG_DIST≈64)
	});

	// 회귀(2026-07-31): 1인 팀 드롭(I3)으로 자유가 된 자석이 기존 자유 자석과 정확히 겹쳐 남으면
	// "실종"이 "가려짐"으로 바뀔 뿐이다. 팀이 사라져 keep-out 이 없어도 겹침이 풀려야 한다.
	it("1인 팀 드롭으로 자유가 된 자석도 기존 자석과 겹치지 않게 비켜난다", () => {
		h.courts = [];
		useBoardStore.getState().setStageSize(2000, 2000);
		// x: 팀 SOLO 의 유일 멤버(= 팀 자리에 있음). c: 사용자가 배치해 둔 자유 자석, 좌표 완전 일치
		seed({
			magnets: [mag("x", "SOLO", 300, 400), mag("c", null, 300, 400)],
			drafts: [draft("SOLO", ["x"], 300, 400)],
		});
		// 원격에도 1인 팀 그대로 → I3 로 드롭되고 x 는 자유가 된다
		useBoardStore.getState().applyRemoteDrafts({
			teams: [{ id: "SOLO", memberIds: ["x"], createdMs: 1 }],
			reservations: [],
		});

		const s = useBoardStore.getState();
		const x = s.magnets.get("x")!;
		const c = s.magnets.get("c")!;
		expect(s.drafts.has("SOLO")).toBe(false);
		expect(x.teamId).toBeNull();
		// 기존 자석(c)은 사용자가 둔 자리 그대로, 새로 풀린 x 가 비켜난다
		expect(c.x).toBe(300);
		expect(c.y).toBe(400);
		expect(Math.hypot(x.x - c.x, x.y - c.y)).toBeGreaterThan(60);
	});
});

describe("경기 완료 흩어짐 — scatterMagnets는 그룹 영역 아래(보이는 곳)에 배치", () => {
	it("완료된 자석을 그룹 자리(겹침)가 아니라 그룹 최하단 아래로 옮긴다", () => {
		const groupY = 200;
		// 그룹 T가 상단(y=200)에 있고, 완료된 4명이 그 그룹 자리에 겹쳐 있는 상황
		seed({
			magnets: ["a", "b", "c", "d"].map((id, i) => mag(id, null, 300 + i * 20, groupY)),
			drafts: [draft("T", ["x", "y"], 300, groupY)],
		});
		useBoardStore.setState({ stageW: 900, stageH: 1200 });
		useBoardStore.getState().scatterMagnets(["a", "b", "c", "d"]);
		const ms = useBoardStore.getState().magnets;
		// 완료 자석은 그룹 anchor 자리에 잔류하지 않고 그 아래(자유 영역)로 내려간다
		for (const id of ["a", "b", "c", "d"]) {
			expect(ms.get(id)!.y).toBeGreaterThan(groupY);
		}
	});
});

// ── 회귀: 원격 멤버십 동기화(applyRemoteDrafts)가 "사용자가 직접 배치한 자유 자석" 위치를 보존 ──
// 버그: 드롭 직후 다른 기기의 board_drafts 브로드캐스트/스냅샷이 도착하면 settleFreeMagnets/scatter가
//       방금 놓은 자석을 밀어내 "가끔 원래자리로/딴자리로" 되돌아옴.
describe("회귀 — applyRemoteDrafts는 사용자 배치 자유 자석을 건드리지 않는다", () => {
	it("실제 멤버십 변경(팀 생성) 적용 시에도 기존 자유 자석 위치는 보존된다", () => {
		useBoardStore.getState().setStageSize(2000, 2000);
		// x,y는 곧 팀이 되고, u는 그 팀 박스 한가운데에 사용자가 놓아둔 자유 자석.
		seed({ magnets: [mag("x", null, 300, 500), mag("y", null, 340, 500), mag("u", null, 320, 500)] });
		useBoardStore.getState().applyRemoteDrafts({
			teams: [{ id: "T1", memberIds: ["x", "y"], createdMs: 1 }],
			reservations: [],
		});
		expect(useBoardStore.getState().magnets.get("x")!.teamId).toBe("T1");
		expect(useBoardStore.getState().magnets.get("y")!.teamId).toBe("T1");
		// 버그면 settleFreeMagnets가 u를 팀 박스 밖으로 밀어냄. 수정 후엔 그대로.
		expect(useBoardStore.getState().magnets.get("u")).toMatchObject({ x: 320, y: 500, teamId: null });
	});

	it("멤버십이 동일한 원격 재수신/스냅샷은 자유 자석을 전혀 움직이지 않는다(early-return)", () => {
		useBoardStore.getState().setStageSize(2000, 2000);
		// 지름 이내로 가깝게 둔 두 자유 자석 — 예전 코드면 settle이 분리해버림.
		seed({ magnets: [mag("u", null, 500, 500), mag("v", null, 505, 500)] });
		useBoardStore.getState().applyRemoteDrafts({ teams: [], reservations: [] });
		expect(useBoardStore.getState().magnets.get("u")).toMatchObject({ x: 500, y: 500 });
		expect(useBoardStore.getState().magnets.get("v")).toMatchObject({ x: 505, y: 500 });
	});
});

// ── 불변식 I2 자가 치유: 경기중이 된 anchor 제거(healPlayingAnchors) ──
describe("healPlayingAnchors — 경기중 anchor를 예비팀에서 제거 + 영속화(편집자)", () => {
	it("팀 전원이 경기중이 되면 팀 해체 + anchor 해제(유실된 dissolve 복구)", () => {
		// T의 a,b,c,d가 코트로 올라가(경기중) board_drafts에 유령으로 남은 상태
		h.courts = [{ id: 1, match: { id: "m1", courtId: 1, gameType: "남복", teamA: ["a", "b"], teamB: ["c", "d"], startedAt: "" } }];
		seed({
			magnets: ["a", "b", "c", "d"].map((id) => mag(id, "T")),
			drafts: [draft("T", ["a", "b", "c", "d"])],
		});

		useBoardStore.getState().healPlayingAnchors();

		expect(useBoardStore.getState().drafts.size).toBe(0);
		for (const id of ["a", "b", "c", "d"]) {
			expect(useBoardStore.getState().magnets.get(id)!.teamId).toBeNull();
		}
	});

	it("일부 멤버만 경기중이고 남은 인원 2명 이상이면 그 멤버만 빠지고 팀 유지", () => {
		// a만 경기중(다른 코트), b·c는 대기 → T는 [b,c]로 유지
		h.courts = [{ id: 1, match: { id: "m1", courtId: 1, gameType: "남복", teamA: ["a", "w"], teamB: ["y", "z"], startedAt: "" } }];
		seed({
			magnets: [mag("a", "T"), mag("b", "T"), mag("c", "T")],
			drafts: [draft("T", ["a", "b", "c"])],
		});

		useBoardStore.getState().healPlayingAnchors();

		const T = useBoardStore.getState().drafts.get("T");
		expect(T).toBeDefined();
		expect([...T!.anchorMemberIds].sort()).toEqual(["b", "c"]);
		expect(useBoardStore.getState().magnets.get("a")!.teamId).toBeNull(); // 경기중 → anchor 아님
		expect(useBoardStore.getState().magnets.get("b")!.teamId).toBe("T");
	});

	it("assigning(경기시작 진행중) 팀은 건드리지 않는다", () => {
		h.courts = [{ id: 1, match: { id: "m1", courtId: 1, gameType: "남복", teamA: ["a", "b"], teamB: ["c", "d"], startedAt: "" } }];
		seed({
			magnets: ["a", "b", "c", "d"].map((id) => mag(id, "T")),
			drafts: [draft("T", ["a", "b", "c", "d"])],
		});
		useBoardStore.setState({ assigningTeamIds: new Set(["T"]) });

		useBoardStore.getState().healPlayingAnchors();

		expect(useBoardStore.getState().drafts.size).toBe(1); // 진행중이라 보존
	});

	it("경기중 선수가 ghost(예약)일 뿐이면 팀을 건드리지 않는다(의도된 빌려주기 보존)", () => {
		// p는 경기중이고 T에 ghost로 예약됨. T의 anchor(a,b)는 대기.
		h.courts = [{ id: 1, match: { id: "m1", courtId: 1, gameType: "남복", teamA: ["p", "w"], teamB: ["y", "z"], startedAt: "" } }];
		seed({
			magnets: [mag("a", "T"), mag("b", "T"), mag("p", null)],
			drafts: [draft("T", ["a", "b"])],
			reservations: [res("r1", "p", "T")],
		});

		useBoardStore.getState().healPlayingAnchors();

		const T = useBoardStore.getState().drafts.get("T");
		expect(T).toBeDefined();
		expect([...T!.anchorMemberIds].sort()).toEqual(["a", "b"]); // 변경 없음
		expect(useBoardStore.getState().reservations.size).toBe(1); // 경기중 ghost 보존
	});
});

// ── 매칭확정(1단계) — confirmTeam/unconfirmTeam + 자동 해제 ──
describe("매칭확정(confirmTeam/unconfirmTeam) — 3단계 흐름의 1단계", () => {
	function seedFull() {
		h.players = new Map(["a", "b", "c", "d"].map((id) => [id, player(id)]));
		seed({
			magnets: ["a", "b", "c", "d"].map((id) => mag(id, "T", 300, 500)),
			drafts: [draft("T", ["a", "b", "c", "d"], 300, 500)],
		});
	}

	it("4명 시작 가능 팀 확정 → confirmedMs 기록, 재호출은 no-op(확정 시각 보존)", () => {
		seedFull();
		useBoardStore.getState().confirmTeam("T");
		const first = useBoardStore.getState().drafts.get("T")!.confirmedMs;
		expect(first).toBeGreaterThan(0);
		useBoardStore.getState().confirmTeam("T");
		expect(useBoardStore.getState().drafts.get("T")!.confirmedMs).toBe(first);
	});

	it("4명 미만이면 확정 불가(no-op)", () => {
		h.players = new Map(["a", "b", "c"].map((id) => [id, player(id)]));
		seed({
			magnets: ["a", "b", "c"].map((id) => mag(id, "T")),
			drafts: [draft("T", ["a", "b", "c"])],
		});
		useBoardStore.getState().confirmTeam("T");
		expect(useBoardStore.getState().drafts.get("T")!.confirmedMs).toBeUndefined();
	});

	it("4명이어도 예약자(ghost) 원본이 경기중이면 확정 불가(시작 가능해질 때까지 대기)", () => {
		h.players = new Map(["a", "b", "c", "p"].map((id) => [id, player(id)]));
		h.courts = [{ id: 1, match: { id: "m", courtId: 1, gameType: "남복", teamA: ["p", "w"], teamB: ["y", "z"], startedAt: "" } }];
		seed({
			magnets: [mag("a", "T"), mag("b", "T"), mag("c", "T"), mag("p", null)],
			drafts: [draft("T", ["a", "b", "c"])],
			reservations: [res("r1", "p", "T")],
		});
		useBoardStore.getState().confirmTeam("T");
		expect(useBoardStore.getState().drafts.get("T")!.confirmedMs).toBeUndefined();
	});

	it("unconfirmTeam → 확정 해제(순번 반납)", () => {
		seedFull();
		useBoardStore.getState().confirmTeam("T");
		useBoardStore.getState().unconfirmTeam("T");
		expect(useBoardStore.getState().drafts.get("T")!.confirmedMs).toBeUndefined();
	});

	it("확정 팀에서 멤버를 빼면(4명 미만) 확정 자동 해제", () => {
		seedFull();
		useBoardStore.getState().confirmTeam("T");
		useBoardStore.getState().detachMember("a", { x: 900, y: 900 });
		const T = useBoardStore.getState().drafts.get("T")!;
		expect(T.anchorMemberIds).not.toContain("a");
		expect(T.confirmedMs).toBeUndefined();
	});

	it("확정 팀의 예약(ghost) 취소 시에도 확정 해제", () => {
		h.players = new Map(["a", "b", "c", "g"].map((id) => [id, player(id)]));
		seed({
			magnets: [mag("a", "T"), mag("b", "T"), mag("c", "T"), mag("g", null)],
			drafts: [draft("T", ["a", "b", "c"])],
			reservations: [res("r1", "g", "T")],
		});
		useBoardStore.getState().confirmTeam("T"); // anchor3+ghost(free)1 = 시작 가능 → 확정
		expect(useBoardStore.getState().drafts.get("T")!.confirmedMs).toBeGreaterThan(0);
		useBoardStore.getState().cancelReservation("r1");
		expect(useBoardStore.getState().drafts.get("T")!.confirmedMs).toBeUndefined();
	});

	it("healPlayingAnchors: 확정 팀 멤버가 경기중이 되면(팀 유지) 확정 해제", () => {
		seedFull();
		useBoardStore.getState().confirmTeam("T");
		h.courts = [{ id: 1, match: { id: "m", courtId: 1, gameType: "남복", teamA: ["a", "w"], teamB: ["y", "z"], startedAt: "" } }];
		useBoardStore.getState().healPlayingAnchors();
		const T = useBoardStore.getState().drafts.get("T")!;
		expect([...T.anchorMemberIds].sort()).toEqual(["b", "c", "d"]);
		expect(T.confirmedMs).toBeUndefined();
	});
});

// ── 그룹 간 멤버 스왑 — 다른 그룹 사람 위에 드롭하면 두 사람 교체 ──
describe("그룹 간 멤버 스왑 — 다른 그룹의 점유 슬롯에 드롭 시 두 사람 맞교환", () => {
	function seedTwoTeams() {
		h.players = new Map(["a", "b", "c", "d", "w", "x", "y", "z"].map((id) => [id, player(id)]));
		seed({
			magnets: [
				...["a", "b", "c", "d"].map((id) => mag(id, "T1", 300, 500)),
				...["w", "x", "y", "z"].map((id) => mag(id, "T2", 700, 500)),
			],
			drafts: [draft("T1", ["a", "b", "c", "d"], 300, 500), draft("T2", ["w", "x", "y", "z"], 700, 500)],
		});
	}

	it("T1의 a를 T2의 w(슬롯0) 위에 드롭 → a↔w 맞교환, 서로의 자리 계승", () => {
		seedTwoTeams();
		useBoardStore.getState().handleDrop("a", { x: 665, y: 465 }); // T2(700,500) 슬롯0 = w 자리
		const st = useBoardStore.getState();
		expect([...st.drafts.get("T1")!.anchorMemberIds].sort()).toEqual(["b", "c", "d", "w"]);
		expect([...st.drafts.get("T2")!.anchorMemberIds].sort()).toEqual(["a", "x", "y", "z"]);
		expect(st.magnets.get("a")!.teamId).toBe("T2");
		expect(st.magnets.get("w")!.teamId).toBe("T1");
		// a는 w가 쓰던 T2 슬롯0, w는 a가 쓰던 T1 슬롯0
		expect(teamMembers("T2", st.drafts, st.reservations).find((m) => m.playerId === "a")!.slot).toBe(0);
		expect(teamMembers("T1", st.drafts, st.reservations).find((m) => m.playerId === "w")!.slot).toBe(0);
	});

	it("2인 팀에서 끌어와도 스왑 — 원 팀이 해체되지 않는다(인원 불변)", () => {
		h.players = new Map(["a", "b", "w", "x"].map((id) => [id, player(id)]));
		seed({
			magnets: [mag("a", "T1", 300, 500), mag("b", "T1", 300, 500), mag("w", "T2", 700, 500), mag("x", "T2", 700, 500)],
			drafts: [draft("T1", ["a", "b"], 300, 500), draft("T2", ["w", "x"], 700, 500)],
		});
		useBoardStore.getState().handleDrop("a", { x: 665, y: 465 }); // w(슬롯0) 위
		const st = useBoardStore.getState();
		expect([...st.drafts.get("T1")!.anchorMemberIds].sort()).toEqual(["b", "w"]);
		expect([...st.drafts.get("T2")!.anchorMemberIds].sort()).toEqual(["a", "x"]);
	});

	it("확정된 두 팀 간 스왑은 양 팀 확정(순번)을 보존한다(4명 유지)", () => {
		seedTwoTeams();
		useBoardStore.getState().confirmTeam("T1");
		useBoardStore.getState().confirmTeam("T2");
		const c1 = useBoardStore.getState().drafts.get("T1")!.confirmedMs;
		const c2 = useBoardStore.getState().drafts.get("T2")!.confirmedMs;
		useBoardStore.getState().handleDrop("a", { x: 665, y: 465 });
		expect(useBoardStore.getState().drafts.get("T1")!.confirmedMs).toBe(c1);
		expect(useBoardStore.getState().drafts.get("T2")!.confirmedMs).toBe(c2);
	});
});

// ── createdBy — 그룹에 사람을 넣은 편집자 기록(마지막 추가자로 갱신) ──
describe("createdBy — 2명 묶는 시점 기록 + 새 멤버 추가 시 갱신", () => {
	it("A가 2명을 묶으면 by A, B가 한 명 더 넣으면 by B로 갱신", () => {
		h.myName = "A";
		seed({ magnets: [mag("a", null, 300, 400), mag("b", null, 330, 400), mag("c", null, 900, 900)] });
		useBoardStore.getState().handleDrop("a", { x: 328, y: 400 }); // a+b 페어 생성
		const teamId = [...useBoardStore.getState().drafts.keys()][0];
		expect(useBoardStore.getState().drafts.get(teamId)!.createdBy).toBe("A");

		h.myName = "B";
		const anchor = useBoardStore.getState().drafts.get(teamId)!.anchor;
		useBoardStore.getState().handleDrop("c", { x: anchor.x - 35, y: anchor.y + 35 }); // 빈 슬롯2 합류
		expect(useBoardStore.getState().drafts.get(teamId)!.anchorMemberIds).toContain("c");
		expect(useBoardStore.getState().drafts.get(teamId)!.createdBy).toBe("B");
	});

	it("같은 팀 내 슬롯 이동(스왑)은 createdBy를 갱신하지 않는다(사람 추가 아님)", () => {
		h.myName = "B";
		seed({
			magnets: [mag("a", "T", 300, 500), mag("b", "T", 300, 500)],
			drafts: [{ ...draft("T", ["a", "b"], 300, 500), createdBy: "A" }],
		});
		useBoardStore.getState().handleDrop("a", { x: 335, y: 465 }); // b 슬롯 위 → 팀내 슬롯 스왑
		expect(useBoardStore.getState().drafts.get("T")!.createdBy).toBe("A");
	});

	it("교체 드롭(자유 자석 → 점유 슬롯)은 사람을 넣는 행위 → createdBy 갱신", () => {
		h.myName = "B";
		seed({
			magnets: [
				mag("a", "T", 300, 500), mag("b", "T", 300, 500), mag("c", "T", 300, 500), mag("d", "T", 300, 500),
				mag("e", null, 900, 900),
			],
			drafts: [{ ...draft("T", ["a", "b", "c", "d"], 300, 500), createdBy: "A" }],
		});
		useBoardStore.getState().handleDrop("e", { x: 265, y: 465 }); // a 자리 교체
		expect(useBoardStore.getState().drafts.get("T")!.createdBy).toBe("B");
	});

	it("그룹 간 스왑은 양 팀 모두 createdBy 갱신(양쪽에 새 사람이 들어감)", () => {
		h.myName = "C";
		h.players = new Map(["a", "b", "w", "x"].map((id) => [id, player(id)]));
		seed({
			magnets: [mag("a", "T1", 300, 500), mag("b", "T1", 300, 500), mag("w", "T2", 700, 500), mag("x", "T2", 700, 500)],
			drafts: [
				{ ...draft("T1", ["a", "b"], 300, 500), createdBy: "A" },
				{ ...draft("T2", ["w", "x"], 700, 500), createdBy: "B" },
			],
		});
		useBoardStore.getState().handleDrop("a", { x: 665, y: 465 }); // w 위 → 스왑
		expect(useBoardStore.getState().drafts.get("T1")!.createdBy).toBe("C");
		expect(useBoardStore.getState().drafts.get("T2")!.createdBy).toBe("C");
	});

	it("ghost 승격(경기완료 자동 anchor 전환)은 createdBy를 갱신하지 않는다", async () => {
		h.players = new Map(["1", "2", "3", "4", "a", "b", "c"].map((id) => [id, player(id)]));
		seed({
			magnets: [
				mag("1", null), mag("2", null), mag("3", null), mag("4", null),
				mag("a", "T"), mag("b", "T"), mag("c", "T"),
			],
			drafts: [{ ...draft("T", ["a", "b", "c"], 300, 500), createdBy: "A" }],
			reservations: [res("r1", "4", "T")],
		});
		h.courts = [{ id: 1, match: { id: "m1", courtId: 1, gameType: "남복", teamA: ["1", "2"], teamB: ["3", "4"], startedAt: "" } }];
		h.handleComplete.mockImplementation(async (courtId: number) => {
			const c = h.courts.find((c) => c.id === courtId);
			if (c) c.match = null;
		});
		h.myName = "B"; // 경기완료 버튼을 누른 사람은 B — 자동 승격은 "추가"가 아니므로 미갱신
		await useBoardStore.getState().completeMatch(1);
		const T = useBoardStore.getState().drafts.get("T")!;
		expect(T.anchorMemberIds).toContain("4");
		expect(T.createdBy).toBe("A");
	});
});

// ── 편집→보기 전환: 진행중 편집 부수상태 일괄 취소(cancelEditActions) ──
describe("cancelEditActions — 드래그/배정중/휴식핫 상태를 초기화", () => {
	it("dragInfo·hoverTarget·detachHot·restFieldHot·assigningTeamIds를 모두 비운다", () => {
		useBoardStore.setState({
			dragInfo: { playerId: "a", detachable: true, restable: false },
			hoverTarget: { kind: "magnet", id: "a" },
			detachHot: true,
			restFieldHot: true,
			assigningTeamIds: new Set(["T"]),
		});

		useBoardStore.getState().cancelEditActions();

		const s = useBoardStore.getState();
		expect(s.dragInfo).toBeNull();
		expect(s.hoverTarget).toBeNull();
		expect(s.detachHot).toBe(false);
		expect(s.restFieldHot).toBe(false);
		expect(s.assigningTeamIds.size).toBe(0);
	});
});

// ── 휴식 — 딱지를 달고 보드에 남는다(2026-07: 펼침 휴식 패널 폐지) ──
// 이전 구현은 휴식 선수를 메인 보드에서 숨기고 별도 패널에만 렌더했다. 운영진이 "버그로 없어졌다"고
// 오인해 게스트를 중복 추가하는 사고가 있어, 자석을 제자리(자유 자석 격자)에 남기는 쪽으로 바꿨다.
describe("휴식 진입/복귀 — 자석은 보드에 남고 멤버십만 정리", () => {
	it("restPlayer: 팀 anchor였던 선수가 팀에서 빠지지만 자석은 보드에 남는다(teamId=null)", () => {
		h.players = new Map([["a", player("a")], ["b", player("b")], ["c", player("c")]]);
		seed({
			magnets: [mag("a", "T", 300, 500), mag("b", "T", 300, 500), mag("c", "T", 300, 500)],
			drafts: [draft("T", ["a", "b", "c"])],
		});
		useBoardStore.getState().restPlayer("a");
		const s = useBoardStore.getState();
		expect(s.drafts.get("T")?.anchorMemberIds).toEqual(["b", "c"]);
		const m = s.magnets.get("a");
		expect(m).toBeDefined(); // 보드에서 사라지지 않는다
		expect(m?.teamId).toBeNull();
		expect(h.setResting).toHaveBeenCalledWith("a", true);
	});

	it("restPlayer: 이 선수를 빌려간 예약(ghost)은 취소되고, 4명 미만이 된 팀은 확정 해제", () => {
		h.players = new Map([["a", player("a")], ["b", player("b")], ["c", player("c")], ["r", player("r")]]);
		seed({
			magnets: [mag("a", "T", 300, 500), mag("b", "T", 300, 500), mag("c", "T", 300, 500), mag("r", null, 100, 100)],
			drafts: [{ ...draft("T", ["a", "b", "c"]), confirmedMs: 1000 }],
			reservations: [res("R1", "r", "T")],
		});
		useBoardStore.getState().restPlayer("r");
		const s = useBoardStore.getState();
		expect(s.reservations.size).toBe(0);
		expect(s.drafts.get("T")?.confirmedMs).toBeUndefined();
		expect(s.magnets.get("r")).toBeDefined();
	});

	it("unrestPlayer: 자석은 그대로 두고 status만 복귀 요청", () => {
		h.players = new Map([["a", player("a")]]);
		h.restingIds = ["a"];
		seed({ magnets: [mag("a", null, 100, 100)] });
		useBoardStore.getState().unrestPlayer("a");
		const s = useBoardStore.getState();
		expect(s.magnets.get("a")).toBeDefined();
		expect(s.magnets.get("a")?.teamId).toBeNull();
		expect(h.setResting).toHaveBeenCalledWith("a", false);
	});

	it("휴식 자석은 정렬 격자의 맨 뒤로 밀린다(대기자보다 아래 줄)", () => {
		h.players = new Map([["a", player("a")], ["b", player("b")], ["c", player("c")]]);
		h.restingIds = ["a"];
		seed({ magnets: [mag("a", null, 0, 0), mag("b", null, 0, 0), mag("c", null, 0, 0)] });
		useBoardStore.setState({ stageW: 200, stageH: 800, scale: 1 }); // 좁은 폭 → 1열 배치로 순서가 y에 드러남
		useBoardStore.getState().rearrangeAll(200, 800);
		const s = useBoardStore.getState();
		const ya = s.magnets.get("a")!.y;
		expect(ya).toBeGreaterThan(s.magnets.get("b")!.y);
		expect(ya).toBeGreaterThan(s.magnets.get("c")!.y);
	});
});
