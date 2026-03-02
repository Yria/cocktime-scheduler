-- ============================================================
-- 현재 DB 외래 키 제약 조건 상태 확인
-- ============================================================

-- matches 테이블의 외래 키 제약 조건 확인
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'matches'
ORDER BY tc.constraint_name;

-- matches 테이블의 컬럼 NULL 허용 상태 확인
SELECT
  column_name,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_name = 'matches'
  AND column_name LIKE 'team_%'
ORDER BY column_name;
