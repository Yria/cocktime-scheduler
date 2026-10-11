import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { matchGuardMessage } from "./actions";

// 20261012000000_board_match_guards.sql 의 실제 함수 본문을 로컬 PGlite 에서 실행한다.
// 운영 DB 쓰기·다중 연결 잠금 경합은 범위 밖이다.
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const migration = readFileSync(new URL("../../../supabase/migrations/20261012000000_board_match_guards.sql", import.meta.url), "utf8");
const ADMIN = uid(1), MEMBER = uid(2);
let db: PGlite;

async function as(user: string) { await db.query("select set_config('test.user',$1,true)", [user]); }
async function assign(match: number, players: (number | null)[], { court = 1, session = 1, client = "editor" as string | null } = {}) {
	await db.query("select public.assign_match($1,$2,$3,'남복',$4,$5,$6,$7,$8,'운영진')",
		[uid(match), session, court, ...players.map(p => p == null ? null : uid(p)), client]);
}
async function roster(match: number, players: number[], removed: number[] = [], added: number[] = []) {
	return (await db.query<{ id: string; status: string }>("select id,status from public.set_match_roster($1,1,$2,$3,$4,$5,$6::uuid[],$7::uuid[],'editor','운영진') order by id",
		[uid(match), ...players.map(uid), removed.map(uid), added.map(uid)])).rows;
}
async function complete(match: number, players: number[], { session = 1, client = "editor" as string | null } = {}) {
	return (await db.query<{ id: string }>("select id from public.complete_match($1,$2,'남복',$3,$4,$5,$6,$7,'운영진') order by id",
		[uid(match), session, ...players.map(uid), client])).rows.map(r => r.id);
}
async function status(n: number) {
	return (await db.query<{ status: string; game_count: number }>("select status,game_count from session_players where id=$1", [uid(n)])).rows[0];
}
async function fails(run: () => Promise<unknown>, message: RegExp) {
	await db.exec("savepoint expected_failure");
	await expect(run()).rejects.toThrow(message);
	await db.exec("rollback to savepoint expected_failure");
}

beforeAll(async () => {
	db = new PGlite();
	await db.exec(`
		create role anon; create role authenticated;
		create schema auth;
		create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user', true), '')::uuid$$;
		create function public.is_admin() returns boolean language sql as $$select auth.uid()='${ADMIN}'::uuid$$;
		create table public.sessions(id bigint primary key, is_active boolean default true, status text default 'active',
			editor_client_id text, editor_name text, editor_lease_until timestamptz,
			match_assign_count int default 0, match_state_version int default 0);
		create table public.session_players(id uuid primary key, session_id bigint references public.sessions, name text,
			gender text default 'M', skills jsonb default '{}', status text default 'waiting', cock_checked boolean default true,
			wait_since timestamptz, game_count int default 0, mixed_count int default 0);
		create table public.matches(id uuid primary key, session_id bigint references public.sessions, court_id int, game_type text,
			team_a_p1 uuid, team_a_p2 uuid, team_b_p1 uuid, team_b_p2 uuid, status text,
			ended_at timestamptz, player_snapshot jsonb, assigned_by text);
		create unique index one_court on public.matches(session_id, court_id) where status = 'playing';
	`);
	await db.exec(migration);
});
beforeEach(async () => {
	await db.exec("begin");
	await as(ADMIN);
	await db.exec("insert into sessions(id) values(1),(2)");
	for (let i = 1; i <= 10; i++) await db.query("insert into session_players(id,session_id,name) values($1,1,$2)", [uid(i), String(i)]);
	await db.query("insert into session_players(id,session_id,name) values($1,2,'other')", [uid(20)]);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });

