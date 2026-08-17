-- Supabase Security Advisor: function_search_path_mutable 7건.
-- search_path 를 고정하지 않은 함수는 호출자가 search_path 를 바꿔치기해 같은 이름의 다른 객체를
-- 가리키게 만들 수 있다. SECURITY DEFINER 함수에서는 그대로 권한 상승 경로가 된다.
--
-- ⚠ 이 프로젝트에서 한 번 사고가 났던 지점이다(2026-07-26, complete_session_playing_matches).
--   `set search_path = ''` 를 걸면 **스키마 없는 이름은 전부 해석 실패**한다. 그래서 본문의 테이블·
--   함수 참조를 하나도 빠짐없이 public. 로 한정했다. 아래 함수들이 참조하는 사용자 객체는
--   session_players / matches / sessions / board_assert_editor / _session_avg_game_count 뿐이고,
--   나머지(coalesce·round·avg·now·greatest·jsonb_build_*·array_length)는 pg_catalog 내장이라
--   search_path 와 무관하게 항상 찾는다.
--   RETURNS SETOF 의 타입명도 public. 로 한정한다.
--
-- 본문 로직은 한 글자도 바꾸지 않았다 — 스키마 한정과 search_path 고정만 더한 재선언이다.

-- ── 1. _session_avg_game_count ──────────────────────────────────────
create or replace function public._session_avg_game_count(p_session_id bigint, p_exclude_id uuid)
returns integer
language sql
stable
set search_path = ''
as $function$
  SELECT COALESCE(ROUND(AVG(game_count)), 0)::INT
  FROM public.session_players
  WHERE session_id = p_session_id
    AND status <> 'resting'
    AND id <> p_exclude_id;
$function$;

-- ── 2. sessions_bump_sync_version (트리거) ──────────────────────────
-- NEW/OLD 필드 접근만 하므로 참조할 객체가 없지만, search_path 고정 자체가 목적이다.
create or replace function public.sessions_bump_sync_version()
returns trigger
language plpgsql
set search_path = ''
as $function$
BEGIN
  IF (NEW.board_drafts         IS DISTINCT FROM OLD.board_drafts
   OR NEW.board_drafts_version IS DISTINCT FROM OLD.board_drafts_version
   OR NEW.match_state_version  IS DISTINCT FROM OLD.match_state_version
   OR NEW.court_count          IS DISTINCT FROM OLD.court_count
   OR NEW.cock_check_enabled   IS DISTINCT FROM OLD.cock_check_enabled
   OR NEW.editor_client_id     IS DISTINCT FROM OLD.editor_client_id
   OR NEW.editor_name          IS DISTINCT FROM OLD.editor_name
   -- editor_lease_until 은 감시 제외: sticky 락에서 lease 는 만료판정 미사용이고 매 op 갱신되면 bump 증폭.
   OR NEW.status               IS DISTINCT FROM OLD.status
   OR NEW.is_active            IS DISTINCT FROM OLD.is_active)
  THEN
    NEW.sync_version := OLD.sync_version + 1;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 3. set_player_resting ───────────────────────────────────────────
create or replace function public.set_player_resting(p_session_player_id uuid, p_session_id bigint, p_resting boolean)
returns setof public.session_players
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_avg INT;
BEGIN
  IF p_resting THEN
    -- 휴식 진입: 대기시간 초기화(rest_since_match는 구 deficit 모델 잔재 — 무해하게 비움)
    UPDATE public.session_players
    SET status = 'resting',
        rest_since_match = NULL,
        wait_since = NULL
    WHERE id = p_session_player_id;
  ELSE
    -- 복귀: 휴식 동안의 판수 격차를 활성 평균으로 보정(빠진 시간만큼 뛴 걸로 가정)
    v_avg := public._session_avg_game_count(p_session_id, p_session_player_id);
    UPDATE public.session_players
    SET game_count = GREATEST(game_count, v_avg),
        status = 'waiting',
        rest_since_match = NULL,
        wait_since = now()
    WHERE id = p_session_player_id;
  END IF;

  RETURN QUERY SELECT * FROM public.session_players WHERE id = p_session_player_id;
END;
$function$;

-- ── 4. set_cock_checked ─────────────────────────────────────────────
create or replace function public.set_cock_checked(p_session_player_id uuid)
returns setof public.session_players
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_session_id BIGINT;
  v_was_checked BOOLEAN;
  v_avg INT;
BEGIN
  SELECT session_id, cock_checked INTO v_session_id, v_was_checked
  FROM public.session_players WHERE id = p_session_player_id;
  IF v_session_id IS NULL THEN
    RETURN; -- 없는 선수
  END IF;

  IF v_was_checked THEN
    -- 이미 확인됨 → 멱등(중복 보정 방지)
    RETURN QUERY SELECT * FROM public.session_players WHERE id = p_session_player_id;
    RETURN;
  END IF;

  v_avg := public._session_avg_game_count(v_session_id, p_session_player_id);
  UPDATE public.session_players
  SET cock_checked = true,
      game_count = GREATEST(game_count, v_avg),
      wait_since = now() -- 합류 시점부터 대기 시작(W_WAIT 과대 우선 방지)
  WHERE id = p_session_player_id;

  RETURN QUERY SELECT * FROM public.session_players WHERE id = p_session_player_id;
END;
$function$;

