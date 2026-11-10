import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// 20261109000000_match_results_elo.sql — 정적 검사(계약 문구) + 로컬 PGlite 실행.
// 운영 DB 쓰기·다중 연결 잠금 경합은 범위 밖이다(잠금 순서는 정적 검사로만 본다).
const read = (name: string) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8");
const sql = read("20261109000000_match_results_elo.sql");
const guards = read("20261012000000_board_match_guards.sql");

/** create function 블록 단위로 자른다(이름 → 본문 포함 전체 텍스트). */
function functionBlocks(text: string): Map<string, string> {
	const out = new Map<string, string>();
	const re = /create or replace function public\.(\w+)\(/g;
	const starts = [...text.matchAll(re)];
	starts.forEach((m, i) => {
		const end = i + 1 < starts.length ? starts[i + 1].index! : text.length;
		out.set(m[1], text.slice(m.index!, end));
	});
	return out;
}
const fns = functionBlocks(sql);
const body = (name: string) => {
	const b = fns.get(name);
	if (!b) throw new Error(`missing function ${name}`);
	return b;
};

describe("정적 계약", () => {
	it("계약 함수가 모두 있다", () => {
		for (const name of [
			"elo_seed", "elo_k", "_complete_match_apply", "complete_match", "_rating_apply", "_match_result_record",
			"ratings_recompute_all", "member_complete_match", "match_result_submit", "match_result_admin_set",
			"rating_my_summary", "match_my_history", "member_commit_completion_drafts",
		]) expect(fns.has(name), name).toBe(true);
	});
	it("모든 함수가 security definer + search_path = '' 이다", () => {
		for (const [name, b] of fns) {
			const header = b.slice(0, b.indexOf("$function$"));
			expect(header, name).toMatch(/security definer/);
			expect(header, name).toMatch(/set search_path = ''/);
		}
		// 트리거·함수 수와 search_path 수가 같아야 빠진 것이 없다.
		expect((sql.match(/^set search_path = ''$/gm) ?? []).length).toBe(fns.size);
	});
	it("본문에서 테이블을 public. 없이 참조하지 않는다", () => {
		const tables = ["matches", "sessions", "session_players", "members", "match_results", "member_ratings", "rating_events", "match_completion_grants"];
		for (const [name, b] of fns) {
			const code = b.replace(/--.*$/gm, "");
			for (const t of tables) {
				const bare = new RegExp(`(?:from|join|update|into)\\s+${t}\\b`, "i");
				expect(bare.test(code), `${name}: ${t}`).toBe(false);
			}
		}
	});
	it("member_complete_match 는 sessions 를 matches 보다 먼저 잠근다", () => {
		const b = body("member_complete_match");
		const lockSessions = b.search(/FROM public\.sessions WHERE id = p_session_id FOR UPDATE/);
		const touchMatches = b.search(/FROM public\.matches|_complete_match_apply\(/);
		expect(lockSessions).toBeGreaterThan(0);
		expect(lockSessions).toBeLessThan(touchMatches);
		expect(b).toMatch(/'not in match' USING ERRCODE = '42501'/);
		expect(b).toMatch(/INSERT INTO public\.match_completion_grants/);
	});
	it("complete_match 는 가드 순서(세션 잠금 → 편집 락)를 지키고 공통부만 호출한다", () => {
		const b = body("complete_match");
		const lock = b.indexOf("FROM public.sessions WHERE id = p_session_id FOR UPDATE");
		const editor = b.indexOf("public.board_assert_editor(p_session_id, p_client_id, p_name, p_lease_seconds)");
		const apply = b.indexOf("public._complete_match_apply(p_match_id, p_session_id, p_game_type)");
		expect(lock).toBeGreaterThan(0);
		expect(editor).toBeGreaterThan(lock);
		expect(apply).toBeGreaterThan(editor);
		expect(body("_complete_match_apply")).toMatch(/RAISE EXCEPTION 'Match already completed or not found'/);
	});
	it("_complete_match_apply 의 갱신 SQL 은 기존 complete_match 1·3·4·5 단계와 글자 그대로 같다", () => {
		const old = guards.slice(guards.indexOf("create or replace function public.complete_match("));
		const step = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
		const apply = body("_complete_match_apply");
		for (const [from, to] of [
			["  UPDATE public.matches m", "  IF NOT FOUND THEN"],
			["  -- 3. 선수 상태 업데이트", "  -- 4."],
			["  -- 4. 동기화 신호", "  -- 5."],
			["  RETURN QUERY", "END;"],
		]) expect(step(apply, from, to), from).toBe(step(old, from, to));
	});
	it("실행 권한: 내부 함수는 전부 회수, 회원 RPC 는 authenticated 만", () => {
		for (const internal of ["elo_seed(integer)", "elo_k(integer)", "_complete_match_apply(uuid, bigint, text)", "_rating_apply(uuid)",
			"_match_result_record(uuid, text, uuid)", "ratings_recompute_all()", "_completion_team_sets(jsonb)",
			"_completion_avoid_violation(bigint, jsonb, jsonb)"]) {
			expect(sql).toContain(`revoke execute on function public.${internal} from public, anon, authenticated;`);
			expect(sql).not.toContain(`grant execute on function public.${internal}`);
		}
		for (const rpc of ["complete_match(uuid, bigint, text, uuid, uuid, uuid, uuid, text, text, integer)", "member_complete_match(uuid, bigint, text)",
			"match_result_submit(uuid, text)", "match_result_admin_set(uuid, text)", "rating_my_summary()",
			"match_my_history(integer, timestamptz)", "member_commit_completion_drafts(bigint, uuid, bigint, jsonb)"]) {
			expect(sql).toContain(`revoke execute on function public.${rpc} from public, anon;`);
			expect(sql).toContain(`grant execute on function public.${rpc} to authenticated;`);
		}
	});
	it("RLS 는 4 테이블 모두 켜고 쓰기 정책은 없다", () => {
		for (const t of ["match_results", "member_ratings", "rating_events", "match_completion_grants"])
			expect(sql).toContain(`alter table public.${t} enable row level security;`);
		expect(sql).not.toMatch(/create policy \w+ on public\.\w+\s+for (insert|update|delete|all)/);
		expect(sql).not.toMatch(/create policy \w+ on public\.match_completion_grants/);
	});
	it("ELO 상수 1000/100/1500/0.6/0.4/400/40/20/10 이 있다", () => {
		expect(body("elo_seed")).toMatch(/1000 \+ 100 \* p_grade else 1500/);
		expect(body("elo_k")).toMatch(/< 10 then 40 else 20/);
		const apply = body("_rating_apply");
		expect(apply).toMatch(/0\.6 \* least/);
		expect(apply).toMatch(/0\.4 \* greatest/);
		expect(apply).toMatch(/\/ 400\)/);
	});
	it("commit drafts 는 편집락을 건드리지 않는다", () => {
		expect(body("member_commit_completion_drafts")).not.toMatch(/editor_client_id\s*=/);
		expect(body("member_commit_completion_drafts")).toMatch(/interval '3 minutes'/);
	});
});

// ── 실행 ──────────────────────────────────────────────────────────
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const mem = (n: number) => `00000000-0000-0000-0001-${String(n).padStart(12, "0")}`;
const ADMIN_USER = uid(9001);
let db: PGlite;

async function asMember(n: number | null) { await db.query("select set_config('test.member',$1,true)", [n == null ? "" : mem(n)]); }
async function fails(run: () => Promise<unknown>, message: RegExp) {
	await db.exec("savepoint expected_failure");
	await expect(run()).rejects.toThrow(message);
	await db.exec("rollback to savepoint expected_failure");
}
async function assign(match: number, players: number[], { court = 1, type = "남복" } = {}) {
	await db.query("select public.assign_match($1,1,$2,$3,$4,$5,$6,$7,'editor','운영진')",
		[uid(match), court, type, ...players.map(uid)]);
}
async function memberComplete(match: number, winner: string | null = null) {
	return (await db.query<{ r: { players: { id: string; status: string }[]; result: Record<string, unknown> | null; courtId: number } }>(
		"select public.member_complete_match($1,1,$2) r", [uid(match), winner])).rows[0].r;
}
async function rating(n: number) {
	return (await db.query<{ rating: number; games: number; wins: number; losses: number }>(
		"select rating,games,wins,losses from member_ratings where member_id=$1", [mem(n)])).rows[0];
}

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
			team_a_p1 uuid, team_a_p2 uuid, team_b_p1 uuid, team_b_p2 uuid, status text,
			ended_at timestamptz, player_snapshot jsonb, assigned_by text);
		create unique index one_court on public.matches(session_id, court_id) where status = 'playing';
		create table public.match_avoid_groups(id bigserial primary key, member_ids uuid[] not null, created_at timestamptz default now());
	`);
	await db.exec(guards);
	await db.exec(sql);
});
beforeEach(async () => {
	await db.exec("begin");
	await db.query("select set_config('test.user',$1,true)", [ADMIN_USER]);
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

describe("ELO 함수", () => {
	it("seed·K", async () => {
		const r = (await db.query<{ a: number; b: number; c: number; d: number; e: number }>(
			"select public.elo_seed(7) a, public.elo_seed(null) b, public.elo_seed(0) c, public.elo_k(9) d, public.elo_k(10) e")).rows[0];
		expect(r).toEqual({ a: 1700, b: 1500, c: 1500, d: 40, e: 20 });
	});
});

describe("member_complete_match", () => {
	it("로스터 회원만 완료할 수 있고, 갱신은 운영진 완료와 같다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(5);
		await fails(() => memberComplete(500), /not in match/);
		await asMember(1);
		const out = await memberComplete(500);
		expect(out.courtId).toBe(1);
		expect(out.result).toBeNull();
		expect(out.players.map(p => p.status)).toEqual(["waiting", "waiting", "waiting", "waiting"]);
		const s = (await db.query<{ match_state_version: number }>("select match_state_version from sessions where id=1")).rows[0];
		expect(s.match_state_version).toBe(2);
		expect((await db.query("select * from match_completion_grants where match_id=$1 and member_id=$2", [uid(500), mem(1)])).rows).toHaveLength(1);
		await fails(() => memberComplete(500), /Match already completed or not found/);
	});
	it("승패를 넘기면 결과를 기록하고 점수를 반영한다", async () => {
		await assign(500, [1, 4, 2, 3]); // A: 1100/1400 → 1220, B: 1200/1300 → 1240
		await asMember(1);
		const out = await memberComplete(500, "A");
		expect(out.result).toMatchObject({ winner: "A", rated: true, games: 1 });
		const ea = 1 / (1 + 10 ** ((1240 - 1220) / 400));
		const d = Math.round(40 * (1 - ea));
		expect(out.result!.delta).toBe(d);
		expect(await rating(1)).toEqual({ rating: 1100 + d, games: 1, wins: 1, losses: 0 });
		expect((await rating(2)).rating).toBe(1200 - d);
	});
	it("혼합·게스트 경기는 기록만 하고 반영하지 않는다", async () => {
		await assign(500, [1, 9, 2, 3]);
		await asMember(1);
		const out = await memberComplete(500, "B");
		expect(out.result).toMatchObject({ rated: false, delta: null });
		expect(await rating(1)).toBeUndefined();
	});
	it("세션이 진행 중이 아니면 거부한다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await db.exec("update sessions set status='completed' where id=1");
		await asMember(1);
		await fails(() => memberComplete(500), /session not active/);
	});
});

describe("complete_match (공통부 리팩터)", () => {
	it("운영진 경로는 기존처럼 선수 행을 돌려주고 grant 를 만들지 않는다", async () => {
		await assign(500, [1, 2, 3, 4], { type: "혼복" });
		const rows = (await db.query<{ id: string; game_count: number }>(
			"select id,game_count from public.complete_match($1,1,'혼복',$2,$3,$4,$5,'editor','운영진') order by id",
			[uid(500), uid(1), uid(2), uid(3), uid(4)])).rows;
		expect(rows.map(r => r.game_count)).toEqual([1, 1, 1, 1]);
		expect((await db.query("select * from match_completion_grants")).rows).toHaveLength(0);
		await fails(() => db.query("select * from public.complete_match($1,1,'남복',$2,$3,$4,$5,'other','남')",
			[uid(501), uid(1), uid(2), uid(3), uid(4)]), /./);
	});
});

describe("결과 입력·정정", () => {
	it("첫 입력이 확정, 다음 입력은 exists", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		await memberComplete(500);
		await asMember(3);
		const first = (await db.query<{ r: { status: string; winner: string } }>("select public.match_result_submit($1,'B') r", [uid(500)])).rows[0].r;
		expect(first).toMatchObject({ status: "recorded", winner: "B" });
		await asMember(2);
		const second = (await db.query<{ r: { status: string; winner: string } }>("select public.match_result_submit($1,'A') r", [uid(500)])).rows[0].r;
		expect(second).toMatchObject({ status: "exists", winner: "B" });
		await db.query("select set_config('test.user','',true)"); // 운영진이 아닌 남
		await asMember(5);
		await fails(() => db.query("select public.match_result_submit($1,'A')", [uid(500)]), /not in match/);
	});
	it("운영진 정정은 전체 재생으로 점수를 다시 만든다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		await memberComplete(500, "A");
		const won = (await rating(1)).rating;
		await db.query("select set_config('test.user','',true)");
		await fails(() => db.query("select public.match_result_admin_set($1,'B')", [uid(500)]), /admin only/);
		await db.query("select set_config('test.user',$1,true)", [ADMIN_USER]);
		const r = (await db.query<{ r: { status: string } }>("select public.match_result_admin_set($1,'B') r", [uid(500)])).rows[0].r;
		expect(r.status).toBe("corrected");
		expect((await rating(1)).rating).toBeLessThan(1100);
		expect((await rating(1)).rating).not.toBe(won);
		expect((await db.query("select * from rating_events")).rows).toHaveLength(4);
		await db.query("select public.match_result_admin_set($1,null)", [uid(500)]);
		expect((await db.query("select * from member_ratings")).rows).toHaveLength(0);
	});
});

describe("내 요약·기록", () => {
	it("행이 없으면 seed, 기록에는 canSubmit 이 뜬다", async () => {
		await asMember(7);
		const s = (await db.query<{ r: unknown }>("select public.rating_my_summary() r")).rows[0].r;
		expect(s).toEqual({ rating: 1700, games: 0, wins: 0, losses: 0, seeded: true });
		await assign(500, [1, 2, 7, 4]);
		await asMember(1);
		await memberComplete(500);
		await asMember(7);
		const h = (await db.query<{ r: Record<string, unknown>[] }>("select public.match_my_history() r")).rows[0].r;
		expect(h).toHaveLength(1);
		expect(h[0]).toMatchObject({ mySide: "B", winner: null, rated: false, canSubmit: true, delta: null });
		expect((h[0].teamB as { memberId: string }[])[0].memberId).toBe(mem(7));
	});
});

describe("member_commit_completion_drafts", () => {
	it("grant 소유자만, 버전이 맞을 때만, 한 번만 저장한다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		await memberComplete(500);
		const payload = JSON.stringify([{ teams: [], reservations: [] }]);
		const commit = (base: number) => db.query<{ r: { status: string; version: number } }>(
			"select public.member_commit_completion_drafts(1,$1,$2,$3::jsonb) r", [uid(500), base, payload]).then(x => x.rows[0].r);
		for (const bad of ["{}", "[]", "[[]]", '[{"teams":[]}]', JSON.stringify(Array(7).fill({ teams: [], reservations: [] }))]) {
			await fails(() => db.query("select public.member_commit_completion_drafts(1,$1,0,$2::jsonb)", [uid(500), bad]), /invalid payload/);
		}
		expect(await commit(7)).toEqual({ status: "stale", version: 0 });
		expect(await commit(0)).toEqual({ status: "ok", version: 1, chosen: 0 });
		await fails(() => commit(1), /no completion grant/);
		await asMember(2);
		await fails(() => commit(1), /no completion grant/);
		const s = (await db.query<{ editor_client_id: string | null }>("select editor_client_id from sessions where id=1")).rows[0];
		expect(s.editor_client_id).toBe("editor");
	});

	it("보드에 올라 있는 사람을 내리는 후보는 건너뛰고, 예비팀 옮기기·예약 승격은 통과시킨다", async () => {
		// 지금 보드: 코트1 그룹(빈) + 예비팀 Q(5,6) + 예비팀 R(7,8) 에 끝날 선수 1 의 예약(ghost).
		const board = {
			teams: [
				{ id: "C1", courtId: 1, memberIds: [], createdMs: 1 },
				{ id: "Q", memberIds: [uid(5), uid(6)], createdMs: 2 },
				{ id: "R", memberIds: [uid(7), uid(8)], createdMs: 3 },
			],
			reservations: [{ id: "g1", playerId: uid(1), teamId: "R", createdMs: 4 }],
		};
		await db.query("update sessions set board_drafts=$1::jsonb, board_drafts_version=3 where id=1", [JSON.stringify(board)]);
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		await memberComplete(500);
		const commit = (payloads: unknown[]) => db.query<{ r: { status: string; version: number } }>(
			"select public.member_commit_completion_drafts(1,$1,3,$2::jsonb) r", [uid(500), JSON.stringify(payloads)]).then(x => x.rows[0].r);
		// 전부 지우기(devtools) · 예약만 지우기 · 예비팀 한 명 빼기 — 모두 건너뛴다.
		const removing = [
			{ teams: [], reservations: [] },
			{ ...board, reservations: [] },
			{ ...board, teams: [board.teams[0], { ...board.teams[1], memberIds: [uid(5)] }, board.teams[2]] },
		];
		// 정당한 편성: Q 를 코트 그룹으로 옮기고(Q 해체), 1 의 예약을 R anchor 로 승격.
		const legit = {
			teams: [
				{ id: "C1", courtId: 1, memberIds: [uid(5), uid(6)], createdMs: 1 },
				{ id: "R", memberIds: [uid(7), uid(8), uid(1)], createdMs: 3 },
			],
			reservations: [],
		};
		// 사람을 내리는 후보가 앞에 있어도 호출 전체가 실패하지 않고 정당한 후보가 저장된다.
		expect(await commit([...removing, legit])).toEqual({ status: "ok", version: 4, chosen: 3 });
		const s = (await db.query<{ board_drafts: unknown }>("select board_drafts from sessions where id=1")).rows[0];
		expect(s.board_drafts).toEqual(legit);
	});

	it("내리는 후보뿐이면 저장 없이 rejected, grant 는 소모", async () => {
		const board = { teams: [{ id: "Q", memberIds: [uid(5), uid(6)], createdMs: 2 }], reservations: [] };
		await db.query("update sessions set board_drafts=$1::jsonb, board_drafts_version=3 where id=1", [JSON.stringify(board)]);
		await assign(500, [1, 2, 3, 4]);
		await asMember(1);
		await memberComplete(500);
		const commit = (payloads: unknown[]) => db.query<{ r: { status: string } }>(
			"select public.member_commit_completion_drafts(1,$1,3,$2::jsonb) r", [uid(500), JSON.stringify(payloads)]).then(x => x.rows[0].r);
		expect(await commit([{ teams: [], reservations: [] }])).toEqual({ status: "rejected" });
		expect((await db.query<{ board_drafts: unknown }>("select board_drafts from sessions where id=1")).rows[0].board_drafts).toEqual(board);
		await fails(() => commit([board]), /no completion grant/);
	});

	describe("후보 배열 · 같이 매칭하지 않기", () => {
		// 지금 보드: 코트1 그룹(빈) + 운영진이 둔 예비팀 Q(5,6) — 5·6 은 한 묶음이지만 이미 있던 조합이다.
		const board = {
			teams: [{ id: "C1", courtId: 1, memberIds: [] as string[], createdMs: 1 }, { id: "Q", memberIds: [uid(5), uid(6)], createdMs: 2 }],
			reservations: [] as { id: string; playerId: string; teamId: string; createdMs: number }[],
		};
		/** 코트1 그룹에 ids 를 올린 후보(Q 는 그대로). */
		const fill = (ids: number[]) => ({ ...board, teams: [{ ...board.teams[0], memberIds: ids.map(uid) }, board.teams[1]] });
		const setup = async () => {
			await db.query("update sessions set board_drafts=$1::jsonb, board_drafts_version=3 where id=1", [JSON.stringify(board)]);
			await db.query("insert into match_avoid_groups(member_ids) values($1), ($2)", [[mem(1), mem(2)], [mem(5), mem(6), mem(7)]]);
			await assign(500, [1, 2, 3, 4]);
			await asMember(1);
			await memberComplete(500);
		};
		const commit = (candidates: unknown[], base = 3) => db.query<{ r: Record<string, unknown> }>(
			"select public.member_commit_completion_drafts(1,$1,$2,$3::jsonb) r", [uid(500), base, JSON.stringify(candidates)]).then(x => x.rows[0].r);
		const saved = async () => (await db.query<{ board_drafts: typeof board; board_drafts_version: number }>(
			"select board_drafts, board_drafts_version from sessions where id=1")).rows[0];
		const grantUsed = async () => (await db.query<{ used_at: string | null }>(
			"select used_at from match_completion_grants where match_id=$1", [uid(500)])).rows[0].used_at != null;

		it("후보 0 이 묶음을 어기면 후보 1 을 저장한다", async () => {
			await setup();
			// 후보 0: 1·2(묶음)를 한 그룹에. 후보 1: 1 대신 3. 후보 2: 안전 후보(그대로).
			expect(await commit([fill([1, 2, 3, 4]), fill([3, 2, 4, 8]), board])).toEqual({ status: "ok", version: 4, chosen: 1 });
			const s = await saved();
			expect(s.board_drafts.teams[0].memberIds).toEqual([uid(3), uid(2), uid(4), uid(8)]);
			expect(await grantUsed()).toBe(true);
		});

		it("새 그룹에서 묶음 회원은 예약(ghost)으로 들어가도 센다 · 이미 있던 조합(부분집합)은 보지 않는다", async () => {
			await setup();
			// 7 을 Q 에 예약으로 붙임 → 5·6·7 묶음 3명이 새 집합 → 위반. Q 를 코트로 옮기기만 하면 통과.
			const ghost = { ...board, reservations: [{ id: "g", playerId: uid(7), teamId: "Q", createdMs: 9 }] };
			const moveQ = { teams: [{ ...board.teams[0], memberIds: [uid(5), uid(6)] }], reservations: [] };
			expect(await commit([ghost, moveQ])).toEqual({ status: "ok", version: 4, chosen: 1 });
		});

		it("전부 어기면 저장 없이 rejected — grant 는 소모해 같은 grant 로 다시 캐 볼 수 없다, 어떤 규칙인지는 드러내지 않는다", async () => {
			await setup();
			expect(await commit([fill([1, 2, 3, 4]), fill([5, 7, 3, 4])])).toEqual({ status: "rejected" });
			const s = await saved();
			expect(s.board_drafts_version).toBe(3);
			expect(s.board_drafts).toEqual(board);
			expect(await grantUsed()).toBe(true);
			// 검사는 grant 당 한 번 — 다른 후보 집합으로 다시 넣어 볼 수 없다.
			await fails(() => commit([fill([3, 4]), board]), /no completion grant/);
		});

		it("사람을 내리는 후보는 건너뛰고 다음 후보를 본다", async () => {
			await setup();
			expect(await commit([{ teams: [board.teams[0]], reservations: [] }, fill([3, 4])])).toEqual({ status: "ok", version: 4, chosen: 1 });
		});

		it("운영진이 이미 함께 둔 묶음 짝(5·6)에 다른 사람을 더하는 건 통과 — 새로 만든 짝만 위반", async () => {
			await setup();
			const grow = (extra: number) => ({ ...board, teams: [board.teams[0], { ...board.teams[1], memberIds: [uid(5), uid(6), uid(extra)] }] });
			// 7 을 더하면 5·7, 6·7 이 새 짝 → 위반. 8 을 더하면 새 짝은 묶음 밖 → 통과.
			expect(await commit([grow(7), grow(8)])).toEqual({ status: "ok", version: 4, chosen: 1 });
		});

		it("다른 그룹에서 빼 와 새로 짝지은 묶음 회원은 위반", async () => {
			await setup();
			// 5 를 Q 에서 빼 코트 그룹에서 7 과 묶는다(Q 엔 6 이 남음) — 5·7 은 새 짝.
			const pulled = { teams: [{ ...board.teams[0], memberIds: [uid(5), uid(7), uid(3), uid(4)] }, { ...board.teams[1], memberIds: [uid(6)] }], reservations: [] };
			expect(await commit([pulled, board])).toEqual({ status: "ok", version: 4, chosen: 1 });
		});

		it("stale 은 어떤 검사보다 먼저", async () => {
			await setup();
			expect(await commit([{ teams: [], reservations: [] }, fill([1, 2, 3, 4])], 2)).toEqual({ status: "stale", version: 3 });
			expect(await grantUsed()).toBe(false);
		});
	});
});
