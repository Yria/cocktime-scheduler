-- ============================================================
-- DB 정리 (forward-only, replay-safe)
--
-- 1) 미사용 RPC swap_match_player 제거 — 경기 수정은 클라이언트 직접 UPDATE로 변경되어 RPC 불필요.
-- 2) 미사용 컬럼 sessions.script_url 제거 — 재접속 복구용으로 의도됐으나 코드에서 전혀 사용 안 함.
-- 3) matches team_* FK = ON DELETE SET NULL 확정 — 선수 삭제 시 완료 매치 기록은 보존하되 참조만 NULL.
-- 4) pair_history FK = ON DELETE CASCADE 확정 — 선수 삭제 시 동반 기록은 함께 정리.
--
-- (3)(4)는 docs/migration_fix_fk.sql 의 의도지만 그 파일은 추적되지 않는 수동 SQL 이라
-- 적용 여부가 불확실했다. 추적되는 마이그레이션으로 확정해 "선수 삭제가 FK 로 막히는" 잠재 버그를 제거한다.
-- DROP CONSTRAINT IF EXISTS + ADD 로 작성해 이미 적용된 DB 에서도 안전하게 재적용된다.
-- ============================================================

-- 1. 미사용 RPC 제거
DROP FUNCTION IF EXISTS swap_match_player(UUID, BIGINT, TEXT, UUID, UUID);

-- 2. 미사용 컬럼 제거
ALTER TABLE sessions DROP COLUMN IF EXISTS script_url;

-- 3. matches team_* — NULL 허용 + ON DELETE SET NULL
ALTER TABLE matches
  ALTER COLUMN team_a_p1 DROP NOT NULL,
  ALTER COLUMN team_a_p2 DROP NOT NULL,
  ALTER COLUMN team_b_p1 DROP NOT NULL,
  ALTER COLUMN team_b_p2 DROP NOT NULL;

ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_team_a_p1_fkey,
  DROP CONSTRAINT IF EXISTS matches_team_a_p2_fkey,
  DROP CONSTRAINT IF EXISTS matches_team_b_p1_fkey,
  DROP CONSTRAINT IF EXISTS matches_team_b_p2_fkey;

ALTER TABLE matches
  ADD CONSTRAINT matches_team_a_p1_fkey FOREIGN KEY (team_a_p1) REFERENCES session_players(id) ON DELETE SET NULL,
  ADD CONSTRAINT matches_team_a_p2_fkey FOREIGN KEY (team_a_p2) REFERENCES session_players(id) ON DELETE SET NULL,
  ADD CONSTRAINT matches_team_b_p1_fkey FOREIGN KEY (team_b_p1) REFERENCES session_players(id) ON DELETE SET NULL,
  ADD CONSTRAINT matches_team_b_p2_fkey FOREIGN KEY (team_b_p2) REFERENCES session_players(id) ON DELETE SET NULL;

-- 4. pair_history — ON DELETE CASCADE
ALTER TABLE pair_history
  DROP CONSTRAINT IF EXISTS pair_history_player_a_fkey,
  DROP CONSTRAINT IF EXISTS pair_history_player_b_fkey;

ALTER TABLE pair_history
  ADD CONSTRAINT pair_history_player_a_fkey FOREIGN KEY (player_a) REFERENCES session_players(id) ON DELETE CASCADE,
  ADD CONSTRAINT pair_history_player_b_fkey FOREIGN KEY (player_b) REFERENCES session_players(id) ON DELETE CASCADE;
