// Isolated PostgreSQL engine. Exercises real functions and RLS, never the live database.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.sessions(id bigint primary key, is_active boolean default true, status text default 'active', board_drafts jsonb, board_drafts_version bigint default 0, court_count int default 2, cock_check_enabled boolean default false, editor_client_id text default 'editor', editor_name text, editor_lease_until timestamptz, match_assign_count int default 0, match_state_version int default 0);
create table public.members(id uuid primary key, auth_user_id uuid, name text, is_active boolean default true);
create table public.user_roles(member_id uuid, role text);
create table public.session_players(id uuid primary key, session_id bigint, member_id uuid, name text, status text default 'waiting', cock_checked boolean default true);
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
const staffProposalSql = readFileSync(new URL('../migrations/20260922020000_admin_viewer_match_proposals.sql', import.meta.url), 'utf8');
await db.exec(staffProposalSql); await db.exec(staffProposalSql);
const rejectionSql = readFileSync(new URL('../migrations/20260918020000_reject_match_proposals.sql', import.meta.url), 'utf8');
await db.exec(rejectionSql); await db.exec(rejectionSql);
const lockSql = readFileSync(new URL('../migrations/20260717000000_lock_sticky_no_heartbeat.sql', import.meta.url), 'utf8');
await db.exec(lockSql.slice(lockSql.indexOf('CREATE OR REPLACE FUNCTION board_save_drafts('), lockSql.indexOf('CREATE OR REPLACE FUNCTION board_assert_editor(')));
await db.exec(lockSql.slice(lockSql.indexOf('CREATE OR REPLACE FUNCTION board_assert_editor(')));
const assignSql = readFileSync(new URL('../migrations/20260817020000_advisor_function_search_path.sql', import.meta.url), 'utf8');
const assignStart = assignSql.indexOf('create or replace function public.assign_match(');
await db.exec(assignSql.slice(assignStart, assignSql.indexOf('$function$;', assignStart) + '$function$;'.length));
const startSql = readFileSync(new URL('../migrations/20260918030000_edit_and_start_match_proposals.sql', import.meta.url), 'utf8');
await db.exec(startSql); await db.exec(startSql);
const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
for (let i=1;i<=8;i++) {
 await db.query('insert into auth.users values($1)',[uid(i)]);
 await db.query('insert into public.members(id,auth_user_id,name) values($1,$1,$2)',[uid(i),`회원${i}`]);
 if(i<=6) await db.query('insert into public.session_players(id,session_id,member_id,name) values($1,1,$1,$2)',[uid(i),`회원${i}`]);
}
await db.exec(`insert into public.sessions(id,is_active,status,board_drafts) values(1,true,'active','{"teams":[],"reservations":[]}'),(2,true,'active',null)`);
await db.query('insert into public.session_players(id,session_id,member_id,name) values($1,2,$2,$3)',[uid(100),uid(6),'다른 세션']);
await db.query("insert into public.user_roles values($1,'admin'),($2,'admin')",[uid(1),uid(8)]);
const as = async (n, role='authenticated') => {
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n ? uid(n) : '']);
 await db.exec(`set role ${role}`);
};
const send = async (id, ids, session=1) => (await db.query('select public.create_match_proposal($1,$2,$3::uuid[]) p',[session,uid(id),ids.map(uid)])).rows[0].p;
const list = async () => (await db.query('select * from public.match_proposals')).rows;
const resolve = (id,status) => db.query('select public.resolve_match_proposal($1,$2)',[uid(id),status]);
await as(2);
const first=await send(200,[2,3]);
assert.equal(first.created_by,uid(2)); assert.deepEqual(first.player_names,['회원2','회원3']);
assert.equal((await send(200,[2,3])).id,first.id); // Lost response retry.
assert.equal((await list()).length,1);
for(const ids of [[],[2,2],[2,3,4,5,6],[100]]) await assert.rejects(send(201,ids));
await assert.rejects(db.query('select public.create_match_proposal(1,$1,null)',[uid(201)]));
await assert.rejects(db.query('select public.create_match_proposal(1,$1,array[null]::uuid[])',[uid(201)]));
assert.equal((await send(202,[3])).player_ids.length,1); // Author need not be among proposed members.
assert.equal((await send(203,[2,3,4,5])).player_ids.length,4);
await assert.rejects(resolve(200,'reviewed')); // Ordinary member cannot impersonate staff.
await assert.rejects(resolve(200,'rejected')); // Authors cannot reject on behalf of administrators.
await assert.rejects(db.query("update public.match_proposals set status='reviewed'"));
await assert.rejects(db.query('delete from public.match_proposals'));
await assert.rejects(db.query('insert into public.match_proposals(id,session_id,created_by,creator_name,player_ids,player_names) values($1,1,$2,\'forged\',array[$2]::uuid[],array[\'forged\'])',[uid(300),uid(3)]));
await as(3);
assert.deepEqual(await list(),[]); // Even a member named in the proposal cannot read it.
await assert.rejects(resolve(200,'withdrawn'));
await assert.rejects(send(200,[2,3])); // Id collision does not reveal author data.
await send(204,[3,4]); assert.equal((await list()).length,1);
await as(1); assert.equal((await list()).length,4); // Admin on another phone.
await resolve(200,'reviewed');
await assert.rejects(resolve(200,'withdrawn')); // Only author may withdraw.
await as(8); assert.equal((await list()).length,4); // Admin need not be playing in this session.
await as(7); await assert.rejects(send(205,[2])); // Nonparticipant cannot submit.
assert.deepEqual(await list(),[]);
await as(2); assert.equal((await list()).find(p=>p.id===uid(200)).status,'reviewed');
await resolve(200,'withdrawn'); await resolve(200,'withdrawn');
await as(1); await assert.rejects(resolve(200,'reviewed')); // Delayed staff action cannot revive withdrawn proposal.
await assert.rejects(resolve(200,'rejected'));
await resolve(203,'rejected'); await resolve(203,'rejected'); // Admin dismissal is idempotent.
await assert.rejects(resolve(203,'reviewed')); // A stale confirmation cannot revive a rejection.
await as(2);
assert.equal((await list()).find(p=>p.id===uid(203)).status,'rejected'); // The author can receive the terminal UPDATE.
await assert.rejects(resolve(203,'withdrawn'));
assert.equal((await send(203,[2,3,4,5])).status,'rejected'); // A delayed send retry does not re-open it.
await as(3); assert.equal((await list()).some(p=>p.id===uid(203)),false);
await as(0,'anon'); await assert.rejects(list()); await assert.rejects(send(206,[2]));
await as(0); await assert.rejects(send(206,[2]));
await db.exec('reset role');
assert.deepEqual((await db.query('select board_drafts from public.sessions where id=1')).rows[0].board_drafts,{teams:[],reservations:[]});
// Private roster updates use optimistic versions and the real editor lock.
await as(2);
let editable = await send(400,[2,3]);
let second = await send(401,[4,5]);
const update = (p, ids) => ({ id:p.id, updated_at:p.updated_at, player_ids:ids.map(uid) });
const edit = async (updates, client='editor') => (await db.query('select public.edit_match_proposals($1::jsonb,$2,$3) p',[JSON.stringify(updates),client,'운영진'])).rows[0].p;
const start = async (p, match=500, court=1, ids=[2,3,4,5], client='editor') => (await db.query('select public.start_match_proposal($1,$2,$3,$4,$5,$6::uuid[],$7::uuid[],$8,$9) p',[p.id,p.updated_at,uid(match),court,'혼복',ids.slice(0,2).map(uid),ids.slice(2).map(uid),client,'운영진'])).rows[0].p;
await assert.rejects(edit([update(editable,[2,3,4])]));
await assert.rejects(start(editable));
await as(1);
await assert.rejects(edit([update(editable,[2,3,4])],null));
await assert.rejects(edit([update(editable,[2,3,4])],'other'));
for (const ids of [[2,2],[2,3,4,5,6],[100]]) await assert.rejects(edit([update(editable,ids)]));
const old = editable;
[editable] = await edit([update(editable,[2,3,4])]);
assert.deepEqual(editable.player_names,['회원2','회원3','회원4']);
await assert.rejects(edit([update(old,[2,3])]));
await assert.rejects(edit([update(editable,[2,3]),{...update(second,[4,5]),updated_at:old.updated_at}]));
assert.deepEqual((await list()).find(p=>p.id===editable.id).player_ids,[uid(2),uid(3),uid(4)]); // Entire transfer rolled back.
[editable,second] = await edit([update(editable,[2,3]),update(second,[4,5,6])]);
await as(2); assert.deepEqual((await list()).find(p=>p.id===second.id).player_ids,[uid(4),uid(5),uid(6)]);
await as(3); assert.equal((await list()).some(p=>p.id===editable.id),false);
await as(1);
[editable] = await edit([update(editable,[2,3,4,5])]);
await assert.rejects(start(old)); // Stale roster cannot start.
await assert.rejects(start(editable,500,1,[2,3,4,6]));
await assert.rejects(start(editable,500,3));
await assert.rejects(start(editable,500,1,[2,3,4,5],null));
await assert.rejects(start(editable,500,1,[2,3,4,5],'other'));
await db.exec('reset role');
await db.exec("update public.session_players set status='resting' where name='회원2'");
await as(1); await assert.rejects(start(editable));
await db.exec('reset role');
await db.exec("update public.session_players set status='waiting',cock_checked=false where name='회원2'; update public.sessions set cock_check_enabled=true where id=1");
await as(1); await assert.rejects(start(editable));
await db.exec('reset role');
await db.exec("update public.session_players set cock_checked=true; update public.sessions set board_drafts=jsonb_build_object('teams',jsonb_build_array(jsonb_build_object('memberIds',jsonb_build_array('"+uid(2)+"'))),'reservations','[]'::jsonb) where id=1");
await as(1); await assert.rejects(start(editable));
await db.exec('reset role');
await db.exec("update public.sessions set board_drafts='{\"teams\":[],\"reservations\":[]}' where id=1");
await db.query("insert into public.matches(id,session_id,court_id,status) values($1,1,1,'playing')",[uid(600)]);
await as(1); await assert.rejects(start(editable));
assert.equal((await list()).find(p=>p.id===editable.id).status,'pending');
await db.exec('reset role'); await db.exec('delete from public.matches');
await as(1);
const started=await start(editable);
assert.equal(started.status,'started'); assert.equal(started.match_id,uid(500));
assert.equal((await start(editable,501)).match_id,uid(500)); // Lost reply retry cannot create another match.
await assert.rejects(resolve(400,'rejected')); await assert.rejects(edit([update(started,[2,3])]));
await as(2); await assert.rejects(resolve(400,'withdrawn'));
await as(1);
const [rejected] = await edit([update(second,[])]); assert.equal(rejected.status,'rejected');
await db.exec('reset role');
assert.equal((await db.query('select count(*)::int n from public.matches')).rows[0].n,1);
assert.equal((await db.query("select count(*)::int n from public.session_players where status='playing'")).rows[0].n,4);
assert.equal((await db.query('select match_assign_count from public.sessions where id=1')).rows[0].match_assign_count,1);
await db.exec("update public.sessions set status='closed' where id=1");
await as(2); await assert.rejects(send(206,[2]));
// Permanent court proposal replacement is atomic and does not create a match.
const applySql = readFileSync(new URL('../migrations/20260922010000_apply_proposal_to_court_group.sql', import.meta.url), 'utf8');
await db.exec('reset role');
await db.exec(applySql); await db.exec(applySql);
await db.exec("update public.sessions set status='active',editor_client_id='editor' where id=1; delete from public.matches; update public.session_players set status='waiting'");
await as(2);
const replacement = await send(700,[2,3,5,6]);
const apply = async (p, team='court-1', version=0, client='editor') => (await db.query(
 'select public.apply_match_proposal_to_group($1,$2,$3,$4,$5,$6) result',
 [p.id,p.updated_at,team,version,client,'운영진'])).rows[0].result;
