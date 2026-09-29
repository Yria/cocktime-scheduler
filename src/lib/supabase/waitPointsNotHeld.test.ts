import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

// 미진행 회차 정산(20260928000000)을 실제 포인트 마이그레이션 위에서 돌린다.
// 20260904000000 → 20260905000000 → 새 마이그레이션(두 번 — 재적용 안전)을 순서대로 올리고
// 종료·취소·하드삭제 세 경로를 실제 트리거로 태운다. 회계·카운터·승격·당일취소 판정은 테스트 값으로 대체한다.

const read = (name: string) =>
	readFileSync(
		new URL(`../../../supabase/migrations/${name}`, import.meta.url),
		"utf8",
	);
const uid = (n: number) =>
	`00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const S = 1; // 기본 회차
let db: PGlite;

const FIXTURE = `
create role anon; create role authenticated;
set check_function_bodies = off;

create table members (
	id uuid primary key, name text not null default 'm', gender text default 'M',
	skills jsonb not null default '{}', is_guest boolean not null default false,
	is_active boolean not null default true
);
create table places (id bigint primary key, name text not null, charges_court_fee boolean not null default true);
create table sessions (
	id bigint primary key, status text not null default 'open',
	scheduled_at timestamptz, ends_at timestamptz, capacity int,
	place_id bigint references places(id), is_active boolean not null default false
);
create table attendances (
	session_id bigint not null references sessions(id) on delete cascade,
	member_id uuid not null references members(id),
	status text not null, invited_by uuid, position int,
	confirmed_at timestamptz default now() - interval '1 day', cancelled_at timestamptz,
	capacity_exempt boolean not null default false, late_minutes int not null default 0,
	carpool_role text not null default 'none', carpool_seats int, updated_at timestamptz,
	primary key (session_id, member_id)
);
create table session_players (
	id bigserial primary key,
	session_id bigint not null references sessions(id) on delete cascade,
	player_id text, member_id uuid
);
create table matches (id bigserial primary key, session_id bigint references sessions(id) on delete cascade);
create table notifications (
	id bigserial primary key,
	recipient_member_id uuid not null references members(id) on delete cascade,
	type text not null, session_id bigint references sessions(id) on delete cascade,
	payload jsonb not null default '{}'
);

create function current_member_id() returns uuid language sql stable
	as $$ select nullif(current_setting('test.member', true), '')::uuid $$;
create function is_admin() returns boolean language sql stable
	as $$ select coalesce(nullif(current_setting('test.admin', true), '')::boolean, false) $$;
create function session_counter_sync(bigint) returns void language sql as $$ select $$;
create function promote_waitlist_fill(bigint) returns void language sql as $$ select $$;
create function dues_is_day_cancel_chargeable(text, timestamptz, timestamptz, timestamptz)
	returns boolean language sql stable
	as $$ select coalesce(nullif(current_setting('test.day_cancel', true), '')::boolean, false) $$;
