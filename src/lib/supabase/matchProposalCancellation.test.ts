import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const read = (name: string) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8");
const migration = read("20260918050000_cancel_overlapping_match_proposals.sql");
function extract(file: string, name: string) {
 const source = read(file);
 const start = source.search(new RegExp(`create or replace function (?:public\\.)?${name}\\(`, "i"));
 if (start < 0) throw new Error(name);
 const tail = source.slice(start), tag = tail.match(/\bas\s+(\$\w*\$)/i)!;
 return tail.slice(0, tail.indexOf(`${tag[1]};`, tag.index! + tag[0].length) + tag[1].length + 1);
}
let db: PGlite;
async function proposal(id: number, ids: number[], status = "pending", session = 1, author = 2) {
 await db.query("insert into match_proposals(id,session_id,created_by,creator_name,player_ids,player_names,status) values($1,$2,$3,'author',$4,$5,$6)",
  [uid(id), session, uid(author), ids.map(uid), ids.map(String), status]);
}
async function statuses() {
 return (await db.query<{ id: string; status: string; match_id: string | null }>("select id,status,match_id from match_proposals order by id")).rows;
}
async function assign(id = 500, players = [1, 2, 3, 4], court = 1) {
 await db.query("select assign_match($1,1,$2,'혼복',$3,$4,$5,$6,'editor','운영진')", [uid(id), court, ...players.map(uid)]);
}
async function start(id = 100, match = 500) {
 return (await db.query<{ result: { status: string; match_id: string } }>(`select start_match_proposal(id,updated_at,$2,1,'혼복',player_ids[1:2],player_ids[3:4],'editor','운영진') as result from match_proposals where id=$1`, [uid(id),uid(match)])).rows[0]?.result;
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
  create function auth.uid() returns uuid language sql as $$select current_setting('test.user')::uuid$$;
  create function is_admin() returns boolean language sql as $$select auth.uid()='${uid(1)}'::uuid$$;
  create table sessions(id bigint primary key,is_active boolean default true,status text default 'active',court_count int default 3,cock_check_enabled boolean default false,board_drafts jsonb default '{"teams":[],"reservations":[]}',match_assign_count int default 0,match_state_version int default 0);
  create table members(id uuid primary key,auth_user_id uuid,name text,is_active boolean default true);
  create table session_players(id uuid primary key,session_id bigint references sessions,member_id uuid references members,name text,status text default 'waiting',cock_checked boolean default true);
  create table matches(id uuid primary key,session_id bigint references sessions,court_id int,game_type text,team_a_p1 uuid,team_a_p2 uuid,team_b_p1 uuid,team_b_p2 uuid,status text,assigned_by text);
  create unique index one_court on matches(session_id,court_id) where status='playing';
  create table match_proposals(id uuid primary key,session_id bigint references sessions,created_by uuid,creator_name text,player_ids uuid[],player_names text[],status text default 'pending',created_at timestamptz default now(),updated_at timestamptz default now());
  create function board_assert_editor(bigint,text,text,integer default 20) returns void language plpgsql as $$begin
   if public.is_admin() is not true or $2 <> 'editor' then raise exception 'not editor'; end if;
   perform 1 from public.sessions where id=$1 for update;
  end$$;
  alter table match_proposals enable row level security;
  grant select on match_proposals to authenticated;
  create policy private_proposals on match_proposals for select to authenticated using(created_by=auth.uid() or is_admin());
  grant usage on schema auth to authenticated;
 `);
 await db.exec(extract("20260918010000_private_match_proposals.sql", "create_match_proposal"));
 await db.exec(extract("20260817020000_advisor_function_search_path.sql", "assign_match"));
 await db.exec(read("20260918030000_edit_and_start_match_proposals.sql"));
 await db.exec(migration);
});
beforeEach(async () => {
 await db.exec(`begin; select set_config('test.user','${uid(1)}',true); insert into sessions(id) values(1),(2);`);
 for (let i = 1; i <= 10; i++) {
  await db.query("insert into members(id,auth_user_id,name) values($1,$1,$2)",[uid(i),String(i)]);
  await db.query("insert into session_players(id,session_id,member_id,name) values($1,1,$1,$2)",[uid(i),String(i)]);
 }
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });

it("starts the selected proposal and cancels every overlapping pending/reviewed proposal across authors", async () => {
 await proposal(100,[1,2,3,4]); await proposal(101,[1,5],"pending",1,3); await proposal(102,[4,6],"reviewed",1,4);
 await proposal(103,[5,6]); await proposal(104,[1,2],"pending",2); await proposal(105,[1,3],"withdrawn");
 expect(await start()).toEqual(expect.objectContaining({status:"started",match_id:uid(500)}));
 expect((await statuses()).map(row=>row.status)).toEqual(["started","rejected","rejected","pending","pending","withdrawn"]);
 expect(await start()).toEqual(expect.objectContaining({status:"started",match_id:uid(500)}));
 expect((await db.query("select * from matches")).rows).toHaveLength(1);
});

it("ordinary shared-team starts cancel overlaps and completing the match never resurrects them", async () => {
 await proposal(100,[2,5]); await proposal(101,[6,7]);
 await assign();
 expect((await statuses()).map(row=>row.status)).toEqual(["rejected","pending"]);
 await db.exec("update matches set status='completed'");
 expect((await statuses()).map(row=>row.status)).toEqual(["rejected","pending"]);
});

it("cancels a late create request when the match start won the session lock", async () => {
 await assign();
 const sql="select create_match_proposal(1,$1,$2) as result";
 const result=await db.query<{result:{status:string}}>(sql,[uid(100),[uid(2),uid(5)]]);
 expect(result.rows[0].result.status).toBe("rejected");
 expect((await db.query<{result:{status:string}}>(sql,[uid(100),[uid(2),uid(5)]])).rows[0].result.status).toBe("rejected");
 await db.exec("update matches set status='completed'; update session_players set status='waiting'");
 expect((await db.query<{result:{status:string}}>(sql,[uid(101),[uid(2),uid(5)]])).rows[0].result.status).toBe("pending");
});

it("cancels a roster edit that adds a playing member and blocks reviving a cancelled proposal", async () => {
 await proposal(100,[5,6]); await assign();
 await db.query(`select edit_match_proposals(jsonb_build_array(jsonb_build_object('id',id,'updated_at',updated_at,'player_ids',$2::jsonb)),'editor','운영진') from match_proposals where id=$1`,[uid(100),JSON.stringify([uid(2),uid(5)])]);
 expect((await statuses())[0].status).toBe("rejected");
 await fails(()=>db.query("select resolve_match_proposal($1,'reviewed')",[uid(100)]),/proposal already closed/);
});

it("a playing roster change cancels proposals for the newly added member", async () => {
 await proposal(100,[5,6]); await assign();
 expect((await statuses())[0].status).toBe("pending");
 await db.query("update matches set team_a_p1=$1 where id=$2",[uid(5),uid(500)]);
 expect((await statuses())[0].status).toBe("rejected");
});

it("rolls proposal cancellation back if assignment fails after the match insert", async () => {
 await proposal(100,[1,5]);
 await db.exec(`alter table session_players add constraint fail_after_insert check (id <> '${uid(1)}'::uuid or status <> 'playing')`);
 await fails(()=>assign(),/fail_after_insert/);
 expect((await statuses())[0].status).toBe("pending");
 expect((await db.query("select * from matches")).rows).toHaveLength(0);
});

it("does not cancel proposals when a non-editor tries to start", async () => {
 await proposal(100,[1,2,3,4]);
 await db.query("select set_config('test.user',$1,true)",[uid(2)]);
 await fails(()=>start(),/not editor/);
 expect((await statuses())[0].status).toBe("pending");
});

it("preserves private visibility and disallows direct member writes", async () => {
 await proposal(100,[1,5],"pending",1,2); await proposal(101,[2,6],"pending",1,3);
 await assign();
 await db.query("select set_config('test.user',$1,true)",[uid(2)]);
 await db.exec("set local role authenticated");
 expect((await statuses()).map(row=>row.id)).toEqual([uid(100)]);
 await fails(()=>db.query("update match_proposals set status='pending' where id=$1",[uid(100)]),/permission denied/);
});

it("cleans up previously stale proposals on migration and can be reapplied", async () => {
 await db.exec("alter table matches disable trigger trg_match_cancel_overlapping_proposals; alter table match_proposals disable trigger trg_proposal_cancel_playing_members");
 await proposal(100,[1,5]); await proposal(101,[6,7]); await assign();
 await db.exec(migration);
 expect((await statuses()).map(row=>row.status)).toEqual(["rejected","pending"]);
 await db.exec(migration);
 expect((await statuses()).map(row=>row.status)).toEqual(["rejected","pending"]);
});
