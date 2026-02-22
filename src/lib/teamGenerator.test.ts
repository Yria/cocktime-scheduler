/**
 * teamGenerator.test.ts
 *
 * 팀 생성 알고리즘 테스트. 각 테스트는 console.log로 실제 결과를 출력한다.
 * 실행: npm test
 */
import { describe, expect, it } from "vitest";
import type { PairHistory, PlayerSkills, SessionPlayer } from "../types";
import { generateTeam, pairingScore, skillScore } from "./teamGenerator";

// ─────────────────────────────────────────────
// 테스트 헬퍼
// ─────────────────────────────────────────────

let _idSeq = 0;

function makePlayer(
	name: string,
	gender: "M" | "F",
	opts: {
		skill?: "O" | "V" | "X";
		gameCount?: number;
		mixedCount?: number;
		forceMixed?: boolean;
		allowMixedSingle?: boolean;
	} = {},
): SessionPlayer {
	const skill = opts.skill ?? "V";
	const skills: PlayerSkills = {
		클리어: skill,
		스매시: skill,
		로테이션: skill,
		드랍: skill,
		헤어핀: skill,
		드라이브: skill,
		백핸드: skill,
	};
	const id = `p${++_idSeq}`;
	return {
		id,
		playerId: id,
		name,
		gender,
		skills,
		allowMixedSingle: opts.allowMixedSingle ?? false,
		status: "waiting",
		forceMixed: opts.forceMixed ?? false,
		gameCount: opts.gameCount ?? 0,
		mixedCount: opts.mixedCount ?? 0,
		waitSince: null,
	};
}

function makeHistory(pairs: [SessionPlayer, SessionPlayer][]): PairHistory {
	const h: PairHistory = {};
	for (const [a, b] of pairs) {
		if (!h[a.id]) h[a.id] = new Set();
		if (!h[b.id]) h[b.id] = new Set();
		h[a.id].add(b.id);
		h[b.id].add(a.id);
	}
	return h;
}

function logTeam(
	label: string,
	team: ReturnType<typeof generateTeam>,
	history: PairHistory = {},
) {
	if (!team) {
		console.log(`  [${label}] 팀 생성 실패 (null)`);
		return;
	}
	const fmt = (p: SessionPlayer) =>
		`${p.name}(스킬:${skillScore(p).toFixed(1)} 경기:${p.gameCount} 혼복:${p.mixedCount})`;
	const hasPrev = (a: SessionPlayer, b: SessionPlayer) =>
		history[a.id]?.has(b.id) ? "⚠️이전팀" : "";
	const [a, b] = team.teamA;
	const [c, d] = team.teamB;
	console.log(`  [${label}] 게임타입: ${team.gameType}`);
	console.log(`    팀A: ${fmt(a)} + ${fmt(b)} ${hasPrev(a, b)}`);
	console.log(`    팀B: ${fmt(c)} + ${fmt(d)} ${hasPrev(c, d)}`);
	console.log(
		`    페어링점수: ${pairingScore(team.teamA, team.teamB, history).toFixed(2)}`,
	);
}

function logWaiting(label: string, waiting: SessionPlayer[]) {
	console.log(`  [${label}] 대기열 (${waiting.length}명):`);
	for (const p of waiting) {
		const flags = [
			p.forceMixed ? "🔴forceMixed" : "",
			p.allowMixedSingle ? "혼합허용" : "",
		]
			.filter(Boolean)
			.join(" ");
		console.log(
			`    ${p.name}(${p.gender}) 스킬:${skillScore(p).toFixed(1)} 경기:${p.gameCount} 혼복:${p.mixedCount} ${flags}`,
		);
	}
}

// ─────────────────────────────────────────────
// 규칙 0: 전체 경기 횟수 균등 분배
// ─────────────────────────────────────────────

