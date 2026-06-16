-- ============================================================
-- 경기 시작 후 선수 교체(경기 수정 특수 액션) RPC (forward-only)
--
-- 진행중(playing) 매치의 한 슬롯 선수를 다른 대기 선수로 교체한다.
-- matches 의 해당 포지션 컬럼 갱신 + 나간 선수 waiting / 들어온 선수 playing.
-- game_count 는 완료 시점에만 증가하므로 교체로 인한 카운트 변화는 없다.
-- ============================================================
CREATE OR REPLACE FUNCTION swap_match_player(
  p_match_id UUID,
  p_session_id BIGINT,
  p_position TEXT,          -- 'team_a_p1' | 'team_a_p2' | 'team_b_p1' | 'team_b_p2'
  p_old_player_id UUID,
  p_new_player_id UUID
) RETURNS SETOF session_players AS $$
DECLARE
  v_current UUID;
BEGIN
  -- 0. 포지션 화이트리스트(동적 컬럼 주입 방지)
  IF p_position NOT IN ('team_a_p1', 'team_a_p2', 'team_b_p1', 'team_b_p2') THEN
    RAISE EXCEPTION 'invalid position';
  END IF;
  IF p_old_player_id = p_new_player_id THEN
    RAISE EXCEPTION 'same player';
  END IF;

  -- 1. 매치가 진행중이고 해당 포지션이 old 선수인지 확인
  EXECUTE format(
    'SELECT %I FROM matches WHERE id = $1 AND session_id = $2 AND status = ''playing''',
    p_position
  ) INTO v_current USING p_match_id, p_session_id;
  IF v_current IS NULL OR v_current <> p_old_player_id THEN
    RAISE EXCEPTION 'swap target mismatch';
  END IF;

  -- 2. 새 선수가 이미 진행중 매치(어느 코트든)에 있으면 거부(중복 출전 방지)
  IF EXISTS (
    SELECT 1 FROM matches
    WHERE session_id = p_session_id AND status = 'playing'
      AND p_new_player_id IN (team_a_p1, team_a_p2, team_b_p1, team_b_p2)
  ) THEN
    RAISE EXCEPTION 'new player already playing';
  END IF;

  -- 3. 매치 포지션 교체
  EXECUTE format('UPDATE matches SET %I = $1 WHERE id = $2', p_position)
    USING p_new_player_id, p_match_id;

  -- 4. 선수 상태: 나간 선수 → waiting(대기시작 갱신), 들어온 선수 → playing
  UPDATE session_players SET status = 'waiting', wait_since = now() WHERE id = p_old_player_id;
  UPDATE session_players SET status = 'playing' WHERE id = p_new_player_id;

  -- 5. 갱신된 두 선수 반환(브로드캐스트 player 동기화용)
  RETURN QUERY SELECT * FROM session_players WHERE id IN (p_old_player_id, p_new_player_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
