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
		pairHistory: {},
		lastGameType: {},
		playingIds: new Set<string>(),
		...overrides,
	};
}

describe("recommendTeammates", () => {
	it("실력이 비슷한 후보가 상위(낮은 점수)에 온다", () => {
		const confirmed = [player("c1", "M", 6)]; // 등급 6
		const close = player("close", "M", 6); // 6
		const far = player("far", "M", 10); // 10
		const ranked = recommendTeammates(confirmed, [far, close], ctx());
		expect(ranked[0].player.id).toBe("close");
	});

	it("동반 회피는 상대별 제곱(Σc²) — 한 명과 여러 번 만난 후보가 여러 명과 한 번씩 만난 후보보다 강하게 하위", () => {
		// confirmed 2명(A,B) 동성/동일실력/0판 → 점수는 동반 항(pairOverlap·W_PAIR)만 작동.
		const confirmed = [player("A", "M"), player("B", "M")];
		const heavy = player("heavy", "M"); // A와 2회, B와 0회 → Σc² = 2²+0² = 4
		const spread = player("spread", "M"); // A와 1회, B와 1회 → Σc² = 1²+1² = 2 (선형 합은 둘 다 2로 동일)
		const pairHistory = { A: { heavy: 2, spread: 1 }, B: { spread: 1 } };
		const ranked = recommendTeammates(confirmed, [heavy, spread], ctx({ pairHistory }));
		expect(ranked[0].player.id).toBe("spread"); // 선형이라면 동점이지만 제곱이 heavy를 밀어냄
		expect(ranked.find((r) => r.player.id === "heavy")!.breakdown!.pair).toBe(
			4 * RECOMMEND_WEIGHTS.W_PAIR,
		);
		expect(ranked.find((r) => r.player.id === "spread")!.breakdown!.pair).toBe(
			2 * RECOMMEND_WEIGHTS.W_PAIR,
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
		const sum = b.skill + b.pair + b.game + b.mixed + b.wait + (b.rotate ?? 0) + (b.gender ?? 0) + (b.playing ?? 0);
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

	it("혼복 그룹에선 남자 후보 실력차는 무시되고(skill 0) 여자 후보만 실력으로 균형된다", () => {
		// 여자 시드(등급6) + 양성 후보 → 혼복 목표. 남자는 실력 균형 대상 아님, 여자만 시드와 맞춘다.
		const confirmed = [player("f1", "F", 6)];
		const mHigh = player("mHigh", "M", 10);
		const mLow = player("mLow", "M", 1);
		const fClose = player("fClose", "F", 6); // 시드와 일치
		const fFar = player("fFar", "F", 10);
		const ranked = recommendTeammates(confirmed, [mHigh, mLow, fClose, fFar], ctx());
		const get = (id: string) => ranked.find((r) => r.player.id === id)!;
		// 남자: 혼복 목표라 실력 균형 대상 아님 → skill 기여 0(실력이 달라도 동일)
		expect(get("mHigh").breakdown!.skill).toBe(0);
		expect(get("mLow").breakdown!.skill).toBe(0);
		// 여자: 시드(여자)와 실력 균형 → 가까운 여자가 먼 여자보다 skill 점수 낮음(우대)
		expect(get("fClose").breakdown!.skill).toBeLessThan(get("fFar").breakdown!.skill);
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

	it("선발 우선순위는 경기수 > 중복 회피 > 실력 (W_GAME > W_PAIR > W_SKILL)", () => {
		// 이 서비스는 '같은 경기 할 4명'을 뽑는 것이고 2v2 실력 균형은 pairPlayers가 따로 잡으므로,
		// 선발 가중치는 경기수가 최우선, 실력이 최하위여야 한다(회귀 가드).
		expect(RECOMMEND_WEIGHTS.W_GAME).toBeGreaterThan(RECOMMEND_WEIGHTS.W_PAIR);
		expect(RECOMMEND_WEIGHTS.W_PAIR).toBeGreaterThan(RECOMMEND_WEIGHTS.W_SKILL);
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

	it("매 라운드 재평가한다 — 한 명을 넣으면 동반 이력에 따라 다음 추천이 달라진다", () => {
		// 전원 동일 실력/남성 + gameCount=0 → 점수 = 동반 누적(pairHistory)×W_PAIR 만 작동.
		const confirmed = [player("c1", "M")];
		const a = player("a", "M");
		const b = player("b", "M");
		const x = player("x", "M");
		// c1 단독 기준: a(0) < b(1) < x(2). a를 먼저 뽑음.
		// a를 넣은 뒤: b는 a와 5회 동반(누적 6)으로 급락, x는 a와 0회(누적 2)라 x가 b보다 상위.
		const pairHistory = { c1: { a: 0, b: 1, x: 2 }, a: { b: 5, x: 0 } };
		const picks = autoFillTeammates(confirmed, [a, b, x], ctx({ pairHistory }), 2);
		expect(picks.map((p) => p.id)).toEqual(["a", "x"]);
		// 단순 상위 N(재평가 없음)이라면 [a, b]가 됐을 것 — 재평가가 b를 밀어냈다.
		const oneShotTop2 = recommendTeammates(confirmed, [a, b, x], ctx({ pairHistory }))
			.slice(0, 2)
			.map((r) => r.player.id);
		expect(oneShotTop2).toEqual(["a", "b"]);
	});
});