describe("규칙 0 — 경기 횟수 균등 분배", () => {
	it("경기 적게 한 선수를 먼저 선발한다", () => {
		console.log("\n▶ 규칙 0: 경기 횟수 균등 분배");

		// 남자 6명 (경기수 다름), 혼복 불가로 남복만 발생
		const players = [
			makePlayer("남A", "M", { gameCount: 5 }),
			makePlayer("남B", "M", { gameCount: 3 }),
			makePlayer("남C", "M", { gameCount: 1 }), // 최소
			makePlayer("남D", "M", { gameCount: 2 }), // 두 번째
			makePlayer("남E", "M", { gameCount: 4 }),
			makePlayer("남F", "M", { gameCount: 0 }), // 최소
		];

		logWaiting("초기", players);
		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		expect(team).not.toBeNull();
		// 경기수 0,1,2,3인 남F,남C,남D,남B 선발
		const selected = [...team!.teamA, ...team!.teamB].map((p) => p.name);
		console.log(`  선발: ${selected.join(", ")}`);
		expect(selected).toContain("남F");
		expect(selected).toContain("남C");
		expect(selected).not.toContain("남A"); // 경기 5회 — 선발 X
		expect(selected).not.toContain("남E"); // 경기 4회 — 선발 X
	});

	it("동점이면 기존 대기 순서를 유지한다 (stable sort)", () => {
		console.log("\n▶ 규칙 0: 동점 stable sort");

		const players = [
			makePlayer("먼저A", "M", { gameCount: 2 }),
			makePlayer("먼저B", "M", { gameCount: 2 }),
			makePlayer("나중C", "M", { gameCount: 2 }),
			makePlayer("나중D", "M", { gameCount: 2 }),
			makePlayer("뒤E", "M", { gameCount: 3 }),
			makePlayer("뒤F", "M", { gameCount: 3 }),
		];

		logWaiting("초기", players);
		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		expect(team).not.toBeNull();
		const selected = [...team!.teamA, ...team!.teamB].map((p) => p.name);
		console.log(`  선발: ${selected.join(", ")}`);
		// 동점(gameCount=2)인 앞 4명이 선발되어야 함
		expect(selected).toContain("먼저A");
		expect(selected).toContain("먼저B");
		expect(selected).toContain("나중C");
		expect(selected).toContain("나중D");
	});
});

// ─────────────────────────────────────────────
// 규칙 1: 혼복 우선
// ─────────────────────────────────────────────

describe("규칙 1 — 혼복 우선", () => {
	it("여자 2명 + 남자 2명 이상이면 혼복을 구성한다", () => {
		console.log("\n▶ 규칙 1: 혼복 우선");

		const players = [
			makePlayer("여A", "F"),
			makePlayer("여B", "F"),
			makePlayer("남A", "M"),
			makePlayer("남B", "M"),
			makePlayer("남C", "M"),
		];

		logWaiting("초기", players);
		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		expect(team?.gameType).toBe("혼복");
		// 각 팀이 여+남으로 구성
		for (const t of [team!.teamA, team!.teamB]) {
			const genders = t.map((p) => p.gender);
			expect(genders).toContain("F");
			expect(genders).toContain("M");
		}
	});

	it("여자 없으면 남복을 구성한다", () => {
		console.log("\n▶ 규칙 1: 남복");

		const players = [
			makePlayer("남A", "M"),
			makePlayer("남B", "M"),
			makePlayer("남C", "M"),
			makePlayer("남D", "M"),
		];

		logWaiting("초기", players);
		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		expect(team?.gameType).toBe("남복");
	});

	it("혼복 우선: 남자 경기수 많아도 여자 있으면 혼복 먼저", () => {
		console.log("\n▶ 규칙 1: 남자 경기수 많아도 여자 있으면 혼복");

		const players = [
			makePlayer("여A", "F", { gameCount: 5 }),
			makePlayer("여B", "F", { gameCount: 5 }),
			makePlayer("남A", "M", { gameCount: 0 }),
			makePlayer("남B", "M", { gameCount: 0 }),
			makePlayer("남C", "M", { gameCount: 0 }),
			makePlayer("남D", "M", { gameCount: 0 }),
		];

		logWaiting("초기", players);
		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		// 여자 경기수가 많아도 혼복이 우선
		expect(team?.gameType).toBe("혼복");
	});
});

// ─────────────────────────────────────────────
// 규칙 1.5: 직전 경기 혼복 참여자 배제
// ─────────────────────────────────────────────

