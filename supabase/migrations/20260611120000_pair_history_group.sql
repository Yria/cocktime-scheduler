-- ============================================================
-- complete_match 갱신: pair_history를 "같은 경기 4명 그룹" 전체로 누적
--   기존: teamA 페어 + teamB 페어(2쌍, 같은 팀만)
--   변경: 같은 경기 4명(teamA+teamB)의 모든 쌍(6쌍) — 상대팀 동반도 카운트
--   game_count / mixed_count 로직은 기존과 동일.
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
  v_ids UUID[] := ARRAY[p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2];
  i INT;
  j INT;
BEGIN
  -- 1. 매치 완료 처리 (동시성 제어: playing인 경우만)
  UPDATE matches
  SET status = 'completed', ended_at = v_now
  WHERE id = p_match_id AND status = 'playing';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Match already completed or not found';
  END IF;

  -- 2. pair_history upsert — 같은 경기 4명 그룹의 모든 쌍(C(4,2)=6쌍)을 +1.
  --    정렬 저장(player_a < player_b)으로 (a,b)/(b,a) 중복을 한 행으로 합산.
  FOR i IN 1..4 LOOP
    FOR j IN (i + 1)..4 LOOP
      INSERT INTO pair_history (session_id, player_a, player_b, count)
      VALUES (
        p_session_id,
        LEAST(v_ids[i], v_ids[j]),
        GREATEST(v_ids[i], v_ids[j]),
        1
      )
      ON CONFLICT (session_id, player_a, player_b)
      DO UPDATE SET count = pair_history.count + 1;
    END LOOP;
  END LOOP;

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

  -- 4. 업데이트된 선수 데이터 반환
  RETURN QUERY
  SELECT * FROM session_players
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
