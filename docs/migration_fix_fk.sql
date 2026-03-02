-- ============================================================
-- matches 테이블 외래 키 제약 조건 수정
-- session_players 삭제 시 매치 기록은 보존하되, 참조만 NULL로 변경
-- ============================================================

-- 1. 먼저 team_*_p* 컬럼을 NULL 허용으로 변경
ALTER TABLE matches
  ALTER COLUMN team_a_p1 DROP NOT NULL,
  ALTER COLUMN team_a_p2 DROP NOT NULL,
  ALTER COLUMN team_b_p1 DROP NOT NULL,
  ALTER COLUMN team_b_p2 DROP NOT NULL;

-- 2. 기존 외래 키 제약 조건 삭제
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_team_a_p1_fkey,
  DROP CONSTRAINT IF EXISTS matches_team_a_p2_fkey,
  DROP CONSTRAINT IF EXISTS matches_team_b_p1_fkey,
  DROP CONSTRAINT IF EXISTS matches_team_b_p2_fkey;

-- 3. 새로운 외래 키 제약 조건 추가 (ON DELETE SET NULL)
-- 이제 플레이어가 삭제되어도 매치 기록은 유지되며, 참조만 NULL이 됨
ALTER TABLE matches
  ADD CONSTRAINT matches_team_a_p1_fkey
    FOREIGN KEY (team_a_p1) REFERENCES session_players(id) ON DELETE SET NULL,
  ADD CONSTRAINT matches_team_a_p2_fkey
    FOREIGN KEY (team_a_p2) REFERENCES session_players(id) ON DELETE SET NULL,
  ADD CONSTRAINT matches_team_b_p1_fkey
    FOREIGN KEY (team_b_p1) REFERENCES session_players(id) ON DELETE SET NULL,
  ADD CONSTRAINT matches_team_b_p2_fkey
    FOREIGN KEY (team_b_p2) REFERENCES session_players(id) ON DELETE SET NULL;

-- 4. pair_history는 CASCADE로 유지 (페어 기록은 플레이어가 없으면 의미 없음)
ALTER TABLE pair_history
  DROP CONSTRAINT IF EXISTS pair_history_player_a_fkey,
  DROP CONSTRAINT IF EXISTS pair_history_player_b_fkey;

ALTER TABLE pair_history
  ADD CONSTRAINT pair_history_player_a_fkey
    FOREIGN KEY (player_a) REFERENCES session_players(id) ON DELETE CASCADE,
  ADD CONSTRAINT pair_history_player_b_fkey
    FOREIGN KEY (player_b) REFERENCES session_players(id) ON DELETE CASCADE;