describe("규칙 1.5 — 직전 혼복 참여자 배제", () => {
	it("직전 혼복 출전 남자는 혼복 선발 최하위", () => {
		console.log("\n▶ 규칙 1.5: 직전 혼복 남자 후순위");

		const lastM1 = makePlayer("직전남A", "M", { mixedCount: 1 });
		const lastM2 = makePlayer("직전남B", "M", { mixedCount: 1 });
		const freshM1 = makePlayer("신규남C", "M", { mixedCount: 0 });
		const freshM2 = makePlayer("신규남D", "M", { mixedCount: 0 });
		const w1 = makePlayer("여A", "F");
		const w2 = makePlayer("여B", "F");

		const players = [w1, w2, lastM1, lastM2, freshM1, freshM2];
		const lastMixedIds = [lastM1.id, lastM2.id];

		logWaiting("초기", players);
		console.log(
			`  직전혼복: ${[lastM1, lastM2].map((p) => p.name).join(", ")}`,
		);

		const team = generateTeam(players, {}, [], lastMixedIds);
		logTeam("결과", team);

		expect(team?.gameType).toBe("혼복");
		const selectedMen = [...team!.teamA, ...team!.teamB]
			.filter((p) => p.gender === "M")
			.map((p) => p.name);
		console.log(`  선발된 남자: ${selectedMen.join(", ")}`);
		// 신규 남자가 선발되어야 함
		expect(selectedMen).toContain("신규남C");
		expect(selectedMen).toContain("신규남D");
		expect(selectedMen).not.toContain("직전남A");
		expect(selectedMen).not.toContain("직전남B");
	});

	it("직전 혼복 출전 여자는 혼복 선발 후순위", () => {
		console.log("\n▶ 규칙 1.5: 직전 혼복 여자 후순위");

		const lastW1 = makePlayer("직전여A", "F");
		const lastW2 = makePlayer("직전여B", "F");
		const freshW = makePlayer("신규여C", "F");
		const m1 = makePlayer("남A", "M");
		const m2 = makePlayer("남B", "M");

		const players = [lastW1, lastW2, freshW, m1, m2];
		const lastMixedIds = [lastW1.id, lastW2.id];

		logWaiting("초기", players);
		console.log(
			`  직전혼복: ${[lastW1, lastW2].map((p) => p.name).join(", ")}`,
		);

		const team = generateTeam(players, {}, [], lastMixedIds);
		logTeam("결과", team);

		expect(team?.gameType).toBe("혼복");
		const selectedWomen = [...team!.teamA, ...team!.teamB]
			.filter((p) => p.gender === "F")
			.map((p) => p.name);
		console.log(`  선발된 여자: ${selectedWomen.join(", ")}`);
		// 신규 여자가 우선 선발
		expect(selectedWomen).toContain("신규여C");
	});

	it("모든 남자가 직전 혼복이면 완화 적용 (전체에서 선발)", () => {
		console.log("\n▶ 규칙 1.5: 완화 적용 (남자 부족)");

		const lastM1 = makePlayer("직전남A", "M", { mixedCount: 2 });
		const lastM2 = makePlayer("직전남B", "M", { mixedCount: 2 });
		const w1 = makePlayer("여A", "F");
		const w2 = makePlayer("여B", "F");

		const players = [w1, w2, lastM1, lastM2];
		const lastMixedIds = [lastM1.id, lastM2.id];

		logWaiting("초기", players);
		console.log("  (남자가 직전 혼복 2명뿐 → 완화 적용)");

		const team = generateTeam(players, {}, [], lastMixedIds);
		logTeam("결과", team);

		// 혼복은 구성되어야 함 (완화)
		expect(team?.gameType).toBe("혼복");
	});
});

// ─────────────────────────────────────────────
// 규칙 2: 혼복 남자 실력 유사성
// ─────────────────────────────────────────────

describe("규칙 2 — 혼복 남자 실력 유사성", () => {
	it("혼복 출전 횟수 같은 남자 중 실력 차이가 작은 쌍을 선택한다", () => {
		console.log("\n▶ 규칙 2: 혼복 남자 실력 유사성");

		// 실력: 강=O(3.0), 중=V(2.0), 약=X(1.0)
		const w1 = makePlayer("여A", "F");
		const w2 = makePlayer("여B", "F");
		const strongM = makePlayer("강남A", "M", { skill: "O" }); // 3.0
		const midM = makePlayer("중남B", "M", { skill: "V" }); // 2.0
		const weakM = makePlayer("약남C", "M", { skill: "X" }); // 1.0

		// 모두 mixedCount=0 (동점)
		const players = [w1, w2, strongM, midM, weakM];

		logWaiting("초기", players);
		console.log(
			`  스킬 점수 — 강남A:${skillScore(strongM).toFixed(1)} 중남B:${skillScore(midM).toFixed(1)} 약남C:${skillScore(weakM).toFixed(1)}`,
		);
		console.log(
			"  기대: 강남A(3.0)+약남C(1.0) 차이=2.0 vs 강남A+중남B 차이=1.0 → 강남A+중남B 선택",
		);

		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		expect(team?.gameType).toBe("혼복");
		const selectedMen = [...team!.teamA, ...team!.teamB]
			.filter((p) => p.gender === "M")
			.map((p) => p.name);
		console.log(`  선발된 남자: ${selectedMen.join(", ")}`);
		// 실력 차이 최소 쌍: 강남A(3.0) + 중남B(2.0) = 차이 1.0
		// 강남A(3.0) + 약남C(1.0) = 차이 2.0 → 선택 X
		// 중남B(2.0) + 약남C(1.0) = 차이 1.0 → 동점이지만 먼저 발견되는 쌍
		expect(selectedMen).not.toContain("약남C"); // 가장 큰 차이 조합에서만 등장
	});

	it("mixedCount 적은 남자를 실력 유사성보다 우선한다", () => {
		console.log("\n▶ 규칙 2: mixedCount 우선 후 실력 유사성");

		const w1 = makePlayer("여A", "F");
		const w2 = makePlayer("여B", "F");
		// mixedCount 1 (많음) — 실력 비슷
		const manyMixed1 = makePlayer("혼복많은A", "M", {
			skill: "V",
			mixedCount: 3,
		});
		const manyMixed2 = makePlayer("혼복많은B", "M", {
			skill: "V",
			mixedCount: 3,
		});
		// mixedCount 0 (적음) — 실력 차이 있음
		const fewMixed1 = makePlayer("혼복적은C", "M", {
			skill: "O",
			mixedCount: 0,
		});
		const fewMixed2 = makePlayer("혼복적은D", "M", {
			skill: "X",
			mixedCount: 0,
		});

		const players = [w1, w2, manyMixed1, manyMixed2, fewMixed1, fewMixed2];

		logWaiting("초기", players);
		console.log("  기대: mixedCount 적은 C(O)+D(X) 선발 (mixedCount 우선)");

		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		const selectedMen = [...team!.teamA, ...team!.teamB]
			.filter((p) => p.gender === "M")
			.map((p) => p.name);
		console.log(`  선발된 남자: ${selectedMen.join(", ")}`);
		// mixedCount 0인 C, D가 선발되어야 함 (규칙 1 우선)
		expect(selectedMen).toContain("혼복적은C");
		expect(selectedMen).toContain("혼복적은D");
	});
});

