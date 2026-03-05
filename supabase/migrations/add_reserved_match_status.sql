-- matches.status에 'reserved' 값 허용
-- 기존 CHECK constraint를 삭제하고 'reserved'를 포함한 새 constraint 추가

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE matches ADD CONSTRAINT matches_status_check
  CHECK (status IN ('playing', 'completed', 'reserved'));
