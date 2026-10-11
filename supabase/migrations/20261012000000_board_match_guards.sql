-- 경기 RPC 서버 가드(동시 편집 플래그와 무관).
--
-- 정상 클라이언트 흐름은 그대로 두고, 잘못되거나 경합한 호출만 막는다. 이 파일만 되돌릴 수 있도록
-- 동시 편집 플래그(20261012010000)와 분리했다. 기준 정의:
--   assign_match / set_match_roster / complete_match → 20260817020000_advisor_function_search_path.sql
--   board_assert_editor                              → 20260717000000_lock_sticky_no_heartbeat.sql
-- 래퍼 assign_match_with_admin_coverage(20260922030000)와 start_match_proposal(20260918030000)은
-- 둘 다 public.assign_match 를 거치므로 손대지 않는다. complete_session_playing_matches 도 그대로 둔다.
--
-- 선수 상태 조건은 status <> 'playing' 만 본다. 메인 보드의 시작 게이트(isTeamStartable)는
-- 휴식·콕 미확인 선수를 거르지 않으므로 status = 'waiting' 을 강제하면 기존 시작이 깨진다.
-- ghost 예약은 경기가 끝난 뒤에야 시작 가능(isTeamStartable 이 경기중 멤버를 거부)하므로 영향 없다.

-- ── 1. board_assert_editor ──────────────────────────────────────────
--   p_client_id 미전달(구버전 클라) 분기에도 운영진 검사를 둔다. 이전엔 무검사 통과라
--   complete_match 등을 아무 회원이나 호출할 수 있었다.
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

-- ── 2. assign_match ─────────────────────────────────────────────────
--   세션 행 잠금으로 같은 세션의 배정·로스터 수정을 직렬화한 뒤, 4인 유효성·중복 출전을 확인한다.
create or replace function public.assign_match(p_match_id uuid, p_session_id bigint, p_court_id integer, p_game_type text, p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid, p_client_id text default null::text, p_name text default null::text, p_lease_seconds integer default 20)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_ids UUID[] := ARRAY[p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2];
  v_updated_count INT;
BEGIN
  -- -1. 세션 잠금(진행 중 세션만). 동시 배정은 여기서 줄을 서고, 뒤 요청은 앞 요청의 결과를 본다.
  PERFORM 1 FROM public.sessions
  WHERE id = p_session_id AND is_active AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session closed';
  END IF;

  -- 0. 편집 락 가드(유효 lease 보유자/자유만 — 아니면 'not editor' 예외로 롤백)
  PERFORM public.board_assert_editor(p_session_id, p_client_id, p_name, p_lease_seconds);

  -- 0-1. 4명 모두 지정되고 서로 달라야 한다.
  IF array_position(v_ids, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> 4 THEN
    RAISE EXCEPTION 'four distinct players required';
  END IF;

  -- 0-2. 같은 세션의 진행 경기에 이미 들어 있는 선수는 시작할 수 없다.
  IF EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.session_id = p_session_id AND m.status = 'playing'
      AND ARRAY[m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2] && v_ids
  ) THEN
    RAISE EXCEPTION 'players already playing';
  END IF;

  -- 1. 매치 레코드 삽입 (코트가 이미 점유면 부분 유니크 인덱스가 unique_violation 발생)
  --    assigned_by = 경기 시작 누른 편집자 실명(p_name).
  INSERT INTO public.matches (id, session_id, court_id, game_type, team_a_p1, team_a_p2, team_b_p1, team_b_p2, status, assigned_by)
  VALUES (p_match_id, p_session_id, p_court_id, p_game_type, p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2, 'playing', p_name);

  -- 2. 선수 상태 업데이트 (같은 트랜잭션). 이 세션 선수이고 경기중이 아닌 4명이 모두 바뀌어야 한다.
  --    휴식·콕 미확인 선수는 기존처럼 허용한다(status = 'waiting' 을 강제하지 않음).
  UPDATE public.session_players
  SET status = 'playing'
  WHERE id = ANY(v_ids) AND session_id = p_session_id AND status <> 'playing';
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> 4 THEN
    RAISE EXCEPTION 'players not ready';
  END IF;

  -- 3. 세션 카운터: match_assign_count(deficit 계산용) + match_state_version(동기화 신호) 동시 증가
  UPDATE public.sessions
  SET match_assign_count = match_assign_count + 1,
      match_state_version = match_state_version + 1
  WHERE id = p_session_id;
EXCEPTION
  WHEN unique_violation THEN
    -- 코트가 이미 다른 기기에 의해 배정됨 → 블록 내 변경 롤백 후 명시적 예외 전파
    RAISE EXCEPTION 'court already assigned';