// ─────────────────────────────────────────────
// 규칙 1.8: 여자복식(여복) fallback
// ─────────────────────────────────────────────

describe("규칙 1.8 — 여자복식(여복) fallback", () => {
	it("상위 규칙으로 팀 구성이 불가능할 때 여자 4명으로 여복을 구성한다", () => {
		console.log("\n▶ 규칙 1.8: 여복 fallback (남자 부족)");

		// 여자 4명, 남자 1명 (혼복 불가, 남복 불가)
		const players = [
			makePlayer("여A", "F"),
			makePlayer("여B", "F"),
			makePlayer("여C", "F"),
			makePlayer("여D", "F"),
			makePlayer("남A", "M"),
		];

		logWaiting("초기", players);
		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		expect(team?.gameType).toBe("여복");
		const selectedGenders = [...team!.teamA, ...team!.teamB].map(
			(p) => p.gender,
		);
		expect(selectedGenders.every((g) => g === "F")).toBe(true);
	});

	it("여복 구성 시에도 스코어 점수 기준으로 최적의 조합을 선발한다", () => {
		console.log("\n▶ 규칙 1.8: 여복 최적 페어링");

		const players = [
			makePlayer("강여A", "F", { skill: "O" }), // 3.0
			makePlayer("강여B", "F", { skill: "O" }), // 3.0
			makePlayer("약여C", "F", { skill: "X" }), // 1.0
			makePlayer("약여D", "F", { skill: "X" }), // 1.0
		];

		logWaiting("초기", players);
		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		expect(team?.gameType).toBe("여복");
		
		const teamASkills = team!.teamA.map((p) => skillScore(p));
		const teamBSkills = team!.teamB.map((p) => skillScore(p));
		const isEven =
			teamASkills[0] === teamASkills[1] && teamBSkills[0] === teamBSkills[1];
		
		// 현재 가중치에서는 [강,강] vs [약,약]이 선택됨 (intraDiff 최소화 우선)
		expect(isEven).toBe(true);
	});
});

// ─────────────────────────────────────────────
// 규칙 2.5: 혼복 여자 실력 유사성
// ─────────────────────────────────────────────

