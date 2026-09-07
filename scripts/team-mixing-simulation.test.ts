import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import type { GameType, GroupHistoryEntry, SessionPlayer, SkillGrade } from "../src/types";
import { autoFillTeammates, pairPlayers, RECOMMEND_WEIGHTS } from "../src/lib/teamSelection";

// A reproducible, synthetic event simulation using the actual production selector.
// No database, credentials, live player data, UI interaction, or score reimplementation.
type Scenario = { name: string; size: number; women: number; courts: number; grades: "balanced" | "split" | "equal"; late?: number };
const scenarios: Scenario[] = [
	{ name: "balanced24", size: 24, women: 12, courts: 3, grades: "balanced" },
	{ name: "skew24", size: 24, women: 6, courts: 3, grades: "balanced" },
	{ name: "split24", size: 24, women: 12, courts: 3, grades: "split" },
	{ name: "tight16", size: 16, women: 4, courts: 3, grades: "balanced" },
	{ name: "late28", size: 28, women: 8, courts: 3, grades: "balanced", late: 4 },
	{ name: "small8", size: 8, women: 0, courts: 2, grades: "equal" },
];
type Metrics = {
	unmetPairs: number; distinct: number; distinctP10: number; maxRepeat: number;
	gameStd: number; gameRange: number; spread: number; balance: number;
	waitP95: number; utilization: number; overlap3: number; genderGap: number;
	multiReservationRate: number;
};
type Match = { players: SessionPlayer[]; type: GameType; end: number; start: number };
const mean = (values: number[]) => values.reduce((sum, x) => sum + x, 0) / values.length;
const std = (values: number[]) => Math.sqrt(mean(values.map(x => (x - mean(values)) ** 2)));
const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] ?? 0;

