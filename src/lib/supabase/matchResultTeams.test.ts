import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// 20261110000000_match_result_team_override.sql — 결과 입력 때 실제 편(p_team_a) 고치기.
// 20261109000000(운영 배포 완료) 위에 순서대로 적용해 로컬 PGlite 에서 돌린다.
const read = (name: string) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8");
const guards = read("20261012000000_board_match_guards.sql");
const elo = read("20261109000000_match_results_elo.sql");
const sql = read("20261110000000_match_result_team_override.sql");

function functionBlocks(text: string): Map<string, string> {
	const out = new Map<string, string>();
	const starts = [...text.matchAll(/create or replace function public\.(\w+)\(/g)];
	starts.forEach((m, i) => {
		const end = i + 1 < starts.length ? starts[i + 1].index! : text.length;
		out.set(m[1], text.slice(m.index!, end));
	});
	return out;
}
const fns = functionBlocks(sql);

describe("정적 계약", () => {
	it("모든 함수가 security definer + search_path = '' 이고 테이블을 public. 없이 참조하지 않는다", () => {
		expect(fns.size).toBeGreaterThan(0);
		for (const [name, b] of fns) {
			const header = b.slice(0, b.indexOf("$function$"));
			expect(header, name).toMatch(/security definer/);
			expect(header, name).toMatch(/set search_path = ''/);
			const code = b.replace(/--.*$/gm, "");
			for (const t of ["matches", "sessions", "session_players", "members", "match_results", "member_ratings", "rating_events", "match_completion_grants"])
				expect(new RegExp(`(?:from|join|update|into)\\s+${t}\\b`, "i").test(code), `${name}: ${t}`).toBe(false);
		}
		expect((sql.match(/^set search_path = ''$/gm) ?? []).length).toBe(fns.size);
	});
	it("옛 시그니처를 지우고 새 시그니처마다 revoke/grant 를 다시 적는다", () => {
		for (const old of ["_match_result_record(uuid, text, uuid)", "member_complete_match(uuid, bigint, text)",
			"match_result_submit(uuid, text)", "match_result_admin_set(uuid, text)"])
			expect(sql).toContain(`drop function if exists public.${old};`);
		for (const sig of ["member_complete_match(uuid, bigint, text, uuid[])", "match_result_submit(uuid, text, uuid[])",
			"match_result_admin_set(uuid, text, uuid[])", "match_my_history(integer, timestamptz)"]) {
			expect(sql).toContain(`revoke execute on function public.${sig} from public, anon;`);
			expect(sql).toContain(`grant execute on function public.${sig} to authenticated;`);
		}
		for (const sig of ["_match_teams_array(jsonb)", "_match_split(uuid, uuid[])", "_pair_key(uuid[])",
			"_match_slot_json(jsonb, uuid)", "_match_result_record(uuid, text, uuid, uuid[])"])
			expect(sql).toContain(`revoke execute on function public.${sig} from public, anon, authenticated;`);
		expect(sql).not.toMatch(/grant execute on function public\._/);
	});
	it("배포된 20261109000000 은 이 기능 때문에 바뀌지 않았다(p_team_a 없음)", () => {
		expect(elo).not.toMatch(/p_team_a uuid\[\]/);
		expect(elo).not.toMatch(/\bteams jsonb\b/);
	});
});

// ── 실행 ──────────────────────────────────────────────────────────
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const mem = (n: number) => `00000000-0000-0000-0001-${String(n).padStart(12, "0")}`;
const ADMIN_USER = uid(9001);
let db: PGlite;

type Json = Record<string, unknown>;
async function asMember(n: number | null) { await db.query("select set_config('test.member',$1,true)", [n == null ? "" : mem(n)]); }
async function asAdmin(on: boolean) { await db.query("select set_config('test.user',$1,true)", [on ? ADMIN_USER : ""]); }
async function fails(run: () => Promise<unknown>, message: RegExp) {
	await db.exec("savepoint expected_failure");
	await expect(run()).rejects.toThrow(message);
	await db.exec("rollback to savepoint expected_failure");
}
async function assign(match: number, players: number[], { court = 1, type = "남복" } = {}) {
	await db.query("select public.assign_match($1,1,$2,$3,$4,$5,$6,$7,'editor','운영진')",
		[uid(match), court, type, ...players.map(uid)]);
}
async function memberComplete(match: number, winner: string | null, teamA: number[] | null = null) {
	return (await db.query<{ r: { result: Json | null } }>("select public.member_complete_match($1,1,$2,$3::uuid[]) r",
		[uid(match), winner, teamA?.map(uid) ?? null])).rows[0].r;
}
async function submit(match: number, winner: string, teamA: number[] | null = null) {
	return (await db.query<{ r: Json }>("select public.match_result_submit($1,$2,$3::uuid[]) r",
		[uid(match), winner, teamA?.map(uid) ?? null])).rows[0].r;
}
async function adminSet(match: number, winner: string | null, teamA: number[] | null = null) {
	return (await db.query<{ r: Json }>("select public.match_result_admin_set($1,$2,$3::uuid[]) r",
		[uid(match), winner, teamA?.map(uid) ?? null])).rows[0].r;
}
async function ratings() {
	const rows = (await db.query<{ member_id: string; rating: number; games: number; wins: number }>(
		"select member_id,rating,games,wins from member_ratings order by member_id")).rows;
	return Object.fromEntries(rows.map((r) => [r.member_id, { rating: r.rating, games: r.games, wins: r.wins }]));
}
async function events() {
	return (await db.query<{ match_id: string; member_id: string; before: number; after: number; delta: number }>(
		"select match_id,member_id,before,after,delta from rating_events order by match_id, member_id")).rows;
}
async function history(n: number) {
	await asMember(n);
	return (await db.query<{ r: Json[] }>("select public.match_my_history() r")).rows[0].r;
}
const ids = (side: unknown) => (side as { memberId: string }[]).map((p) => p.memberId).sort();

beforeAll(async () => {
	db = new PGlite();
	await db.exec(`
		create role anon; create role authenticated;
		create schema auth;
		create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user', true), '')::uuid$$;
		create function public.is_admin() returns boolean language sql as $$select coalesce(auth.uid()='${ADMIN_USER}'::uuid, false)$$;
		create function public.current_member_id() returns uuid language sql as $$select nullif(current_setting('test.member', true), '')::uuid$$;
		create table public.members(id uuid primary key, name text, gender text, skills jsonb default '{}');
		create table public.sessions(id bigint primary key, is_active boolean default true, status text default 'active',
			editor_client_id text, editor_name text, editor_lease_until timestamptz,
			match_assign_count int default 0, match_state_version int default 0,
			board_drafts jsonb default '{"teams":[],"reservations":[]}', board_drafts_version bigint default 0);
		create table public.session_players(id uuid primary key, session_id bigint references public.sessions, name text,
			gender text default 'M', skills jsonb default '{}', status text default 'waiting', cock_checked boolean default true,
			wait_since timestamptz, game_count int default 0, mixed_count int default 0, member_id uuid references public.members);
		create table public.matches(id uuid primary key, session_id bigint references public.sessions, court_id int, game_type text,
			-- 운영과 같이 선수 행 삭제 → 로스터 칸 NULL(20260616000000 FK ON DELETE SET NULL).
			team_a_p1 uuid references public.session_players on delete set null, team_a_p2 uuid references public.session_players on delete set null,
			team_b_p1 uuid references public.session_players on delete set null, team_b_p2 uuid references public.session_players on delete set null, status text,
			ended_at timestamptz, player_snapshot jsonb, assigned_by text);
		create unique index one_court on public.matches(session_id, court_id) where status = 'playing';
		create table public.match_avoid_groups(id bigserial primary key, member_ids uuid[] not null, created_at timestamptz default now());
	`);
	await db.exec(guards);
	await db.exec(elo);
	await db.exec(sql);
});
beforeEach(async () => {
	await db.exec("begin");
	await asAdmin(true);
	await db.exec("insert into sessions(id) values(1)");
	// 회원 1~8: grade = 번호(1→1100 … 8→1800). 9 는 게스트(member_id 없음).
	for (let i = 1; i <= 8; i++) {
		await db.query("insert into members(id,name,skills) values($1,$2,$3)", [mem(i), `m${i}`, JSON.stringify({ grade: i })]);
		await db.query("insert into session_players(id,session_id,name,member_id) values($1,1,$2,$3)", [uid(i), `m${i}`, mem(i)]);
	}
	await db.query("insert into session_players(id,session_id,name) values($1,1,'guest')", [uid(9)]);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });

describe("실제 편 고치기", () => {
	it("보드 나눔(1·2 vs 3·4)과 다른 실제 편(1·4 vs 2·3)으로 점수가 매겨진다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		// 실제 A = 1·4(1100/1400 → 1220), B = 2·3(1200/1300 → 1240). A 승.
		const out = await memberComplete(500, "A", [4, 1]);
		const ea = 1 / (1 + 10 ** ((1240 - 1220) / 400));
		const d = Math.round(40 * (1 - ea));
		expect(out.result).toMatchObject({ winner: "A", rated: true, delta: d });
		const r = await ratings();
		expect(r[mem(1)]).toEqual({ rating: 1100 + d, games: 1, wins: 1 });
		expect(r[mem(4)]).toEqual({ rating: 1400 + d, games: 1, wins: 1 });
		expect(r[mem(2)]).toEqual({ rating: 1200 - d, games: 1, wins: 0 });
		expect(r[mem(3)]).toEqual({ rating: 1300 - d, games: 1, wins: 0 });
		const row = (await db.query<Json>("select a1,a2,b1,b2,teams from match_results")).rows[0];
		// 편 안의 순서는 로스터 순으로 맞춘다(4,1 로 보내도 1,4).
		expect(row).toEqual({ a1: mem(1), a2: mem(4), b1: mem(2), b2: mem(3), teams: [uid(1), uid(4), uid(2), uid(3)] });
		// 보드 로스터는 그대로다.
		const m = (await db.query<Json>("select team_a_p1,team_a_p2,team_b_p1,team_b_p2 from matches")).rows[0];
		expect(m).toEqual({ team_a_p1: uid(1), team_a_p2: uid(2), team_b_p1: uid(3), team_b_p2: uid(4) });
	});

	it("p_team_a 를 안 보내면 보드 나눔 그대로", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		await memberComplete(500, "B");
		const row = (await db.query<Json>("select a1,a2,b1,b2,teams,winner from match_results")).rows[0];
		expect(row).toEqual({ a1: mem(1), a2: mem(2), b1: mem(3), b2: mem(4), teams: [uid(1), uid(2), uid(3), uid(4)], winner: "B" });
	});

	it("잘못된 편은 22023 'invalid teams' — 완료까지 함께 되돌린다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		for (const bad of [[1], [1, 1], [1, 5], [1, 2, 3], []])
			await fails(() => memberComplete(500, "A", bad), /invalid teams/);
		const st = (await db.query<{ status: string }>("select status from matches where id=$1", [uid(500)])).rows[0];
		expect(st.status).toBe("playing");
		await fails(() => db.query("select public.member_complete_match($1,1,'A',array[$2::uuid,null]::uuid[])", [uid(500), uid(1)]), /invalid teams/);
		await memberComplete(500, null);
		await asMember(2);
		await fails(() => submit(500, "A", [1, 9]), /invalid teams/);
		await fails(() => submit(500, "A", [2, 2]), /invalid teams/);
		expect((await db.query("select * from match_results")).rows).toHaveLength(0);
		await asAdmin(true);
		await fails(() => adminSet(500, "A", [5, 6]), /invalid teams/);
	});

	it("보충(match_result_submit)도 실제 편을 받고, 이미 있으면 편도 바꾸지 않는다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		await memberComplete(500, null);
		await asMember(3);
		expect(await submit(500, "B", [1, 3])).toMatchObject({ status: "recorded", winner: "B" });
		await asMember(2);
		expect(await submit(500, "A", [1, 2])).toMatchObject({ status: "exists", winner: "B" });
		const row = (await db.query<Json>("select teams from match_results")).rows[0];
		expect(row.teams).toEqual([uid(1), uid(3), uid(2), uid(4)]);
		const r = await ratings();
		expect(r[mem(2)].wins + r[mem(4)].wins).toBe(2);
		expect(r[mem(1)].wins + r[mem(3)].wins).toBe(0);
	});

	it("내 기록의 teamA/teamB/mySide 는 실제 편을 따른다(결과 없으면 보드 나눔)", async () => {
		await assign(500, [1, 2, 3, 4]);
		await assign(501, [5, 6, 7, 8], { court: 2 });
		await asMember(1);
		await memberComplete(500, "A", [1, 3]);
		await asMember(5);
		await memberComplete(501, null);

		const h3 = await history(3);
		expect(h3).toHaveLength(1);
		expect(h3[0]).toMatchObject({ mySide: "A", winner: "A" }); // 보드에선 B 였던 3 이 실제로 A편에서 이겼다
		expect(ids(h3[0].teamA)).toEqual([mem(1), mem(3)].sort());
		expect(ids(h3[0].teamB)).toEqual([mem(2), mem(4)].sort());
		expect((h3[0].teamA as { spId: string }[]).map((p) => p.spId)).toEqual([uid(1), uid(3)]);
		const h2 = await history(2);
		expect(h2[0]).toMatchObject({ mySide: "B" });
		expect(h2[0].delta).toBeLessThan(0);

		const h7 = await history(7);
		expect(h7[0]).toMatchObject({ mySide: "B", winner: null, canSubmit: true });
		expect((h7[0].teamA as { spId: string; name: string }[]).map((p) => [p.spId, p.name])).toEqual([[uid(5), "m5"], [uid(6), "m6"]]);
	});

	it("선수 행이 지워져도 기록 이름은 스냅샷에서 같은 id 로 찾는다", async () => {
		await assign(500, [1, 2, 3, 9]);
		await asMember(1);
		await memberComplete(500, "A", [1, 9]);
		await db.query("delete from session_players where id=$1", [uid(9)]);
		const h = await history(1);
		expect((h[0].teamA as { name: string; memberId: string | null }[]).map((p) => [p.name, p.memberId])).toEqual([["m1", mem(1)], ["guest", null]]);
		expect(h[0]).toMatchObject({ rated: false, mySide: "A" });
	});

	it("결과 없는 경기에서 선수 행이 지워져(로스터 칸 NULL) 도 이름·spId 는 스냅샷 같은 자리에서 찾는다", async () => {
		await assign(500, [1, 2, 3, 9]);
		await asMember(1);
		await memberComplete(500, null);
		await db.query("delete from session_players where id=$1", [uid(9)]);
		expect((await db.query<Json>("select team_b_p2 from matches")).rows[0].team_b_p2).toBeNull();
		const h = await history(1);
		expect(h[0]).toMatchObject({ winner: null, canSubmit: true, mySide: "A" });
		expect((h[0].teamB as { spId: string; name: string; memberId: string | null }[]).map((p) => [p.spId, p.name, p.memberId]))
			.toEqual([[uid(3), "m3", mem(3)], [uid(9), "guest", null]]);
		// 보충 때 지워진 선수를 짝으로 골라도 스냅샷 id 로 받는다.
		await asMember(2);
		expect(await submit(500, "B", [1, 9])).toMatchObject({ status: "recorded" });
		expect((await db.query<Json>("select teams from match_results")).rows[0].teams).toEqual([uid(1), uid(9), uid(2), uid(3)]);
		const h2 = await history(2);
		expect((h2[0].teamA as { name: string }[]).map((p) => p.name)).toEqual(["m1", "guest"]);
	});
});

