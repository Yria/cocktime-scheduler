/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionPlayer } from "../../types";
import { autoFillTeammates, recommendTeammates, RECOMMEND_WEIGHTS } from "./recommendTeammates";

// Finite exhaustive checks support the general proofs in TEAM_MATCHING_MATH.md.
// Count populations are multisets: averaging is invariant to participant order.
function populations(maxSize: number, maxCount: number): number[][] {
	const result: number[][] = [];
	function visit(prefix: number[], minimum: number) {
		if (prefix.length > 0) result.push(prefix);
		if (prefix.length === maxSize) return;
		for (let count = minimum; count <= maxCount; count++) {
			visit([...prefix, count], count);
		}
	}
	visit([], 0);
	return result;
}

const cases = populations(6, 8).map((counts, index) => ({ id: index + 1, counts }));
// Exact nonnegative half-up rounding: avoids a floating-point oracle near .5.
const roundedMean = (sum: number, n: number) => Math.floor((2 * sum + n) / (2 * n));
let db: PGlite;
let baselines: Map<number, number>;

beforeAll(async () => {
	db = new PGlite();
	await db.exec(`
		create role anon;
		create role authenticated;
		create table public.sessions(id bigint primary key, cock_check_enabled boolean not null);
		create table public.session_players(
			id uuid primary key default gen_random_uuid(), session_id bigint references public.sessions(id),
			player_id text not null, game_count integer not null default 0,
			status text not null default 'waiting', cock_checked boolean not null default false,
			wait_since timestamptz, unique(session_id,player_id)
		);
		create table test_cases(id bigint primary key, counts integer[] not null);
	`);
	await db.exec(readFileSync(new URL("../../../supabase/migrations/20260907040000_late_join_game_count.sql", import.meta.url), "utf8"));
	await db.query(`insert into test_cases select * from jsonb_to_recordset($1::jsonb) as c(id bigint,counts integer[])`, [JSON.stringify(cases)]);
	await db.exec(`
		insert into public.sessions select id,false from test_cases;
		-- Seed established counts, without treating them as fresh arrivals.
		alter table public.session_players disable trigger trg_sp_apply_join_baseline;
		insert into public.session_players(session_id,player_id,game_count)
		select c.id,p.ordinality::text,p.count from test_cases c,
		lateral unnest(c.counts) with ordinality as p(count,ordinality);
		alter table public.session_players enable trigger trg_sp_apply_join_baseline;
	`);
	const inserted = await db.query<{ session_id: number; game_count: number }>(`
		insert into public.session_players(session_id,player_id)
		select id,'late-1' from test_cases returning session_id,game_count
	`);
	baselines = new Map(inserted.rows.map(row => [row.session_id, row.game_count]));
}, 30_000);

afterAll(async () => {
	vi.useRealTimers();
	await db?.close();
});

