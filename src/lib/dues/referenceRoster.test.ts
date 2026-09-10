import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import legacy from "../../../supabase/tests/fixtures/dues-v2-legacy.sql?raw";
import seed from "../../../supabase/tests/fixtures/dues-v2-seed.sql?raw";
import sql from "../../../supabase/migrations/20260908020000_reference_meal_roster.sql?raw";

let db: PGlite;
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const ids = [3, 5, 6, 7].map(
	(n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
);
async function roster(meal: boolean, session = 1) {
	return (
		await db.query<{ roster: string[] }>(
			"select dues_v2_reference_members($1,$2) as roster",
			[session, meal],
		)
	).rows[0].roster;
}
beforeAll(async () => {
	db = new PGlite();
	await db.exec(legacy);
	await db.exec(sql);
}, 30_000);
beforeEach(async () => {
	await db.exec("begin");
	await db.exec(seed);
	await db.exec(
		"update sessions set is_regular=true,meal_enabled=true where id=1",
	);
	await db.query(
		"insert into members(id,name,is_guest) values($1,'늦참 게스트',true),($2,'대기자',false),($3,'취소자',false),($4,'보드 추가',false)",
		ids,
	);
	await db.query(
		"insert into attendances(session_id,member_id,status,meal_joining) values(1,$1,'confirmed',true),(1,$2,'confirmed',false),(1,$3,'late_pool',true),(1,$4,'waitlisted',true),(1,$5,'cancelled',true)",
		[A, B, ...ids.slice(0, 3)],
	);
	await db.query(
		"insert into session_players(session_id,member_id) values(1,$1),(1,$2),(1,$3)",
		[A, ids[1], ids[3]],
	);
});
afterEach(async () => {
	await db.exec("rollback");
});
afterAll(async () => {
	await db.close();
});

it("uses the schedule's meal participants, excludes waiting/cancelled/opted-out/board-only people, and keeps guests", async () => {
	expect(await roster(true)).toEqual([A, ids[0]]);
	// General roster also includes actual board members, independently of meal intent.
	expect(await roster(false)).toEqual([A, B, ids[0], ids[1], ids[3]]);
});

it("rejects default-true meal values when that session never collected meal attendance", async () => {
	await db.exec("savepoint regular");
	await db.exec("update sessions set meal_enabled=false where id=1");
	await expect(roster(true)).rejects.toThrow("회식 참석을 기록하지 않았습니다");
	await db.exec("rollback to savepoint regular");
	await db.exec("update sessions set is_regular=false where id=1");
	await expect(roster(true)).rejects.toThrow("회식 참석을 기록하지 않았습니다");
});

it("returns an empty roster if all recorded participants opted out, without changing attendance or dues", async () => {
	await db.exec("update attendances set meal_joining=false where session_id=1");
	const query =
		"select jsonb_build_object('attendance',(select jsonb_agg(to_jsonb(a)) from attendances a),'charges',(select jsonb_agg(to_jsonb(c)) from dues_charges c),'payments',(select jsonb_agg(to_jsonb(a)) from dues_allocations a)) as facts";
	const before = (await db.query(query)).rows;
	expect(await roster(true)).toEqual([]);
	expect((await db.query(query)).rows).toEqual(before);
});

it("requires admin access to reference rosters", async () => {
	await db.exec("set test.admin='false'; set role authenticated");
	await expect(roster(true)).rejects.toThrow("forbidden");
});
