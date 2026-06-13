-- pending 상태 추가, reserved 관련 잔재 제거
-- session_players.status: reserved → pending 교체
-- matches.status: reserved 제거
-- reserved_groups 테이블 삭제

-- 1. session_players.status CHECK 교체
--    기존: ('waiting', 'playing', 'resting', 'reserved')
--    신규: ('waiting', 'playing', 'resting', 'pending')
ALTER TABLE session_players DROP CONSTRAINT IF EXISTS session_players_status_check;
ALTER TABLE session_players ADD CONSTRAINT session_players_status_check
  CHECK (status IN ('waiting', 'playing', 'resting', 'pending'));

-- 2. matches.status CHECK 교체 (reserved 제거)
--    기존: ('playing', 'completed', 'reserved')
--    신규: ('playing', 'completed')
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE matches ADD CONSTRAINT matches_status_check
  CHECK (status IN ('playing', 'completed'));

-- 3. reserved_groups 테이블 삭제
DROP TABLE IF EXISTS reserved_groups CASCADE;
