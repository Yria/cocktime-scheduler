-- ============================================================
-- 콕확인 = 합류 기준 + 평균 판수 보정 (deficit 모델 제거 대응)
--
-- 배경: 편성 우선순위를 deficit(라운드 비례 기대치) 모델 대신 순수 game_count(절대 판수)로
--       매기도록 알고리즘을 단순화한다. 그러면 늦참자(game_count=0)나 휴식 복귀자(판수 정체)가
--       무조건 추천 1순위로 튀어 불공정해진다.
-- 해결: "합류 시점"에 그 시점 활성 참가자(휴식·본인 제외)의 평균 판수로 game_count를 보정한다.
--       (= 늦참/휴식한 시간만큼 평균적으로 뛴 것으로 가정.)
--       단 GREATEST를 써서 이미 더 많이 뛴 선수의 값을 깎지 않는다(보정은 올림만).
--   - 합류 기준 = 콕확인(set_cock_checked): 최초 확인 1회만 보정.
--   - 휴식 복귀(set_player_resting, p_resting=false): 동일 보정으로 일반화.
-- 구 deficit 보정용 joined_at_match 전진은 더 이상 쓰이지 않으므로 제거한다.
-- ============================================================

-- 세션 활성 참가자(휴식·본인 제외)의 평균 판수. 대상이 없으면 0.
CREATE OR REPLACE FUNCTION _session_avg_game_count(p_session_id BIGINT, p_exclude_id UUID)
RETURNS INT AS $$
  SELECT COALESCE(ROUND(AVG(game_count)), 0)::INT
  FROM session_players
  WHERE session_id = p_session_id
    AND status <> 'resting'
    AND id <> p_exclude_id;
$$ LANGUAGE sql STABLE;

-- 콕확인 = 합류. 최초 확인 시 game_count를 활성 평균으로 보정(GREATEST). 멱등.
-- 기존 dbSetCockChecked의 단순 UPDATE(cock_checked=true)를 대체한다.
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
      game_count = GREATEST(game_count, v_avg)
  WHERE id = p_session_player_id;

  RETURN QUERY SELECT * FROM session_players WHERE id = p_session_player_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 휴식 토글 — 복귀(p_resting=false) 시 평균 판수 보정(구 joined_at_match 전진 대체).
CREATE OR REPLACE FUNCTION set_player_resting(
  p_session_player_id UUID,
  p_session_id BIGINT,
  p_resting BOOLEAN
) RETURNS SETOF session_players AS $$
DECLARE
  v_avg INT;
BEGIN
  IF p_resting THEN
    -- 휴식 진입: 대기시간 초기화(rest_since_match는 구 deficit 모델 잔재 — 무해하게 비움)
    UPDATE session_players
    SET status = 'resting',
        rest_since_match = NULL,
        wait_since = NULL
    WHERE id = p_session_player_id;
  ELSE
    -- 복귀: 휴식 동안의 판수 격차를 활성 평균으로 보정(빠진 시간만큼 뛴 걸로 가정)
    v_avg := _session_avg_game_count(p_session_id, p_session_player_id);
    UPDATE session_players
    SET game_count = GREATEST(game_count, v_avg),
        status = 'waiting',
        rest_since_match = NULL,
        wait_since = now()
    WHERE id = p_session_player_id;
  END IF;

  RETURN QUERY SELECT * FROM session_players WHERE id = p_session_player_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
