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
create table public.sessions(id bigint primary key, is_active boolean default true, status text default 'active', board_drafts jsonb);
create table public.members(id uuid primary key, auth_user_id uuid, name text, is_active boolean default true);
create table public.user_roles(member_id uuid, role text);
create table public.session_players(id uuid primary key, session_id bigint, member_id uuid, name text);
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.members m join public.user_roles r on r.member_id=m.id
 where m.auth_user_id=auth.uid() and m.is_active and r.role='admin')
$$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid(), public.is_admin() to authenticated;
`);
const sql = readFileSync(new URL('../migrations/20260918010000_private_match_proposals.sql', import.meta.url), 'utf8');
await db.exec(sql); await db.exec(sql);
const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
for (let i=1;i<=8;i++) {
 await db.query('insert into auth.users values($1)',[uid(i)]);
 await db.query('insert into public.members(id,auth_user_id,name) values($1,$1,$2)',[uid(i),`회원${i}`]);
 if(i<=6) await db.query('insert into public.session_players values($1,1,$1,$2)',[uid(i),`회원${i}`]);
}
await db.exec(`insert into public.sessions values(1,true,'active','{"teams":[],"reservations":[]}'),(2,true,'active',null)`);
await db.query('insert into public.session_players values($1,2,$2,$3)',[uid(100),uid(6),'다른 세션']);
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
await as(0,'anon'); await assert.rejects(list()); await assert.rejects(send(206,[2]));
await as(0); await assert.rejects(send(206,[2]));
await db.exec('reset role');
assert.deepEqual((await db.query('select board_drafts from public.sessions where id=1')).rows[0].board_drafts,{teams:[],reservations:[]});
await db.exec("update public.sessions set status='closed' where id=1");
await as(2); await assert.rejects(send(206,[2]));
await db.close();
console.log('Private match proposal SQL: RLS, roles, 1–4 members, idempotency, lifecycle and shared-board isolation passed.');
