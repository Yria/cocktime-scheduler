import { vi, describe, it, expect, beforeEach } from "vitest";
import type { SessionPlayer, Court } from "../types";
import type { DraftTeam, MagnetPosition, Reservation } from "../types/board";

// ── sessionStore / appStore 모킹 (Supabase 미로드) ───────────
const h = vi.hoisted(() => ({
	handleAssign: vi.fn(),
	handleComplete: vi.fn(),
	courts: [] as Court[],
	players: new Map<string, SessionPlayer>(),
	singleWomanIds: [] as string[],
}));

vi.mock("./sessionStore", () => ({
	useSessionStore: {
		getState: () => ({
			courts: h.courts,
			sessionPlayers: h.players,
			handleAssign: h.handleAssign,
			handleComplete: h.handleComplete,
			isEditor: true, // 편집 락: 테스트는 편집자 관점에서 동작 검증
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
		name: id,
		gender,
		skills: { 클리어: "V", 스매시: "V", 로테이션: "V", 드랍: "V", 헤어핀: "V", 드라이브: "V", 백핸드: "V" },
		allowMixedSingle: false,
		status: "waiting",
		gameCount: 0,
		mixedCount: 0,
		waitSince: null,
		joinedAtMatch: 0,
	};
}
function mag(playerId: string, teamId: string | null, x = 0, y = 0): MagnetPosition {
	return { playerId, x, y, teamId };
}
function draft(id: string, anchorMemberIds: string[], x = 300, y = 500): DraftTeam {
	return { id, anchorMemberIds, anchor: { x, y }, createdAt: 0 };
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
		// 화면 바운더리 바깥으로 나가지 않음 (store의 viewport fallback과 동일 계산: vw=400, vh=innerHeight-84)
		const vw = typeof window !== "undefined" ? window.innerWidth : 400;
		const vh = (typeof window !== "undefined" ? window.innerHeight : 800) - 84;
		expect(c.x).toBeGreaterThanOrEqual(0);
		expect(c.x).toBeLessThanOrEqual(vw);
		expect(c.y).toBeGreaterThanOrEqual(0);
		expect(c.y).toBeLessThanOrEqual(vh);
	});
});

// ── 요구5: 다중 예약 ──────────────────────────────────────
describe("요구5 — 다중 예약(한 선수 여러 팀 동시 소속)", () => {
	it("anchor 멤버를 다른 팀에 겹치면 원본 유지 + ghost 예약 추가, 여러 팀에 가능", () => {
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

		// a를 T2 위로 → 예약(원본 T1 유지)
		store.handleDrop("a", { x: 700, y: 500 });
		expect(useBoardStore.getState().magnets.get("a")!.teamId).toBe("T1"); // 원본 유지
		const t2 = teamMembers("T2", useBoardStore.getState().drafts, useBoardStore.getState().reservations);
		expect(t2.find((m) => m.playerId === "a")).toMatchObject({ kind: "ghost" });

		// a를 T3 위로 → 또 다른 예약 (동시 다중 소속)
		store.handleDrop("a", { x: 1100, y: 500 });
		const t3 = teamMembers("T3", useBoardStore.getState().drafts, useBoardStore.getState().reservations);
		expect(t3.find((m) => m.playerId === "a")).toMatchObject({ kind: "ghost" });
		// a는 T1 anchor + T2/T3 ghost = 예약 2개
		const aRes = [...useBoardStore.getState().reservations.values()].filter((r) => r.playerId === "a");
		expect(aRes.map((r) => r.teamId).sort()).toEqual(["T2", "T3"]);
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
		useBoardStore.getState().handlePlayingMagnetDrop("p", { x: 300, y: 500 });
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
			magnets: [mag("a", "OLD", 100, 300), mag("b", "OLD", 130, 300)],
			drafts: [draft("OLD", ["a", "b"], 100, 300)],
		});
		// 원격에는 OLD가 없고 a만 가진 NEW 팀
		useBoardStore.getState().applyRemoteDrafts({
			teams: [{ id: "NEW", memberIds: ["a"], createdMs: 5 }],
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
		// a,b: 팀 T1 멤버. c: 자유 자석으로 a와 정확히 같은 좌표(빠지면 즉시 겹침)
		seed({
			magnets: [mag("a", "T1", 300, 400), mag("b", "T1", 320, 400), mag("c", null, 300, 400)],
			drafts: [draft("T1", ["a", "b"], 310, 400)],
		});
		// 원격: T1에서 a 제거(b만 남음) → a가 자유로 필드에 들어옴
		useBoardStore.getState().applyRemoteDrafts({
			teams: [{ id: "T1", memberIds: ["b"], createdMs: 1 }],
			reservations: [],
		});

		const s = useBoardStore.getState();
		const a = s.magnets.get("a")!;
		const c = s.magnets.get("c")!;
		expect(a.teamId).toBeNull(); // 필드로 진입
		const dist = Math.hypot(a.x - c.x, a.y - c.y);
		expect(dist).toBeGreaterThan(60); // 흩어져 겹치지 않음(MIN_MAG_DIST≈64)
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