describe("늦참 평균 보정의 수학적 성질과 한계", () => {
	it("실제 SQL: 5,004개 판수 집합에서 평균 오차 ≤ 0.5판, 기존 최소·최대 범위 유지", () => {
		expect(cases).toHaveLength(5_004);
		expect(baselines.size).toBe(cases.length);
		let worstError = 0;
		for (const { id, counts } of cases) {
			const sum = counts.reduce((a, b) => a + b, 0);
			const n = counts.length;
			const baseline = baselines.get(id)!;
			assert.equal(baseline, roundedMean(sum, n));
			assert.ok(2 * Math.abs(n * baseline - sum) <= n, `mean error: case ${id}`);
			assert.ok(baseline >= counts[0] && baseline <= counts[n - 1]);
			worstError = Math.max(worstError, Math.abs(n * baseline - sum) / n);
		}
		expect(worstError).toBe(0.5);
		expect(worstError * RECOMMEND_WEIGHTS.W_GAME).toBe(5);
	});

	it("변화 없이 1~20명 추가하는 100,080개 경우: 기준 유지, 평균 이동 ≤ 0.5판, 분산 비증가", () => {
		let checked = 0;
		for (const { id, counts } of cases) {
			const sum = counts.reduce((a, b) => a + b, 0);
			const squares = counts.reduce((a, b) => a + b * b, 0);
			const n = counts.length;
			const baseline = baselines.get(id)!;
			for (let k = 1; k <= 20; k++) {
				assert.equal(roundedMean(sum + k * baseline, n + k), baseline);
				// |(S+kr)/(n+k) - S/n| <= 1/2, using exact integer products.
				assert.ok(2 * k * Math.abs(n * baseline - sum) <= n * (n + k));
				const oldVarianceNumerator = n * squares - sum * sum;
				const newVarianceNumerator = (n + k) * (squares + k * baseline ** 2) - (sum + k * baseline) ** 2;
				assert.ok(newVarianceNumerator * n ** 2 <= oldVarianceNumerator * (n + k) ** 2);
				checked++;
			}
		}
		expect(checked).toBe(100_080);
	});

	it("실제 SQL로 각 집합에 4명을 더 추가해도 최초 합류 기준을 유지한다", async () => {
		for (let k = 2; k <= 5; k++) {
			const inserted = await db.query<{ session_id: number; game_count: number }>(`
				insert into public.session_players(session_id,player_id)
				select id,$1 from test_cases returning session_id,game_count
			`, [`late-${k}`]);
			assert.equal(inserted.rows.length, cases.length);
			for (const row of inserted.rows) assert.equal(row.game_count, baselines.get(row.session_id));
		}
	}, 30_000);

	it("기존 각 선수가 진행 중인 판을 최대 한 번 마치면 직전·직후 기준 차이는 0 또는 1판", () => {
		let sawOneGameGap = false;
		for (const { id, counts } of cases) {
			const sum = counts.reduce((a, b) => a + b, 0);
			for (let p = 0; p <= counts.length; p++) {
				const gap = roundedMean(sum + p, counts.length) - baselines.get(id)!;
				assert.ok(gap === 0 || gap === 1);
				if (gap === 1) sawOneGameGap = true;
			}
		}
		expect(sawOneGameGap).toBe(true);
	});

	it("실제 SQL 반례: 4판인 기존 8명의 경기 완료 직전 합류는 4판, 직후 합류는 5판", async () => {
		await db.exec(`
			insert into public.sessions values(9001,true),(9002,true);
			insert into public.session_players(session_id,player_id,game_count,status,cock_checked)
			select s.id,p::text,4,'playing',true from public.sessions s,generate_series(1,8) p
			where s.id in (9001,9002);
			insert into public.session_players(session_id,player_id)
			values(9001,'late'),(9002,'late');
		`);
		const before = await db.query<{ game_count: number }>(`
			select game_count from public.set_cock_checked(
				(select id from public.session_players where session_id=9001 and player_id='late'))
		`);
		// The completion event adds one count per incumbent. This isolates the
		// baseline calculation; complete_match itself has its own integration tests.
		await db.exec(`update public.session_players set game_count=game_count+1,status='waiting'
			where session_id in (9001,9002) and player_id <> 'late'`);
		const after = await db.query<{ game_count: number }>(`
			select game_count from public.set_cock_checked(
				(select id from public.session_players where session_id=9002 and player_id='late'))
		`);
		expect(before.rows[0].game_count).toBe(4);
		expect(after.rows[0].game_count).toBe(5);
	});

	it("같은 판수·같은 다른 비용이면 기존 대기자의 기다린 시간을 보존한다", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-07T10:00:00Z"));
		const old = player("old", 3, 10);
		const late = player("late", 3);
		const ranked = recommendTeammates([], [late, old], emptyContext());
		const novelty = RECOMMEND_WEIGHTS.W_NEW_ENCOUNTER ?? 0;
		expect(ranked.map(row => [row.player.id, row.score])).toEqual([["old", 20 - novelty], ["late", 30 - novelty]]);
		vi.useRealTimers();
	});

	it("실제 추천 반례: 평균 보정을 해도 이력이 없는 늦참자가 더 적게 뛴 기존자보다 먼저 뽑힐 수 있다", () => {
		const seed = player("seed", 3);
		const old = player("old", 2);
		const late = player("late", 3); // Population [2,3,3,4] has mean 3.
		const context = {
			...emptyContext(),
			groupHistory: [
				{ matchId: "m1", members: ["seed", "old", "a", "b"] },
				{ matchId: "m2", members: ["seed", "old", "c", "d"] },
			],
		};
		const ranked = recommendTeammates([seed], [old, late], context);
		expect(ranked.map(row => [row.player.id, row.score])).toEqual([["late", 30 - (RECOMMEND_WEIGHTS.W_NEW_ENCOUNTER ?? 0)], ["old", 36]]);
		expect(autoFillTeammates([seed], [old, late], context, 1).map(p => p.id)).toEqual(["late"]);
	});
});

function player(id: string, gameCount: number, waitMinutes = 0): SessionPlayer {
	return {
		id, playerId: id, memberId: null, name: id, gender: "M", skills: { grade: 5 },
		allowMixedSingle: false, status: "waiting", gameCount, mixedCount: 0,
		waitSince: waitMinutes ? new Date(Date.now() - waitMinutes * 60_000).toISOString() : null,
		joinedAtMatch: 0, cockChecked: true,
	};
}

function emptyContext() {
	return { groupHistory: [], lastGameType: {}, playingIds: new Set<string>() };
}
