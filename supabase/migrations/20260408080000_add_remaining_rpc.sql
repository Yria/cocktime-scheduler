-- ============================================================
-- 1. complete_match: 경기 완료를 단일 트랜잭션으로 처리
--    matches UPDATE + pair_history UPSERT + session_players UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION complete_match(
  p_match_id UUID,
  p_session_id BIGINT,
  p_game_type TEXT,
  p_team_a_p1 UUID,
  p_team_a_p2 UUID,
  p_team_b_p1 UUID,
  p_team_b_p2 UUID
) RETURNS SETOF session_players AS $$
DECLARE
  v_updated_count INT;
  v_now TIMESTAMPTZ := NOW();
  v_is_mixed BOOLEAN := (p_game_type = '혼복');
  v_pair_a1 UUID;
  v_pair_a2 UUID;
  v_pair_b1 UUID;
  v_pair_b2 UUID;
BEGIN
  -- 1. 매치 완료 처리 (동시성 제어: playing인 경우만)
  UPDATE matches
  SET status = 'completed', ended_at = v_now
  WHERE id = p_match_id AND status = 'playing';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Match already completed or not found';
  END IF;

  -- 2. pair_history upsert (팀A 페어 + 팀B 페어)
  -- 정렬하여 저장 (player_a < player_b)
  v_pair_a1 := LEAST(p_team_a_p1, p_team_a_p2);
  v_pair_a2 := GREATEST(p_team_a_p1, p_team_a_p2);
  v_pair_b1 := LEAST(p_team_b_p1, p_team_b_p2);
  v_pair_b2 := GREATEST(p_team_b_p1, p_team_b_p2);

  INSERT INTO pair_history (session_id, player_a, player_b, count)
  VALUES (p_session_id, v_pair_a1, v_pair_a2, 1)
  ON CONFLICT (session_id, player_a, player_b)
  DO UPDATE SET count = pair_history.count + 1;

  INSERT INTO pair_history (session_id, player_a, player_b, count)
  VALUES (p_session_id, v_pair_b1, v_pair_b2, 1)
  ON CONFLICT (session_id, player_a, player_b)
  DO UPDATE SET count = pair_history.count + 1;

  -- 3. 선수 상태 업데이트: waiting 복귀 + game_count 증가
  UPDATE session_players
  SET status = 'waiting',
      wait_since = v_now,
      game_count = game_count + 1,
      mixed_count = CASE
        WHEN v_is_mixed AND gender = 'M' THEN mixed_count + 1
        ELSE mixed_count
      END
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);

  -- 4. 업데이트된 선수 데이터 반환
  RETURN QUERY
  SELECT * FROM session_players
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. save_team_candidates: 기존 후보 삭제 + 새 후보 삽입
-- ============================================================
CREATE OR REPLACE FUNCTION save_team_candidates(
  p_session_id BIGINT,
  p_candidates JSONB
) RETURNS VOID AS $$
BEGIN
  -- 기존 후보만 삭제 (큐 아이템 보존: queue_position < 100)
  DELETE FROM team_candidates
  WHERE session_id = p_session_id AND queue_position < 100;

  -- 새 후보 삽입
  IF jsonb_array_length(p_candidates) > 0 THEN
    INSERT INTO team_candidates (session_id, queue_position, game_type, team_a_p1, team_a_p2, team_b_p1, team_b_p2, reason, strategy, is_new)
    SELECT
      p_session_id,
      (item->>'queue_position')::INT,
      item->>'game_type',
      (item->>'team_a_p1')::UUID,
      (item->>'team_a_p2')::UUID,
      (item->>'team_b_p1')::UUID,
      (item->>'team_b_p2')::UUID,
      item->>'reason',
      item->>'strategy',
      COALESCE((item->>'is_new')::BOOLEAN, false)
    FROM jsonb_array_elements(p_candidates) AS item;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. save_match_queue: 기존 큐 삭제 + 새 큐 삽입
-- ============================================================
CREATE OR REPLACE FUNCTION save_match_queue(
  p_session_id BIGINT,
  p_queue JSONB
) RETURNS VOID AS $$
BEGIN
  -- 기존 큐만 삭제 (후보 보존: queue_position >= 100)
  DELETE FROM team_candidates
  WHERE session_id = p_session_id AND queue_position >= 100;

  -- 새 큐 삽입
  IF jsonb_array_length(p_queue) > 0 THEN
    INSERT INTO team_candidates (session_id, queue_position, game_type, team_a_p1, team_a_p2, team_b_p1, team_b_p2, reason, strategy, is_new)
    SELECT
      p_session_id,
      (item->>'queue_position')::INT,
      item->>'game_type',
      (item->>'team_a_p1')::UUID,
      (item->>'team_a_p2')::UUID,
      (item->>'team_b_p1')::UUID,
      (item->>'team_b_p2')::UUID,
      item->>'reason',
      item->>'strategy',
      COALESCE((item->>'is_new')::BOOLEAN, false)
    FROM jsonb_array_elements(p_queue) AS item;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
