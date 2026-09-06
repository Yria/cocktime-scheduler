-- 회원 파티: 운영진이 모두 경기 중일 때, 누르고 있는 회원만 대상으로 4인 확정 팀을 만든다.
-- 매칭 점수 계산은 기존 TS 알고리즘을 재사용하고, 참가/시간/권한/멤버십/CAS는 서버가 검증한다.
-- sessions 편집 권한이나 기존 운영진 RPC의 권한은 변경하지 않는다.
-- 세션당 현재 라운드와 최근 결과 1개만 유지한다. 하트비트는 sessions를 UPDATE하지 않아
-- 전체 보드 sync/realtime 팬아웃을 발생시키지 않는다. 클라이언트는 RPC로 상태를 조회한다.
create table if not exists public.member_party_rounds (
  session_id bigint primary key references public.sessions(id) on delete cascade,
  round_id uuid,
  ends_at timestamptz,
  last_result jsonb,
  check ((round_id is null) = (ends_at is null))
);

create table if not exists public.member_party_holds (
  session_id bigint not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null check (length(client_id) between 1 and 128),
  board_client_id text not null check (length(board_client_id) between 1 and 128),
  player_id uuid not null references public.session_players(id) on delete cascade,
  round_id uuid not null,
  lease_until timestamptz not null,
  primary key (session_id, user_id, client_id)
);

-- 미배포 개발본을 재적용해도 읽기 모드 확인을 건너뛴 이전 누름이 남지 않는다.
alter table public.member_party_holds add column if not exists board_client_id text;
delete from public.member_party_holds where board_client_id is null;
alter table public.member_party_holds alter column board_client_id set not null;

alter table public.member_party_rounds enable row level security;
alter table public.member_party_holds enable row level security;
revoke all on public.member_party_rounds, public.member_party_holds from public, anon, authenticated;

