// Isolated PostgreSQL execution; never connects to the live Supabase database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const oldWait = '2000-01-01T00:00:00.000Z';
const migration = readFileSync(new URL('../migrations/20260907040000_late_join_game_count.sql', import.meta.url), 'utf8');

function readFunction(file, name) {
  const source = readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
  const start = source.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
  assert.ok(start >= 0, `Missing SQL function ${name}`);
  const tail = source.slice(start);
  const tag = tail.match(/\bas\s+(\$\w*\$)/i);
  assert.ok(tag);
  const end = tail.indexOf(`${tag[1]};`, tag.index + tag[0].length);
  assert.ok(end >= 0);
  return tail.slice(0, end + tag[1].length + 1);
}

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create table public.sessions (
      id bigint primary key, cock_check_enabled boolean not null default true,
      sync_version bigint not null default 0
    );
    create table public.session_players (
      id uuid primary key default gen_random_uuid(),
      session_id bigint not null references public.sessions(id),
      player_id text not null, name text not null default '선수',
      status text not null default 'waiting',
      game_count integer not null default 0,
      cock_checked boolean not null default false,
      wait_since timestamptz, rest_since_match integer,
      unique (session_id, player_id)
    );
  `);
  await db.exec(readFunction('20260817020000_advisor_function_search_path.sql', 'set_player_resting'));
  // Keep the real child -> parent update trigger: a BEFORE sessions trigger would
  // conflict with this path when disabling cock checks updates session_players.
  await db.exec(readFunction('20260722010000_sync_version_broadcast.sql', 'bump_session_sync_from_children'));
  await db.exec(`
    create trigger trg_sp_bump_sync_ins after insert on public.session_players
      referencing new table as new_rows for each statement
      execute function public.bump_session_sync_from_children();
    create trigger trg_sp_bump_sync_upd after update on public.session_players
      referencing new table as new_rows for each statement
      execute function public.bump_session_sync_from_children();
  `);
  await db.exec(migration);
  await db.exec(migration); // Reapplying must preserve grants and install one trigger.
});
after(() => db.close());

async function fixture(checkEnabled, players = []) {
  await db.exec('truncate public.session_players, public.sessions');
  await db.query('insert into public.sessions(id,cock_check_enabled) values(1,$1),(2,true)', [checkEnabled]);
  // Seed established participants, without pretending that they just arrived.
  await db.exec('alter table public.session_players disable trigger trg_sp_apply_join_baseline');
  for (const [n, games, status = 'waiting', checked = true, session = 1] of players) {
    await db.query(`insert into public.session_players
      (id,session_id,player_id,game_count,status,cock_checked,wait_since)
      values($1,$2,$3,$4,$5,$6,$7)`, [uid(n), session, String(n), games, status, checked, oldWait]);
  }
  await db.exec('alter table public.session_players enable trigger trg_sp_apply_join_baseline');
}
async function player(n) {
  return (await db.query('select * from public.session_players where id=$1', [uid(n)])).rows[0];
}
async function add(n, games = 0, checked = false) {
  return (await db.query(`insert into public.session_players
    (id,session_id,player_id,game_count,cock_checked,wait_since)
    values($1,1,$2,$3,$4,$5) returning *`, [uid(n), String(n), games, checked, oldWait])).rows[0];
}
async function check(n) {
  return (await db.query('select * from public.set_cock_checked($1)', [uid(n)])).rows[0];
}

test('최초 참가자는 콕 체크 ON/OFF 모두 0판으로 시작한다', async () => {
  for (const enabled of [true, false]) {
    await fixture(enabled);
    assert.equal((await add(1)).game_count, 0);
    assert.equal((await check(1)).game_count, 0);
  }
});

test('확인된 대기/경기 중 참가자의 판수만 반올림하며 진행 중인 1판은 더하지 않는다', async () => {
  await fixture(true, [
    [1, 2, 'playing'], [2, 5], [3, 0, 'waiting', false],
    [4, 40, 'resting'], [5, 90, 'waiting', true, 2],
  ]);
  await add(6);
  const joined = await check(6);
  assert.equal(joined.game_count, 4); // round((2 + 5) / 2), not 5 or the diluted 2.
  assert.ok(joined.wait_since > new Date(oldWait));
  assert.equal((await player(1)).game_count, 2);
  assert.equal((await player(2)).game_count, 5);
});

test('콕 체크 ON에서는 등록 시점이 아닌 최초 확인 시점의 평균을 쓴다', async () => {
  await fixture(true, [[1, 2]]);
  assert.equal((await add(2)).game_count, 0);
  await db.exec('update public.session_players set game_count=8 where player_id=\'1\'');
  const joined = await check(2);
  assert.equal(joined.game_count, 8);
  await db.exec('update public.session_players set game_count=12 where player_id=\'1\'');
  assert.deepEqual(await check(2), joined); // Duplicate confirmation preserves count and wait.
});

test('콕 체크 OFF에서는 추가 즉시 보정하고 나중의 콕 확인으로 다시 보정하지 않는다', async () => {
  await fixture(false, [[1, 2], [2, 6, 'playing', false], [3, 50, 'resting']]);
  const joined = await add(4);
  assert.equal(joined.game_count, 4);
  assert.ok(joined.wait_since > new Date(oldWait));
  await db.exec('update public.session_players set game_count=12 where player_id in (\'1\',\'2\')');
  const checked = await check(4);
  assert.equal(checked.game_count, 4);
  assert.deepEqual(checked.wait_since, joined.wait_since);
});

test('여러 늦참자를 한 번에 추가해도 같은 평균을 적용한다', async () => {
  await fixture(false, [[1, 2], [2, 5]]);
  const result = await db.query(`insert into public.session_players(session_id,player_id)
    values(1,'3'),(1,'4'),(1,'5') returning game_count`);
  assert.deepEqual(result.rows.map(row => row.game_count), [4, 4, 4]);
});

test('기존 판수는 줄이지 않으며 확인된 상태로 추가하는 경로도 보정한다', async () => {
  await fixture(true, [[1, 4]]);
  await add(2, 9);
  assert.equal((await check(2)).game_count, 9);
  assert.equal((await add(3, 0, true)).game_count, 7);
  await fixture(false, [[1, 4]]);
  assert.equal((await add(2, 9)).game_count, 9);
});

test('평균 대상이 없으면 0이며 휴식자는 대기시간을 시작하지 않는다', async () => {
  await fixture(true, [[1, 20, 'resting'], [2, 0, 'waiting', false], [3, 0, 'resting', false]]);
  await add(4);
  assert.equal((await check(4)).game_count, 0);
  const resting = await player(3);
  assert.deepEqual((await check(3)).wait_since, resting.wait_since);
  assert.equal((await check(99)), undefined);
});

test('기존 선수 upsert와 중복 추가는 새 합류로 보정하지 않는다', async () => {
  await fixture(false, [[1, 2], [2, 8]]);
  const before = await player(1);
  await db.query(`insert into public.session_players(id,session_id,player_id,name,game_count,wait_since)
    values($1,1,'1','새 이름',2,$2)
    on conflict(id) do update set name=excluded.name,game_count=excluded.game_count,wait_since=excluded.wait_since`, [uid(1), oldWait]);
  const updated = await player(1);
  assert.equal(updated.name, '새 이름');
  assert.equal(updated.game_count, before.game_count);
  assert.deepEqual(updated.wait_since, before.wait_since);
  await db.exec(`insert into public.session_players(session_id,player_id)
    values(1,'1') on conflict(session_id,player_id) do nothing`);
  assert.deepEqual(await player(1), updated);
});

test('콕 체크를 끄면 미확인 대기자를 전환 전 참가자 평균으로 보정하고 동기화한다', async () => {
  await fixture(true, [[1, 4, 'playing'], [2, 4], [3, 0, 'waiting', false], [4, 0, 'resting', false]]);
  await add(5); // Same sequence as updateSession: add first, change setting last.
  const version = (await db.query('select sync_version from public.sessions where id=1')).rows[0].sync_version;
  await db.exec('update public.sessions set cock_check_enabled=false where id=1');
  assert.equal((await player(3)).game_count, 4);
  assert.equal((await player(5)).game_count, 4);
  assert.equal((await player(4)).game_count, 0);
  assert.deepEqual((await player(2)).wait_since, new Date(oldWait));
  assert.ok((await db.query('select sync_version from public.sessions where id=1')).rows[0].sync_version > version);
  const joined = await player(3);
  await db.exec('update public.session_players set game_count=10 where cock_checked');
  await db.exec('update public.sessions set cock_check_enabled=false where id=1');
  assert.deepEqual(await player(3), joined);
});

test('휴식 복귀도 미확인자를 제외한 평균을 쓰고 기존 높은 판수는 보존한다', async () => {
  await fixture(true, [[1, 4], [2, 0, 'waiting', false], [3, 1, 'resting'], [4, 8, 'resting']]);
  const returned = (await db.query('select * from public.set_player_resting($1,1,false)', [uid(3)])).rows[0];
  assert.equal(returned.game_count, 4);
  assert.equal(returned.status, 'waiting');
  assert.ok(returned.wait_since > new Date(oldWait));
  assert.equal((await db.query('select * from public.set_player_resting($1,1,false)', [uid(4)])).rows[0].game_count, 8);
});

test('보정 함수는 내부 전용이며 콕 확인 RPC의 기존 인증 역할 권한을 유지한다', async () => {
  for (const signature of [
    '_session_avg_game_count(bigint,uuid)', 'session_players_apply_join_baseline()',
    'sessions_apply_join_baseline_on_cock_disable()',
  ]) {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, `public.${signature}`])).rows[0].allowed, false);
    }
  }
  assert.equal((await db.query("select has_function_privilege('anon','public.set_cock_checked(uuid)','EXECUTE') allowed")).rows[0].allowed, false);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.set_cock_checked(uuid)','EXECUTE') allowed")).rows[0].allowed, true);
});