const draftPayload = { teams: [
 {id:'court-1',courtId:1,memberIds:[1,2,3,4].map(uid),createdMs:1,slots:{[uid(2)]:3},confirmedMs:123,createdBy:'old'},
 {id:'court-2',courtId:2,memberIds:[],createdMs:2}],
 reservations:[{id:'reservation-1',playerId:uid(6),teamId:'court-1',createdMs:2},
 {id:'reservation-2',playerId:uid(1),teamId:'court-2',createdMs:3}],
 layout: {version:1,teams:{'court-1':{x:620,y:250},'court-2':{x:220,y:450}},courts:{'1':{x:620,y:250},'2':{x:220,y:450}},magnets:{[uid(6)]:{x:410,y:700}}} };
await db.exec('reset role');
await db.query('update public.sessions set board_drafts=$1 where id=1',[draftPayload]);
await as(2); await assert.rejects(apply(replacement), /not editor/);
await as(1);
await assert.rejects(apply(replacement,'court-1',0,'other'), /not editor/);
await assert.rejects(apply(replacement,'court-1',0,null), /not editor/);
await assert.rejects(apply(replacement,'court-1',99), /board changed/);
await assert.rejects(apply({...replacement,updated_at:'2000-01-01'}), /proposal changed/);
await assert.rejects(apply(replacement,'missing'), /court group not found/);
await db.exec('reset role');
await db.query("insert into public.matches(id,session_id,court_id,status) values($1,1,1,'playing')",[uid(701)]);
await as(1); await assert.rejects(apply(replacement), /court already assigned/);
await db.exec('reset role');
assert.deepEqual((await db.query('select board_drafts from public.sessions where id=1')).rows[0].board_drafts,draftPayload);
await db.exec('delete from public.matches');
await db.query("update public.sessions set board_drafts=jsonb_set(board_drafts,'{teams,1,memberIds}',$1) where id=1",[JSON.stringify([uid(5)])]);
await as(1); await assert.rejects(apply(replacement), /players already grouped/);
await db.exec('reset role');
await db.query('update public.sessions set board_drafts=$1 where id=1',[draftPayload]);
await db.query("update public.session_players set status='resting' where id=$1",[uid(5)]);
await as(1); await assert.rejects(apply(replacement), /players not ready/);
await db.exec('reset role'); await db.exec("update public.session_players set status='waiting'");
await as(1);
const applied = await apply(replacement);
assert.equal(applied.proposal.status,'applied');
assert.equal(applied.proposal.applied_team_id,'court-1');
assert.equal(applied.version,1);
assert.deepEqual(applied.drafts.teams[0],{id:'court-1',courtId:1,memberIds:[2,3,5,6].map(uid),createdMs:1,createdBy:'회원2'});
assert.deepEqual(applied.drafts.teams[1],draftPayload.teams[1]);
assert.deepEqual(applied.drafts.reservations,[draftPayload.reservations[1]]);
assert.deepEqual(applied.drafts.layout,draftPayload.layout); // Approval replaces the roster without losing saved coordinates.
assert.equal((await apply(replacement)).version,1); // Lost response retry does not overwrite again.
await assert.rejects(apply(replacement,'court-2',1), /proposal already closed/);
await assert.rejects(resolve(700,'reviewed'), /proposal already closed/);
await db.exec('reset role');
assert.equal((await db.query('select count(*)::int n from public.matches')).rows[0].n,0);
await as(2); assert.equal((await list()).find(p=>p.id===uid(700)).status,'applied');
console.log('Court proposal replacement: full roster reset, reservation cleanup, stable identity, editor/version/playing guards, atomic rejection, retry, no automatic start passed.');
const saveBoard = async (data, base=1, client='editor') => (await db.query(
 'select public.board_save_drafts(1,$1,$2,$3,$4) version',[client,'운영진',data,base])).rows[0].version;