-- 내부 헬퍼는 API에서 호출할 수 없다. 현재 자석/예약과 실제 playing 매치를 함께 검사한다.
create or replace function public._member_party_player_reason(p_session_id bigint, p_player_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when sp.id is null or not coalesce(m.is_active, false) or m.auth_user_id is null then 'not_participant'
    when sp.status = 'playing' or exists (
      select 1 from public.matches mt
      where mt.session_id = s.id and mt.status = 'playing'
        and sp.id in (mt.team_a_p1, mt.team_a_p2, mt.team_b_p1, mt.team_b_p2)
    ) then 'playing'
    when sp.status <> 'waiting' then 'resting'
    when s.cock_check_enabled and not sp.cock_checked then 'cock_unchecked'
    when exists (
      select 1 from jsonb_array_elements(coalesce(s.board_drafts->'teams', '[]'::jsonb)) t
      where coalesce(t->'memberIds', '[]'::jsonb) ? sp.id::text
    ) or exists (
      select 1 from jsonb_array_elements(coalesce(s.board_drafts->'reservations', '[]'::jsonb)) r
      where r->>'playerId' = sp.id::text
    ) then 'assigned'
    else null
  end
  from public.sessions s
  left join public.session_players sp on sp.id = p_player_id and sp.session_id = s.id
  left join public.members m on m.id = sp.member_id
  where s.id = p_session_id;
$$;

create or replace function public._member_party_snapshot(p_session_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions%rowtype;
  v_round public.member_party_rounds%rowtype;
  v_player_id uuid;
  v_reason text;
  v_eligible_reason text;
  v_participants uuid[];
  v_now timestamptz := clock_timestamp();
begin
  select * into strict v_session from public.sessions where id = p_session_id;
  select * into v_round from public.member_party_rounds where session_id = p_session_id;
  select sp.id into v_player_id
  from public.session_players sp join public.members m on m.id = sp.member_id
  where sp.session_id = p_session_id and m.auth_user_id = auth.uid() and m.is_active
  order by sp.id limit 1;

  v_reason := case
    when not v_session.is_active or v_session.status <> 'active' then 'session_closed'
    when not exists (
      select 1 from public.session_players sp join public.user_roles ur on ur.member_id = sp.member_id
      join public.members m on m.id = sp.member_id and m.is_active and m.auth_user_id is not null
      where sp.session_id = p_session_id and ur.role = 'admin'
    ) then 'no_admin'
    when exists (
      select 1 from public.session_players sp join public.user_roles ur on ur.member_id = sp.member_id
      join public.members m on m.id = sp.member_id and m.is_active and m.auth_user_id is not null
      where sp.session_id = p_session_id and ur.role = 'admin' and not exists (
        select 1 from public.matches mt
        where mt.session_id = p_session_id and mt.status = 'playing'
          and sp.id in (mt.team_a_p1, mt.team_a_p2, mt.team_b_p1, mt.team_b_p2)
      )
    ) then 'admin_available'
    else null
  end;
  v_eligible_reason := public._member_party_player_reason(p_session_id, v_player_id);

  select coalesce(array_agg(distinct h.player_id order by h.player_id), '{}'::uuid[])
  into v_participants
  from public.member_party_holds h
  join public.session_players sp on sp.id = h.player_id and sp.session_id = h.session_id
  join public.members m on m.id = sp.member_id and m.auth_user_id = h.user_id
  where h.session_id = p_session_id and h.round_id = v_round.round_id
    and h.lease_until > v_now
    -- 편집권은 만료 시각과 무관하게 유지되는 기존 sticky 락 규칙을 따른다.
    and h.board_client_id is distinct from v_session.editor_client_id
    and public._member_party_player_reason(p_session_id, h.player_id) is null;

  return jsonb_build_object(
    'available', v_reason is null,
    'eligible', v_reason is null and v_eligible_reason is null,
    'reason', coalesce(v_reason, v_eligible_reason),
    'roundId', v_round.round_id,
    'endsAt', v_round.ends_at,
    'participants', case when v_reason is null then to_jsonb(v_participants) else '[]'::jsonb end,
    'myPlayerId', v_player_id,
    'serverNow', v_now,
    'lastResult', v_round.last_result
  );
end;
$$;

create or replace function public._member_party_close(p_session_id bigint, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.member_party_rounds
  set round_id = null, ends_at = null, last_result = p_result
  where session_id = p_session_id;
  delete from public.member_party_holds where session_id = p_session_id;
end;
$$;

create or replace function public.member_party_state(p_session_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_state jsonb;
  v_now timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  -- 모든 RPC가 같은 세션 행을 먼저 잠근다. board_save_drafts의 CAS 갱신과도 직렬화한다.
  perform 1 from public.sessions where id = p_session_id for update;
  if not found then raise exception 'session not found'; end if;
  v_state := public._member_party_snapshot(p_session_id);
  v_now := clock_timestamp();
  if v_state->>'roundId' is not null and (
    not (v_state->>'available')::boolean
    or v_now >= (v_state->>'endsAt')::timestamptz + interval '10 seconds'
    or (v_now >= (v_state->>'endsAt')::timestamptz and jsonb_array_length(v_state->'participants') < 4)
  ) then
    perform public._member_party_close(p_session_id, jsonb_build_object(
      'roundId', v_state->>'roundId', 'status', 'cancelled'
    ));
    v_state := public._member_party_snapshot(p_session_id);
  end if;
  return v_state;
end;
$$;

-- 이전 인자 수의 RPC가 남아 읽기 모드 검사를 우회하지 못하게 제거한다.
drop function if exists public.member_party_hold(bigint, text, boolean, uuid);
create or replace function public.member_party_hold(
  p_session_id bigint, p_client_id text, p_holding boolean, p_round_id uuid default null,
  p_board_client_id text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_state jsonb;
  v_round_id uuid;
  v_now timestamptz;
  v_editor_client_id text;
begin
  if p_client_id is null or length(p_client_id) not between 1 and 128 or p_holding is null then
    raise exception 'invalid hold request' using errcode = '22023';
  end if;
  v_state := public.member_party_state(p_session_id);
  if not p_holding then
    -- 같은 회원의 다른 기기에서 누르는 상태는 유지한다.
    delete from public.member_party_holds
    where session_id = p_session_id and user_id = auth.uid() and client_id = p_client_id;
    return public.member_party_state(p_session_id);
  end if;
  if p_board_client_id is null or length(p_board_client_id) not between 1 and 128 then
    raise exception 'board client id required' using errcode = '22023';
  end if;
  select editor_client_id into v_editor_client_id from public.sessions where id = p_session_id;
  if p_board_client_id = v_editor_client_id then
    delete from public.member_party_holds
    where session_id = p_session_id and user_id = auth.uid() and client_id = p_client_id;
    return public.member_party_state(p_session_id) || jsonb_build_object('eligible', false, 'reason', 'editor');
  end if;
  if not (v_state->>'eligible')::boolean then return v_state; end if;
  v_round_id := (v_state->>'roundId')::uuid;
  -- 이미 끝난 라운드의 지연 하트비트가 새 라운드를 자동 시작하지 못한다.
  if p_round_id is not null and p_round_id is distinct from v_round_id then return v_state; end if;
  v_now := clock_timestamp();
  if v_round_id is null then
    v_round_id := gen_random_uuid();
    delete from public.member_party_holds where session_id = p_session_id;
    insert into public.member_party_rounds (session_id, round_id, ends_at)
    values (p_session_id, v_round_id, v_now + interval '5 seconds')
    on conflict (session_id) do update set round_id = excluded.round_id, ends_at = excluded.ends_at;
  elsif v_now >= (v_state->>'endsAt')::timestamptz and not exists (
    select 1 from public.member_party_holds
    where session_id = p_session_id and user_id = auth.uid() and client_id = p_client_id
      and round_id = v_round_id and lease_until > v_now
      and board_client_id = p_board_client_id
  ) then
    -- 마감 후 새 참가/만료된 누름 부활을 막고, 계속 누르는 기존 참가자의 lease만 갱신한다.
    return v_state;
  end if;
  insert into public.member_party_holds (session_id, user_id, client_id, board_client_id, player_id, round_id, lease_until)
  values (p_session_id, auth.uid(), p_client_id, p_board_client_id, (v_state->>'myPlayerId')::uuid,
    v_round_id, v_now + interval '3 seconds')
  on conflict (session_id, user_id, client_id) do update
  set board_client_id = excluded.board_client_id, player_id = excluded.player_id,
    round_id = excluded.round_id, lease_until = excluded.lease_until;
  return public._member_party_snapshot(p_session_id);
end;
$$;

drop function if exists public.member_party_finish(bigint, uuid, uuid[], bigint);
create or replace function public.member_party_finish(
  p_session_id bigint, p_round_id uuid, p_player_ids uuid[], p_board_version bigint,
  p_board_client_id text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_state jsonb;
  v_session public.sessions%rowtype;
  v_team_id uuid;
  v_now_ms bigint;
  v_team jsonb;
  v_result jsonb;
  v_participants uuid[];
begin
  v_state := public.member_party_state(p_session_id);
  if p_board_client_id is null or length(p_board_client_id) not between 1 and 128 then
    raise exception 'board client id required' using errcode = '22023';
  end if;
  select * into strict v_session from public.sessions where id = p_session_id;
  if p_board_client_id = v_session.editor_client_id then
    raise exception 'editor cannot create member party' using errcode = '42501';
  end if;
  -- 동시 확정/재전송에는 같은 결과를 반환한다. 확정 팀을 중복 추가하지 않는다.
  if v_state->'lastResult'->>'roundId' = p_round_id::text then
    return v_state->'lastResult';
  end if;
  if p_round_id is null or p_round_id::text is distinct from v_state->>'roundId' then
    return jsonb_build_object('status', 'stale');
  end if;
  if clock_timestamp() < (v_state->>'endsAt')::timestamptz then
    return jsonb_build_object('status', 'pending');
  end if;
  select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_participants
  from jsonb_array_elements_text(v_state->'participants');
  -- state()가 4명 미만/사용 불가 라운드는 취소했다. 호출자도 현재 참가자여야 한다.
  if not (v_state->>'eligible')::boolean
    or not coalesce((v_state->>'myPlayerId')::uuid = any(v_participants), false)
    or not exists (
      select 1 from public.member_party_holds h
      where h.session_id = p_session_id and h.user_id = auth.uid()
        and h.board_client_id = p_board_client_id and h.round_id = p_round_id
        and h.player_id = (v_state->>'myPlayerId')::uuid and h.lease_until > clock_timestamp()
    ) then
    raise exception 'not holding' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_player_ids), 0) <> 4
    or (select count(distinct id) from unnest(p_player_ids) id) <> 4
    or not p_player_ids <@ v_participants then
    return jsonb_build_object('status', 'stale');
  end if;
  if p_board_version is distinct from v_session.board_drafts_version then
    return jsonb_build_object('status', 'stale');
  end if;

  v_team_id := gen_random_uuid();
  v_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_team := jsonb_build_object(
    'id', v_team_id, 'memberIds', to_jsonb(p_player_ids), 'createdMs', v_now_ms,
    'confirmedMs', v_now_ms, 'createdBy', '회원 파티',
    'slots', jsonb_build_object(p_player_ids[1]::text, 0, p_player_ids[2]::text, 1,
      p_player_ids[3]::text, 2, p_player_ids[4]::text, 3)
  );
  -- 기존 drafts 전체를 보존하며 확정 팀 1개만 append한다. 편집권은 건드리지 않는다.
  update public.sessions
  set board_drafts = jsonb_set(
      coalesce(board_drafts, '{"teams":[],"reservations":[]}'::jsonb), '{teams}',
      coalesce(board_drafts->'teams', '[]'::jsonb) || jsonb_build_array(v_team)
    ),
    board_drafts_version = board_drafts_version + 1
  where id = p_session_id;
  -- 기존 sessions bump/broadcast 트리거가 새 팀을 모든 보드에 전파한다.
  v_result := jsonb_build_object('roundId', p_round_id, 'status', 'created',
    'teamId', v_team_id, 'memberIds', to_jsonb(p_player_ids));
  perform public._member_party_close(p_session_id, v_result);
  return v_result;
end;
$$;

revoke all on function public._member_party_player_reason(bigint, uuid) from public, anon, authenticated;
revoke all on function public._member_party_snapshot(bigint) from public, anon, authenticated;
revoke all on function public._member_party_close(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.member_party_state(bigint) from public, anon;
revoke all on function public.member_party_hold(bigint, text, boolean, uuid, text) from public, anon;
revoke all on function public.member_party_finish(bigint, uuid, uuid[], bigint, text) from public, anon;
grant execute on function public.member_party_state(bigint) to authenticated;
grant execute on function public.member_party_hold(bigint, text, boolean, uuid, text) to authenticated;
grant execute on function public.member_party_finish(bigint, uuid, uuid[], bigint, text) to authenticated;

-- 설정만 변경되어도 기존 동기화 경로로 서버 스냅샷에 수렴시킨다.
create or replace function public.sessions_bump_sync_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.board_drafts is distinct from old.board_drafts
    or new.board_drafts_version is distinct from old.board_drafts_version
    or new.match_state_version is distinct from old.match_state_version
    or new.court_count is distinct from old.court_count
    or new.cock_check_enabled is distinct from old.cock_check_enabled
    or new.editor_client_id is distinct from old.editor_client_id
    or new.editor_name is distinct from old.editor_name
    or new.status is distinct from old.status
    or new.is_active is distinct from old.is_active) then
    new.sync_version := old.sync_version + 1;
  end if;
  return new;
end;
$$;
revoke all on function public.sessions_bump_sync_version() from public, anon, authenticated;

create or replace function public.load_session_state(p_session_id bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'board_drafts', s.board_drafts,
    'board_drafts_version', s.board_drafts_version,
    'match_state_version', s.match_state_version,
    'sync_version', s.sync_version,
    'court_count', s.court_count,
    'cock_check_enabled', s.cock_check_enabled,
    'editor_client_id', s.editor_client_id,
    'editor_name', s.editor_name,
    'editor_lease_until', s.editor_lease_until,
    'matches', coalesce((select jsonb_agg(to_jsonb(m) order by m.court_id)
      from public.matches m where m.session_id = p_session_id and m.status = 'playing'), '[]'::jsonb),
    'session_players', coalesce((select jsonb_agg(to_jsonb(sp) order by sp.id)
      from public.session_players sp where sp.session_id = p_session_id), '[]'::jsonb)
  ) from public.sessions s where s.id = p_session_id;
$$;
revoke all on function public.load_session_state(bigint) from public, anon;
grant execute on function public.load_session_state(bigint) to authenticated;