END;
$function$;

-- ── 3. set_match_roster ─────────────────────────────────────────────
--   빠진/들어온 선수는 서버가 현재 로스터와 비교해 직접 계산한다(p_removed_ids/p_added_ids 는
--   시그니처 호환용으로만 남기고 무시). 두 기기가 같은 코트를 동시에 고쳐도 상태가 어긋나지 않는다.
create or replace function public.set_match_roster(p_match_id uuid, p_session_id bigint, p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid, p_removed_ids uuid[], p_added_ids uuid[], p_client_id text default null::text, p_name text default null::text, p_lease_seconds integer default 20)
returns setof public.session_players
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_new UUID[] := ARRAY[p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2];
  v_old UUID[];
  v_removed UUID[];
  v_added UUID[];
  v_updated_count INT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- -1. 세션 잠금 — 같은 세션의 경기 배정과 직렬화
  PERFORM 1 FROM public.sessions WHERE id = p_session_id FOR UPDATE;

  -- 0. 편집 락 가드
  PERFORM public.board_assert_editor(p_session_id, p_client_id, p_name, p_lease_seconds);

  IF array_position(v_new, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT x) FROM unnest(v_new) x) <> 4 THEN
    RAISE EXCEPTION 'four distinct players required';
  END IF;

  -- 1. 현재 로스터(서버 권위). playing 인 경우만 — 이미 완료/삭제된 매치 보호
  SELECT ARRAY[m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2] INTO v_old
  FROM public.matches m
  WHERE m.id = p_match_id AND m.session_id = p_session_id AND m.status = 'playing'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found or already completed';
  END IF;

  -- array_position 은 NULL 슬롯(삭제된 선수)도 안전하게 비교한다.
  v_removed := ARRAY(SELECT x FROM unnest(v_old) x WHERE x IS NOT NULL AND array_position(v_new, x) IS NULL);
  v_added := ARRAY(SELECT x FROM unnest(v_new) x WHERE array_position(v_old, x) IS NULL);

  -- 1-1. 들어올 선수가 다른 진행 경기에 있으면 거부
  IF EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.session_id = p_session_id AND m.status = 'playing' AND m.id <> p_match_id
      AND ARRAY[m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2] && v_added
  ) THEN
    RAISE EXCEPTION 'players already playing';
  END IF;

  -- 2. 로스터 교체
  UPDATE public.matches
  SET team_a_p1 = p_team_a_p1,
      team_a_p2 = p_team_a_p2,
      team_b_p1 = p_team_b_p1,
      team_b_p2 = p_team_b_p2
  WHERE id = p_match_id;

  -- 3. 빠진 선수 → 대기(완료 전 이탈이라 game_count 변동 없음, 대기 시작 갱신)
  IF cardinality(v_removed) > 0 THEN
    UPDATE public.session_players
    SET status = 'waiting', wait_since = v_now
    WHERE id = ANY(v_removed) AND session_id = p_session_id;
  END IF;

  -- 4. 들어온 선수 → 경기중(이 세션 선수여야 한다)
  IF cardinality(v_added) > 0 THEN
    UPDATE public.session_players
    SET status = 'playing'
    WHERE id = ANY(v_added) AND session_id = p_session_id;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> cardinality(v_added) THEN
      RAISE EXCEPTION 'players not ready';
    END IF;
  END IF;

  -- 5. 동기화 신호
  UPDATE public.sessions SET match_state_version = match_state_version + 1 WHERE id = p_session_id;

  -- 6. 변경된 선수 반환(broadcast player 동기화 + 발신측 로컬 반영용)
  RETURN QUERY
  SELECT * FROM public.session_players
  WHERE id = ANY(v_removed || v_added);
END;
$function$;

-- ── 4. complete_match ───────────────────────────────────────────────
--   세션을 고정하고, 선수 갱신은 클라가 넘긴 4명이 아니라 matches 의 실제 로스터로 한다.
--   (p_team_* 는 시그니처 호환용 — 로스터 수정 직후의 낡은 화면이 엉뚱한 선수를 풀어주지 않게)
create or replace function public.complete_match(p_match_id uuid, p_session_id bigint, p_game_type text, p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid, p_client_id text default null::text, p_name text default null::text, p_lease_seconds integer default 20)
returns setof public.session_players
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_is_mixed BOOLEAN := (p_game_type = '혼복');
  v_a1 UUID;
  v_a2 UUID;
  v_b1 UUID;
  v_b2 UUID;