function rng(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

function simulate(scenario: Scenario, seed: number, encounterWeight: number, maxPlaying: number): Metrics {
	const shuffle = rng(seed);
	const durationRandom = rng(seed ^ 0x513fab);
	const pairingRandom = rng(seed ^ 0x61bd);
	const originalNow = Date.now;
	const originalRandom = Math.random;
	const epoch = Date.parse("2026-09-07T10:00:00Z");
	let time = 0;
	Date.now = () => epoch + time * 60_000;
	Math.random = pairingRandom;
	try {
		const players: SessionPlayer[] = Array.from({ length: scenario.size }, (_, i) => {
			const grade = scenario.grades === "equal" ? 5 : scenario.grades === "split" ? (i % 2 ? 8 : 2) : 2 + (i * 5 % 7);
			return {
				id: `p${i}`, playerId: `p${i}`, memberId: null, name: `P${i}`,
				gender: i < scenario.women ? "F" : "M", skills: { grade: grade as SkillGrade },
				allowMixedSingle: false, status: "waiting", gameCount: 0, mixedCount: 0,
				waitSince: new Date(epoch).toISOString(), joinedAtMatch: 0, cockChecked: true,
			};
		});
		const arrivals = new Set(players.slice(-(scenario.late ?? 0)).map(p => p.id));
		if (!scenario.late) arrivals.clear();
		for (let i = players.length - 1; i > 0; i--) {
			const j = Math.floor(shuffle() * (i + 1));
			[players[i], players[j]] = [players[j], players[i]];
		}
		const active = new Set(players.filter(p => !arrivals.has(p.id)).map(p => p.id));
		const games: (Match | null)[] = Array.from({ length: scenario.courts }, () => null);
		const pending: (SessionPlayer[] | null)[] = games.map(() => null);
		const reserved = new Set<string>();
		const history: GroupHistoryEntry[] = [];
		const lastType: Record<string, GameType> = {};
		const actualGames = new Map(players.map(p => [p.id, 0]));
		const weights = { ...RECOMMEND_WEIGHTS, W_NEW_ENCOUNTER: encounterWeight };
		const waits: number[] = [];
		const spreads: number[] = [];
		const balances: number[] = [];
		let totalPlayingMinutes = 0;
		let issued = 0;
		let completed = 0;
		let multiReservationTeams = 0;
		const matchBudget = 48;
		let arrivalTime = arrivals.size ? 45 : Infinity;
		const playingIds = () => new Set(games.flatMap(g => g?.players.map(p => p.id) ?? []));
		const start = (court: number, selected: SessionPlayer[]) => {
			assert.equal(selected.length, 4);
			assert.equal(new Set(selected.map(p => p.id)).size, 4);
			const playing = playingIds();
			assert.ok(selected.every(p => !playing.has(p.id)), "a player cannot occupy two courts");
			const paired = pairPlayers(selected as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer], []);
			const byId = new Map(selected.map(p => [p.id, p]));
			const teamGrade = (ids: string[]) => ids.reduce((sum, id) => sum + byId.get(id)!.skills.grade, 0);
			balances.push(Math.abs(teamGrade(paired.teamA) - teamGrade(paired.teamB)));
			spreads.push(Math.max(...selected.map(p => p.skills.grade)) - Math.min(...selected.map(p => p.skills.grade)));
			for (const p of selected) {
				waits.push((Date.now() - Date.parse(p.waitSince!)) / 60_000);
				p.status = "playing";
				lastType[p.id] = paired.gameType;
				reserved.delete(p.id);
			}
			const duration = 10 + durationRandom() * 5;
			totalPlayingMinutes += duration;
			games[court] = { players: selected, type: paired.gameType, start: time, end: time + duration };
			pending[court] = null;
		};
		const fillCourts = () => {
			// Honor already drafted teams as soon as all their reserved players are free.
			for (let c = 0; c < games.length; c++) {
				const team = pending[c];
				if (team && team.every(p => p.status !== "playing")) start(c, team);
			}
			for (let c = 0; c < games.length && issued < matchBudget; c++) {
				if (games[c] || pending[c]) continue;
				const pool = players.filter(p => active.has(p.id) && !reserved.has(p.id));
				const selected = autoFillTeammates([], pool, {
					groupHistory: history, lastGameType: lastType, playingIds: playingIds(),
					ongoingGroups: games.flatMap(game => game ? [game.players.map(p => p.id)] : []),
				}, 4, weights, { maxPlaying });
				if (selected.length < 4) continue;
				assert.ok(selected.some(p => p.status !== "playing"), "a draft needs a waiting anchor");
				assert.equal(new Set(selected.map(p => p.id)).size, 4);
				assert.ok(selected.every(p => !reserved.has(p.id)), "no player reserved by two drafts");
				if (selected.filter(p => p.status === "playing").length > 1) multiReservationTeams++;
				issued++;
				if (selected.some(p => p.status === "playing")) {
					pending[c] = selected;
					selected.forEach(p => reserved.add(p.id));
				} else start(c, selected);
			}
		};
		fillCourts();
		while (completed < matchBudget) {
			const nextEnd = Math.min(...games.map(g => g?.end ?? Infinity));
			time = Math.min(nextEnd, arrivalTime);
			assert.ok(Number.isFinite(time), "simulation must make progress");
			if (arrivalTime <= nextEnd) {
				const baseline = Math.round(mean(players.filter(p => active.has(p.id)).map(p => p.gameCount)));
				for (const p of players.filter(p => arrivals.has(p.id))) {
					p.gameCount = baseline;
					p.waitSince = new Date(Date.now()).toISOString();
					active.add(p.id);
				}
				arrivalTime = Infinity;
			}
			for (let c = 0; c < games.length; c++) {
				const game = games[c];
				if (!game || game.end > time) continue;
				for (const p of game.players) {
					p.gameCount++;
					actualGames.set(p.id, actualGames.get(p.id)! + 1);
					p.status = "waiting";
					p.waitSince = new Date(Date.now()).toISOString();
				}
				history.push({ matchId: `m${completed++}`, members: game.players.map(p => p.id) });
				games[c] = null;
			}
			fillCourts();
		}
		assert.equal(history.length, matchBudget);
		assert.equal([...actualGames.values()].reduce((a, b) => a + b, 0), matchBudget * 4);
		const meetings = new Map(players.map(p => [p.id, new Map<string, number>()]));
		let overlap3 = 0;
		for (let i = 0; i < history.length; i++) {
			const ids = history[i].members;
			if (history.slice(0, i).some(g => g.members.filter(id => ids.includes(id)).length >= 3)) overlap3++;
			for (const id of ids) for (const other of ids) {
				if (id !== other) meetings.get(id)!.set(other, (meetings.get(id)!.get(other) ?? 0) + 1);
			}
		}
		const distinct = players.map(p => meetings.get(p.id)!.size);
		const correctedCounts = players.map(p => p.gameCount);
		const maleGames = players.filter(p => p.gender === "M" && !arrivals.has(p.id)).map(p => actualGames.get(p.id)!);
		const femaleGames = players.filter(p => p.gender === "F" && !arrivals.has(p.id)).map(p => actualGames.get(p.id)!);
		return {
			unmetPairs: scenario.size * (scenario.size - 1) / 2 - distinct.reduce((a, b) => a + b, 0) / 2,
			distinct: mean(distinct), distinctP10: quantile(distinct, 0.1),
			maxRepeat: mean(players.map(p => Math.max(0, ...meetings.get(p.id)!.values()))),
			gameStd: std(correctedCounts), gameRange: Math.max(...correctedCounts) - Math.min(...correctedCounts),
			spread: mean(spreads), balance: mean(balances), waitP95: quantile(waits, 0.95),
			utilization: totalPlayingMinutes / (scenario.courts * time), overlap3: overlap3 / completed,
			genderGap: femaleGames.length && maleGames.length ? Math.abs(mean(maleGames) - mean(femaleGames)) : 0,
			multiReservationRate: multiReservationTeams / issued,
		};
	} finally {
		Date.now = originalNow;
		Math.random = originalRandom;
	}
}

