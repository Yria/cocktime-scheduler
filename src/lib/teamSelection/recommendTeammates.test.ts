import { describe, it, expect } from "vitest";
import type { GameType, SessionPlayer } from "../../types";
import { recommendTeammates, autoFillTeammates, RECOMMEND_WEIGHTS, type RecommendContext } from "./recommendTeammates";

function player(
	id: string,
	gender: "M" | "F",
	grade = 5,
): SessionPlayer {
	return {
		id,
		playerId: id,
		memberId: null,
		name: id,
		gender,
		skills: { grade },
		allowMixedSingle: false,
		status: "waiting",
		gameCount: 0,
		mixedCount: 0,
		waitSince: null,
		joinedAtMatch: 0,
		cockChecked: true,
	};
}

function ctx(overrides: Partial<RecommendContext> = {}): RecommendContext {
	return {
		groupHistory: [],
		lastGameType: {},
		playingIds: new Set<string>(),
		...overrides,
	};
}

/** 그룹 이력 항목 헬퍼 — matchId는 멤버 조합에서 파생(테스트 내 유일성만 보장하면 됨). */
let grpSeq = 0;
function grp(...members: string[]) {
	return { matchId: `m${grpSeq++}-${members.join(".")}`, members };
}

describe("recommendTeammates", () => {
	it("실력이 비슷한 후보가 상위(낮은 점수)에 온다", () => {
		const confirmed = [player("c1", "M", 6)]; // 등급 6
		const close = player("close", "M", 6); // 6
		const far = player("far", "M", 10); // 10
		const ranked = recommendTeammates(confirmed, [far, close], ctx());
		expect(ranked[0].player.id).toBe("close");
	});

	it("재결성 회피는 그룹 겹침 단위 — 2명 유지(약) < 3명 유지(중) 순으로 벌점이 커진다", () => {
		// confirmed 2명(A,B) 동성/동일실력/0판 → 점수는 그룹 재결성 항만 작동.
		const confirmed = [player("A", "M"), player("B", "M")];
		const dup2 = player("dup2", "M"); // 과거 {A,dup2,x,y} → 팀에 그 그룹 2명 유지(k=1)
		const dup3 = player("dup3", "M"); // 과거 {A,B,dup3,z} → 팀에 그 그룹 3명 유지(k=2)
		const fresh = player("fresh", "M"); // 겹침 없음
		const groupHistory = [grp("A", "dup2", "x", "y"), grp("A", "B", "dup3", "z")];
		const ranked = recommendTeammates(confirmed, [dup2, dup3, fresh], ctx({ groupHistory }));
		const get = (id: string) => ranked.find((r) => r.player.id === id)!;
		expect(get("fresh").breakdown!.group).toBe(0);
		expect(get("dup2").breakdown!.group).toBe(RECOMMEND_WEIGHTS.W_GROUP2);
		expect(get("dup3").breakdown!.group).toBe(RECOMMEND_WEIGHTS.W_GROUP3);
		expect(ranked.map((r) => r.player.id)).toEqual(["fresh", "dup2", "dup3"]);
	});

	it("4명 완전 재결성은 사실상 금지 — 판수가 3판 적어도 재결성 후보가 밀린다", () => {
		// 과거 {A,B,C,D}. confirmed A,B,C의 마지막 슬롯에 D(0판, 재결성)보다 3판 더 뛴 신규 E가 상위.
		const confirmed = [player("A", "M"), player("B", "M"), player("C", "M")];
		const d = player("D", "M"); // gameCount 0이지만 완전 재결성(W_GROUP4)
		const e = { ...player("E", "M"), gameCount: 3 };
		const groupHistory = [grp("A", "B", "C", "D")];
		const ranked = recommendTeammates(confirmed, [d, e], ctx({ groupHistory }));
		expect(ranked[0].player.id).toBe("E");
		expect(ranked.find((r) => r.player.id === "D")!.breakdown!.group).toBe(
			RECOMMEND_WEIGHTS.W_GROUP4,
		);
	});

	it("혼복 구성 중에는 직전에 남복/여복(단식)을 한 후보가 직전 혼복 후보보다 우대된다", () => {
		// confirmed 1남1녀 → 후보 추가 시 혼복 지향
		const confirmed = [player("m", "M"), player("f", "F")];
		const rotateIn = player("rotateIn", "F"); // 직전 남복 → 혼복으로 로테이션(우대)
		const stayMixed = player("stayMixed", "F"); // 직전 혼복 → 로테이션 아님
		const ranked = recommendTeammates(confirmed, [stayMixed, rotateIn], ctx({
			lastGameType: { rotateIn: "남복" as GameType, stayMixed: "혼복" as GameType },
		}));
		expect(ranked[0].player.id).toBe("rotateIn");
	});

	it("1명 시드의 직전 타입(남복)이면 혼복으로 돌리기 위해 여성 후보가 우대된다", () => {
		// 시드 직전 남복 → 목표(혼복)와 달라 여성 후보(혼복 지향)에 보너스, 남성 후보(동성 지향)에 페널티
		const seed = player("seed", "M");
		const female = player("female", "F");
		const male = player("male", "M");
		const ranked = recommendTeammates([seed], [male, female], ctx({
			lastGameType: { seed: "남복" as GameType },
		}));
		expect(ranked[0].player.id).toBe("female");
	});

	it("1명 시드의 직전 타입(혼복)이면 동성으로 돌리기 위해 남성 후보가 우대된다", () => {
		const seed = player("seed", "M");
		const female = player("female", "F");
		const male = player("male", "M");
		const ranked = recommendTeammates([seed], [male, female], ctx({
			lastGameType: { seed: "혼복" as GameType },
		}));
		expect(ranked[0].player.id).toBe("male");
	});

	it("혼복 목표에서 성별이 초과되는 후보는 하위로 밀린다", () => {
		// confirmed 2남1녀 → 3남(초과) 페널티, 추가 여자(2남2녀)는 정상
		const confirmed = [player("m1", "M"), player("m2", "M"), player("f1", "F")];
		const extraMale = player("extraMale", "M");
		const balanceFemale = player("balanceFemale", "F");
		const ranked = recommendTeammates(confirmed, [extraMale, balanceFemale], ctx());
		expect(ranked[0].player.id).toBe("balanceFemale");
		// 초과 성별 후보는 큰 페널티
		const male = ranked.find((r) => r.player.id === "extraMale")!;
		const female = ranked.find((r) => r.player.id === "balanceFemale")!;
		expect(male.score - female.score).toBeGreaterThanOrEqual(RECOMMEND_WEIGHTS.W_GENDER - 0.01);
	});

	it("'남복 편성 허용' 여성은 3남 그룹 추천에서 성별 페널티 면제(allowMixedSingle)", () => {
		// confirmed 3남 + 여성 후보 = 1F3M → 보통은 성별 초과 페널티. allowMixedSingle 여성은 면제되어 상위.
		const confirmed = [player("m1", "M"), player("m2", "M"), player("m3", "M")];
		const allowed: SessionPlayer = { ...player("wAllowed", "F"), allowMixedSingle: true };
		const notAllowed = player("wNo", "F"); // allowMixedSingle=false
		const ranked = recommendTeammates(confirmed, [notAllowed, allowed], ctx());
		expect(ranked[0].player.id).toBe("wAllowed");
		const a = ranked.find((r) => r.player.id === "wAllowed")!;
		const n = ranked.find((r) => r.player.id === "wNo")!;
		// 면제 여성이 페널티만큼 더 상위(낮은 점수)
		expect(n.score - a.score).toBeGreaterThanOrEqual(RECOMMEND_WEIGHTS.W_GENDER - 0.01);
	});

	it("경기중 후보는 동일 조건의 대기 후보보다 하위로 밀린다", () => {
		const confirmed = [player("c1", "M")];
		const waiting = player("waiting", "M");
		const playing = player("playing", "M");
		const ranked = recommendTeammates(confirmed, [playing, waiting], ctx({
			playingIds: new Set(["playing"]),
		}));
		expect(ranked[0].player.id).toBe("waiting");
		const w = ranked.find((r) => r.player.id === "waiting")!;
		const p = ranked.find((r) => r.player.id === "playing")!;
		expect(p.score - w.score).toBeCloseTo(RECOMMEND_WEIGHTS.W_PLAYING, 5);
	});

	it("시드의 직전 타입 반복 페널티(W_ROTATE_REPEAT)는 로테이션 보너스(W_ROTATE)보다 작다(완화)", () => {
		const seed = player("seed", "M"); // 시드만 직전 타입 보유 → 시드 시점만 작용
		const male = player("male", "M"); // 시드와 동성(또 동성) → 시드 반복 +W_ROTATE_REPEAT
		const female = player("female", "F"); // 혼복 전환 → 시드 보너스 −W_ROTATE
		const ranked = recommendTeammates([seed], [male, female], ctx({
			lastGameType: { seed: "남복" as GameType },
		}));
		const m = ranked.find((r) => r.player.id === "male")!;
		const f = ranked.find((r) => r.player.id === "female")!;
		expect(RECOMMEND_WEIGHTS.W_ROTATE_REPEAT).toBeLessThan(RECOMMEND_WEIGHTS.W_ROTATE);
		// 남↔여 격차 = 시드 반복 페널티 + 시드 보너스 (시드 시점은 완화된 비대칭)
		expect(m.score - f.score).toBeCloseTo(RECOMMEND_WEIGHTS.W_ROTATE_REPEAT + RECOMMEND_WEIGHTS.W_ROTATE, 5);
	});

	it("breakdown 항목 합이 최종 score와 일치한다", () => {
		const ranked = recommendTeammates(
			[player("s", "M")],
			[player("a", "F", 10)],
			ctx({ lastGameType: { s: "남복" as GameType } }),
		);
		const r = ranked[0];
		const b = r.breakdown!;
		const sum = b.skill + b.group + b.game + b.mixed + b.wait + (b.rotate ?? 0) + (b.gender ?? 0) + (b.playing ?? 0);
		expect(sum).toBeCloseTo(r.score, 5);
	});

	it("혼복 구조(1남2녀)에서 2남2녀를 완성하는 부족 성별(남자) 후보가 우대된다", () => {
		// confirmed가 이미 남녀 혼합 → 부족한 성별(남자)에 W_MIXED_COMPLETE 보너스, 초과 성별(여자)에 W_GENDER 페널티
		const confirmed = [player("m1", "M"), player("f1", "F"), player("f2", "F")];
		const male = player("male", "M");
		const female = player("female", "F");
		const ranked = recommendTeammates(confirmed, [female, male], ctx());
		expect(ranked[0].player.id).toBe("male");
	});

	it("confirmed가 동성(남자만)이면 혼복 완성 보너스가 적용되지 않는다", () => {
		// baseMixed=false(남2) → W_MIXED_COMPLETE 미적용. 두 남자 후보의 gender 기여는 0.
		const confirmed = [player("m1", "M"), player("m2", "M")];
		const a = player("a", "M");
		const b = player("b", "M");
		const ranked = recommendTeammates(confirmed, [a, b], ctx());
		expect(ranked.every((r) => (r.breakdown?.gender ?? 0) === 0)).toBe(true);
	});

	it("혼복 팀 구성 중, 직전 혼복 후보는 직전 동성 후보보다 후보 시점 로테이션으로 강하게 하위(대칭 ±W_ROTATE)", () => {
		const confirmed = [player("m", "M"), player("f", "F")]; // 1남1녀(혼복 지향)
		const repeatMixed = player("repeatMixed", "M"); // 직전 혼복 → 또 혼복(하위)
		const rotateOut = player("rotateOut", "M"); // 직전 남복 → 동성 차례(우대)
		const ranked = recommendTeammates(confirmed, [repeatMixed, rotateOut], ctx({
			lastGameType: { repeatMixed: "혼복" as GameType, rotateOut: "남복" as GameType },
		}));
		expect(ranked[0].player.id).toBe("rotateOut");
		const rm = ranked.find((r) => r.player.id === "repeatMixed")!;
		const ro = ranked.find((r) => r.player.id === "rotateOut")!;
		// 두 후보는 confirmed·성별이 같아 시드 항·W_MIXED_COMPLETE가 공통 → 격차는 후보 시점 로테이션뿐: 대칭 2×W_ROTATE
		expect(rm.score - ro.score).toBeCloseTo(2 * RECOMMEND_WEIGHTS.W_ROTATE, 5);
	});

	it("혼복 그룹에서도 남자 후보 실력이 반영된다 — 여자만 균형 규칙 제거(2026-07)", () => {
		// 여자 시드(등급6) + 남성 후보 → 혼복 목표여도 남녀 구분 없이 4명 전원 실력을 맞춘다.
		const confirmed = [player("f1", "F", 6)];
		const mClose = player("mClose", "M", 6); // 시드와 일치
		const mFar = player("mFar", "M", 10);
		const ranked = recommendTeammates(confirmed, [mClose, mFar], ctx());
		const get = (id: string) => ranked.find((r) => r.player.id === id)!;
		expect(get("mClose").breakdown!.skill).toBe(0);
		expect(get("mFar").breakdown!.skill).toBeCloseTo(4 * RECOMMEND_WEIGHTS.W_SKILL, 5);
		expect(ranked[0].player.id).toBe("mClose");
	});

	it("skillDiff는 스프레드 증가분 — 밴드 안 후보는 동일(0), 밴드를 넓히는 후보만 벌점", () => {
		// (구) 평균 거리 방식은 {2,8}(평균 5)에서 중간 등급 5를 항상 '최적합'으로 흡수했다.
		const confirmed = [player("lo", "M", 2), player("hi", "M", 8)];
		const mid = player("mid", "M", 5); // 밴드(2~8) 안 — 구 방식이라면 유일한 0점
		const edge = player("edge", "M", 7); // 밴드 안
		const widen = player("widen", "M", 10); // 밴드를 2만큼 넓힘
		const ranked = recommendTeammates(confirmed, [mid, edge, widen], ctx());
		const get = (id: string) => ranked.find((r) => r.player.id === id)!;
		expect(get("mid").breakdown!.skill).toBe(0);
		expect(get("edge").breakdown!.skill).toBe(0); // 중간 등급이 더 이상 특별 우대되지 않는다
		expect(get("widen").breakdown!.skill).toBeCloseTo(2 * RECOMMEND_WEIGHTS.W_SKILL, 5);
	});

	it("밴드 하방 확장도 상방과 동일하게 벌점된다", () => {
		const confirmed = [player("a", "M", 5), player("b", "M", 8)];
		const below = player("below", "M", 1); // 밴드(5~8)를 아래로 4 넓힘
		const inside = player("inside", "M", 6);
		const ranked = recommendTeammates(confirmed, [below, inside], ctx());
		const get = (id: string) => ranked.find((r) => r.player.id === id)!;
		expect(get("below").breakdown!.skill).toBeCloseTo(4 * RECOMMEND_WEIGHTS.W_SKILL, 5);
		expect(get("inside").breakdown!.skill).toBe(0);
	});

	it("미등급(skillScore 0)은 밴드에서 제외되고, 미등급 후보도 벌점받지 않는다", () => {
		// 미등급 confirmed가 밴드 하한을 0으로 무너뜨리면 하방 판별이 통째로 꺼진다 — 제외 확인.
		const confirmed = [player("rated", "M", 8), player("unrated", "M", 0)];
		const low = player("low", "M", 1); // 등급 있는 confirmed({8}) 기준 7 확장
		const unratedCand = player("unratedCand", "M", 0); // 정보 없음 → 벌점 없음
		const ranked = recommendTeammates(confirmed, [low, unratedCand], ctx());
		const get = (id: string) => ranked.find((r) => r.player.id === id)!;
		expect(get("low").breakdown!.skill).toBeCloseTo(7 * RECOMMEND_WEIGHTS.W_SKILL, 5);
		expect(get("unratedCand").breakdown!.skill).toBe(0);
	});

	it("같은 조건이면 더 오래 기다린(대기시간 긴) 후보가 우선된다(W_WAIT)", () => {
		const confirmed = [player("c1", "M")];
		const longWait = player("longWait", "M");
		const shortWait = player("shortWait", "M");
		longWait.waitSince = new Date(Date.now() - 30 * 60000).toISOString(); // 30분 전부터 대기
		shortWait.waitSince = new Date(Date.now() - 5 * 60000).toISOString(); // 5분 전부터 대기
		const ranked = recommendTeammates(confirmed, [shortWait, longWait], ctx());
		expect(ranked[0].player.id).toBe("longWait");
		const lw = ranked.find((r) => r.player.id === "longWait")!;
		const sw = ranked.find((r) => r.player.id === "shortWait")!;
		// 대기 25분 차 × W_WAIT 만큼 점수 차(낮을수록 우선)
		expect(sw.score - lw.score).toBeCloseTo(25 * RECOMMEND_WEIGHTS.W_WAIT, 0);
	});

	it("가중치 회귀 가드 — 2명 겹침 < 경기수 1판 < 3명 겹침, 4명 재결성 > 경기중 페널티", () => {
		// 2명 유지+2명 교체는 경기수(1판=W_GAME)를 못 뒤집는 약한 회피여야 하고,
		// 3명 유지+1명 교체는 1판을 넘어서며, 완전 재결성은 경기중 ghost를 데려오는 것(W_PLAYING)보다
		// 비싸야 한다("재결성될 바엔 경기중에서 데려온다"). 실력은 경기수보다 약하게.
		expect(RECOMMEND_WEIGHTS.W_GROUP2).toBeLessThan(RECOMMEND_WEIGHTS.W_GAME);
		expect(RECOMMEND_WEIGHTS.W_GROUP3).toBeGreaterThan(RECOMMEND_WEIGHTS.W_GAME);
		expect(RECOMMEND_WEIGHTS.W_GROUP4).toBeGreaterThan(RECOMMEND_WEIGHTS.W_PLAYING);
		expect(RECOMMEND_WEIGHTS.W_GAME).toBeGreaterThan(RECOMMEND_WEIGHTS.W_SKILL);
	});

	it("경기수가 실력을 이긴다 — 더 뛴 '실력 쌍둥이'보다 덜 뛴 후보가 우선 선발된다", () => {
		const confirmed = [player("seed", "M", 6)]; // 등급 6
		const similar = { ...player("similar", "M", 6), gameCount: 2 }; // 실력 동일하지만 2판 더 뜀
		const fewGames = { ...player("fewGames", "M", 1), gameCount: 0 }; // 실력 다르지만 0판
		const ranked = recommendTeammates(confirmed, [similar, fewGames], ctx());
		// 실력만 봤다면 similar가 1순위였겠지만, 경기수 우선이라 덜 뛴 fewGames가 앞선다.
		expect(ranked[0].player.id).toBe("fewGames");
	});
});