`;

async function scalar<T = unknown>(
	sql: string,
	params: unknown[] = [],
): Promise<T> {
	return Object.values(
		(await db.query<Record<string, T>>(sql, params)).rows[0],
	)[0];
}

async function member(n: number, opts: { guest?: boolean; active?: boolean } = {}) {
	await db.query(
		"insert into members(id, is_guest, is_active) values ($1, $2, $3)",
		[uid(n), opts.guest ?? false, opts.active ?? true],
	);
}

async function attend(
	n: number,
	status: string,
	opts: { session?: number; invitedBy?: number } = {},
) {
	await db.query(
		"insert into attendances(session_id, member_id, status, invited_by) values ($1, $2, $3, $4)",
		[opts.session ?? S, uid(n), status, opts.invitedBy ? uid(opts.invitedBy) : null],
	);
}

/** 원장에 직접 한 줄 — 과거 회차에서 쌓인 잔액을 흉내 낸다(session_id null 이라 유니크 대상 아님). */
async function seedBalance(n: number, points: number) {
	await db.query(
		"select wait_points_write($1, null, 'adjust', $2, '{\"note\":\"seed\"}')",
		[uid(n), points],
	);
}

const balance = (n: number) =>
	scalar<number>(
		"select coalesce(sum(delta), 0)::int from wait_point_ledger where member_id = $1",
		[uid(n)],
	);
const cached = (n: number) =>
	scalar<number>("select balance from wait_point_balances where member_id = $1", [
		uid(n),
	]);
const rows = (n: number, session = S) =>
	db
		.query<{ kind: string; delta: number; reason: string | null }>(
			`select kind, delta, detail->>'reason' as reason from wait_point_ledger
			where member_id = $1 and session_id = $2 order by id`,
			[uid(n), session],
		)
		.then((r) => r.rows);
const readyCount = (n: number) =>
	scalar<number>(
		"select count(*)::int from notifications where recipient_member_id = $1 and type = 'wait_ticket_ready'",
		[uid(n)],
	);
const setStatus = (status: string, session = S) =>
	db.query("update sessions set status = $1 where id = $2", [status, session]);
const startBoard = (members: number[], session = S) =>
	db.query(
		`insert into session_players(session_id, player_id, member_id)
		select $1, x::text, x from unnest($2::uuid[]) x`,
		[session, members.map(uid)],
	);

/** 티켓으로 확정된 회원 — 원장 spend 와 정원 외 자리. */
async function ticketHolder(n: number, status = "confirmed", exempt = true) {
	await seedBalance(n, 7);
	await db.query(
		"select wait_points_write($1, $2, 'spend', -7, '{\"reason\":\"join\"}')",
		[uid(n), S],
	);
	await db.query(
		`insert into attendances(session_id, member_id, status, capacity_exempt, exempt_reason)
		values ($1, $2, $3, $4, $5)`,
		[S, uid(n), status, exempt, exempt ? "ticket" : null],
	);
}

async function cancelSelf(n: number, dayCancel: boolean) {
	await db.query("select set_config('test.member', $1, false)", [uid(n)]);
	await db.query("select set_config('test.day_cancel', $1, false)", [
		String(dayCancel),
	]);
	await db.query("select cancel_attendance($1)", [S]);
}

beforeAll(async () => {
	db = new PGlite();
	await db.exec(FIXTURE);
	await db.exec(read("20260904000000_wait_points_ticket.sql"));
	await db.exec(read("20260905000000_wait_points_gate_by_board.sql"));
	const migration = read("20260928000000_wait_points_not_held.sql");
	await db.exec(migration);
	await db.exec(migration); // 재적용 안전
	const courtOnly = read("20260929000000_day_cancel_penalty_court_fee_only.sql");
	await db.exec(courtOnly);
	await db.exec(courtOnly);
});

afterAll(async () => {
	await db?.close();
});

beforeEach(async () => {
	await db.exec("begin");
	await db.exec(`insert into places values (1, '토요벙 체육관', true), (2, '동네 공원', false);
		insert into sessions(id, status, scheduled_at, place_id, capacity)
		values (1, 'open', '2026-10-03T09:00:00+09', 1, 12),
		       (2, 'open', '2026-10-04T09:00:00+09', 1, 12);`);
});

afterEach(async () => {
	await db.exec("rollback");
});

it("재적용 후에도 kind CHECK 는 하나이고 reversal 을 받는다", async () => {
	expect(
		await scalar(
			`select count(*)::int from pg_constraint
			where conrelid = 'wait_point_ledger'::regclass and contype = 'c'
				and pg_get_constraintdef(oid) ilike '%kind%'`,
		),
	).toBe(1);
	expect(
		await scalar(
			`select pg_get_indexdef('wait_point_ledger_once_per_session'::regclass) like '%reversal%'`,
		),
	).toBe(true);
});

it("방치 → 자동 종료(보드 없음): 신청을 유지한 회원 전원 +1, 게스트·비활성·사전취소는 제외", async () => {
	for (const n of [1, 2, 3, 4, 5, 6, 7]) await member(n);
	await member(8, { guest: true });
	await member(9, { active: false });
	await attend(1, "confirmed");
	await attend(2, "late_pool");
	await attend(3, "waitlisted");
	await attend(4, "cancelled");
	await attend(8, "confirmed", { invitedBy: 1 });
	await attend(9, "confirmed");

	await setStatus("closed");

	for (const n of [1, 2, 3]) {
		expect(await rows(n)).toEqual([
			{ kind: "earn", delta: 1, reason: "session_not_held" },
		]);
		expect(await cached(n)).toBe(1);
	}
	for (const n of [4, 8, 9]) expect(await rows(n)).toEqual([]);
	// 장소·시각 스냅샷 — 회차가 지워져도 내역 라벨이 남는다.
	expect(
		await scalar(
			"select detail->>'place_name' from wait_point_ledger where member_id = $1",
			[uid(1)],
		),
	).toBe("토요벙 체육관");
});

it("종료 훅이 다시 발화해도(closed→open→closed) 한 번만 적립한다", async () => {
	await member(1);
	await attend(1, "confirmed");
	await setStatus("closed");
	await setStatus("open");
	await setStatus("closed");
	expect(await rows(1)).toEqual([
		{ kind: "earn", delta: 1, reason: "session_not_held" },
	]);
});

it("당일 취소 감점은 미진행 회차에서 실제로 깎인 만큼만 되돌리고, 사전 취소는 손대지 않는다", async () => {
	for (const n of [1, 2, 3]) await member(n);
	await seedBalance(1, 3);
	await seedBalance(3, 2);
	await attend(1, "confirmed");
	await attend(2, "confirmed"); // 잔액 0 — 감점이 clamp 로 0 이 된다
	await attend(3, "confirmed");

	await cancelSelf(1, true);
	await cancelSelf(2, true);
	await cancelSelf(3, false);
	expect(await balance(1)).toBe(2);

	await setStatus("closed");

	expect(await rows(1)).toEqual([
		{ kind: "penalty", delta: -1, reason: "day_cancel" },
		{ kind: "reversal", delta: 1, reason: "session_not_held" },
	]);
	expect(await balance(1)).toBe(3);
	// 0점이라 깎인 게 없으면 되돌릴 것도 없다. 취소했으니 적립도 없다.
	expect(await rows(2)).toEqual([
		{ kind: "penalty", delta: 0, reason: "day_cancel" },
	]);
	expect(await rows(3)).toEqual([]);
	expect(await balance(3)).toBe(2);
});

it("당일 취소 후 다시 신청해 끝까지 남으면 감점 환원과 적립을 모두 받는다", async () => {
	await member(1);
	await seedBalance(1, 4);
	await attend(1, "confirmed");
	await cancelSelf(1, true);
	await db.query(
		"update attendances set status = 'confirmed' where session_id = $1 and member_id = $2",
		[S, uid(1)],
	);
	await setStatus("closed");
	expect((await rows(1)).map((r) => r.kind)).toEqual([
		"penalty",
		"reversal",
		"earn",
	]);
	expect(await balance(1)).toBe(5);
});

it("반복 회차 [삭제] → 취소(보드 없음): 같은 미진행 정산", async () => {
	await member(1);
	await attend(1, "confirmed");
	await setStatus("cancelled");
	expect(await rows(1)).toEqual([
		{ kind: "earn", delta: 1, reason: "session_not_held" },
	]);
});

it("시작된 뒤 취소된 회차는 적립 없이 티켓만 환원한다 — 늦참으로 사유를 잃은 티켓도(F3)", async () => {
	await member(1);
	await member(2);
	await ticketHolder(1, "late_pool", false); // set_late_minutes 가 exempt_reason 을 내려놓은 상태
	await attend(2, "confirmed");
	await startBoard([2]);

	await setStatus("cancelled");

	expect(await rows(1)).toEqual([
		{ kind: "spend", delta: -7, reason: "join" },
		{ kind: "refund", delta: 7, reason: "session_cancelled" },
	]);
	expect(await rows(2)).toEqual([]);
});

it("일회성 회차 하드 삭제: 삭제 직전에 정산해 원장이 남는다", async () => {
	await member(1);
	await member(2);
	await seedBalance(2, 6);
	await attend(1, "confirmed");
	await attend(2, "waitlisted");

	await db.query("delete from sessions where id = $1", [S]);

	expect(await scalar("select count(*)::int from sessions where id = $1", [S])).toBe(0);
	expect(await rows(1)).toEqual([
		{ kind: "earn", delta: 1, reason: "session_not_held" },
	]);
	expect(await balance(2)).toBe(7);
	// 알림은 session_id 없이 넣어 CASCADE 에 지워지지 않는다.
	expect(await readyCount(2)).toBe(1);

	await db.query("select set_config('test.member', $1, false)", [uid(1)]);
	expect(
		(
			await db.query<{ place_name: string; session_at: string }>(
				"select place_name, session_at from wait_points_my_ledger(10)",
			)
		).rows[0],
	).toMatchObject({ place_name: "토요벙 체육관" });
});

it("삭제 훅은 시작된 회차의 사실을 건드리지 않는다", async () => {
	await member(1);
	await attend(1, "confirmed");
	await startBoard([1]);
	await db.query("delete from sessions where id = $1", [S]);
	expect(await rows(1)).toEqual([]);
});

it("취소 후 삭제·재취소가 겹쳐도 보상은 한 번이다", async () => {
	await member(1);
	await attend(1, "confirmed");
	await setStatus("cancelled");
	await setStatus("draft"); // 되살리기
	await setStatus("cancelled");
	await db.query("delete from sessions where id = $1", [S]);
	expect(await rows(1)).toEqual([
		{ kind: "earn", delta: 1, reason: "session_not_held" },
	]);
});

it("미진행 회차에 쓴 티켓은 자리를 들고 있든 당일 취소로 몰수됐든 환원한다(F1)", async () => {
	await member(1);
	await member(2);
	await ticketHolder(1); // 자리 유지
	await ticketHolder(2);
	await cancelSelf(2, true); // 당일 취소 → 몰수 + 감점(잔액 0 이라 0)

	await setStatus("closed"); // 방치 종료 — 종전에는 환원 경로가 없었다

	expect(await rows(1)).toEqual([
		{ kind: "spend", delta: -7, reason: "join" },
		{ kind: "refund", delta: 7, reason: "session_not_held" },
		{ kind: "earn", delta: 0, reason: "session_not_held" }, // 7점 상한
	]);
	expect(await balance(1)).toBe(7);
	expect(await rows(2)).toEqual([
		{ kind: "spend", delta: -7, reason: "join" },
		{ kind: "penalty", delta: 0, reason: "day_cancel" },
		{ kind: "refund", delta: 7, reason: "session_not_held" },
	]);
	expect(await balance(2)).toBe(7);
	// 환원으로 7점이 된 것은 '새로 모은 것'이 아니다 — 알림 없음.
	expect(await readyCount(1)).toBe(0);
	expect(await readyCount(2)).toBe(0);
});

it("7점 알림은 이번 적립으로 막 찼을 때만 한 번 — 이미 7점이면 보내지 않는다(F2)", async () => {
	for (const n of [1, 2]) await member(n);
	await seedBalance(1, 6);
	await seedBalance(2, 7);
	await attend(1, "confirmed");
	await attend(2, "confirmed");
	await setStatus("closed");
	expect(await readyCount(1)).toBe(1);
	expect(await readyCount(2)).toBe(0);
	expect(await rows(2)).toEqual([
		{ kind: "earn", delta: 0, reason: "session_not_held" },
	]);
});

it("당일 취소 감점 환원으로 처음 7점이 돼도 알림은 한 번 나간다", async () => {
	await member(1);
	await seedBalance(1, 7);
	await attend(1, "confirmed");
	await cancelSelf(1, true); // 7 → 6
	await db.query("delete from notifications");
	await setStatus("closed");
	expect(await balance(1)).toBe(7);
	expect(await readyCount(1)).toBe(1);
});

it("재신청 회원은 감점 환원이 먼저 7을 채워도 알림이 정확히 한 번이다", async () => {
	await member(1);
	await seedBalance(1, 6);
	await attend(1, "confirmed");
	await cancelSelf(1, true); // 6 → 5
	await db.query(
		"update attendances set status = 'confirmed' where session_id = $1 and member_id = $2",
		[S, uid(1)],
	);
	await seedBalance(1, 1); // 다른 회차에서 6 으로
	await setStatus("closed");
	expect(await balance(1)).toBe(7);
	expect(await readyCount(1)).toBe(1);
});

for (const order of [
	[1, 2],
	[2, 1],
] as const) {
	it(`미진행 두 회차를 어느 순서로 닫아도 7점 알림은 한 번이다(${order.join("→")})`, async () => {
		await member(1);
		await seedBalance(1, 6);
		await attend(1, "confirmed"); // 회차 1: 당일 취소 → 환원 대상
		await attend(1, "confirmed", { session: 2 }); // 회차 2: 적립 대상
		await cancelSelf(1, true); // 6 → 5
		for (const session of order) await setStatus("closed", session);
		expect(await balance(1)).toBe(7);
		expect(await readyCount(1)).toBe(1);
	});
}

it("하드 삭제된 회차의 이전 원장 행(티켓 사용·당일 취소)도 같은 회차의 스냅샷으로 날짜·장소를 보여 준다", async () => {
	await member(1);
	await member(2);
	await ticketHolder(1);
	await seedBalance(2, 3);
	await attend(2, "confirmed");
	await cancelSelf(2, true);
	await db.query("delete from sessions where id = $1", [S]);

	for (const n of [1, 2]) {
		await db.query("select set_config('test.member', $1, false)", [uid(n)]);
		const labels = (
			await db.query<{ kind: string; place_name: string | null; session_at: string | null }>(
				"select kind, place_name, session_at from wait_points_my_ledger(10) where session_id = $1",
				[S],
			)
		).rows;
		expect(labels.length).toBeGreaterThan(1);
		for (const l of labels) {
			expect(l.place_name).toBe("토요벙 체육관");
			expect(l.session_at).not.toBeNull();
		}
	}
});

it("진행된 회차 종료는 종전 규칙 그대로 — 대기 +1, 보드에 없는 확정 −1, 7점 재적립 알림 없음", async () => {
	for (const n of [1, 2, 3, 4]) await member(n);
	await seedBalance(2, 1);
	await seedBalance(4, 7);
	await attend(1, "confirmed");
	await attend(2, "confirmed");
	await attend(3, "waitlisted");
	await attend(4, "waitlisted");
	await startBoard([1]);

	await setStatus("closed");

	expect(await rows(1)).toEqual([]);
	expect(await rows(2)).toEqual([
		{ kind: "penalty", delta: -1, reason: "noshow" },
	]);
	expect(await rows(3)).toEqual([
		{ kind: "earn", delta: 1, reason: "waitlisted_at_close" },
	]);
	expect(await readyCount(4)).toBe(0);
	// 종료 훅 재발화에도 알림이 늘지 않는다.
	await setStatus("active");
	await setStatus("closed");
	expect(await readyCount(4)).toBe(0);
	expect(await readyCount(3)).toBe(0);
});

it("진행된 회차에서 대기로 6→7 이 되면 알림은 회차를 달고 한 번", async () => {
	for (const n of [1, 2]) await member(n);
	await seedBalance(2, 6);
	await attend(1, "confirmed");
	await attend(2, "waitlisted");
	await startBoard([1]);
	await setStatus("closed");
	expect(
		await scalar(
			"select session_id::int from notifications where recipient_member_id = $1 and type = 'wait_ticket_ready'",
			[uid(2)],
		),
	).toBe(S);
});

it("다른 회차의 원장·참석에는 영향이 없다", async () => {
	await member(1);
	await attend(1, "confirmed", { session: 2 });
	await setStatus("closed", S);
	expect(await rows(1, 2)).toEqual([]);
	expect(await balance(1)).toBe(0);
});

// ── 당일 취소 감점은 대관 장소 회차에만(20260929000000) ──
async function atPlace(placeId: number | null) {
	await db.query("update sessions set place_id = $1 where id = $2", [placeId, S]);
}

it("비대관 장소 회차의 당일 취소는 감점하지 않는다", async () => {
	await member(1);
	await seedBalance(1, 3);
	await atPlace(2);
	await attend(1, "confirmed");
	await cancelSelf(1, true);
	expect(await rows(1)).toEqual([]);
	expect(await balance(1)).toBe(3);
});

it("장소가 없는 회차의 당일 취소도 감점하지 않는다", async () => {
	await member(1);
	await seedBalance(1, 3);
	await atPlace(null);
	await attend(1, "confirmed");
	await cancelSelf(1, true);
	expect(await rows(1)).toEqual([]);
});

it("대관 장소 회차의 당일 취소는 종전대로 −1", async () => {
	await member(1);
	await seedBalance(1, 3);
	await atPlace(1);
	await attend(1, "confirmed");
	await cancelSelf(1, true);
	expect(await rows(1)).toEqual([{ kind: "penalty", delta: -1, reason: "day_cancel" }]);
	expect(await balance(1)).toBe(2);
});

it("비대관 회차라도 당일 취소한 티켓은 종전대로 몰수, 사전 취소는 환원", async () => {
	await member(1);
	await member(2);
	await atPlace(2);
	await ticketHolder(1);
	await ticketHolder(2);
	await cancelSelf(1, true);
	await cancelSelf(2, false);
	expect(await rows(1)).toEqual([{ kind: "spend", delta: -7, reason: "join" }]);
	expect(await rows(2)).toEqual([
		{ kind: "spend", delta: -7, reason: "join" },
		{ kind: "refund", delta: 7, reason: "early_cancel" },
	]);
});

it("운영진이 뺀 경우는 대관 장소여도 감점하지 않는다", async () => {
	await member(1);
	await seedBalance(1, 3);
	await atPlace(1);
	await attend(1, "confirmed");
	await db.query("select set_config('test.admin', 'true', false)");
	await db.query("select set_config('test.day_cancel', 'true', false)");
	await db.query("select admin_cancel_attendance($1, $2)", [S, uid(1)]);
	await db.query("select set_config('test.admin', 'false', false)");
	expect(await rows(1)).toEqual([]);
});