assert.equal(await saveBoard(applied.drafts),null); // Members cannot persist local moves.
await as(1);
assert.equal(await saveBoard(applied.drafts,1,'other'),null);
assert.equal(await saveBoard(applied.drafts,0),null); // Stale coordinates cannot overwrite a newer layout.
assert.equal(Number(await saveBoard(applied.drafts)),2);
await db.exec('reset role');
assert.deepEqual((await db.query('select board_drafts from public.sessions where id=1')).rows[0].board_drafts,applied.drafts);
console.log('Board layout SQL: existing CAS stores coordinates, rejects viewers/stale editors, and proposal approval preserves the layout.');
await as(8); // Administrator 8 has no session_players row and owns no editing lock.
const staffProposal = await send(800,[2,3]);
assert.equal(staffProposal.created_by,uid(8));
assert.equal(staffProposal.creator_name,'회원8');
assert.equal(staffProposal.status,'pending');
assert.equal((await send(800,[2,3])).id,staffProposal.id);
await assert.rejects(send(801,[100]), /player left session/);
await as(2); assert.equal((await list()).some(p=>p.id===uid(800)),false);
await as(1); assert.equal((await list()).some(p=>p.id===uid(800)),true);
await as(8); await resolve(800,'withdrawn');
await db.exec('reset role');
const unchangedBoard = (await db.query('select board_drafts,board_drafts_version,editor_client_id from public.sessions where id=1')).rows[0];
assert.deepEqual(unchangedBoard.board_drafts,applied.drafts);
assert.equal(Number(unchangedBoard.board_drafts_version),2);
assert.equal(unchangedBoard.editor_client_id,'editor');
assert.equal((await db.query('select count(*)::int n from public.matches')).rows[0].n,0);
await db.query('delete from public.user_roles where member_id=$1',[uid(8)]);
await as(8); await assert.rejects(send(802,[2,3]), /not participant/);
console.log('Staff-only proposals: nonparticipant administrators can submit/withdraw, RLS and shared-board authority remain unchanged, revoked roles are rejected.');
await db.close();
console.log('Private match proposal SQL: RLS, roles, 1–4 members, idempotency, rejection lifecycle, private roster editing, atomic direct start, editor guards, retries and shared-board isolation passed.');
