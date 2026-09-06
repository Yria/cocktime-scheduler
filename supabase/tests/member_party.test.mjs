// Run against an isolated PostgreSQL WASM database; no live Supabase connection.
// Install PGlite outside the repo and pass its module path via PGLITE_MODULE.
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`
create role anon;
create role authenticated;
create schema auth;
create schema realtime;
create table realtime.sent (payload jsonb, event text, topic text, private boolean);
create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language plpgsql as $$
begin
 if current_setting('test.realtime_failure', true) = 'on' then raise exception 'transport unavailable'; end if;
 insert into realtime.sent values(payload, event, topic, private);
end;
$$;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.sessions (
 id bigint primary key, is_active boolean default true, status text default 'active',
 cock_check_enabled boolean default true, board_drafts jsonb, board_drafts_version bigint default 0,
 sync_version bigint default 0, match_state_version bigint default 0, court_count int default 3,
 editor_client_id text, editor_name text, editor_lease_until timestamptz
);
create table public.members (id uuid primary key, auth_user_id uuid unique references auth.users(id), is_active boolean default true);
create table public.user_roles (member_id uuid references public.members(id), role text, primary key(member_id, role));
create table public.session_players (id uuid primary key, session_id bigint references public.sessions(id), member_id uuid references public.members(id), status text default 'waiting', cock_checked boolean default true);
create table public.matches (id uuid primary key, session_id bigint references public.sessions(id), status text default 'playing', court_id int default 1, team_a_p1 uuid, team_a_p2 uuid, team_b_p1 uuid, team_b_p2 uuid);
`);
const migration = readFileSync(new URL('../migrations/20260907010000_member_party.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration); // Replay safety.
const realtimeMigration = readFileSync(new URL('../migrations/20260907020000_member_party_realtime.sql', import.meta.url), 'utf8');
await db.exec(realtimeMigration);
await db.exec(realtimeMigration); // Trigger/function replay must not duplicate events or reset RPC grants.
await db.exec(`create trigger bump_sync before update on public.sessions for each row execute function public.sessions_bump_sync_version();`);
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
for (let i=1; i<=8; i++) {
 await db.query('insert into auth.users values($1)', [uid(i)]);
 await db.query('insert into public.members(id,auth_user_id) values($1,$1)', [uid(i)]);
}
const existingDrafts = {
 teams: [{id: 'existing-team', memberIds: [uid(7)], createdMs: 1}],
 reservations: [{id: 'existing-reservation', playerId: uid(8), teamId: 'existing-team', createdMs: 2}],
};
await db.query('insert into public.sessions(id,board_drafts) values(1,$1),(2,null)', [existingDrafts]);
for (let i=1; i<=7; i++) await db.query('insert into public.session_players(id,member_id,session_id) values($1,$1,1)', [uid(i)]);
await db.query("insert into public.user_roles values($1,'admin'),($2,'admin')", [uid(1), uid(8)]); // Admin 8 absent from session.
let currentUser = 0;
const as = async n => { currentUser = n; return db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(n)]); };
const rpc = async (name,args) => (await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result;
const state = () => rpc('member_party_state',[1]);
const signals = async () => (await db.query('select * from realtime.sent')).rows;
const clearSignals = () => db.exec('truncate realtime.sent');
const hold = (client, holding=true, round=null, boardClient=`board-${currentUser}`) => rpc('member_party_hold',[1,client,holding,round,boardClient]);
const finish = (round,ids,version=0, boardClient=`board-${currentUser}`) => rpc('member_party_finish',[1,round,ids,version,boardClient]);
const due = async () => db.exec("update public.member_party_rounds set ends_at=clock_timestamp()-interval '0.1 seconds'; update public.member_party_holds set lease_until=clock_timestamp()+interval '3 seconds';");
await as(2);
assert.equal((await state()).reason,'admin_available');
assert.equal((await state()).realtimeEnabled,true);
await db.query('insert into public.matches(id,session_id,team_a_p1) values($1,1,$2)',[uid(99),uid(1)]);
await db.query("update public.session_players set status='playing' where id=$1",[uid(1)]);
assert.equal((await state()).available,true); // absent admin irrelevant
// A retained role on an inactive/deleted account cannot act as session staff.
await db.query("insert into public.user_roles values($1,'admin')", [uid(7)]);
assert.equal((await state()).reason,'admin_available');
await db.query('update public.members set auth_user_id=null where id=$1', [uid(7)]);
assert.equal((await state()).available,true);
await db.query('update public.members set auth_user_id=id,is_active=false where id=$1', [uid(7)]);
assert.equal((await state()).available,true);
await db.query('update public.members set is_active=false where id=$1', [uid(1)]);
assert.equal((await state()).reason,'no_admin');
await db.query('update public.members set is_active=true where id in ($1,$2)', [uid(1),uid(7)]);
await db.query('delete from public.user_roles where member_id=$1', [uid(7)]);
assert.equal((await rpc('member_party_state',[2])).reason,'no_admin');
await as(8); assert.equal((await state()).reason,'not_participant');
await as(1); assert.equal((await state()).reason,'playing'); assert.equal((await hold('admin')).roundId,null);
await as(2);
await clearSignals();
let s = await hold('two'); const r = s.roundId; assert.ok(r);
assert.ok((await signals()).length >= 2); // Both the new round and first participant notify idle viewers.
assert.ok((await signals()).every(signal => signal.event === 'member_party_changed' && signal.topic === 'session-bc:1' && signal.private === false));
assert.ok((await signals()).every(signal => JSON.stringify(signal.payload) === '{}')); // Public hint exposes no identities.
await clearSignals();
await hold('two',true,r);
assert.equal((await signals()).length,0); // Valid lease renewal must not fan out every second.
await db.exec('begin');
await hold('rollback-device',true,r);
assert.equal((await signals()).length,1);
await db.exec('rollback');
assert.equal((await signals()).length,0); // Rolled-back participation emits no committed notification.
await db.exec("set test.realtime_failure='on'");
assert.ok((await hold('transport-failure',true,r)).participants.includes(uid(2))); // Transport failure cannot undo a valid hold.
await hold('transport-failure',false);
await db.exec("set test.realtime_failure='off'");
await hold('two-other'); assert.equal((await state()).participants.length,1);
assert.equal((await signals()).length,1);
await clearSignals();
await hold('two',false); assert.equal((await state()).participants.length,1); // device release preserved
assert.equal((await signals()).length,1);
await hold('two-other',false); assert.equal((await state()).participants.length,0);
await hold('two');
for (let i=3;i<=6;i++){ await as(i); await hold(String(i)); }
assert.equal((await state()).participants.length,5);
await db.query("update public.member_party_holds set lease_until=clock_timestamp()-interval '1 second' where user_id=$1",[uid(6)]);
assert.equal((await state()).participants.length,4); // lost connection expires without a release
await clearSignals();
await hold('6',true,r); assert.equal((await state()).participants.length,5);
assert.ok((await signals()).length > 0); // Reviving an expired lease changes visible participation.
assert.equal((await finish(r,[uid(2),uid(3),uid(4),uid(5)],0)).status,'pending');
await due();
assert.equal((await finish(r,[],0)).status,'stale');
assert.equal((await finish(r,[uid(2),uid(2),uid(4),uid(5)],0)).status,'stale');
assert.equal((await finish(r,[uid(1),uid(3),uid(4),uid(5)],0)).status,'stale');
assert.equal((await finish(r,[uid(2),uid(3),uid(4),uid(5)],999)).status,'stale');
await as(7); await assert.rejects(finish(r,[uid(2),uid(3),uid(4),uid(5)],0),/not holding/);
await as(6);
await clearSignals();
const result = await finish(r,[uid(2),uid(3),uid(4),uid(5)],0);
assert.ok((await signals()).length > 0); // Completion wakes all observers as well as selected members.
assert.equal(result.status,'created'); assert.equal(result.memberIds.length,4);
assert.deepEqual(await finish(r,[uid(2),uid(3),uid(4),uid(5)],0),result);
s=await state(); assert.equal(s.roundId,null); assert.deepEqual(s.lastResult,result); assert.equal(s.participants.length,0);
assert.equal((await hold('6',true,r)).roundId,null); // stale heartbeat cannot start a round
const session = (await db.query('select * from public.sessions where id=1')).rows[0];
assert.equal(session.board_drafts.teams.length,2); assert.equal(session.board_drafts_version,1); assert.equal(session.sync_version,1);
assert.deepEqual(session.board_drafts.teams[0],existingDrafts.teams[0]);
assert.deepEqual(session.board_drafts.reservations,existingDrafts.reservations);
assert.equal(session.board_drafts.teams[1].createdBy,'회원 파티'); assert.ok(session.board_drafts.teams[1].confirmedMs);
await as(2); assert.equal((await state()).reason,'assigned');
await as(6); s=await hold('6'); await due(); await clearSignals(); assert.equal((await state()).lastResult.status,'cancelled');
assert.ok((await signals()).length > 0);
// Resting, cock unchecked, reservations and stale playing status must all be excluded.
await db.query("update public.session_players set status='resting' where id=$1",[uid(6)]); assert.equal((await state()).reason,'resting');
await db.query("update public.session_players set status='waiting', cock_checked=false where id=$1",[uid(6)]); assert.equal((await state()).reason,'cock_unchecked');
await db.exec('update public.sessions set cock_check_enabled=false where id=1'); assert.equal((await state()).eligible,true);
await db.query("update public.sessions set board_drafts=jsonb_set(board_drafts,'{reservations}',$1::jsonb) where id=1",[JSON.stringify([{playerId:uid(6)}])]); assert.equal((await state()).reason,'assigned');
await db.exec("update public.sessions set board_drafts=null where id=1");
await db.query('insert into public.matches(id,session_id,team_a_p1) values($1,1,$2)',[uid(98),uid(6)]);
assert.equal((await state()).reason,'playing'); // actual playing match wins over stale waiting status
await db.query('delete from public.matches where id=$1',[uid(98)]);
s = await hold('6'); await db.exec("update public.matches set status='completed'");
assert.equal((await state()).reason,'admin_available'); assert.equal((await state()).roundId,null); assert.equal((await state()).lastResult.roundId,s.roundId);
await db.exec("update public.matches set status='playing'");
s = await hold('6'); await db.exec("update public.member_party_rounds set ends_at=clock_timestamp()-interval '11 seconds'"); assert.equal((await state()).lastResult.status,'cancelled');
s = await hold('6'); await db.exec("update public.sessions set is_active=false where id=1"); assert.equal((await state()).lastResult.roundId,s.roundId); assert.equal((await state()).reason,'session_closed');
const loaded = await rpc('load_session_state',[1]);
assert.equal(loaded.cock_check_enabled,false);
// Party participation is restricted to the device's read mode, not its user's admin role.
await db.exec("update public.sessions set is_active=true,status='active',board_drafts=null where id=1");
await as(2);
await assert.rejects(rpc('member_party_hold',[1,'missing-board',true,null]),/board client id required/);
await assert.rejects(rpc('member_party_finish',[1,uid(999),[],1]),/board client id required/);
await rpc('member_party_hold',[1,'missing-board',false,null]); // Releases require no board identity.
await db.exec("update public.sessions set editor_client_id='editor-board',editor_lease_until=clock_timestamp()-interval '1 hour' where id=1");
s = await hold('editor-mount',true,null,'editor-board');
assert.equal(s.reason,'editor'); assert.equal(s.eligible,false); assert.equal(s.roundId,null);
await assert.rejects(finish(uid(999),[],1,'editor-board'),/editor cannot create/); // Expired lease still owns sticky lock.
s = await hold('readonly-mount',true,null,'readonly-board');
const readonlyRound = s.roundId;
assert.ok(readonlyRound); assert.ok(s.participants.includes(uid(2)));
await hold('editor-mount',true,readonlyRound,'editor-board');
assert.ok((await state()).participants.includes(uid(2))); // Same member's other read-only board hold survives.
await as(1);
assert.equal((await hold('readonly-admin',true,readonlyRound,'readonly-admin-board')).reason,'playing'); // No blanket admin rejection.
await as(3); await hold('promoted-mount',true,readonlyRound,'promoted-board');
for (let i=4;i<=6;i++){ await as(i); await hold(`reader-${i}`,true,readonlyRound); }
assert.equal((await state()).participants.length,5);
await db.exec("update public.sessions set editor_client_id='promoted-board' where id=1");
assert.equal((await state()).participants.length,4); // Becoming editor immediately removes that board's holds from candidates.
assert.ok(!(await state()).participants.includes(uid(3)));
await as(3);
assert.equal((await hold('promoted-mount',true,readonlyRound,'promoted-board')).reason,'editor');
assert.equal((await db.query("select count(*)::int n from public.member_party_holds where client_id='promoted-mount'")).rows[0].n,0);
await due();
await assert.rejects(finish(readonlyRound,[uid(2),uid(4),uid(5),uid(6)],1,'promoted-board'),/editor cannot create/);
await as(6);
await assert.rejects(finish(readonlyRound,[uid(2),uid(4),uid(5),uid(6)],1,'unregistered-board'),/not holding/);
assert.equal((await finish(readonlyRound,[uid(2),uid(3),uid(4),uid(5)],1)).status,'stale'); // Cannot nominate an editor's excluded hold.
assert.deepEqual((await finish(readonlyRound,[uid(2),uid(4),uid(5),uid(6)],1)).memberIds,[uid(2),uid(4),uid(5),uid(6)]);
assert.equal((await db.query('select editor_client_id from public.sessions where id=1')).rows[0].editor_client_id,'promoted-board');
await db.exec('update public.sessions set is_active=false where id=1');
// Authenticated role cannot directly mutate private hold rows or call internal bypass helpers.
await db.exec('set role authenticated');
assert.equal((await state()).reason, 'session_closed');
await assert.rejects(db.exec("select public._member_party_snapshot(1)"),/permission denied/);
await assert.rejects(db.exec("select public.broadcast_member_party_change()"),/permission denied/);
await assert.rejects(db.exec("insert into public.member_party_holds(session_id,user_id,client_id,board_client_id,player_id,round_id,lease_until) values(1,null,'x','board',null,null,now())"),/permission denied/);
await db.exec('reset role; set role anon'); await assert.rejects(state(),/permission denied/); await db.exec('reset role');
await db.query("select set_config('request.jwt.claim.sub','',false)"); await assert.rejects(state(),/authentication required/);
console.log('PASS: replay-safe migrations, authorization, admin scope, hold leases/devices, countdown, exact-four validation, CAS/idempotency, append/sync, stale heartbeat, cancellation, eligibility, read-mode/editor guards, committed realtime hints, heartbeat suppression and transport failure isolation');
await db.close();