it("같은 조건에서 만남 보정과 경기중 예약 정책을 비교한다", () => {
	const seeds = Number(process.env.MIXING_SEEDS ?? 20);
	const seedStart = Number(process.env.MIXING_SEED_START ?? 1);
	const weights = (process.env.MIXING_WEIGHTS ?? "0,4,8,12").split(",").map(Number);
	// 새 팀은 대기 anchor가 필요하므로 현재 운영진 정책의 최대 예약 수는 3명이다.
	const playingLimits = (process.env.MIXING_PLAYING_LIMITS ?? "3").split(",").map(Number);
	const variants = playingLimits.flatMap(maxPlaying => weights.map(weight => ({ weight, maxPlaying })));
	assert.ok(Number.isInteger(seeds) && seeds > 0 && seeds <= 1000);
	assert.ok(weights.every(w => Number.isFinite(w) && w >= 0));
	assert.ok(playingLimits.every(n => Number.isInteger(n) && n >= 0 && n <= 3));
	const rows: unknown[] = [];
	for (const scenario of scenarios) {
		const baselineRuns: Metrics[] = [];
		for (const [variantIndex, { weight, maxPlaying }] of variants.entries()) {
			const runs = Array.from({ length: seeds }, (_, i) => simulate(scenario, seedStart + i, weight, maxPlaying));
			if (variantIndex === 0) baselineRuns.push(...runs);
			const keys = Object.keys(runs[0]) as (keyof Metrics)[];
			const averages = Object.fromEntries(keys.map(key => [key, mean(runs.map(run => run[key]))]));
			if (process.env.MIXING_VERIFY === "1" && variantIndex > 0) {
				const baseline = Object.fromEntries(keys.map(key => [key, mean(baselineRuns.map(run => run[key]))]));
				assert.ok(averages.unmetPairs <= baseline.unmetPairs, `${scenario.name}: unmet pairs must not increase`);
				assert.ok(averages.gameStd <= baseline.gameStd + 0.12, `${scenario.name}: corrected count spread`);
				assert.ok(averages.waitP95 <= baseline.waitP95 + 2.5, `${scenario.name}: p95 wait increase`);
				assert.ok(averages.utilization >= baseline.utilization - 0.04, `${scenario.name}: court utilization`);
				assert.ok(averages.balance <= baseline.balance + 1.1, `${scenario.name}: team grade sum difference`);
			}
			const pairedDeltas = Object.fromEntries(keys.map(key => {
				const deltas = runs.map((run, i) => run[key] - baselineRuns[i][key]);
				// std() uses the population divisor; n-1 here yields sample SE.
				return [key, { mean: mean(deltas), se: seeds > 1 ? std(deltas) / Math.sqrt(seeds - 1) : 0 }];
			}));
			rows.push({ scenario: scenario.name, weight, maxPlaying, averages, pairedDeltas });
			console.log(JSON.stringify({ scenario: scenario.name, weight, maxPlaying, ...Object.fromEntries(Object.entries(averages).map(([k, v]) => [k, Number(v.toFixed(3))])) }));
		}
	}
	writeFileSync(process.env.MIXING_OUTPUT ?? "/tmp/cocktime-team-mixing-sweep.json", JSON.stringify({
		seeds, seedStart, weights, playingLimits, matchesPerSession: 48, durationMinutes: [10, 15], scenarios, rows,
	}, null, 2) + "\n");
});
