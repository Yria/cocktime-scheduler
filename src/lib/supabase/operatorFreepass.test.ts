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
		create function session_newbie_grace(bigint, uuid) returns boolean language sql as $$ select false $$;
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
	await db.exec(migration);
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

it.each([
	[1, 2],
	[8, 2],
	[16, 2],
	[20, 2],
	[23, 2],
	[24, 3],
	[28, 3],
	[31, 3],
	[32, 4],
	[40, 5],
])("정원 %i명은 운영진 %i명까지 만석 참여를 허용하고 다음 운영진은 대기한다", async (capacity, limit) => {
	await fullSession(capacity, limit - 1);
	await attendance(1100, "waitlisted");
	expect(await join(limit, true)).toEqual({
		status: "confirmed",
		capacity_exempt: false,
		exempt_reason: null,
	});
	expect(await join(limit + 1)).toMatchObject({ status: "waitlisted" });
	expect(await status(1100)).toBe("waitlisted");
	expect(await operatorCount()).toBe(limit);
	expect(
		await scalar(
			"select confirmed_count from session_counters where session_id=1",
		),
	).toBe(capacity + 1);
	expect(await scalar("select count(*)::int from ticket_spends")).toBe(0);
});

it("만석에서도 운영진이 없으면 정원별 기준 인원까지 참여한다", async () => {
	await fullSession(32);
	for (let i = 1; i <= 4; i++)
		expect(await join(i)).toMatchObject({ status: "confirmed" });
	expect(await join(5)).toMatchObject({ status: "waitlisted" });
});

it.each([
	24, 28, 32,
])("정원 %i명의 티켓 안내와 신청이 같은 운영진 기준을 사용한다", async (capacity) => {
	const limit = Math.floor(capacity / 8);
	await fullSession(capacity, limit - 1);
	await login(limit);
	expect(await scalar("select wait_ticket_options(1)->>'reason'")).toBe(
		"free_pass",
	);
	await join(limit);
	await login(limit + 1);
	expect(await scalar("select wait_ticket_options(1)->>'reason'")).toBe("ok");
	expect(await join(limit + 1, true)).toMatchObject({
		status: "confirmed",
		exempt_reason: "ticket",
		capacity_exempt: true,
	});
	expect(await scalar("select sum(delta)::int from ticket_spends")).toBe(-7);
});

it.each([
	24, 28, 32,
])("정원 %i명의 자동 승급은 운영진 기준까지 순서대로 채운다", async (capacity) => {
	const limit = Math.floor(capacity / 8);
	await fullSession(capacity, limit - 2);
	await attendance(1100, "waitlisted");
	for (let i = limit - 1; i <= limit + 1; i++)
		await attendance(i, "waitlisted");
	expect(await scalar("select promote_waitlist_fill(1)")).toBe(2);
	expect(await status(limit - 1)).toBe("confirmed");
	expect(await status(limit)).toBe("confirmed");
	expect(await status(limit + 1)).toBe("waitlisted");
	expect(await status(1100)).toBe("waitlisted");
	expect(await scalar("select promote_waitlist_fill(1)")).toBe(0);
	expect(
		await scalar(
			"select count(*)::int from notifications where type='promoted'",
		),
	).toBe(2);
});

it.each([
	24, 28, 32,
])("정원 %i명의 늦참 복귀도 같은 운영진 한도를 적용한다", async (capacity) => {
	const limit = Math.floor(capacity / 8);
	await fullSession(capacity, limit - 1);
	await attendance(limit, "late_pool");
	await attendance(limit + 1, "late_pool");
	await login(limit);
	expect(await scalar("select set_late_minutes(1,0)->>'status'")).toBe(
		"confirmed",
	);
	await login(limit + 1);
	expect(await scalar("select set_late_minutes(1,0)->>'status'")).toBe(
		"waitlisted",
	);
});

it("운영진이 늦참으로 빠지면 다음 운영진이 승급하고 복귀자는 한도에 따라 대기한다", async () => {
	await fullSession(24, 2);
	await join(3);
	await attendance(1100, "waitlisted");
	await attendance(4, "waitlisted");
	await login(3);
	expect(await scalar("select set_late_minutes(1,120)")).toEqual({
		status: "late_pool",
		promoted: 1,
	});
	expect(await status(4)).toBe("confirmed");
	expect(await status(1100)).toBe("waitlisted");
	expect(await scalar("select set_late_minutes(1,0)->>'status'")).toBe(
		"waitlisted",
	);
});

it("정원 축소·확대 시 새 정원으로 운영진 기준을 다시 계산하고 정원 외 자리를 보존한다", async () => {
	await fullSession(32, 4);
	await attendance(1100, "confirmed", "newbie");
	await attendance(1099, "confirmed", "ticket");
	expect(await scalar("select set_session_capacity(1,24)")).toEqual({
		promoted: 0,
		demoted: 5,
	});
	expect(await operatorCount()).toBe(3);
	expect(await status(4)).toBe("waitlisted");
	expect(
		await scalar(
			"select confirmed_count from session_counters where session_id=1",
		),
	).toBe(27);
	expect(await scalar("select set_session_capacity(1,32)")).toEqual({
		promoted: 5,
		demoted: 0,
	});
	expect(await operatorCount()).toBe(4);
	expect(await scalar("select set_session_capacity(1,32)")).toEqual({
		promoted: 0,
		demoted: 0,
	});
	expect(
		await scalar(
			"select count(*)::int from attendances where status='confirmed' and capacity_exempt",
		),
	).toBe(2);
});

it("대관비 부과 장소에서는 운영진 신청·복귀·승급·정원 재배분에 프리패스를 주지 않는다", async () => {
	await fullSession(32, 2, true);
	await login(3);
	expect(await scalar("select wait_ticket_options(1)->>'reason'")).toBe("ok");
	expect(await join(3)).toMatchObject({ status: "waitlisted" });
	await attendance(4, "late_pool");
	await login(4);
	expect(await scalar("select set_late_minutes(1,0)->>'status'")).toBe(
		"waitlisted",
	);
	expect(await scalar("select promote_waitlist_fill(1)")).toBe(0);
	expect(await scalar("select set_session_capacity(1,32)")).toEqual({
		promoted: 0,
		demoted: 0,
	});
	expect(await operatorCount()).toBe(2);
});

it.each([
	40,
	null,
])("정원 %s에 여유가 있으면 운영진 기준과 무관하게 참여할 수 있다", async (capacity) => {
	await fullSession(32, 4);
	await db.query("update sessions set capacity=$1 where id=1", [capacity]);
	expect(await join(5)).toMatchObject({ status: "confirmed" });
	expect(await join(6)).toMatchObject({ status: "confirmed" });
});

it("진행 중 세션도 새 운영진 기준으로 참여하고 보드에 추가한다", async () => {
	await fullSession(24, 2);
	await db.exec("update sessions set status='active' where id=1");
	expect(await join(3)).toMatchObject({ status: "confirmed" });
	expect(await scalar("select member_id from session_players")).toBe(uid(3));
});

it("계산 헬퍼와 내부 승급 함수는 클라이언트가 직접 실행할 수 없다", async () => {
	for (const role of ["anon", "authenticated"]) {
		for (const fn of [
			"operator_freepass_limit(integer)",
			"promote_next_waitlisted(bigint)",
		]) {
			expect(
				await scalar("select has_function_privilege($1,$2,'execute')", [
					role,
					fn,
				]),
			).toBe(false);
		}
	}
});