BEGIN
  -- -1. 세션 잠금 — 배정·로스터 수정과 같은 순서(sessions → matches)로 잠가 교착을 피한다.
  PERFORM 1 FROM public.sessions WHERE id = p_session_id FOR UPDATE;

  -- 0. 편집 락 가드
  PERFORM public.board_assert_editor(p_session_id, p_client_id, p_name, p_lease_seconds);

  -- 1. 매치 완료 처리 + 선수 스냅샷 기록(동시성 제어: playing인 경우만). SET 의 m.* 는 갱신 전 값이다.
  UPDATE public.matches m
  SET status = 'completed',
      ended_at = v_now,
      player_snapshot = jsonb_build_array(
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM public.session_players sp WHERE sp.id = m.team_a_p1),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM public.session_players sp WHERE sp.id = m.team_a_p2),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM public.session_players sp WHERE sp.id = m.team_b_p1),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM public.session_players sp WHERE sp.id = m.team_b_p2)
      )
  WHERE m.id = p_match_id AND m.session_id = p_session_id AND m.status = 'playing'
  RETURNING m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2 INTO v_a1, v_a2, v_b1, v_b2;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match already completed or not found';
  END IF;

  -- 2. (제거됨) pair_history upsert — 재결성 회피 이력은 완료 matches 에서 파생한다(2026-07-27).

  -- 3. 선수 상태 업데이트: waiting 복귀 + game_count 증가 + (혼복 남자) mixed_count 증가
  UPDATE public.session_players
  SET status = 'waiting',
      wait_since = v_now,
      game_count = game_count + 1,
      mixed_count = CASE
        WHEN v_is_mixed AND gender = 'M' THEN mixed_count + 1
        ELSE mixed_count
      END
  WHERE id IN (v_a1, v_a2, v_b1, v_b2) AND session_id = p_session_id;

  -- 4. 동기화 신호: 코트가 비워졌음을 catch-up 으로 알린다.
  UPDATE public.sessions SET match_state_version = match_state_version + 1 WHERE id = p_session_id;

  -- 5. 업데이트된 선수 데이터 반환
  RETURN QUERY
  SELECT * FROM public.session_players
  WHERE id IN (v_a1, v_a2, v_b1, v_b2) AND session_id = p_session_id;
END;
$function$;

-- ── 5. 기존 상태 어긋남 1회 정리 ─────────────────────────────────────
--   예전 complete_match 는 클라가 넘긴 4명을 풀어줬다. 로스터 교체 직후 낡은 화면이 완료하면 새로 들어온
--   선수가 진행 경기 없이 status = 'playing' 으로 남을 수 있었다(그땐 무해). 위 assign_match 의
--   status <> 'playing' 가드가 그런 선수를 영구히 'players not ready' 로 막으므로, 진행 중 세션에 한해
--   어떤 진행 경기에도 없는 'playing' 행을 'waiting' 으로 되돌린다. 새 complete_match/set_match_roster 는
--   서버 로스터로 갱신하므로 이후 같은 어긋남은 생기지 않는다. wait_since 는 건드리지 않는다.
update public.session_players sp
set status = 'waiting'
where sp.status = 'playing'
  and exists (select 1 from public.sessions s where s.id = sp.session_id and s.is_active and s.status = 'active')
  and not exists (
    select 1 from public.matches m
    where m.session_id = sp.session_id and m.status = 'playing'
      and sp.id in (m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2)
  );

-- create or replace 는 기존 GRANT 를 보존하지만, 회수 의도(20260817010000/20260817020000)를 재명시한다.
revoke execute on function public.board_assert_editor(bigint, text, text, integer) from public, anon, authenticated;
revoke execute on function public.assign_match(uuid, bigint, integer, text, uuid, uuid, uuid, uuid, text, text, integer) from public, anon;
revoke execute on function public.set_match_roster(uuid, bigint, uuid, uuid, uuid, uuid, uuid[], uuid[], text, text, integer) from public, anon;
revoke execute on function public.complete_match(uuid, bigint, text, uuid, uuid, uuid, uuid, text, text, integer) from public, anon;
grant execute on function public.assign_match(uuid, bigint, integer, text, uuid, uuid, uuid, uuid, text, text, integer) to authenticated;
grant execute on function public.set_match_roster(uuid, bigint, uuid, uuid, uuid, uuid, uuid[], uuid[], text, text, integer) to authenticated;
grant execute on function public.complete_match(uuid, bigint, text, uuid, uuid, uuid, uuid, text, text, integer) to authenticated;
