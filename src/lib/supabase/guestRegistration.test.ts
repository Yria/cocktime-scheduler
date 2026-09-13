import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

const read = (name: string) =>
	readFileSync(
		new URL(`../../../supabase/migrations/${name}`, import.meta.url),
		"utf8",
	);
const migration = read("20260913010000_unify_guest_registration.sql");
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const historical = "3eea6adf-750a-40f5-a1c5-33d61050a015";
let db: PGlite;

async function scalar<T = unknown>(
	sql: string,
	params: unknown[] = [],
): Promise<T> {
	return Object.values(
		(await db.query<Record<string, T>>(sql, params)).rows[0],
	)[0];
}
async function guest(name = "새 게스트", session = 1, gender = "M") {
	return (
		await db.query<{ member_id: string; status: string }>(
			"select member_id,status from add_guest_attendance($1,$2,$3,'{\"grade\":5}')",
			[session, name, gender],
		)
	).rows[0];
}
async function board(name = "새 게스트", key = "guest-local-1", session = 1) {
	return (
		await db.query<{ id: string; member_id: string; player_id: string }>(
			"insert into session_players(session_id,player_id,name,gender,skills) values($1,$2,$3,'M','{\"grade\":7}') returning id,member_id,player_id",
			[session, key, name],
		)
	).rows[0];
}
async function fails(run: () => Promise<unknown>, pattern: RegExp) {
	await db.exec("savepoint expected_failure");
	await expect(run()).rejects.toThrow(pattern);
	await db.exec("rollback to savepoint expected_failure");
}
function extract(file: string, name: string) {
	const source = read(file);
	const start = source.search(
		new RegExp(`create or replace function public\\.${name}\\(`, "i"),
	);
	if (start < 0) throw Error(name);
	const tail = source.slice(start);
	const tag = tail.match(/\bas\s+(\$\w*\$)/i)!;
	return tail.slice(
		0,
		tail.indexOf(`${tag[1]};`, tag.index! + tag[0].length) + tag[1].length + 1,
	);
}
beforeAll(async () => {
	db = new PGlite();
	await db.exec(`
    create role anon; create role authenticated;
    create table members(id uuid primary key default gen_random_uuid(),name text not null,
      gender text,skills jsonb,is_guest boolean not null default false,is_active boolean not null default true,
      auth_user_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
    create function current_member_id() returns uuid language sql as $$select nullif(current_setting('test.member',true),'')::uuid$$;
    create function is_admin() returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'false')='true'$$;
    create function is_operator(uuid) returns boolean language sql as $$select false$$;
    create table sessions(id bigint primary key,capacity int,status text,ends_at timestamptz,scheduled_at timestamptz);
    create table session_counters(session_id bigint primary key,confirmed_count int default 0);
    create sequence attendance_position_seq;
    create table attendances(session_id bigint references sessions,member_id uuid references members,
      status text,position bigint default nextval('attendance_position_seq'),invited_by uuid references members,
      requested_at timestamptz default now(),confirmed_at timestamptz,cancelled_at timestamptz,updated_at timestamptz default now(),
      primary key(session_id,member_id));
    create table session_players(id uuid primary key default gen_random_uuid(),session_id bigint references sessions,
      player_id text not null,member_id uuid references members on delete set null,name text not null,gender text,
      skills jsonb,game_count int default 0,status text default 'waiting',unique(session_id,player_id));
    create table matches(id int primary key,player_id uuid references session_players);
    create table financial_facts(id int primary key,amount int,beneficiary text);
    create function session_guest_cap(bigint) returns int language sql as $$select nullif(current_setting('test.gcap',true),'')::int$$;
    grant select,insert,update,delete on members,session_players to authenticated;
    alter table members enable row level security;
    alter table session_players enable row level security;
    create policy members_select on members for select to authenticated using(true);
    create policy members_write on members for all to authenticated using(is_admin()) with check(is_admin());
    create policy players_select on session_players for select to authenticated using(true);
    create policy players_write on session_players for all to authenticated using(is_admin()) with check(is_admin());
    insert into sessions(id,status,scheduled_at) values(191,'closed','2026-09-13T15:00:00+09');
    insert into session_players(id,session_id,player_id,name,gender,skills,game_count)
      values('${historical}',191,'guest-1789279778067-1','강원식','M','{"grade":10}',10);
    insert into matches values(1,'${historical}');
    insert into financial_facts values(1,6000,'기존 부과');
  `);
	await db.exec(
		extract("20260819030000_guest_row_reuse.sql", "name_match_key"),
	);
	await db.exec(
		extract(
			"20260810000000_day_cancel_grace_1h.sql",
			"dues_is_day_cancel_chargeable",
		),
	);
	await db.exec(
		extract(
			"20260818000000_court_targets_include_board_added.sql",
			"dues_court_targets",
		),
	);
	await db.exec(migration);
	await db.exec(migration);
}, 30000);
beforeEach(async () => {
	await db.exec(`begin;
    set test.admin='true'; set test.member='${A}'; set test.gcap='';
    insert into members(id,name,gender) values('${A}','회원','M'),('${B}','다른 회원','F');
    insert into sessions values(1,20,'open',now()+interval '1 day',now()),(2,20,'open',now()+interval '1 day',now());
    insert into attendances(session_id,member_id,status) values(1,'${A}','confirmed'),(2,'${A}','confirmed');
    insert into session_counters values(1,1),(2,1);
  `);
});
afterEach(() => db.exec("rollback"));
afterAll(() => db.close());

