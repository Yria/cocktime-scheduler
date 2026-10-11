-- 롤백 전용(마이그레이션 폴더 밖) — 20261012010000_board_multi_editor_flag.sql 되돌리기.
--
-- 순서: ① 모든 세션 플래그 OFF(아래 1번이 함께 한다) → ② 필요하면 클라이언트 revert 배포 →
--       ③ 이 파일을 SQL 편집기/Management API 로 실행. supabase db push 대상이 아니다.
-- 각 함수는 플래그 마이그레이션의 OFF 분기(= 이전 정의)로 복원한다. board_assert_editor 는
-- 20260717000000 이 아니라 20261012000000 가드 버전(p_client_id NULL 분기 운영진 검사 포함)이 기준이다.
-- 가드 마이그레이션(20261012000000)은 그대로 둔다. 원격 이력(supabase_migrations.schema_migrations)의
-- 20261012010000 행은 남으므로 db push 가 다시 적용하지 않는다. 다시 켤 때는 그 행을 지우고 db push 하거나
-- 마이그레이션 파일을 SQL 로 직접 실행한다. 클라이언트가 board_multi_editor 를 못 받으면 OFF 로 본다.

begin;

-- ── 1. ON 세션 정리 — 켜진 세션이 있으면 끄고 editor_* 를 비운다(트리거가 sync_version 을 올려 클라에 알린다).
update public.sessions
set board_multi_editor = false,
    board_drafts_version = board_drafts_version + 1,
    editor_client_id = null,
    editor_name = null,
    editor_lease_until = null
where board_multi_editor;

