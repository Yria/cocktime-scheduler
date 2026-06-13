-- 보드 "팀 구성중"(drafts) + 예약(reservations) 멤버십을 클라이언트 간 공유하기 위한 컬럼.
-- 위치(anchor x/y)는 각 클라이언트 로컬이므로 저장하지 않고, 멤버십/예약 구조만 저장한다.
-- 형식: { "teams": [{ "id", "memberIds": [...], "createdMs" }],
--        "reservations": [{ "id", "playerId", "teamId", "createdMs" }] }
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS board_drafts JSONB NOT NULL
  DEFAULT '{"teams":[],"reservations":[]}'::jsonb;