it("repairs the confirmed historical guest once, preserving board IDs, games and financial facts", async () => {
	const row = (
		await db.query<{ member_id: string }>(
			"select * from session_players where id=$1",
			[historical],
		)
	).rows[0];
	expect(row).toMatchObject({
		player_id: "guest-1789279778067-1",
		game_count: 10,
		name: "강원식",
	});
	expect(row.member_id).toBeTruthy();
	expect(
		await scalar("select count(*)::int from members where name='강원식'"),
	).toBe(1);
	expect(await scalar("select player_id from matches where id=1")).toBe(
		historical,
	);
	expect(await scalar("select amount from financial_facts where id=1")).toBe(
		6000,
	);
	expect(
		await scalar("select count(*)::int from attendances where session_id=191"),
	).toBe(0);
	expect(
		await scalar("select member_id from dues_court_targets(191,false)"),
	).toBe(row.member_id);
});

it.each([
	true,
	false,
])("schedule and board registration resolve one member in either order (schedule first: %s)", async (scheduleFirst) => {
	let invited, saved;
	if (scheduleFirst) {
		invited = await guest("김 지훈");
		saved = await board("김지훈");
	} else {
		saved = await board("김지훈");
		invited = await guest("김 지훈");
	}
	expect(saved.member_id).toBe(invited.member_id);
	expect(
		await scalar(
			"select count(*)::int from members where is_guest and name_match_key(name)='김지훈'",
		),
	).toBe(1);
	expect(
		await scalar(
			"select count(*)::int from dues_court_targets(1,false) where member_id=$1",
			[saved.member_id],
		),
	).toBe(1);
	expect(
		await scalar(
			"select invited_by from attendances where session_id=1 and member_id=$1",
			[saved.member_id],
		),
	).toBe(A);
});

it("board-only registration is immediately included in court targets without inventing a schedule application", async () => {
	const saved = await board();
	expect(saved.player_id).toBe("guest-local-1");
	expect(saved.member_id).toMatch(/^[\da-f-]{36}$/);
	expect(
		await scalar(
			"select count(*)::int from dues_court_targets(1,false) where member_id=$1",
			[saved.member_id],
		),
	).toBe(1);
	expect(
		await scalar("select count(*)::int from attendances where member_id=$1", [
			saved.member_id,
		]),
	).toBe(0);
});

it("reuses a session's older guest identity ahead of unrelated newer duplicate records", async () => {
	const invited = await guest();
	await db.exec(
		"insert into members(name,gender,is_guest,created_at) values('새게스트','M',true,now()+interval '1 second')",
	);
	expect((await board()).member_id).toBe(invited.member_id);
});

it("reuses a guest across sessions and keeps distinct genders separate", async () => {
	const saved = await board();
	expect((await guest("새 게스트", 2)).member_id).toBe(saved.member_id);
	expect((await guest("새 게스트", 2, "F")).member_id).not.toBe(
		saved.member_id,
	);
});

