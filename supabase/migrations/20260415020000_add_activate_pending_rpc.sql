-- pending → waiting 활성화 RPC
-- 원자적으로 status, wait_since, joined_at_match를 업데이트
CREATE OR REPLACE FUNCTION activate_pending_player(
  p_session_id BIGINT,
  p_session_player_id UUID
) RETURNS VOID AS $$
DECLARE
  v_current_match_count INT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 현재 match_assign_count 조회
  SELECT match_assign_count INTO v_current_match_count
  FROM sessions WHERE id = p_session_id;

  -- 선수 활성화: status, wait_since, joined_at_match 원자적 업데이트
  UPDATE session_players
  SET status = 'waiting',
      wait_since = v_now,
      joined_at_match = v_current_match_count
  WHERE id = p_session_player_id AND status = 'pending';
END;
$$ LANGUAGE plpgsql;