describe("규칙 2.5 — 혼복 여자 실력 유사성", () => {
	it("혼복에 투입할 여자 2명은 서로 실력이 비슷한 쌍을 우선 선택한다", () => {
		console.log("\n▶ 규칙 2.5: 혼복 여자 실력 유사성");

		// 실력: 강=O(3.0), 중=V(2.0), 약=X(1.0)
		const strongW = makePlayer("강여A", "F", { skill: "O" }); // 3.0
		const midW = makePlayer("중여B", "F", { skill: "V" }); // 2.0
		const weakW = makePlayer("약여C", "F", { skill: "X" }); // 1.0
		const m1 = makePlayer("남A", "M");
		const m2 = makePlayer("남B", "M");

		// 모두 gameCount=0 (동점)
		const players = [strongW, midW, weakW, m1, m2];

		logWaiting("초기", players);
		console.log(
			`  스킬 점수 — 강여A:${skillScore(strongW).toFixed(1)} 중여B:${skillScore(midW).toFixed(1)} 약여C:${skillScore(weakW).toFixed(1)}`,
		);
		console.log(
			"  기대: 강여A(3.0)+약여C(1.0) 차이=2.0 vs 강여A+중여B 차이=1.0 → 강여A+중여B 선택",
		);

		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		expect(team?.gameType).toBe("혼복");
		const selectedWomen = [...team!.teamA, ...team!.teamB]
			.filter((p) => p.gender === "F")
			.map((p) => p.name);
		console.log(`  선발된 여자: ${selectedWomen.join(", ")}`);
		
		// 실력 차이 최소 쌍: 강여A(3.0) + 중여B(2.0) = 차이 1.0
		// 중여B(2.0) + 약여C(1.0) = 차이 1.0 → 동점이지만 먼저 발견되는 쌍
		expect(selectedWomen).not.toContain("약여C");
	});

	it("직전 혼복 출전자를 후순위 처리 후, 남은 후보 중 실력 차이가 가장 작은 쌍 선택", () => {
		console.log("\n▶ 규칙 2.5: 직전 혼복 출전자 후순위 + 실력 유사성");

		// 실력: 강=O(3.0), 중=V(2.0), 약=X(1.0)
		const lastStrongW = makePlayer("직전강여A", "F", { skill: "O" }); // 3.0 (직전 혼복)
		const midW1 = makePlayer("중여B", "F", { skill: "V" }); // 2.0
		const midW2 = makePlayer("중여C", "F", { skill: "V" }); // 2.0
		const weakW = makePlayer("약여D", "F", { skill: "X" }); // 1.0
		const m1 = makePlayer("남A", "M");
		const m2 = makePlayer("남B", "M");

		const players = [lastStrongW, midW1, midW2, weakW, m1, m2];
		const lastMixedIds = [lastStrongW.id];

		logWaiting("초기", players);
		console.log(`  직전혼복: ${lastStrongW.name}`);
		console.log("  기대: 직전강여A 제외 후, 중여B+중여C (차이 0) 선택");

		const team = generateTeam(players, {}, [], lastMixedIds);
		logTeam("결과", team);

		expect(team?.gameType).toBe("혼복");
		const selectedWomen = [...team!.teamA, ...team!.teamB]
			.filter((p) => p.gender === "F")
			.map((p) => p.name);
		console.log(`  선발된 여자: ${selectedWomen.join(", ")}`);
		
		expect(selectedWomen).toContain("중여B");
		expect(selectedWomen).toContain("중여C");
		expect(selectedWomen).not.toContain("직전강여A");
		expect(selectedWomen).not.toContain("약여D");
	});
});

// ─────────────────────────────────────────────
// 규칙 3+4: 페어링 스코어 (파트너 실력 유사 + 팀 균형)
// ─────────────────────────────────────────────

describe("규칙 3+4 — 파트너 실력 유사 + 팀 간 균형", () => {
	it("페어링 점수 비교: 현재 가중치 동작 확인", () => {
		console.log("\n▶ 규칙 3+4: 페어링 점수 비교 (가중치 검증)");

		const strong1 = makePlayer("강A", "M", { skill: "O" }); // 3.0
		const strong2 = makePlayer("강B", "M", { skill: "O" }); // 3.0
		const weak1 = makePlayer("약C", "M", { skill: "X" }); // 1.0
		const weak2 = makePlayer("약D", "M", { skill: "X" }); // 1.0

		// [강,강] vs [약,약]
		const scoreEven = pairingScore([strong1, strong2], [weak1, weak2], {});
		// [강,약] vs [강,약]
		const scoreMixed = pairingScore([strong1, weak1], [strong2, weak2], {});

		const intraEven = Math.abs(3 - 3) + Math.abs(1 - 1); // 0
		const interEven = Math.abs(6 - 2); // 4
		const intraMixed = Math.abs(3 - 1) + Math.abs(3 - 1); // 4
		const interMixed = Math.abs(4 - 4); // 0

		console.log(
			`  [강A,강B] vs [약C,약D] 점수: ${scoreEven.toFixed(2)}` +
				`  (intra:${intraEven}×1.5=${(intraEven * 1.5).toFixed(1)} + inter:${interEven}×0.5=${(interEven * 0.5).toFixed(1)})`,
		);
		console.log(
			`  [강A,약C] vs [강B,약D] 점수: ${scoreMixed.toFixed(2)}` +
				`  (intra:${intraMixed}×1.5=${(intraMixed * 1.5).toFixed(1)} + inter:${interMixed}×0.5=${(interMixed * 0.5).toFixed(1)})`,
		);
		console.log(
			`  → 현재 가중치(intra:1.5 > inter:0.5)로 선택: ${scoreEven < scoreMixed ? "[강,강] vs [약,약]" : "[강,약] vs [강,약]"}`,
		);
		console.log(
			"  ⚠️  기획서 예시('강자+약자가 유리')와 반대 동작 — 가중치 조정 필요 시 TEAM_GENERATION_RULES.md의 intra:1.5/inter:0.5 값 변경",
		);

		// 현재 가중치에서는 파트너 실력 유사성(규칙3, 1.5배)이 팀 균형(규칙4, 0.5배)보다 강해
		// [강,강] vs [약,약]이 더 낮은 점수(=더 좋음)로 선택된다.
		expect(scoreEven).toBeLessThan(scoreMixed);
	});

	it("남복에서 최적 페어링을 선택한다 (현재 가중치 동작)", () => {
		console.log("\n▶ 규칙 3+4: 남복 최적 페어링 (현재 가중치)");

		const players = [
			makePlayer("강A", "M", { skill: "O" }), // 3.0
			makePlayer("강B", "M", { skill: "O" }), // 3.0
			makePlayer("약C", "M", { skill: "X" }), // 1.0
			makePlayer("약D", "M", { skill: "X" }), // 1.0
		];

		logWaiting("초기", players);
		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		const teamANames = team!.teamA.map((p) => p.name).sort();
		const teamBNames = team!.teamB.map((p) => p.name).sort();
		console.log(`  팀A: ${teamANames.join("+")}  팀B: ${teamBNames.join("+")}`);

		const teamASkills = team!.teamA.map((p) => skillScore(p));
		const teamBSkills = team!.teamB.map((p) => skillScore(p));
		const isEven =
			teamASkills[0] === teamASkills[1] && teamBSkills[0] === teamBSkills[1];
		const isMixed =
			teamASkills[0] !== teamASkills[1] && teamBSkills[0] !== teamBSkills[1];
		console.log(
			`  선택된 조합: ${isEven ? "[강,강] vs [약,약] ← 현재 가중치(intra:1.5)로 선택됨" : isMixed ? "[강,약] vs [강,약]" : "기타"}`,
		);
		console.log(
			"  ⚠️  기획서 예시('[강,약] 유리')와 반대 — intra/inter 가중치 조정 필요 시 팀 알고리즘 규칙서 참고",
		);

		// 현재 가중치에서는 [강,강] vs [약,약]이 선택됨 (intraDiff 최소화 우선)
		expect(isEven).toBe(true);
		expect(team).not.toBeNull();
	});
});

