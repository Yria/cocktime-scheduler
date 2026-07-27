-- ============================================================
-- pair_history 폐기 — 쌍 단위 동반 이력 → 그룹 이력 개편의 서버측 마무리
--
-- 배경: 2026-07-27 팀매칭 개편(커밋 64f3f44)으로 클라이언트 재결성 회피가
--   쌍 누적(Σc²)에서 "완료 경기 4인 그룹과의 겹침 수"로 전환되며, 이력 원천이
--   pair_history 테이블 조회 → 완료 matches 파생(groupHistory)으로 바뀌었다
--   (docs/TEAM_GENERATION_RULES.md §4). 이후 pair_history 는 쓰기만 되고
--   아무도 읽지 않는 죽은 테이블이므로 누적 코드와 테이블을 제거한다.
--
-- 변경 (함수 재정의는 각 라이브 정의에서 pair_history 블록만 제거 — 그 외 문자 그대로):
--  1) complete_match — 20260624020000 정의에서 pair_history upsert(구 2단계)와
--     그 전용 변수(v_ids, i, j)만 제거. 시그니처·반환·편집락 가드·스냅샷·
--     카운터·match_state_version 신호 전부 동일.
--  2) complete_session_playing_matches — 20260726090000 정의에서 pair_history
--     블록(구 ②)만 제거. ★ search_path='' + public. 스키마 한정을 그대로 유지 —
--     sessions close 트리거 → sync_schedule_occurrences(search_path='') 경로에서
--     호출되므로 이 설정이 깨지면 일정 sync 전체가 롤백된다(2026-07-26 사고).
--     트리거는 함수명을 그대로 가리키므로 재바인딩 불필요.
--  3) DROP TABLE pair_history (RLS 정책·인덱스·FK 동반 삭제).
-- ============================================================

-- ------------------------------------------------------------
-- 1. complete_match — pair_history upsert 제거
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION complete_match(
  p_match_id UUID,
  p_session_id BIGINT,
  p_game_type TEXT,
  p_team_a_p1 UUID,
  p_team_a_p2 UUID,
  p_team_b_p1 UUID,
  p_team_b_p2 UUID,
  p_client_id TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_lease_seconds INT DEFAULT 20
) RETURNS SETOF session_players AS $$
DECLARE
  v_updated_count INT;
  v_now TIMESTAMPTZ := NOW();
  v_is_mixed BOOLEAN := (p_game_type = '혼복');
BEGIN
  -- 0. 편집 락 가드
  PERFORM board_assert_editor(p_session_id, p_client_id, p_name, p_lease_seconds);

  -- 1. 매치 완료 처리 + 선수 스냅샷 기록(동시성 제어: playing인 경우만)
  UPDATE matches
  SET status = 'completed',
      ended_at = v_now,
      player_snapshot = jsonb_build_array(
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM session_players sp WHERE sp.id = p_team_a_p1),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM session_players sp WHERE sp.id = p_team_a_p2),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM session_players sp WHERE sp.id = p_team_b_p1),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM session_players sp WHERE sp.id = p_team_b_p2)
      )
  WHERE id = p_match_id AND status = 'playing';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Match already completed or not found';
  END IF;

  -- 2. (제거됨) pair_history upsert — 재결성 회피 이력은 완료 matches 에서 파생한다(2026-07-27).

  -- 3. 선수 상태 업데이트: waiting 복귀 + game_count 증가 + (혼복 남자) mixed_count 증가
  UPDATE session_players
  SET status = 'waiting',
      wait_since = v_now,
      game_count = game_count + 1,
      mixed_count = CASE
        WHEN v_is_mixed AND gender = 'M' THEN mixed_count + 1
        ELSE mixed_count
      END
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);

  -- 4. 동기화 신호: 코트가 비워졌음을 catch-up 으로 알린다.
  UPDATE sessions SET match_state_version = match_state_version + 1 WHERE id = p_session_id;

  -- 5. 업데이트된 선수 데이터 반환
  RETURN QUERY
  SELECT * FROM session_players
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 2. complete_session_playing_matches — pair_history 블록 제거
--    (search_path='' + public. 한정 유지 — 20260726090000 그대로)
-- ------------------------------------------------------------
create or replace function public.complete_session_playing_matches(p_session_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  m         record;
  v_now     timestamptz := now();
  v_is_mixed boolean;
  v_n int := 0;
begin
  for m in
    select id, game_type, team_a_p1, team_a_p2, team_b_p1, team_b_p2
    from public.matches
    where session_id = p_session_id and status = 'playing'
  loop
    v_is_mixed := (m.game_type = '혼복');

    -- ① 매치 완료 + 시점 스냅샷([a1,a2,b1,b2] 순, 삭제된 선수 슬롯은 null — complete_match 와 동일)
    update public.matches
    set status = 'completed',
        ended_at = v_now,
        player_snapshot = jsonb_build_array(
          (select jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) from public.session_players sp where sp.id = m.team_a_p1),
          (select jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) from public.session_players sp where sp.id = m.team_a_p2),
          (select jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) from public.session_players sp where sp.id = m.team_b_p1),
          (select jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) from public.session_players sp where sp.id = m.team_b_p2)
        )
    where id = m.id and status = 'playing';

    -- ② (제거됨) pair_history upsert — 재결성 회피 이력은 완료 matches 에서 파생한다(2026-07-27).

    -- ③ 선수 상태: waiting 복귀 + game_count/mixed_count/wait_since (complete_match 와 동일)
    update public.session_players
    set status = 'waiting',
        wait_since = v_now,
        game_count = game_count + 1,
        mixed_count = case when v_is_mixed and gender = 'M' then mixed_count + 1 else mixed_count end
    where id in (m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2);

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- ------------------------------------------------------------
-- 3. pair_history 테이블 삭제 (정책·인덱스·FK 동반 삭제)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS public.pair_history;
