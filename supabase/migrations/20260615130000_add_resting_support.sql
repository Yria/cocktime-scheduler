-- ============================================================
-- 휴식(resting) 지원 — 복귀 시 deficit 보정 (forward-only)
--
-- 배경: 휴식은 "복귀 전까지 지속". 휴식 중에도 sessions.match_assign_count 는 계속 오르고
--       session_players.game_count 는 그대로라, 복귀 시 deficit(기대 경기수 − 실제)이 폭증해
--       추천 1순위로 튄다. (deficit = eligibleRounds * playProb − gameCount,
--        eligibleRounds = match_assign_count − joined_at_match)
--
-- 해결: 휴식 시작 시점의 match_assign_count 를 rest_since_match 에 기록해 두고,
--       복귀 시 joined_at_match 를 "휴식 동안 진행된 매치 수"만큼 전진시켜
--       휴식 구간을 eligibleRounds 에서 제외한다 → 복귀해도 휴식 전 standing 유지.
--       (wait_since 도 휴식 중 NULL, 복귀 시 now() 로 리셋해 대기 우선도 왜곡 방지.)
--
-- rest_since_match 는 서버 보조 컬럼 — 클라이언트 타입/transformer 는 읽지 않는다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 휴식 시작 시점 보조 컬럼
-- ------------------------------------------------------------
ALTER TABLE session_players ADD COLUMN IF NOT EXISTS rest_since_match INT;

-- ------------------------------------------------------------
-- 2. 휴식 토글 RPC — 갱신된 선수 행을 반환(브로드캐스트 player_updated 용)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_player_resting(
  p_session_player_id UUID,
  p_session_id BIGINT,
  p_resting BOOLEAN
) RETURNS SETOF session_players AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT match_assign_count INTO v_count FROM sessions WHERE id = p_session_id;
  v_count := COALESCE(v_count, 0);

  IF p_resting THEN
    -- 휴식 진입: 기준점 기록 + 대기시간 초기화
    UPDATE session_players
    SET status = 'resting',
        rest_since_match = v_count,
        wait_since = NULL
    WHERE id = p_session_player_id;
  ELSE
    -- 복귀: 휴식 동안 진행된 매치 수만큼 joined_at_match 를 전진(deficit 폭증 방지)
    UPDATE session_players
    SET joined_at_match = joined_at_match + (v_count - COALESCE(rest_since_match, v_count)),
        status = 'waiting',
        rest_since_match = NULL,
        wait_since = now()
    WHERE id = p_session_player_id;
  END IF;

  RETURN QUERY SELECT * FROM session_players WHERE id = p_session_player_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
