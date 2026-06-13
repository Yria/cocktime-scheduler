-- ============================================================
-- 레거시 자동 팀 편성 제거 마이그레이션 (forward-only DROP)
--
-- 배경: /session 페이지(SessionMain) 제거 및 /session/board(자석 칠판)를
--       /session 으로 승격하면서 아래 기능 슬라이스를 전부 제거한다.
--         - 자동 팀 편성(auto team formation) / 팀 후보(team candidates)
--         - 매치 대기열(match queue)
--         - pending(미도착) 상태
--         - 수동매칭 로그(manual match logs)
--
-- 주의: 기존 마이그레이션은 append-only 히스토리이므로 수정하지 않고,
--       이 forward 마이그레이션 하나로 DROP을 수행한다.
--       모든 구문은 IF EXISTS / CASCADE 로 replay-safe 하게 작성한다.
--
-- 유지 객체(절대 건드리지 않음):
--   테이블 sessions, session_players, matches, pair_history
--   컬럼 sessions.match_assign_count, session_players.joined_at_match,
--        sessions.board_drafts
--   RPC assign_match, complete_match
-- ============================================================

-- ------------------------------------------------------------
-- 1. 기존 pending 행 정리
--    'pending' 상태는 20260415010000_add_pending_status.sql 에서 도입됨.
--    아래 2단계에서 CHECK 제약을 ('waiting','playing','resting')로
--    교체하기 전에, 남아있는 pending 행을 'waiting'으로 정리해야
--    제약 추가가 실패하지 않는다.
--    wait_since 가 NULL이면 정리 시점(now())으로 채워 대기 시간 기준을 보존한다.
-- ------------------------------------------------------------
UPDATE session_players
SET status = 'waiting',
    wait_since = COALESCE(wait_since, now())
WHERE status = 'pending';

-- ------------------------------------------------------------
-- 2. session_players_status_check 제약 교체
--    이 제약은 20260415010000_add_pending_status.sql 에서
--    ('waiting','playing','resting','pending') 로 정의되어 있다.
--    pending 상태 제거에 따라 ('waiting','playing','resting')로 교체한다.
-- ------------------------------------------------------------
ALTER TABLE session_players DROP CONSTRAINT IF EXISTS session_players_status_check;
ALTER TABLE session_players ADD CONSTRAINT session_players_status_check
  CHECK (status IN ('waiting', 'playing', 'resting'));

-- ------------------------------------------------------------
-- 3. status 컬럼 DEFAULT를 'waiting'로 설정
--    pending 도입 이후의 DEFAULT 잔재를 정리하고,
--    신규 행이 기본적으로 'waiting'으로 생성되도록 보장한다.
-- ------------------------------------------------------------
ALTER TABLE session_players ALTER COLUMN status SET DEFAULT 'waiting';

-- ------------------------------------------------------------
-- 4. 레거시 RPC 함수 제거
--    DROP FUNCTION 은 인자 시그니처까지 정확히 명시해야 안전하게 삭제된다.
-- ------------------------------------------------------------

-- save_team_candidates(p_session_id BIGINT, p_candidates JSONB)
--   → 20260408080000_add_remaining_rpc.sql 에서 생성됨.
--     team_candidates 테이블에 의존하는 팀 후보 저장 RPC.
DROP FUNCTION IF EXISTS save_team_candidates(BIGINT, JSONB);

-- save_match_queue(p_session_id BIGINT, p_queue JSONB)
--   → 20260408080000_add_remaining_rpc.sql 에서 생성됨.
--     team_candidates 테이블에 의존하는 매치 대기열 저장 RPC.
DROP FUNCTION IF EXISTS save_match_queue(BIGINT, JSONB);

-- activate_pending_player(p_session_id BIGINT, p_session_player_id UUID)
--   → 20260415020000_add_activate_pending_rpc.sql 에서 생성됨.
--     pending → waiting 활성화 RPC. pending 상태 제거에 따라 불필요.
DROP FUNCTION IF EXISTS activate_pending_player(BIGINT, UUID);

-- ------------------------------------------------------------
-- 5. 레거시 테이블 제거
--    CASCADE 로 의존 인덱스/RLS 정책/제약을 함께 제거한다.
-- ------------------------------------------------------------

-- team_candidates
--   → add_team_candidates.sql 에서 생성됨
--     (테이블 + idx_team_candidates_session_queue 인덱스 + RLS 정책 3종).
--     자동 팀 편성 후보/대기열 저장소. 보드 메인화로 불필요.
DROP TABLE IF EXISTS team_candidates CASCADE;

-- manual_match_logs
--   → add_manual_match_logs.sql 에서 생성됨
--     (테이블 + idx_manual_match_logs_session 인덱스),
--     add_rls_manual_match_logs.sql 에서 RLS 정책 추가됨.
--     수동매칭 로그 저장소. 보드 메인화로 불필요.
DROP TABLE IF EXISTS manual_match_logs CASCADE;

-- ------------------------------------------------------------
-- 6. session_players 의 force_mixed / force_hard_game 컬럼 제거
--    혼복강제/빡센경기 토글은 자동 팀 편성 플로우의 일부였고,
--    토글/쓰기 경로가 전부 제거되어 더 이상 사용하지 않으므로 컬럼도 제거한다.
-- ------------------------------------------------------------
ALTER TABLE session_players DROP COLUMN IF EXISTS force_mixed;
ALTER TABLE session_players DROP COLUMN IF EXISTS force_hard_game;

-- ------------------------------------------------------------
-- 7. assign_match RPC 재정의 (force 컬럼 참조 제거)
--    20260408070000_add_assign_match_rpc.sql 의 assign_match 는 선수 상태
--    업데이트 시 force_mixed/force_hard_game 를 false 로 설정했는데, 위 6단계에서
--    두 컬럼을 DROP 했으므로 그대로 두면 경기 시작 시 RPC 가 런타임 에러를 낸다.
--    해당 참조만 제거하고 나머지 동작(matches INSERT + status='playing' +
--    match_assign_count 증가)은 동일하게 유지하도록 CREATE OR REPLACE 한다.
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
  -- 1. 매치 레코드 삽입
  INSERT INTO matches (id, session_id, court_id, game_type, team_a_p1, team_a_p2, team_b_p1, team_b_p2, status)
  VALUES (p_match_id, p_session_id, p_court_id, p_game_type, p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2, 'playing');

  -- 2. 선수 상태 업데이트 (같은 트랜잭션) — force_* 컬럼 제거됨
  UPDATE session_players
  SET status = 'playing'
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);

  -- 3. 세션의 매치 배정 카운트 증가 (deficit 계산용)
  UPDATE sessions SET match_assign_count = match_assign_count + 1 WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