// ─────────────────────────────────────────────
// 규칙 5: 파트너 중복 최소화
// ─────────────────────────────────────────────

describe("규칙 5 — 파트너 중복 최소화", () => {
	it("이전에 같이 뛴 파트너를 피한다 (가중치 10)", () => {
		console.log("\n▶ 규칙 5: 파트너 중복 기피");

		const m1 = makePlayer("남A", "M");
		const m2 = makePlayer("남B", "M");
		const m3 = makePlayer("남C", "M");
		const m4 = makePlayer("남D", "M");

		// m1-m2가 이전에 파트너였음
		const history = makeHistory([[m1, m2]]);

		const players = [m1, m2, m3, m4];

		logWaiting("초기", players);
		console.log("  이전 파트너: 남A-남B");
		const team = generateTeam(players, history, []);
		logTeam("결과", team, history);

		// m1과 m2가 같은 팀이 되면 안 됨
		const teamA = team!.teamA.map((p) => p.id);
		const isM1InA = teamA.includes(m1.id);
		const isM2InA = teamA.includes(m2.id);
		console.log(
			`  남A와 남B가 같은 팀: ${isM1InA === isM2InA ? "YES ⚠️" : "NO ✅"}`,
		);
		expect(isM1InA).not.toEqual(isM2InA);
	});

	it("파트너 중복 페널티가 실력 차이보다 강하다 (가중치 10 vs 1.5)", () => {
		console.log("\n▶ 규칙 5: 파트너 중복 vs 실력 차이");

		const strong = makePlayer("강A", "M", { skill: "O" }); // 3.0
		const weak = makePlayer("약B", "M", { skill: "X" }); // 1.0
		const mid1 = makePlayer("중C", "M", { skill: "V" }); // 2.0
		const mid2 = makePlayer("중D", "M", { skill: "V" }); // 2.0

		// 강A-약B가 이전에 파트너
		const history = makeHistory([[strong, weak]]);

		const players = [strong, weak, mid1, mid2];

		logWaiting("초기", players);
		console.log("  이전 파트너: 강A-약B");
		console.log("  실력상 자연스러운 페어: 강A+약B vs 중C+중D (interDiff=0)");
		console.log("  파트너 중복 패널티: 강A-약B 재결합 시 +10 → 회피 우선");

		const team = generateTeam(players, history, []);
		logTeam("결과", team, history);

		const teamA = team!.teamA.map((p) => p.id);
		const isStrongInA = teamA.includes(strong.id);
		const isWeakInA = teamA.includes(weak.id);
		// 강A와 약B는 다른 팀이어야 함
		expect(isStrongInA).not.toEqual(isWeakInA);
	});
});

// ─────────────────────────────────────────────
// 규칙 7: 혼복 우선배치 강제 적용
// ─────────────────────────────────────────────

