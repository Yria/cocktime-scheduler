import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

const read = (name: string) =>
	readFileSync(
		new URL(`../../../supabase/migrations/${name}`, import.meta.url),
		"utf8",
	);
const migration = read("20260921000000_scale_operator_freepass.sql");
const uid = (n: number) =>
	`00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
let db: PGlite;

function extract(file: string, name: string) {
	const source = read(file);
	const start = source.indexOf(`create or replace function public.${name}(`);
	if (start < 0) throw Error(name);
	return source.slice(start, source.indexOf("\n$$;", start) + 4);
}

async function scalar<T = unknown>(
	sql: string,
	params: unknown[] = [],
): Promise<T> {
	return Object.values(
		(await db.query<Record<string, T>>(sql, params)).rows[0],
	)[0];
}

async function login(member: number) {
	await db.query("select set_config('test.member', $1, false)", [uid(member)]);
}

async function attendance(
	member: number,
	status: string,
	exemptReason: string | null = null,
) {
	await db.query(
		`insert into attendances(session_id, member_id, status, capacity_exempt, exempt_reason)
		values (1, $1, $2, $3, $4)`,
		[uid(member), status, exemptReason !== null, exemptReason],
	);
}

async function fullSession(capacity: number, operators = 0, paid = false) {
	await db.query("update sessions set capacity=$1, place_id=$2 where id=1", [
		capacity,
		paid ? 2 : 1,
	]);
	await db.query(
		`insert into attendances(session_id, member_id, status)
		select 1, id, 'confirmed' from members where id > $1 order by id limit $2`,
		[uid(1000), capacity - operators],
	);
	for (let i = 1; i <= operators; i++) await attendance(i, "confirmed");
}

async function join(member: number, useTicket = false) {
	await login(member);
	return (
		await db.query<{
			status: string;
			capacity_exempt: boolean;
			exempt_reason: string | null;
		}>(
			"select status, capacity_exempt, exempt_reason from join_session(1, $1)",
			[useTicket],
		)
	).rows[0];
}

const status = (member: number) =>
	scalar("select status from attendances where session_id=1 and member_id=$1", [
		uid(member),
	]);
const operatorCount = () =>
	scalar(
		"select count(*)::int from attendances where status='confirmed' and is_operator(member_id)",
	);

beforeAll(async () => {
	db = new PGlite();
	await db.exec(`
		create role anon; create role authenticated;
		create table places(id int primary key, charges_court_fee boolean);
		create table sessions(id bigint primary key, capacity int, status text default 'open', place_id int,
			scheduled_at timestamptz default now()+interval '1 day', ends_at timestamptz default now()+interval '1 day 3 hours');
		create table members(id uuid primary key, name text default '회원', is_active boolean default true,
			gender text default 'M', skills jsonb default '{"grade":5}');
		create table user_roles(member_id uuid, role text);
		create sequence attendance_position_seq;
		create table attendances(session_id bigint, member_id uuid, status text,
			position bigint default nextval('attendance_position_seq'), invited_by uuid,
			confirmed_at timestamptz, requested_at timestamptz default now(), cancelled_at timestamptz,
			updated_at timestamptz default now(), late_minutes int default 0,
			capacity_exempt boolean not null default false, exempt_reason text,
			primary key(session_id, member_id));
		create table session_counters(session_id bigint primary key, confirmed_count int default 0);
		create table session_players(session_id bigint, player_id text, member_id uuid, name text,
			gender text, skills jsonb, status text, wait_since timestamptz, unique(session_id,player_id));
		create table notifications(recipient_member_id uuid, type text, session_id bigint, payload jsonb);
		create table ticket_spends(member_id uuid, session_id bigint, delta int);
		create function current_member_id() returns uuid language sql stable as $$
			select nullif(current_setting('test.member', true), '')::uuid $$;
		-- Unrelated eligibility/point helpers use fixed fixtures; the five attendance RPCs below are real SQL.
		create function session_guest_cap(bigint) returns int language sql as $$ select 2 $$;
		create table test_newbies(member_id uuid primary key);
		create function session_newbie_grace(bigint, uuid) returns boolean language sql as $$
			select exists(select 1 from public.test_newbies where member_id=$2) $$;
		create function wait_ticket_cost() returns int language sql as $$ select 7 $$;
		create function wait_ticket_session_cap() returns int language sql as $$ select 2 $$;
		create function wait_points_recount(uuid) returns int language sql as $$ select 7 $$;
		create function wait_ticket_session_used(bigint) returns int language sql as $$
			select count(*)::int from public.ticket_spends where session_id=$1 $$;
		create function wait_ticket_spent(bigint, uuid) returns boolean language sql as $$
			select exists(select 1 from public.ticket_spends where session_id=$1 and member_id=$2) $$;
		create function wait_points_write(uuid, bigint, text, int, jsonb) returns void language sql as $$
			insert into public.ticket_spends values($1,$2,$4) $$;
	`);
	await db.exec(extract("20260713040000_accounting_schema.sql", "is_operator"));
	await db.exec(
		"create function is_admin() returns boolean language sql as $$ select public.is_operator(public.current_member_id()) $$",
	);
	await db.exec(
		extract("20260726110000_operator_freepass_capacity.sql", "session_op_free"),
	);
	await db.exec(
		extract(
			"20260903010000_newbie_capacity_exempt.sql",
			"session_counter_sync",
		),
	);
	await db.exec(
		extract("20260806010000_promotion_hardening.sql", "promote_waitlist_fill"),
	);
	await db.exec(migration);
	await db.exec(read("20261002000000_newbie_freepass_cap.sql"));
}, 30000);

beforeEach(async () => {
	await db.exec(`begin;
		insert into places values(1,false),(2,true);
		insert into sessions(id,capacity,place_id) values(1,24,1);
		insert into members(id) select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
			from generate_series(1,8) n;
		insert into user_roles select id,'admin' from members;
		insert into members(id) select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
			from generate_series(1001,1100) n;
	`);
	await login(1);
});
afterEach(() => db.exec("rollback"));
afterAll(() => db.close());

const newbie = (member: number) =>
	db.query("insert into test_newbies values($1)", [uid(member)]);
const newbieCount = () =>
	scalar(
		"select count(*)::int from attendances where status='confirmed' and exempt_reason='newbie'",
	);

it("부과 없는 만석 일정에서 신규 프리패스는 회차당 2명까지, 세 번째 신규는 대기한다", async () => {
	await fullSession(16);
	for (const m of [1051, 1052, 1053]) await newbie(m);
	expect(await join(1051)).toEqual({ status: "confirmed", capacity_exempt: true, exempt_reason: "newbie" });
	expect(await join(1052)).toEqual({ status: "confirmed", capacity_exempt: true, exempt_reason: "newbie" });
	expect(await join(1053)).toMatchObject({ status: "waitlisted", capacity_exempt: false });
	expect(await newbieCount()).toBe(2);
	expect(await scalar("select confirmed_count from session_counters where session_id=1")).toBe(16);
});

it("신규 상한이 차면 티켓을 쓸 수 있고, 신규 한 명이 취소하면 다음 신규가 다시 프리패스를 받는다", async () => {
	await fullSession(16);
	for (const m of [1051, 1052, 1053, 1054]) await newbie(m);
	await join(1051);
	await join(1052);
	await login(1053);
	expect(await scalar<{ reason: string }>("select wait_ticket_options(1)")).toMatchObject({ reason: "ok" });
	expect(await join(1053, true)).toEqual({ status: "confirmed", capacity_exempt: true, exempt_reason: "ticket" });
	// 취소 RPC 는 이 하네스 밖이다 — 상한은 '확정 + newbie' 행 수만 보므로 행 상태로 재현한다.
	await db.query("update attendances set status='cancelled' where member_id=$1", [uid(1051)]);
	await login(1054);
	expect(await scalar<{ reason: string }>("select wait_ticket_options(1)")).toMatchObject({ reason: "free_pass" });
	expect(await join(1054)).toMatchObject({ status: "confirmed", exempt_reason: "newbie" });
	expect(await newbieCount()).toBe(2);
});

it("정시 복귀(늦참 풀 → 확정)도 신규 상한을 따른다", async () => {
	await fullSession(16);
	for (const m of [1051, 1052, 1053]) await newbie(m);
	await join(1051);
	await join(1052);
	await attendance(1053, "late_pool");
	await login(1053);
	await db.query("select set_late_minutes(1, 0)");
	expect(await status(1053)).toBe("waitlisted");
});

it("대관비 부과 일정에서는 상한과 무관하게 신규 프리패스가 없다", async () => {
	await fullSession(16, 0, true);
	await newbie(1051);
	expect(await join(1051)).toMatchObject({ status: "waitlisted" });
});
