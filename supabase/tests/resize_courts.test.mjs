// Real PostgreSQL triggers in an isolated database; no production writes.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create table public.sessions(id bigint primary key, court_count int not null, board_drafts jsonb,
  board_drafts_version bigint default 0, match_state_version bigint default 0,
  cock_check_enabled boolean default false, editor_client_id text, editor_name text,
  editor_lease_until timestamptz, status text default 'active', is_active boolean default true);
create table public.session_players(id text primary key, session_id bigint);
create table public.matches(id text primary key, session_id bigint, court_id int, status text, team_a_p1 text);
create unique index on public.matches(session_id,court_id) where status = 'playing';
create schema realtime;
create table realtime.hints(payload jsonb);
create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void
language sql as $$ insert into realtime.hints values(payload) $$;
`);
const migration = name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
await db.exec(migration('20260722010000_sync_version_broadcast'));
const resizeSql = migration('20260922040000_resize_empty_courts');
await db.exec(resizeSql); await db.exec(resizeSql);

const drafts = () => ({ teams: [1,2,3,4,5].map(courtId => ({ id: `court-${courtId}`, courtId, memberIds: [], createdMs: courtId })),
  reservations: [], layout: { version: 1, teams: Object.fromEntries([1,2,3,4,5].map(id => [`court-${id}`, { x: id * 100, y: 200 }])),
    courts: Object.fromEntries([1,2,3,4,5].map(id => [String(id), { x: id * 100, y: 200 }])), magnets: { p: { x: 10, y: 20 } } } });
async function setup(sid, playing, payload = drafts()) {
  await db.query('insert into sessions(id,court_count,board_drafts) values($1,5,$2)', [sid, payload]);
  for (const court of playing) await db.query("insert into matches values($1,$2,$3,'playing',$4)", [`${sid}-${court}`,sid,court,`player-${court}`]);
}
const resize = (sid, count) => db.query('update sessions set court_count=$2 where id=$1', [sid,count]);
const snapshot = async sid => (await db.query('select public.load_session_state($1) s', [sid])).rows[0].s;

await setup(1, [1,2,4,5]);
await db.exec("insert into matches values('history',1,5,'completed','historical-player')");
const before = await snapshot(1);
await resize(1,4);
const after = await snapshot(1);
assert.deepEqual(after.matches.map(m => [m.id,m.court_id,m.team_a_p1]), [1,2,4,5].map((id,i) => [`1-${id}`,i+1,`player-${id}`]));
assert.deepEqual(after.board_drafts.teams.map(t => [t.id,t.courtId]), [['court-1',1],['court-2',2],['court-4',3],['court-5',4]]);
assert.deepEqual(after.board_drafts.layout.courts, { 1:{x:100,y:200}, 2:{x:200,y:200}, 3:{x:400,y:200}, 4:{x:500,y:200} });
assert.equal(after.board_drafts.layout.teams['court-3'], undefined);
assert.deepEqual(after.board_drafts.layout.magnets, before.board_drafts.layout.magnets);
assert.equal((await db.query("select court_id from matches where id='history'")).rows[0].court_id,5);
assert.equal(after.match_state_version, before.match_state_version + 1);
assert.equal(after.board_drafts_version, before.board_drafts_version + 1);
assert.ok(after.sync_version > before.sync_version);
await assert.rejects(db.exec("insert into matches values('stale',1,5,'playing','late-player')"), /court no longer exists/);
await assert.rejects(db.exec("update matches set court_id=5 where id='1-5'"), /court no longer exists/);

// No empty court: all changes, versions and hints are rolled back together.
const hintCount = (await db.query('select count(*) n from realtime.hints')).rows[0].n;
await assert.rejects(resize(1,3), /not enough empty courts/);
assert.deepEqual(await snapshot(1), after);
assert.equal((await db.query('select count(*) n from realtime.hints')).rows[0].n, hintCount);
await resize(1,5);
assert.equal((await snapshot(1)).matches.length,4);
assert.equal((await snapshot(1)).match_state_version, after.match_state_version + 1);
const increased = await snapshot(1);
await resize(1,5);
assert.deepEqual(await snapshot(1), increased);

await setup(2,[2,5]);
await resize(2,2);
assert.deepEqual((await snapshot(2)).matches.map(m => [m.id,m.court_id]), [['2-2',1],['2-5',2]]);
await setup(3,[]);
await resize(3,3);
assert.deepEqual((await snapshot(3)).board_drafts.teams.map(t => t.courtId), [1,2,3]);
assert.equal((await snapshot(3)).match_state_version,1);

// A court without a running match may still hold a prepared roster. Preserve it as a draft.
const queued = drafts();
queued.teams[2].memberIds = ['p','q']; queued.teams[2].slots = { p:0,q:1,r:2 };
queued.reservations.push({ id:'ghost',playerId:'r',teamId:'court-3',createdMs:3 });
queued.teams.push({ id:'prepared',memberIds:['s','t'],createdMs:100 });
await setup(4,[1,2,4,5],queued);
await resize(4,4);
const preserved = (await snapshot(4)).board_drafts;
assert.equal(preserved.teams.find(t => t.id === 'court-3').courtId, undefined);
assert.deepEqual(preserved.teams.find(t => t.id === 'court-3').memberIds,['p','q']);
assert.deepEqual(preserved.teams.find(t => t.id === 'court-3').slots,{p:0,q:1,r:2});
assert.deepEqual(preserved.reservations,queued.reservations);
assert.deepEqual(preserved.teams.find(t => t.id === 'prepared'), queued.teams.at(-1));
await setup(5,[1,2,4],{ ...queued, teams: queued.teams.map(t => t.courtId === 3 ? {...t,courtId:5,id:'queue-on-five'} : t.courtId === 5 ? {...t,courtId:3,id:'empty-three'} : t), reservations: [] });
await resize(5,4); // Prefer completely empty court 3 over the prepared group on court 5.
assert.equal((await snapshot(5)).board_drafts.teams.find(t => t.id === 'queue-on-five').courtId,4);

await setup(6,[5],null);
await resize(6,1);
assert.equal((await snapshot(6)).matches[0].court_id,1);
assert.equal((await snapshot(6)).board_drafts,null);
await assert.rejects(resize(6,0), /court count must be positive/);
assert.equal((await snapshot(6)).court_count,1);
await db.exec('set role authenticated');
await assert.rejects(db.exec('select public.sessions_resize_empty_courts()'),/permission denied/);
await db.close();
console.log('Court resize SQL passed: middle/multiple/empty courts, collision-free renumbering, queued rosters and history preserved, atomic rollback and sync versions.');