-- ── 2. board_assert_editor ─────────────────────────────────────────
--   20261012000000 가드 버전으로 복원(플래그 분기 제거).
create or replace function public.board_assert_editor(
  p_session_id    bigint,
  p_client_id     text,
  p_name          text,
  p_lease_seconds integer default 20
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_editor TEXT;
BEGIN
  IF p_client_id IS NULL THEN
    -- 구버전 클라(미전달) 호환: 락 판정은 생략하되 운영진만 통과
    IF auth.uid() IS NULL OR public.is_admin() IS NOT TRUE THEN
      RAISE EXCEPTION 'not editor' USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;
  SELECT s.editor_client_id INTO v_editor FROM public.sessions s WHERE s.id = p_session_id;
  -- 이미 편집자(신원 일치) → sessions UPDATE 없이 통과. 단 운영진 여부는 계속 확인(권한 회수 반영).
  IF v_editor IS NOT NULL AND v_editor = p_client_id THEN
    IF public.is_admin() THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'not editor';
  END IF;
  -- 미보유: 자유(NULL)면 self-claim(운영진만), 남이 보유면 0행 → 거부. 만료 조항 없음(sticky).
  UPDATE public.sessions s
  SET editor_client_id   = p_client_id,
      editor_name        = COALESCE(p_name, s.editor_name),
      editor_lease_until = now() + make_interval(secs => coalesce(p_lease_seconds, 20))
  WHERE s.id = p_session_id
    AND public.is_admin()
    AND s.editor_client_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not editor';
  END IF;
END;
$function$;
revoke execute on function public.board_assert_editor(bigint, text, text, integer) from public, anon, authenticated;

-- ── 3. board_save_drafts ───────────────────────────────────────────
--   20260717000000 의 SQL 본문으로 복원(편집자 조건·editor_* 갱신 포함).
create or replace function public.board_save_drafts(
  p_session_id    bigint,
  p_client_id     text,
  p_name          text,
  p_payload       jsonb,
  p_base_version  bigint,
  p_lease_seconds integer default 20
) returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_version BIGINT;
BEGIN
  UPDATE public.sessions s
  SET board_drafts         = p_payload,
      board_drafts_version = s.board_drafts_version + 1,
      editor_client_id     = p_client_id,
      editor_name          = p_name,
      editor_lease_until   = now() + make_interval(secs => coalesce(p_lease_seconds, 20))
  WHERE s.id = p_session_id
    AND public.is_admin()
    AND s.board_drafts_version = p_base_version
    AND (s.editor_client_id IS NULL
         OR s.editor_client_id = p_client_id)
  RETURNING s.board_drafts_version INTO v_version;
  RETURN v_version;
END;
$function$;
revoke execute on function public.board_save_drafts(bigint, text, text, jsonb, bigint, integer) from public, anon;
grant execute on function public.board_save_drafts(bigint, text, text, jsonb, bigint, integer) to authenticated;

-- ── 4. board_claim / takeover / handoff ────────────────────────────
--   기준 정의(20260717000000 / 20260701020000)의 UPDATE 로 복원.
create or replace function public.board_claim_editor(
  p_session_id    bigint,
  p_client_id     text,
  p_name          text,
  p_lease_seconds integer default 20
) returns table(o_client_id text, o_name text, o_lease_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
BEGIN
  RETURN QUERY
  UPDATE public.sessions s
  SET editor_client_id   = p_client_id,
      editor_name        = p_name,
      editor_lease_until = now() + make_interval(secs => coalesce(p_lease_seconds, 20))
  WHERE s.id = p_session_id
    AND public.is_admin()
    AND (s.editor_client_id IS NULL
         OR s.editor_client_id = p_client_id)
  RETURNING s.editor_client_id, s.editor_name, s.editor_lease_until;
END;
$function$;
revoke execute on function public.board_claim_editor(bigint, text, text, integer) from public, anon;
grant execute on function public.board_claim_editor(bigint, text, text, integer) to authenticated;

create or replace function public.board_takeover_editor(
  p_session_id    bigint,
  p_client_id     text,
  p_name          text,
  p_lease_seconds integer default 20
) returns table(o_client_id text, o_name text, o_lease_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
BEGIN
  RETURN QUERY
  UPDATE public.sessions s
  SET editor_client_id   = p_client_id,
      editor_name        = p_name,
      editor_lease_until = now() + make_interval(secs => coalesce(p_lease_seconds, 20))
  WHERE s.id = p_session_id
    AND public.is_admin()
  RETURNING s.editor_client_id, s.editor_name, s.editor_lease_until;
END;
$function$;
revoke execute on function public.board_takeover_editor(bigint, text, text, integer) from public, anon;
grant execute on function public.board_takeover_editor(bigint, text, text, integer) to authenticated;

create or replace function public.board_handoff_editor(
  p_session_id     bigint,
  p_from_client_id text,
  p_to_client_id   text,
  p_to_name        text,
  p_lease_seconds  integer default 20
) returns table(o_client_id text, o_name text, o_lease_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
BEGIN
  RETURN QUERY
  UPDATE public.sessions s
  SET editor_client_id   = p_to_client_id,
      editor_name        = p_to_name,
      editor_lease_until = now() + make_interval(secs => coalesce(p_lease_seconds, 20))
  WHERE s.id = p_session_id
    AND public.is_admin()
    AND s.editor_client_id = p_from_client_id
  RETURNING s.editor_client_id, s.editor_name, s.editor_lease_until;
END;
$function$;
revoke execute on function public.board_handoff_editor(bigint, text, text, text, integer) from public, anon;
grant execute on function public.board_handoff_editor(bigint, text, text, text, integer) to authenticated;

-- ── 5. sync bump 트리거 ─────────────────────────────────────────────
--   20260907010000 의 비교 컬럼으로 복원(board_multi_editor 제외).
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

-- ── 6. load_session_state ──────────────────────────────────────────
--   20260907010000 의 스냅샷으로 복원(board_multi_editor 키 제외).
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

-- ── 7. 회원 파티: 편집자 기기 제외 판정 복원 ─────────────────────────
--   20260907010000 의 판정(board_client_id = editor_client_id)만 남긴다.
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
revoke all on function public._member_party_snapshot(bigint) from public, anon, authenticated;

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
revoke all on function public.member_party_hold(bigint, text, boolean, uuid, text) from public, anon;
grant execute on function public.member_party_hold(bigint, text, boolean, uuid, text) to authenticated;

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
revoke all on function public.member_party_finish(bigint, uuid, uuid[], bigint, text) from public, anon;
grant execute on function public.member_party_finish(bigint, uuid, uuid[], bigint, text) to authenticated;

-- ── 8. 토글 RPC·헬퍼·컬럼 제거(이제 아무 함수도 참조하지 않는다) ─────────
drop function if exists public.admin_set_board_multi_editor(bigint, boolean);
drop function if exists public.board_multi_editor_enabled(bigint);
alter table public.sessions drop column if exists board_multi_editor;

commit;
