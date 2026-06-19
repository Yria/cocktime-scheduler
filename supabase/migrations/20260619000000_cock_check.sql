-- ============================================================
-- 콕 체크(셔틀콕 제출 확인) 기능
--
-- 입장한 선수가 제출한 콕을 운영자가 확인해야 실제 매칭 대기 상태가 된다.
-- - sessions.cock_check_enabled: 세션별 on/off (디폴트 on)
-- - session_players.cock_checked: 선수별 확인 여부 (디폴트 false=미확인)
--   매칭 대기 = (NOT cock_check_enabled) OR cock_checked
-- ============================================================

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS cock_check_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE session_players
  ADD COLUMN IF NOT EXISTS cock_checked BOOLEAN NOT NULL DEFAULT false;
