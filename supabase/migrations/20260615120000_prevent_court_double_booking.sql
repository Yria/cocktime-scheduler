-- ============================================================
-- 코트 이중배정 방지 (forward-only)
--
-- 배경: assign_match 에는 (session_id, court_id) 진행중 매치 유일성 제약이 없어
--       두 기기가 동시에 같은 빈 코트로 "경기시작"을 누르면 matches 에
--       status='playing' 행이 코트당 2개 INSERT 되어 데이터가 손상됐다.
--       (클라이언트 startMatch 의 빈 코트 판정은 로컬 상태 기반이라 레이스에 취약.)
--
-- 해결: (1) 코트당 진행중 매치 최대 1개를 강제하는 부분 유니크 인덱스 추가,
--       (2) assign_match 가 충돌(unique_violation)을 잡아 명시적 예외로 변환.
--       → 늦게 도착한 두 번째 배정은 RPC 에러 → dbAssignMatch=false →
--         handleAssign 이 로컬 미반영 → startMatch 성공판정 false → "코트 배치 실패" 토스트.
--       완료된(completed) 매치는 인덱스 대상이 아니므로 코트 재사용은 정상 동작.
--
-- replay-safe: IF NOT EXISTS / CREATE OR REPLACE 사용. 기존 중복은 선정리.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 기존 중복 'playing' 매치 정리 (인덱스 생성 실패 방지)
--    코트별로 started_at 이 가장 이른 1건만 남기고 나머지는 completed 로 정리한다.
--    (status 직접 변경이므로 pair_history 는 건드리지 않음 — 어차피 잘못 생성된 중복.)
-- ------------------------------------------------------------
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY session_id, court_id
           ORDER BY started_at ASC, id ASC
         ) AS rn
  FROM matches
  WHERE status = 'playing'
)
UPDATE matches m
SET status = 'completed',
    ended_at = COALESCE(m.ended_at, now())
FROM ranked r
WHERE m.id = r.id
  AND r.rn > 1;

-- ------------------------------------------------------------
-- 2. 부분 유니크 인덱스: 코트당 진행중(playing) 매치는 최대 1개
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_matches_active_court
  ON matches (session_id, court_id)
  WHERE status = 'playing';

-- ------------------------------------------------------------
-- 3. assign_match 재정의: unique_violation 을 명시적 예외로 변환
--    시그니처/동작은 20260612120000 버전과 동일하며, 충돌 처리만 추가한다.
-- ------------------------------------------------------------
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
  -- 1. 매치 레코드 삽입 (코트가 이미 점유면 부분 유니크 인덱스가 unique_violation 발생)
  INSERT INTO matches (id, session_id, court_id, game_type, team_a_p1, team_a_p2, team_b_p1, team_b_p2, status)
  VALUES (p_match_id, p_session_id, p_court_id, p_game_type, p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2, 'playing');

  -- 2. 선수 상태 업데이트 (같은 트랜잭션)
  UPDATE session_players
  SET status = 'playing'
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);

  -- 3. 세션의 매치 배정 카운트 증가 (deficit 계산용)
  UPDATE sessions SET match_assign_count = match_assign_count + 1 WHERE id = p_session_id;
EXCEPTION
  WHEN unique_violation THEN
    -- 코트가 이미 다른 기기에 의해 배정됨 → 블록 내 변경 롤백 후 명시적 예외 전파
    RAISE EXCEPTION 'court already assigned';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
