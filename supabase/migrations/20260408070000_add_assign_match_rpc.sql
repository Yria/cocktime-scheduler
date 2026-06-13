-- 매치 배정을 단일 트랜잭션으로 처리하는 RPC 함수
-- matches INSERT + session_players UPDATE를 원자적으로 실행
CREATE OR REPLACE FUNCTION assign_match(
  p_match_id UUID,
  p_session_id BIGINT,
  p_court_id INT,
  p_game_type TEXT,
  p_team_a_p1 UUID,
  p_team_a_p2 UUID,
  p_team_b_p1 UUID,
  p_team_b_p2 UUID
) RETURNS VOID AS $$
BEGIN
  -- 1. 매치 레코드 삽입
  INSERT INTO matches (id, session_id, court_id, game_type, team_a_p1, team_a_p2, team_b_p1, team_b_p2, status)
  VALUES (p_match_id, p_session_id, p_court_id, p_game_type, p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2, 'playing');

  -- 2. 선수 상태 업데이트 (같은 트랜잭션)
  UPDATE session_players
  SET status = 'playing', force_mixed = false, force_hard_game = false
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);

  -- 3. 세션의 매치 배정 카운트 증가 (deficit 계산용)
  UPDATE sessions SET match_assign_count = match_assign_count + 1 WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
