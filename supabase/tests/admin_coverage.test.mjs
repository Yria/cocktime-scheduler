// Isolated PostgreSQL coverage guard tests; no live writes.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.sessions(id bigint primary key, is_active boolean default true, status text default 'active', board_drafts jsonb, court_count int default 2, cock_check_enabled boolean default false, editor_client_id text default 'editor', editor_name text, editor_lease_until timestamptz, match_assign_count int default 0, match_state_version int default 0);
create table public.members(id uuid primary key, auth_user_id uuid, name text, is_active boolean default true);
create table public.user_roles(member_id uuid, role text);
create table public.session_players(id uuid primary key, session_id bigint, member_id uuid, name text, status text default 'waiting', cock_checked boolean default true, wait_since timestamptz);
create table public.matches(id uuid primary key, session_id bigint, court_id int, game_type text, team_a_p1 uuid, team_a_p2 uuid, team_b_p1 uuid, team_b_p2 uuid, status text, assigned_by text);
create unique index on public.matches(session_id,court_id) where status='playing';
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.members m join public.user_roles r on r.member_id=m.id
 where m.auth_user_id=auth.uid() and m.is_active and r.role='admin')
$$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid(), public.is_admin() to authenticated;
`);
const sql = readFileSync(new URL('../migrations/20260918010000_private_match_proposals.sql', import.meta.url), 'utf8');
await db.exec(sql); await db.exec(sql);
const rejectionSql = readFileSync(new URL('../migrations/20260918020000_reject_match_proposals.sql', import.meta.url), 'utf8');
await db.exec(rejectionSql); await db.exec(rejectionSql);
const lockSql = readFileSync(new URL('../migrations/20260717000000_lock_sticky_no_heartbeat.sql', import.meta.url), 'utf8');
await db.exec(lockSql.slice(lockSql.indexOf('CREATE OR REPLACE FUNCTION board_assert_editor(')));
const assignSql = readFileSync(new URL('../migrations/20260817020000_advisor_function_search_path.sql', import.meta.url), 'utf8');
const assignStart = assignSql.indexOf('create or replace function public.assign_match(');
await db.exec(assignSql.slice(assignStart, assignSql.indexOf('$function$;', assignStart) + '$function$;'.length));
const rosterStart = assignSql.indexOf('create or replace function public.set_match_roster(');
await db.exec(assignSql.slice(rosterStart, assignSql.indexOf('$function$;', rosterStart) + '$function$;'.length));
const startSql = readFileSync(new URL('../migrations/20260918030000_edit_and_start_match_proposals.sql', import.meta.url), 'utf8');
await db.exec(startSql); await db.exec(startSql);

const coverageSql = readFileSync(new URL('../migrations/20260918040000_admin_coverage_start_guard.sql', import.meta.url), 'utf8');
await db.exec(coverageSql); await db.exec(coverageSql);
const requiredSql = readFileSync(new URL('../migrations/20260920020000_require_admin_match_coverage.sql', import.meta.url), 'utf8');
await db.exec(requiredSql); await db.exec(requiredSql);

const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
await db.exec("insert into public.sessions(id, court_count, board_drafts) values(1,4,'{\"teams\":[],\"reservations\":[]}')");
for (let i = 1; i <= 12; i++) {
 await db.query('insert into auth.users values($1)', [uid(i)]);
 await db.query('insert into public.members(id,auth_user_id,name) values($1,$1,$2)', [uid(i), `선수${i}`]);
 await db.query('insert into public.session_players(id,session_id,member_id,name) values($1,1,$1,$2)', [uid(i), `선수${i}`]);
}
await db.query("insert into public.user_roles values($1,'admin'),($2,'admin')", [uid(1), uid(5)]);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(1)]);
await db.exec('set role authenticated');
const start = (match, court, ids, override = false) => db.query(
 'select public.assign_match_with_admin_coverage($1,1,$2,\'남복\',$3,$4,$5,$6,\'editor\',\'운영진\',$7)',
 [uid(match), court, ...ids.map(uid), override]);
await start(101, 1, [1,2,3,4]);
await assert.rejects(start(102, 2, [5,6,7,8]), /admin coverage required/);
await db.exec('reset role');
assert.equal((await db.query('select count(*)::int n from matches')).rows[0].n, 1);
assert.equal((await db.query('select match_assign_count n from sessions where id=1')).rows[0].n, 1);
assert.equal((await db.query('select status from session_players where id=$1',[uid(5)])).rows[0].status, 'waiting');
await db.exec('set role authenticated');
await start(103, 3, [9,10,11,12]); // Ordinary team can use the empty court.
await assert.rejects(start(102, 2, [5,6,7,8], true), /admin coverage required/); // Cached clients cannot override.
const legacyStart = (match, court, ids) => db.query("select public.assign_match($1,1,$2,'남복',$3,$4,$5,$6,'editor','운영진')", [uid(match),court,...ids.map(uid)]);
await assert.rejects(legacyStart(102,2,[5,6,7,8]), /admin coverage required/);
const roster = (match, ids, removed=[], added=[]) => db.query("select * from public.set_match_roster($1,1,$2,$3,$4,$5,$6::uuid[],$7::uuid[],'editor','운영진')",[uid(match),...ids.map(uid),removed.map(uid),added.map(uid)]);
await assert.rejects(roster(103,[5,10,11,12],[9],[5]), /admin coverage required/);
await db.exec('reset role');
const before = (await db.query('select match_state_version from sessions where id=1')).rows[0].match_state_version;
await assert.rejects(db.query('update matches set team_a_p1=$1 where id=$2',[uid(5),uid(103)]), /admin coverage required/);
assert.equal((await db.query('select team_a_p1 from matches where id=$1',[uid(103)])).rows[0].team_a_p1,uid(9));
assert.equal((await db.query('select match_state_version from sessions where id=1')).rows[0].match_state_version,before);
await db.exec('set role authenticated');
// Staff may exchange places: the outgoing administrator restores coverage.
await roster(101,[5,2,3,4],[1],[5]);
await assert.rejects(roster(103,[1,10,11,12],[9],[1]), /admin coverage required/);
await roster(101,[2,5,4,3]); // Rearranging the same players remains valid.
await db.exec('reset role');
assert.equal((await db.query('select status from session_players where id=$1',[uid(1)])).rows[0].status,'waiting');
assert.equal((await db.query('select status from session_players where id=$1',[uid(5)])).rows[0].status,'playing');
await db.query("update matches set status='completed' where id=$1",[uid(101)]); // Ending a match is never blocked.
await db.exec('set role authenticated');
await db.exec('reset role');
await db.exec("delete from matches; update session_players set status='waiting'");
await db.exec('set role authenticated');
await assert.rejects(start(104, 1, [1,5,2,3]), /admin coverage required/); // Both remaining staff in one team.
await db.exec('reset role');
await db.query("update session_players set status='resting' where id=$1", [uid(5)]);
await db.exec('set role authenticated');
await start(105, 1, [1,2,3,4]); // Resting staff can operate the board.
await db.exec('reset role');
await db.exec("delete from matches; update session_players set status='waiting'; update sessions set cock_check_enabled=true");
await db.query('update session_players set cock_checked=false where id=$1', [uid(5)]);
await db.exec('set role authenticated');
await assert.rejects(start(106, 1, [1,2,3,4]), /admin coverage required/); // Registered but not arrived.
await db.exec('reset role');
await db.exec('update session_players set cock_checked=true');
await db.query('delete from session_players where id=$1', [uid(5)]);
await db.exec('set role authenticated');
await assert.rejects(start(107, 1, [1,2,3,4]), /admin coverage required/); // Sole present administrator.
await assert.rejects(start(107, 1, [1,2,3,4], true), /admin coverage required/);
await db.exec('reset role');
await db.query('update session_players set cock_checked=false where id=$1',[uid(1)]);
await db.exec('set role authenticated');
await assert.rejects(legacyStart(107,1,[1,2,3,4]), /admin coverage required/); // Entering a game proves presence even via an old unchecked path.
await db.exec('reset role');
await db.exec('update session_players set cock_checked=true');
await db.exec('set role authenticated');
await db.exec('reset role');
await db.exec("delete from matches; update session_players set status='waiting'");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(2)]);
await db.exec('set role authenticated');
const proposal = (await db.query('select public.create_match_proposal(1,$1,$2::uuid[]) p', [uid(200), [1,2,3,4].map(uid)])).rows[0].p;
const proposeStart = override => db.query('select public.start_match_proposal_with_admin_coverage($1,$2,$3,1,\'남복\',$4::uuid[],$5::uuid[],\'editor\',\'운영진\',$6) p',
 [proposal.id, proposal.updated_at, uid(201), [1,2].map(uid), [3,4].map(uid), override]);
await assert.rejects(proposeStart(true)); // Ordinary members cannot use the override.
await db.exec('reset role');
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(1)]);
await db.exec('set role authenticated');
await assert.rejects(proposeStart(false), /admin coverage required/);
await assert.rejects(proposeStart(true), /admin coverage required/);
await assert.rejects(db.query("select public.start_match_proposal($1,$2,$3,1,'남복',$4::uuid[],$5::uuid[],'editor','운영진')",[proposal.id,proposal.updated_at,uid(201),[1,2].map(uid),[3,4].map(uid)]), /admin coverage required/);
assert.equal((await db.query('select status from match_proposals where id=$1',[proposal.id])).rows[0].status,'pending');
await db.exec('reset role');
await db.query('insert into session_players(id,session_id,member_id,name) values($1,1,$1,$2)',[uid(5),'복귀한 운영진']);
await db.exec('set role authenticated');
assert.equal((await proposeStart(false)).rows[0].p.status, 'started');
assert.equal((await proposeStart(false)).rows[0].p.match_id, uid(201)); // Retry remains idempotent.
await assert.rejects(db.query('select public.assert_match_admin_coverage(1,$1::uuid[],true)', [[1,2,3,4].map(uid)]));
await assert.rejects(db.query('select public.assert_match_admin_coverage_for_roster(1,$1::uuid[],null)', [[1,2,3,4].map(uid)]));

// The latest policy requires an explicit confirmation instead of a blanket ban.
await db.exec('reset role');
const confirmationSql = readFileSync(new URL('../migrations/20260922030000_confirm_admin_absence.sql', import.meta.url), 'utf8');
await db.exec(confirmationSql); await db.exec(confirmationSql);
await db.exec("delete from matches; update session_players set status='waiting'");
await db.exec('set role authenticated');
await assert.rejects(start(301, 1, [1,5,2,3]), /admin coverage required/);
await db.exec('begin');
await start(301, 1, [1,5,2,3], true);
await db.exec('reset role');
assert.equal((await db.query('select count(*)::int n from matches')).rows[0].n, 1);
assert.equal((await db.query("select coalesce(current_setting('cocktime.admin_absence_approval',true),'') v")).rows[0].v, '');
await db.exec('commit');
await db.exec("delete from matches; update session_players set status='waiting'");
await db.exec('set role authenticated');
await assert.rejects(legacyStart(302,1,[1,5,2,3]), /admin coverage required/);
await assert.rejects(start(302,1,[1,5,2,3]), /admin coverage required/); // No approval is carried to the next start.
await db.exec('reset role');
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(2)]);
await db.exec('set role authenticated');
await assert.rejects(start(303,1,[1,5,2,3],true), /not editor/);
await db.exec('reset role');
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(1)]);
await db.query("update sessions set editor_client_id='another-editor' where id=1");
await db.exec('set role authenticated');
await assert.rejects(start(303,1,[1,5,2,3],true), /not editor/);
await db.exec('reset role');
await db.exec("update sessions set editor_client_id='editor'; delete from session_players where id='00000000-0000-0000-0000-000000000005'; delete from match_proposals");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(2)]);
await db.exec('set role authenticated');
const confirmedProposal = (await db.query('select public.create_match_proposal(1,$1,$2::uuid[]) p', [uid(400), [1,2,3,4].map(uid)])).rows[0].p;
await db.exec('reset role');
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(1)]);
await db.exec('set role authenticated');
const confirmProposalStart = allow => db.query("select public.start_match_proposal_with_admin_coverage($1,$2,$3,1,'남복',$4::uuid[],$5::uuid[],'editor','운영진',$6) p",
 [confirmedProposal.id, confirmedProposal.updated_at, uid(401), [1,2].map(uid), [3,4].map(uid), allow]);
await assert.rejects(confirmProposalStart(false), /admin coverage required/);
assert.equal((await confirmProposalStart(true)).rows[0].p.status, 'started');
assert.equal((await confirmProposalStart(true)).rows[0].p.match_id, uid(401));
await db.close();
console.log('Admin coverage SQL passed: historical guards and latest explicit confirmation, one-match scope, editor authorization, proposal retry.');