-- ── 5. assign_match ─────────────────────────────────────────────────
create or replace function public.assign_match(p_match_id uuid, p_session_id bigint, p_court_id integer, p_game_type text, p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid, p_client_id text default null::text, p_name text default null::text, p_lease_seconds integer default 20)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
BEGIN
  -- 0. 편집 락 가드(유효 lease 보유자/자유만 — 아니면 'not editor' 예외로 롤백)
  PERFORM public.board_assert_editor(p_session_id, p_client_id, p_name, p_lease_seconds);

  -- 1. 매치 레코드 삽입 (코트가 이미 점유면 부분 유니크 인덱스가 unique_violation 발생)
  --    assigned_by = 경기 시작 누른 편집자 실명(p_name).
  INSERT INTO public.matches (id, session_id, court_id, game_type, team_a_p1, team_a_p2, team_b_p1, team_b_p2, status, assigned_by)
  VALUES (p_match_id, p_session_id, p_court_id, p_game_type, p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2, 'playing', p_name);

  -- 2. 선수 상태 업데이트 (같은 트랜잭션)
  UPDATE public.session_players
  SET status = 'playing'
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);

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

-- ── 6. set_match_roster ─────────────────────────────────────────────
create or replace function public.set_match_roster(p_match_id uuid, p_session_id bigint, p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid, p_removed_ids uuid[], p_added_ids uuid[], p_client_id text default null::text, p_name text default null::text, p_lease_seconds integer default 20)
returns setof public.session_players
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_updated_count INT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 0. 편집 락 가드
  PERFORM public.board_assert_editor(p_session_id, p_client_id, p_name, p_lease_seconds);

  -- 1. 진행중 매치의 로스터 교체 (playing 인 경우만 — 이미 완료/삭제된 매치 보호)
  UPDATE public.matches
  SET team_a_p1 = p_team_a_p1,
      team_a_p2 = p_team_a_p2,
      team_b_p1 = p_team_b_p1,
      team_b_p2 = p_team_b_p2
  WHERE id = p_match_id AND session_id = p_session_id AND status = 'playing';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Match not found or already completed';
  END IF;

  -- 2. 빠진 선수 → 대기(완료 전 이탈이라 game_count 변동 없음, 대기 시작 갱신)
  IF array_length(p_removed_ids, 1) IS NOT NULL THEN
    UPDATE public.session_players
    SET status = 'waiting', wait_since = v_now
    WHERE id = ANY(p_removed_ids);
  END IF;

  -- 3. 들어온 선수 → 경기중
  IF array_length(p_added_ids, 1) IS NOT NULL THEN
    UPDATE public.session_players
    SET status = 'playing'
    WHERE id = ANY(p_added_ids);
  END IF;

  -- 4. 동기화 신호
  UPDATE public.sessions SET match_state_version = match_state_version + 1 WHERE id = p_session_id;

  -- 5. 변경된 선수 반환(broadcast player 동기화 + 발신측 로컬 반영용)
  RETURN QUERY
  SELECT * FROM public.session_players
  WHERE id = ANY(p_removed_ids) OR id = ANY(p_added_ids);
END;
$function$;

-- ── 7. complete_match ───────────────────────────────────────────────
create or replace function public.complete_match(p_match_id uuid, p_session_id bigint, p_game_type text, p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid, p_client_id text default null::text, p_name text default null::text, p_lease_seconds integer default 20)
returns setof public.session_players
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_updated_count INT;
  v_now TIMESTAMPTZ := NOW();
  v_is_mixed BOOLEAN := (p_game_type = '혼복');
BEGIN
  -- 0. 편집 락 가드
  PERFORM public.board_assert_editor(p_session_id, p_client_id, p_name, p_lease_seconds);

  -- 1. 매치 완료 처리 + 선수 스냅샷 기록(동시성 제어: playing인 경우만)
  UPDATE public.matches
  SET status = 'completed',
      ended_at = v_now,
      player_snapshot = jsonb_build_array(
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM public.session_players sp WHERE sp.id = p_team_a_p1),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM public.session_players sp WHERE sp.id = p_team_a_p2),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM public.session_players sp WHERE sp.id = p_team_b_p1),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM public.session_players sp WHERE sp.id = p_team_b_p2)
      )
  WHERE id = p_match_id AND status = 'playing';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
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
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);

  -- 4. 동기화 신호: 코트가 비워졌음을 catch-up 으로 알린다.
  UPDATE public.sessions SET match_state_version = match_state_version + 1 WHERE id = p_session_id;

  -- 5. 업데이트된 선수 데이터 반환
  RETURN QUERY
  SELECT * FROM public.session_players
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);
END;
$function$;

-- 재선언은 기존 GRANT 를 보존하지만(create or replace), 20260817010000 의 회수 의도가 확실히 남도록
-- 이 파일에서도 한 번 더 명시한다. is_admin/current_member_id 처럼 남겨야 할 대상은 여기 없다.
revoke execute on function public._session_avg_game_count(bigint, uuid) from public, anon, authenticated;
revoke execute on function public.sessions_bump_sync_version() from public, anon, authenticated;
revoke execute on function public.set_player_resting(uuid, bigint, boolean) from public, anon;
revoke execute on function public.set_cock_checked(uuid) from public, anon;
revoke execute on function public.assign_match(uuid, bigint, integer, text, uuid, uuid, uuid, uuid, text, text, integer) from public, anon;
revoke execute on function public.set_match_roster(uuid, bigint, uuid, uuid, uuid, uuid, uuid[], uuid[], text, text, integer) from public, anon;
revoke execute on function public.complete_match(uuid, bigint, text, uuid, uuid, uuid, uuid, text, text, integer) from public, anon;
