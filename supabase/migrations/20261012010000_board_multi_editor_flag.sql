-- 운영진 동시 편집(실험) 플래그 — 세션 단위.
--
-- sessions.board_multi_editor 가 true 인 세션에서만 운영진 전원이 보드를 편집한다. 기본값 false 이고,
-- false 인 세션은 이 파일 이전과 완전히 같은 경로(단일 편집자 sticky 락)로 동작한다. 각 함수는
-- 맨 앞에서 플래그를 보고 갈라지며, OFF 쪽 본문은 기준 정의를 그대로 옮겼다.
--
-- 플래그를 sessions 행에 두는 이유: 토글이 editor_* 정리와 같은 UPDATE 라서 클라이언트에 같은 행 이벤트
-- (postgres_changes payload.new)로 함께 도착한다. 플래그만 늦게 와서 생기는 '편집권 상실' 오인이 없고,
-- 테스트 세션 하나에서만 켤 수 있다.
--
-- 기준 정의:
--   board_assert_editor                          → 20261012000000_board_match_guards.sql (가드 버전)
--   board_save_drafts / board_claim_editor       → 20260717000000_lock_sticky_no_heartbeat.sql
--   board_takeover_editor / board_handoff_editor → 20260701020000_board_edit_admin_only.sql
--   sessions_bump_sync_version / load_session_state / _member_party_snapshot /
--   member_party_hold / member_party_finish      → 20260907010000_member_party.sql
-- board_release_editor 는 바꾸지 않는다(ON 에서는 editor_* 가 비어 있어 해제할 것이 없다).
--
-- 되돌리기: 플래그를 끄면(admin_set_board_multi_editor(id, false)) 즉시 기존 동작이다. 함수까지 되돌릴 때
-- board_assert_editor 는 20260717000000 이 아니라 20261012000000 가드 버전으로 복원해야 한다.

-- ── 1. 컬럼 + 헬퍼 ─────────────────────────────────────────────────
alter table public.sessions add column if not exists board_multi_editor boolean not null default false;

create or replace function public.board_multi_editor_enabled(p_session_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((select s.board_multi_editor from public.sessions s where s.id = p_session_id), false);
$function$;
revoke all on function public.board_multi_editor_enabled(bigint) from public, anon, authenticated;

-- ── 2. board_assert_editor ─────────────────────────────────────────
--   ON: 운영진 여부만 본다. self-claim UPDATE 가 없어 sessions 쓰기·팬아웃이 생기지 않는다.
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
  IF public.board_multi_editor_enabled(p_session_id) THEN
    IF auth.uid() IS NULL OR public.is_admin() IS NOT TRUE THEN
      RAISE EXCEPTION 'not editor' USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;

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
--   ON: 편집자 조건 없이 버전 CAS 만 본다. editor_* 를 쓰지 않는다(쓰면 마지막 저장자만 편집자로 보인다).
--   ON 분기 UPDATE 에도 board_multi_editor 를 다시 걸어, 잠금 대기 중 플래그가 꺼졌으면 0행(=충돌)으로 끝낸다.
--   OFF 분기는 20260717000000 의 SQL 본문 그대로다(0행이면 NULL 반환도 같다).
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
  IF public.board_multi_editor_enabled(p_session_id) THEN
    UPDATE public.sessions s
    SET board_drafts         = p_payload,
        board_drafts_version = s.board_drafts_version + 1
    WHERE s.id = p_session_id
      AND s.board_multi_editor
      AND public.is_admin()
      AND s.board_drafts_version = p_base_version
    RETURNING s.board_drafts_version INTO v_version;
    RETURN v_version;
  END IF;

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
--   ON: editor_* 를 쓰지 않는 no-op(0행 → 클라는 null). 구버전 PWA 가 호출해도 ON 세션에 편집자가 생기지 않는다.
--   OFF 분기는 기준 정의의 UPDATE 그대로다.
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
  IF public.board_multi_editor_enabled(p_session_id) THEN
    RETURN;
  END IF;
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
  IF public.board_multi_editor_enabled(p_session_id) THEN
    RETURN;
  END IF;
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
  IF public.board_multi_editor_enabled(p_session_id) THEN
    RETURN;
  END IF;
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
--   플래그 변경도 sync_version 을 올려 힌트 broadcast 로 전 보드에 알린다.
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
    or new.board_multi_editor is distinct from old.board_multi_editor
    or new.status is distinct from old.status
    or new.is_active is distinct from old.is_active) then
    new.sync_version := old.sync_version + 1;
  end if;
  return new;