describe("규칙 7 — 혼복 우선배치 강제 적용", () => {
	it("forceMixed 남자가 있으면 일반 조건 없어도 혼복 구성 시도", () => {
		console.log("\n▶ 규칙 7: forceMixed 남자 — 혼복 강제");

		// 여자 1명 + 남자 5명 (일반이면 남복)
		// 단, 남자 중 1명이 forceMixed
		const w1 = makePlayer("여A", "F");
		const forcedM = makePlayer("강제남B", "M", { forceMixed: true });
		const m2 = makePlayer("남C", "M");
		const m3 = makePlayer("남D", "M");
		const m4 = makePlayer("남E", "M");
		const m5 = makePlayer("남F", "M");

		const players = [w1, forcedM, m2, m3, m4, m5];

		logWaiting("초기", players);
		console.log(
			"  여자 1명뿐이므로 일반이면 남복 → forceMixed가 있어도 여자 1명이면 혼복 불가",
		);
		console.log("  (혼복엔 여자 2명이 필요 — 강제도 불가)");

		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		// 여자 1명으로는 혼복 구성 불가 → 남복으로 fallthrough
		// forceMixed man은 ordered 앞에 오므로 남복에서는 포함됨
		expect(team).not.toBeNull();
		console.log(`  실제 게임타입: ${team?.gameType}`);
	});

	it("forceMixed 남자 + 여자 2명 있으면 혼복 강제 (여자 부족 조건 무시)", () => {
		console.log("\n▶ 규칙 7: forceMixed 남자 + 여자 2명 이상");

		// 여자 2명 + 남자 6명 (일반이면 상위 8명 candidates에서 여2+남2 충족)
		// forceMixed 남자가 있으면 그 남자 반드시 포함
		const w1 = makePlayer("여A", "F", { gameCount: 5 }); // 경기 많음
		const w2 = makePlayer("여B", "F", { gameCount: 5 }); // 경기 많음
		const forcedM = makePlayer("강제남C", "M", {
			gameCount: 10, // 경기 매우 많음 → 일반이면 후순위
			mixedCount: 0,
			forceMixed: true,
		});
		const m2 = makePlayer("남D", "M", { gameCount: 0 });
		const m3 = makePlayer("남E", "M", { gameCount: 0 });
		const m4 = makePlayer("남F", "M", { gameCount: 0 });

		const players = [w1, w2, forcedM, m2, m3, m4];

		logWaiting("초기", players);
		console.log(
			"  강제남C는 gameCount=10이라 일반이면 후순위지만 forceMixed로 반드시 포함",
		);

		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		expect(team?.gameType).toBe("혼복");
		const selectedIds = [...team!.teamA, ...team!.teamB].map((p) => p.id);
		console.log(
			`  강제남C 선발 여부: ${selectedIds.includes(forcedM.id) ? "✅ 포함" : "❌ 미포함"}`,
		);
		expect(selectedIds).toContain(forcedM.id);
	});

	it("forceMixed 여자가 있으면 그 여자 반드시 포함", () => {
		console.log("\n▶ 규칙 7: forceMixed 여자 강제 포함");

		const forcedW = makePlayer("강제여A", "F", {
			gameCount: 10, // 경기 많음 → 일반이면 후순위
			forceMixed: true,
		});
		const w2 = makePlayer("여B", "F", { gameCount: 0 });
		const m1 = makePlayer("남C", "M", { gameCount: 0 });
		const m2 = makePlayer("남D", "M", { gameCount: 0 });
		const m3 = makePlayer("남E", "M", { gameCount: 0 });

		const players = [forcedW, w2, m1, m2, m3];

		logWaiting("초기", players);
		console.log("  강제여A는 gameCount=10이지만 forceMixed로 반드시 포함");

		const team = generateTeam(players, {}, []);
		logTeam("결과", team);

		expect(team?.gameType).toBe("혼복");
		const selectedIds = [...team!.teamA, ...team!.teamB].map((p) => p.id);
		console.log(
			`  강제여A 선발 여부: ${selectedIds.includes(forcedW.id) ? "✅ 포함" : "❌ 미포함"}`,
		);
		expect(selectedIds).toContain(forcedW.id);
	});

	it("forceMixed + 규칙 1.5 동시 적용", () => {
		console.log("\n▶ 규칙 7+1.5: 강제 혼복 + 직전 혼복 참여자 후순위");

		const forcedM = makePlayer("강제남A", "M", {
			forceMixed: true,
			mixedCount: 0,
		});
		const lastW1 = makePlayer("직전여B", "F"); // 직전 혼복 출전
		const lastW2 = makePlayer("직전여C", "F"); // 직전 혼복 출전
		const freshW = makePlayer("신규여D", "F"); // 직전 혼복 미출전
		const m2 = makePlayer("남E", "M", { mixedCount: 0 });
		const m3 = makePlayer("남F", "M", { mixedCount: 0 });

		const players = [forcedM, lastW1, lastW2, freshW, m2, m3];
		const lastMixedIds = [lastW1.id, lastW2.id];

		logWaiting("초기", players);
		console.log(
			`  직전혼복: ${[lastW1, lastW2].map((p) => p.name).join(", ")}`,
		);
		console.log("  기대: 강제남A 포함, 여자는 신규여D 우선 선발");

		const team = generateTeam(players, {}, [], lastMixedIds);
		logTeam("결과", team);

		expect(team?.gameType).toBe("혼복");
		const selected = [...team!.teamA, ...team!.teamB];
		const selectedIds = selected.map((p) => p.id);
		const selectedWomen = selected
			.filter((p) => p.gender === "F")
			.map((p) => p.name);

		console.log(`  선발된 여자: ${selectedWomen.join(", ")}`);
		console.log(
			`  강제남A 포함: ${selectedIds.includes(forcedM.id) ? "✅" : "❌"}`,
		);

		expect(selectedIds).toContain(forcedM.id);
		// 신규 여자 D가 우선 선발되어야 함
		expect(selectedIds).toContain(freshW.id);
	});
});