describe("운영진 정정 · 재생", () => {
	it("편을 바꾸면 a1..b2·teams 를 고치고 전체 재생, 같은 결과(표기만 다름)는 unchanged", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		await memberComplete(500, "A"); // 보드 나눔: 1·2 승
		await asAdmin(true);
		expect(await adminSet(500, "A")).toMatchObject({ status: "unchanged" });
		// 3·4 를 A 로 적고 B(1·2) 승 = 같은 결과.
		expect(await adminSet(500, "B", [3, 4])).toMatchObject({ status: "unchanged" });
		// 실제로는 1·3 vs 2·4, 1·3 승.
		expect(await adminSet(500, "A", [1, 3])).toMatchObject({ status: "corrected", winner: "A" });
		const row = (await db.query<Json>("select a1,a2,b1,b2,teams,corrected_by from match_results")).rows[0];
		expect(row).toMatchObject({ a1: mem(1), a2: mem(3), b1: mem(2), b2: mem(4), teams: [uid(1), uid(3), uid(2), uid(4)] });
		const r = await ratings();
		expect([r[mem(1)].wins, r[mem(3)].wins, r[mem(2)].wins, r[mem(4)].wins]).toEqual([1, 1, 0, 0]);
		// 승자만 고치면(p_team_a NULL) 기록된 편(1·3 vs 2·4)을 유지한다.
		expect(await adminSet(500, "B")).toMatchObject({ status: "corrected", winner: "B" });
		expect((await db.query<Json>("select teams from match_results")).rows[0].teams).toEqual([uid(1), uid(3), uid(2), uid(4)]);
		const r2 = await ratings();
		expect([r2[mem(2)].wins, r2[mem(4)].wins, r2[mem(1)].wins, r2[mem(3)].wins]).toEqual([1, 1, 0, 0]);
	});

	it("선수 행이 지워진 뒤 승자만 고쳐도 기록 때 멤버를 유지하고 재생이 그 경기를 빼먹지 않는다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		await memberComplete(500, "A");
		await db.query("delete from session_players where id=$1", [uid(4)]);
		await asAdmin(true);
		expect(await adminSet(500, "B")).toMatchObject({ status: "corrected", winner: "B" });
		const row = (await db.query<Json>("select a1,a2,b1,b2,teams,rated from match_results")).rows[0];
		expect(row).toEqual({ a1: mem(1), a2: mem(2), b1: mem(3), b2: mem(4), teams: [uid(1), uid(2), uid(3), uid(4)], rated: true });
		expect(await events()).toHaveLength(4);
		const r = await ratings();
		expect([r[mem(3)].wins, r[mem(4)].wins, r[mem(1)].wins, r[mem(2)].wins]).toEqual([1, 1, 0, 0]);
		// 편까지 고쳐도(지워진 4 를 1 의 짝으로) 멤버는 자리만 옮긴다.
		expect(await adminSet(500, "A", [1, 4])).toMatchObject({ status: "corrected" });
		const row2 = (await db.query<Json>("select a1,a2,b1,b2,teams from match_results")).rows[0];
		expect(row2).toEqual({ a1: mem(1), a2: mem(4), b1: mem(2), b2: mem(3), teams: [uid(1), uid(4), uid(2), uid(3)] });
		expect(await events()).toHaveLength(4);
		expect((await ratings())[mem(4)]).toMatchObject({ games: 1, wins: 1 });
	});

	it("teams NULL(이전 행) + 지워진 선수: 정정이 스냅샷 id 로 기록 때 멤버를 잇는다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		await memberComplete(500, "A");
		await db.exec("update match_results set teams = null");
		await db.query("delete from session_players where id=$1", [uid(2)]);
		await asAdmin(true);
		expect(await adminSet(500, "A")).toMatchObject({ status: "unchanged" });
		expect(await adminSet(500, "B")).toMatchObject({ status: "corrected" });
		const row = (await db.query<Json>("select a1,a2,b1,b2,teams from match_results")).rows[0];
		expect(row).toEqual({ a1: mem(1), a2: mem(2), b1: mem(3), b2: mem(4), teams: [uid(1), uid(2), uid(3), uid(4)] });
		expect(await events()).toHaveLength(4);
	});

	it("결과 없는 경기에 운영진이 편과 함께 넣을 수 있다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		await memberComplete(500, null);
		await asAdmin(true);
		await asMember(null);
		expect(await adminSet(500, "B", [2, 4])).toMatchObject({ status: "recorded" });
		expect((await db.query<Json>("select a1,a2,b1,b2 from match_results")).rows[0]).toEqual({ a1: mem(2), a2: mem(4), b1: mem(1), b2: mem(3) });
	});

	it("편을 고친 여러 경기에서 전체 재생 = 증분 반영", async () => {
		await assign(500, [1, 2, 3, 4]);
		await assign(501, [5, 6, 7, 8], { court: 2 });
		await asMember(1);
		await memberComplete(500, "A", [1, 4]);
		await asMember(5);
		await memberComplete(501, "B", [5, 8]);
		await assign(502, [1, 5, 2, 6]);
		await asMember(2);
		await memberComplete(502, "A", [2, 5]);
		await assign(503, [3, 7, 4, 8], { court: 2 });
		await asMember(3);
		await memberComplete(503, null);
		await asMember(8);
		await submit(503, "A", [3, 8]);

		const incR = await ratings();
		const incE = await events();
		expect(incE).toHaveLength(16);
		await db.exec("select public.ratings_recompute_all()");
		expect(await ratings()).toEqual(incR);
		expect(await events()).toEqual(incE);
	});

	it("이 파일 이전에 기록된 행(teams NULL)은 보드 나눔으로 읽는다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		await memberComplete(500, "A");
		await db.exec("update match_results set teams = null");
		const h = await history(3);
		expect(h[0]).toMatchObject({ mySide: "B", winner: "A" });
		await asAdmin(true);
		expect(await adminSet(500, "A")).toMatchObject({ status: "unchanged" });
		expect(await adminSet(500, "A", [1, 3])).toMatchObject({ status: "corrected" });
	});
});