describe("autoFillTeammates — greedy 자동편성", () => {
	it("요청한 인원 수만큼, 풀이 모자라면 가능한 만큼만 뽑는다", () => {
		const confirmed = [player("c1", "M")];
		const pool = [player("a", "M"), player("b", "M")];
		expect(autoFillTeammates(confirmed, pool, ctx(), 3)).toHaveLength(2); // 풀=2 < 3
		expect(autoFillTeammates(confirmed, pool, ctx(), 1)).toHaveLength(1);
		// 같은 후보를 중복으로 뽑지 않는다
		const picks = autoFillTeammates(confirmed, pool, ctx(), 2);
		expect(new Set(picks.map((p) => p.id)).size).toBe(2);
	});

	it("매 라운드 재평가한다 — 한 명을 넣으면 그룹 겹침에 따라 다음 추천이 달라진다", () => {
		// 전원 동일 실력/남성 + gameCount=0 → 점수 = 그룹 재결성 항만 작동.
		const confirmed = [player("c1", "M")];
		const a = player("a", "M");
		const b = player("b", "M");
		const x = player("x", "M");
		// c1 단독 기준: a(0) < b(c1과 1그룹 = W_GROUP2) < x(c1과 2그룹 = 2×W_GROUP2). a를 먼저 뽑음.
		// a를 넣은 뒤: b는 a와의 과거 2그룹이 추가로 걸려(합 3×W_GROUP2) 급락, x(2×W_GROUP2)가 상위.
		const groupHistory = [
			grp("c1", "b", "m", "n"),
			grp("a", "b", "p", "q"),
			grp("a", "b", "p", "q"),
			grp("c1", "x", "y", "w"),
			grp("c1", "x", "u", "v"),
		];
		const picks = autoFillTeammates(confirmed, [a, b, x], ctx({ groupHistory }), 2);
		expect(picks.map((p) => p.id)).toEqual(["a", "x"]);
		// 단순 상위 N(재평가 없음)이라면 [a, b]가 됐을 것 — 재평가가 b를 밀어냈다.
		const oneShotTop2 = recommendTeammates(confirmed, [a, b, x], ctx({ groupHistory }))
			.slice(0, 2)
			.map((r) => r.player.id);
		expect(oneShotTop2).toEqual(["a", "b"]);
	});

	it("maxPlaying — 경기중 후보는 상한(팀당 ghost 수)까지만 뽑히고, 기본값(0)은 대기 선수만", () => {
		// 대기 w1·w2는 판수+재결성 벌점(20+12=32)으로, 경기중 p1·p2(0판, W_PLAYING=30)보다 순수 점수는 하위.
		const confirmed = [player("A", "M"), player("B", "M")];
		const w1 = { ...player("w1", "M"), gameCount: 2 };
		const w2 = { ...player("w2", "M"), gameCount: 2 };
		const p1 = player("p1", "M");
		const p2 = player("p2", "M");
		const groupHistory = [grp("A", "B", "w1", "z1"), grp("A", "B", "w2", "z2")];
		const c = ctx({ groupHistory, playingIds: new Set(["p1", "p2"]) });
		// 상한 1: 경기중은 1명(p1)까지만 — 2번째 슬롯은 순수 점수상 p2가 상위여도 대기(w1)로 채운다.
		const capped = autoFillTeammates(confirmed, [w1, w2, p1, p2], c, 2, undefined, { maxPlaying: 1 });
		expect(capped.map((p) => p.id)).toEqual(["p1", "w1"]);
		// 기본(0): 경기중 제외 — 대기 선수만.
		const waitingOnly = autoFillTeammates(confirmed, [w1, w2, p1, p2], c, 2);
		expect(waitingOnly.map((p) => p.id)).toEqual(["w1", "w2"]);
	});
});