describe("assign_match 가드", () => {
	it("휴식·콕 미확인 선수도 기존처럼 시작할 수 있다", async () => {
		await db.query("update session_players set status='resting' where id=$1", [uid(1)]);
		await db.query("update session_players set cock_checked=false where id=$1", [uid(2)]);
		await assign(500, [1, 2, 3, 4]);
		expect((await Promise.all([1, 2, 3, 4].map(status))).map(s => s.status)).toEqual(["playing", "playing", "playing", "playing"]);
		const s = (await db.query<{ match_assign_count: number; match_state_version: number }>("select * from sessions where id=1")).rows[0];
		expect([s.match_assign_count, s.match_state_version]).toEqual([1, 1]);
	});
	it("빈 자리·중복 선수는 거부한다", async () => {
		await fails(() => assign(500, [1, 2, 3, null]), /four distinct players required/);
		await fails(() => assign(500, [1, 2, 3, 3]), /four distinct players required/);
	});
	it("다른 진행 경기의 선수를 넣으면 아무것도 남기지 않고 거부한다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await fails(() => assign(501, [4, 5, 6, 7], { court: 2 }), /players already playing/);
		expect((await db.query("select * from matches")).rows).toHaveLength(1);
		expect((await status(5)).status).toBe("waiting");
	});
	it("다른 세션 선수·status 만 경기중인 선수는 'players not ready'", async () => {
		await fails(() => assign(500, [1, 2, 3, 20]), /players not ready/);
		await db.query("update session_players set status='playing' where id=$1", [uid(4)]);
		await fails(() => assign(500, [1, 2, 3, 4]), /players not ready/);
	});
	it("배포 시 진행 경기 없이 'playing' 으로 남은 선수(옛 완료 경로의 어긋남)를 대기로 되돌린다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await db.query("update session_players set status='playing' where id=any($1::uuid[])", [[uid(5), uid(20)]]);
		await db.exec("update sessions set is_active=false, status='closed' where id=2");
		await db.exec(migration); // 재실행해도 함수 정의는 같고 정리 UPDATE 만 다시 돈다
		expect((await status(5)).status).toBe("waiting");
		expect((await Promise.all([1, 2, 3, 4].map(status))).map(s => s.status)).toEqual(["playing", "playing", "playing", "playing"]);
		expect((await status(20)).status).toBe("playing"); // 종료된 세션 기록은 건드리지 않는다
		await assign(501, [5, 6, 7, 8], { court: 2 });
	});
	it("종료된 세션에는 배정하지 않는다", async () => {
		await db.exec("update sessions set is_active=false, status='closed' where id=1");
		await fails(() => assign(500, [1, 2, 3, 4]), /session closed/);
	});
	it("코트 선점은 기존 문구를 유지한다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await fails(() => assign(501, [5, 6, 7, 8]), /court already assigned/);
	});
});

describe("set_match_roster 가드", () => {
	it("클라가 넘긴 removed/added 를 무시하고 서버 로스터로 계산한다", async () => {
		await assign(500, [1, 2, 3, 4]);
		// 낡은 화면: 실제로 빠지는 4번 대신 1번을 빠진다고, 들어오는 5번 대신 6번을 넣는다고 보냄
		const changed = await roster(500, [1, 2, 3, 5], [1], [6]);
		expect(changed.map(r => [r.id, r.status])).toEqual([[uid(4), "waiting"], [uid(5), "playing"]]);
		expect([(await status(1)).status, (await status(6)).status]).toEqual(["playing", "waiting"]);
	});
	it("다른 진행 경기 선수를 들이면 거부한다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await assign(501, [5, 6, 7, 8], { court: 2 });
		await fails(() => roster(500, [1, 2, 3, 5], [4], [5]), /players already playing/);
		expect((await status(4)).status).toBe("playing");
	});
	it("다른 세션 선수는 들일 수 없다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await fails(() => roster(500, [1, 2, 3, 20], [4], [20]), /players not ready/);
	});
});

describe("complete_match 가드", () => {
	it("낡은 로스터로 완료해도 실제 로스터 선수만 풀어준다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await roster(500, [1, 2, 3, 5]);
		expect(await complete(500, [1, 2, 3, 4])).toEqual([1, 2, 3, 5].map(uid));
		expect(await status(5)).toEqual({ status: "waiting", game_count: 1 });
		expect(await status(4)).toEqual({ status: "waiting", game_count: 0 });
		const snap = (await db.query<{ player_snapshot: { id: string }[] }>("select player_snapshot from matches where id=$1", [uid(500)])).rows[0];
		expect(snap.player_snapshot.map(p => p.id)).toEqual([1, 2, 3, 5].map(uid));
	});
	it("다른 세션 id 로는 완료할 수 없다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await fails(() => complete(500, [1, 2, 3, 4], { session: 2 }), /already completed or not found/);
	});
});

describe("board_assert_editor 의 client id 미전달 분기", () => {
	it("운영진만 통과한다", async () => {
		await assign(500, [1, 2, 3, 4]);
		await as(MEMBER);
		await fails(() => complete(500, [1, 2, 3, 4], { client: null }), /not editor/);
		await as("");
		await fails(() => complete(500, [1, 2, 3, 4], { client: null }), /not editor/);
		await as(ADMIN);
		expect(await complete(500, [1, 2, 3, 4], { client: null })).toHaveLength(4);
	});
});

describe("matchGuardMessage", () => {
	it("서버 가드 문구만 사람이 읽을 문구로 바꾼다", () => {
		expect(matchGuardMessage("players already playing", "start")).toContain("경기를 시작하지 않았어요");
		expect(matchGuardMessage("players not ready", "roster")).toContain("선수 교체를 적용하지 않았어요");
		expect(matchGuardMessage("court already assigned", "start")).toBeNull();
		expect(matchGuardMessage(undefined, "start")).toBeNull();
	});
});