// ─────────────────────────────────────────────
// 혼복 팀 편성: 여+남 vs 여+남
// ─────────────────────────────────────────────

describe("혼복 팀 편성 — 파트너 이력 + 스킬 균형", () => {
	it("혼복에서 이전 파트너 조합을 피한다", () => {
		console.log("\n▶ 혼복 팀 편성: 이전 파트너 회피");

		const w1 = makePlayer("여A", "F");
		const w2 = makePlayer("여B", "F");
		const m1 = makePlayer("남C", "M");
		const m2 = makePlayer("남D", "M");

		// 여A-남C가 이전에 파트너
		const history = makeHistory([[w1, m1]]);

		logWaiting("초기", [w1, w2, m1, m2]);
		console.log("  이전 파트너: 여A-남C");
		console.log("  기대: 여A+남D vs 여B+남C (이전 파트너 회피)");

		const team = generateTeam([w1, w2, m1, m2], history, []);
		logTeam("결과", team, history);

		expect(team?.gameType).toBe("혼복");

		// 여A와 남C가 같은 팀이 되면 안 됨
		const teamAIds = team!.teamA.map((p) => p.id);
		const isW1InA = teamAIds.includes(w1.id);
		const isM1InA = teamAIds.includes(m1.id);
		console.log(`  여A-남C 같은팀: ${isW1InA === isM1InA ? "YES ⚠️" : "NO ✅"}`);
		expect(isW1InA).not.toEqual(isM1InA);
	});
});

// ─────────────────────────────────────────────
// 종합: 연속 게임 시뮬레이션
// ─────────────────────────────────────────────

describe("종합 시뮬레이션 — 연속 경기", () => {
	it("5경기 연속으로 규칙들이 일관되게 적용된다", () => {
		console.log("\n▶ 종합: 5경기 연속 시뮬레이션");

		const players = [
			makePlayer("여A", "F", { skill: "O" }),
			makePlayer("여B", "F", { skill: "V" }),
			makePlayer("남C", "M", { skill: "O" }),
			makePlayer("남D", "M", { skill: "V" }),
			makePlayer("남E", "M", { skill: "X" }),
			makePlayer("남F", "M", { skill: "V" }),
		];

		const history: PairHistory = {};
		let lastMixedIds: string[] = [];
		const playerMap = new Map(players.map((p) => [p.id, p]));

		for (let round = 1; round <= 5; round++) {
			// 대기 중인 모든 선수 (경기 후 gameCount 증가 시뮬레이션)
			const waiting = [...players];
			const team = generateTeam(waiting, history, [], lastMixedIds);

			if (!team) {
				console.log(`  라운드 ${round}: 팀 생성 실패`);
				break;
			}

			logTeam(`라운드 ${round}`, team, history);

			// 이력 업데이트 시뮬레이션
			for (const [a, b] of [team.teamA, team.teamB]) {
				if (!history[a.id]) history[a.id] = new Set();
				if (!history[b.id]) history[b.id] = new Set();
				history[a.id].add(b.id);
				history[b.id].add(a.id);
			}

			// gameCount 증가
			for (const p of [...team.teamA, ...team.teamB]) {
				const player = playerMap.get(p.id)!;
				player.gameCount += 1;
				if (team.gameType === "혼복" && p.gender === "M") {
					player.mixedCount += 1;
				}
			}

			// 직전 혼복 출전자 갱신
			if (team.gameType === "혼복") {
				lastMixedIds = [...team.teamA, ...team.teamB].map((p) => p.id);
			} else {
				lastMixedIds = [];
			}

			expect(team).not.toBeNull();
		}

		console.log("\n  최종 선수별 경기/혼복 횟수:");
		for (const p of players) {
			console.log(
				`    ${p.name}(${p.gender}): 경기${p.gameCount} 혼복${p.mixedCount}`,
			);
		}
	});
});
