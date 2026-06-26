-- ============================================================
-- 콕확인(합류) 시 wait_since 도 now()로 리셋 — W_WAIT(대기 우선) 활성화 대응.
--
-- 배경: 추천 점수에 "오래 쉰(대기) 사람 강한 우선"(RECOMMEND_WEIGHTS.W_WAIT=1.0)을 켰다.
--       wait 항 = −(now − wait_since)분 × W_WAIT. 그런데 set_cock_checked 는 game_count 만 활성 평균으로
--       보정하고 wait_since 는 그대로 둬서, 세션 시작 때 일괄 insert 된 wait_since(=세션 시작 시각)가 유지된다.
--       콕확인은 "매칭 가능 시작(합류)"이므로, 합류 전부터 쌓인 대기시간으로 갓 합류자가 과대 우선되면 안 된다.
-- 해결: 최초 콕확인 시 wait_since = now() 로 리셋(매칭 가능 시점부터 대기 시작). game_count 평균 보정과 동일 취지.
--       (휴식 복귀 set_player_resting(false)는 이미 wait_since=now() 리셋함 — 20260624000000.)
-- 본문은 20260624000000 정의 그대로 + UPDATE에 wait_since 만 추가. 멱등(이미 확인됨이면 no-op) 유지.
-- ============================================================

CREATE OR REPLACE FUNCTION set_cock_checked(p_session_player_id UUID)
RETURNS SETOF session_players AS $$
DECLARE
  v_session_id BIGINT;
  v_was_checked BOOLEAN;
  v_avg INT;
BEGIN
  SELECT session_id, cock_checked INTO v_session_id, v_was_checked
  FROM session_players WHERE id = p_session_player_id;
  IF v_session_id IS NULL THEN
    RETURN; -- 없는 선수
  END IF;

  IF v_was_checked THEN
    -- 이미 확인됨 → 멱등(중복 보정 방지)
    RETURN QUERY SELECT * FROM session_players WHERE id = p_session_player_id;
    RETURN;
  END IF;

  v_avg := _session_avg_game_count(v_session_id, p_session_player_id);
  UPDATE session_players
  SET cock_checked = true,
      game_count = GREATEST(game_count, v_avg),
      wait_since = now() -- 합류 시점부터 대기 시작(W_WAIT 과대 우선 방지)
  WHERE id = p_session_player_id;

  RETURN QUERY SELECT * FROM session_players WHERE id = p_session_player_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