end;
$$;
revoke all on function public.sessions_bump_sync_version() from public, anon, authenticated;

-- ── 6. load_session_state ──────────────────────────────────────────
--   스냅샷에 board_multi_editor 를 싣는다. 구클라는 모르는 키라 무시한다.
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
    'board_multi_editor', s.board_multi_editor,
    'matches', coalesce((select jsonb_agg(to_jsonb(m) order by m.court_id)
      from public.matches m where m.session_id = p_session_id and m.status = 'playing'), '[]'::jsonb),
    'session_players', coalesce((select jsonb_agg(to_jsonb(sp) order by sp.id)
      from public.session_players sp where sp.session_id = p_session_id), '[]'::jsonb)
  ) from public.sessions s where s.id = p_session_id;
$$;
revoke all on function public.load_session_state(bigint) from public, anon;
grant execute on function public.load_session_state(bigint) to authenticated;

-- ── 7. 토글 RPC ─────────────────────────────────────────────────────
--   플래그와 editor_* 정리를 한 UPDATE 로 처리한다. 값이 같으면 아무것도 쓰지 않는다
--   (OFF 를 다시 눌러 현재 편집자를 내쫓지 않게). 반환값은 적용 후 플래그.
--   board_drafts_version 도 올린다(내용은 그대로) — 전환 전에 출발한 저장이 전환 뒤 도착하면 CAS 로 실패시킨다.
--   안 그러면 ON 에서 보낸 머지 안 된 저장이 OFF 분기(editor_* 가 비어 있음)에서 성공해 그 기기가 편집권까지 잡는다.
create or replace function public.admin_set_board_multi_editor(p_session_id bigint, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid flag' USING ERRCODE = '22023';
  END IF;
  UPDATE public.sessions s
  SET board_multi_editor   = p_on,
      board_drafts_version = s.board_drafts_version + 1,
      editor_client_id   = NULL,
      editor_name        = NULL,
      editor_lease_until = NULL
  WHERE s.id = p_session_id
    AND s.board_multi_editor IS DISTINCT FROM p_on;
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = p_session_id) THEN
    RAISE EXCEPTION 'session not found';
  END IF;
  RETURN p_on;
END;
$function$;
revoke all on function public.admin_set_board_multi_editor(bigint, boolean) from public, anon;
grant execute on function public.admin_set_board_multi_editor(bigint, boolean) to authenticated;

-- ── 8. 회원 파티: ON 에서는 운영진 기기를 편집자로 본다 ────────────────
--   OFF 의 판정(board_client_id = editor_client_id)은 그대로다. ON 에서는 editor_client_id 가 비어 있으므로
--   운영진 계정의 누름·확정을 편집자 것으로 보고 제외한다(클라 useMemberParty 의 isEditor 배제와 같은 규칙).
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
    -- 동시 편집 ON: 운영진 계정의 누름은 편집자 것으로 보고 뺀다. OFF 면 항상 참이다.
    and not (v_session.board_multi_editor and exists (
      select 1 from public.user_roles ur join public.members am on am.id = ur.member_id
      where am.auth_user_id = h.user_id and ur.role = 'admin'
    ))
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
  -- 동시 편집 ON 에서는 운영진이 모두 편집자다.
  if p_board_client_id = v_editor_client_id
    or (public.board_multi_editor_enabled(p_session_id) and public.is_admin()) then
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
  -- 동시 편집 ON 에서는 운영진이 모두 편집자다.
  if p_board_client_id = v_session.editor_client_id
    or (v_session.board_multi_editor and public.is_admin()) then
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
