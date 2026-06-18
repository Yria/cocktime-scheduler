-- ============================================================
-- matches.player_snapshot — 경기 시점 선수 스냅샷(이름/성별/스킬)
--
-- 버그: 로그/디버그가 matches의 UUID FK로 현재 session_players를 룩업해 이름을 복원하므로,
--       선수가 설정에서 삭제되면(ON DELETE SET NULL) "?"로 표시됨.
-- 조치: 경기 완료 시 4명의 스냅샷을 matches에 denormalize 저장 → 로그는 "그 시점 데이터"만 사용.
--       배열 순서 = [team_a_p1, team_a_p2, team_b_p1, team_b_p2]. 삭제된(없는) 선수 위치는 null.
--
-- 주의: complete_match의 pair_history 누적은 20260611120000의 "6쌍(같은 경기 4명 전체)" 동작을 그대로 보존하고
--       player_snapshot 기록만 추가한다.
-- ============================================================

ALTER TABLE matches ADD COLUMN IF NOT EXISTS player_snapshot JSONB;

-- 기존 완료 매치 백필 — 현재 session_players 기준(이미 삭제된 선수는 복구 불가 → 해당 위치 null)
UPDATE matches m SET player_snapshot = jsonb_build_array(
  (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM session_players sp WHERE sp.id = m.team_a_p1),
  (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM session_players sp WHERE sp.id = m.team_a_p2),
  (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM session_players sp WHERE sp.id = m.team_b_p1),
  (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM session_players sp WHERE sp.id = m.team_b_p2)
)
WHERE m.status = 'completed' AND m.player_snapshot IS NULL;

-- complete_match: 6쌍 pair_history 누적(20260611120000 보존) + 완료 시점 player_snapshot 기록(시그니처 불변)
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