it("reactivates reused guests without rewriting older board skill snapshots", async () => {
	const saved = await board();
	await db.query("update members set is_active=false where id=$1", [
		saved.member_id,
	]);
	await guest("새 게스트", 2);
	expect(
		await scalar("select skills from members where id=$1", [saved.member_id]),
	).toEqual({ grade: 5 });
	expect(
		await scalar("select skills from session_players where id=$1", [saved.id]),
	).toEqual({ grade: 7 });
	expect(
		await scalar("select is_active from members where id=$1", [
			saved.member_id,
		]),
	).toBe(true);
});

it("blocks duplicate board aliases and rolls back all registrations in a failed batch", async () => {
	const saved = await board();
	await fails(() => board("새 게스트", "guest-local-2"), /uq_session_member/);
	await fails(() => board("새 게스트", saved.member_id), /uq_session_member/);
	await fails(
		() =>
			db.exec(`insert into session_players(session_id,player_id,name,gender)
    values(1,'guest-batch-1','일괄 신규','M'),(1,'guest-batch-2','일괄신규','M')`),
		/uq_session_member/,
	);
	expect(
		await scalar(
			"select count(*)::int from members where name_match_key(name)='일괄신규'",
		),
	).toBe(0);
});

it("old-client retry/upsert keeps the existing guest member link, even after membership conversion", async () => {
	const saved = await board();
	await db.query("update members set is_guest=false where id=$1", [
		saved.member_id,
	]);
	await db.exec(`insert into session_players(session_id,player_id,name,gender,member_id)
    values(1,'guest-local-1','새 게스트','M',null)
    on conflict(session_id,player_id) do update set member_id=excluded.member_id`);
	expect(
		await scalar("select member_id from session_players where id=$1", [
			saved.id,
		]),
	).toBe(saved.member_id);
	expect(
		await scalar(
			"select count(*)::int from session_players where session_id=1",
		),
	).toBe(1);
});

it("rejects invalid identities and active member names without leaving orphan guest records", async () => {
	await fails(() => board("회 원"), /name_is_member/);
	await fails(() => board("등록 안 됨", "unknown-id"), /board_member_required/);
	await fails(() => guest(" "), /guest name required/);
	await fails(() => guest("잘못된 성별", 1, "X"), /guest gender required/);
	expect(
		await scalar(
			"select count(*)::int from members where name='등록 안 됨' or name='잘못된 성별'",
		),
	).toBe(0);
});

it("preserves capacity, guest cap, late-pool inheritance and duplicate invitation checks", async () => {
	await db.exec("set test.gcap='1'");
	expect((await guest("첫째")).status).toBe("confirmed");
	expect((await guest("둘째")).status).toBe("waitlisted");
	await fails(() => guest("첫째"), /guest_already_joined/);
	await db.query(
		"insert into attendances(session_id,member_id,status) values(1,$1,'confirmed')",
		[B],
	);
	await db.exec(`set test.member='${B}'`);
	await fails(() => guest("첫째"), /guest_taken_by_other/);
	await db.exec(
		`set test.member='${A}'; update attendances set status='late_pool' where session_id=2 and member_id='${A}'`,
	);
	expect((await guest("늦참", 2)).status).toBe("late_pool");
	await db.exec("update sessions set capacity=0 where id=1");
	expect((await guest("셋째")).status).toBe("waitlisted");
});

it("reinvites cancelled guests using the same member and resets cancellation metadata", async () => {
	const invited = await guest();
	await db.query(
		"update attendances set status='cancelled',cancelled_at=now() where member_id=$1",
		[invited.member_id],
	);
	const rejoined = await guest();
	expect(rejoined.member_id).toBe(invited.member_id);
	expect(
		await scalar("select cancelled_at from attendances where member_id=$1", [
			invited.member_id,
		]),
	).toBeNull();
});

it("keeps helpers private and enforces board-write and attendance permissions", async () => {
	await db.exec("set role authenticated; set test.admin='false'");
	await fails(
		() => db.exec("select _register_guest_member('임의 등록','M','{}',1)"),
		/permission denied/,
	);
	await fails(() => board("권한 없음"), /row-level security/);
	expect(
		await scalar("select count(*)::int from members where name='권한 없음'"),
	).toBe(0);
	expect((await guest()).status).toBe("confirmed");
	await db.exec("set test.member=''");
	await fails(() => guest("로그인 없음"), /not authenticated/);
	await db.exec("reset role; set role anon");
	await fails(() => guest(), /permission denied/);
});
