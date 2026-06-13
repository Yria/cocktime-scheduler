-- ============================================================
-- 콕타임 DB 마이그레이션 (현재 스키마 스냅샷)
-- 기존 테이블(sessions, session_participants, match_records) 제거 후 재설계
--
-- NOTE (2026-06 리팩토링):
--   자동 팀 편성 슬라이스 제거로 아래 객체는 더 이상 존재하지 않는다.
--   (forward DROP: supabase/migrations/20260612120000_remove_legacy_team_formation.sql)
--     - 테이블 team_candidates, manual_match_logs (예약 reserved_groups 도 이전에 제거됨)
--     - RPC save_team_candidates, save_match_queue, activate_pending_player
--     - session_players.status 의 'pending' 값
--     - session_players.force_mixed / force_hard_game 컬럼
--         (20260612120000 에서 ALTER TABLE ... DROP COLUMN IF EXISTS 로 제거.
--          코드 필드·transformer·DebugMatchModal 표시·타입까지 전부 제거됨.)
--   유지: sessions/session_players/matches/pair_history,
--         sessions.match_assign_count, sessions.board_drafts,
--         session_players.joined_at_match, RPC assign_match / complete_match
-- ============================================================

-- ── 기존 테이블 제거 ─────────────────────────────────────────

DROP TABLE IF EXISTS match_records CASCADE;
DROP TABLE IF EXISTS session_participants CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;

-- ── 신규 테이블 생성 ─────────────────────────────────────────

-- 1. sessions
CREATE TABLE sessions (
  id                 BIGSERIAL    PRIMARY KEY,
  is_active          BOOLEAN      NOT NULL DEFAULT true,
  court_count        INT          NOT NULL,
  script_url         TEXT,
  started_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at           TIMESTAMPTZ,
  match_assign_count INT          NOT NULL DEFAULT 0,  -- 누적 코트 배정 횟수 (deficit 기산점)
  board_drafts       JSONB                            -- 보드 "팀 구성중" 멤버십 (공유 드래프트)
);

-- 2. session_players
CREATE TABLE session_players (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          BIGINT       NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  player_id           TEXT         NOT NULL,
  name                TEXT         NOT NULL,
  gender              TEXT         NOT NULL CHECK (gender IN ('M', 'F')),
  skills              JSONB        NOT NULL,

  allow_mixed_single  BOOLEAN      NOT NULL DEFAULT false,

  -- 'pending' 제거됨 (2026-06): ('waiting','playing','resting')만 허용, DEFAULT 'waiting'
  status              TEXT         NOT NULL DEFAULT 'waiting'
                                   CHECK (status IN ('waiting', 'playing', 'resting')),
  -- NOTE: force_mixed / force_hard_game 컬럼은 20260612120000 마이그레이션에서 DROP 됨

  game_count          INT          NOT NULL DEFAULT 0,
  mixed_count         INT          NOT NULL DEFAULT 0,
  joined_at_match     INT          NOT NULL DEFAULT 0,  -- 합류 시점 match_assign_count (deficit 기산점)

  wait_since          TIMESTAMPTZ,
  joined_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sp_session        ON session_players(session_id);
CREATE INDEX idx_sp_session_status ON session_players(session_id, status);

-- 3. matches
CREATE TABLE matches (
  id          UUID         PRIMARY KEY,
  session_id  BIGINT       NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  court_id    INT          NOT NULL,
  game_type   TEXT         NOT NULL CHECK (game_type IN ('혼복', '남복', '여복', '혼합')),

  team_a_p1   UUID         NOT NULL REFERENCES session_players(id),
  team_a_p2   UUID         NOT NULL REFERENCES session_players(id),
  team_b_p1   UUID         NOT NULL REFERENCES session_players(id),
  team_b_p2   UUID         NOT NULL REFERENCES session_players(id),

  status      TEXT         NOT NULL DEFAULT 'playing'
                           CHECK (status IN ('playing', 'completed')),
  -- NOTE: 'reserved' 상태는 미구현 잔재로 제거됨
  started_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ
);

CREATE INDEX idx_matches_session        ON matches(session_id);
CREATE INDEX idx_matches_session_status ON matches(session_id, status);

-- 4. pair_history
CREATE TABLE pair_history (
  session_id  BIGINT  NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_a    UUID    NOT NULL REFERENCES session_players(id),
  player_b    UUID    NOT NULL REFERENCES session_players(id),
  count       INT     NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, player_a, player_b),
  -- player_a < player_b 강제 (애플리케이션 레벨에서도 보장해야 함)
  CONSTRAINT pair_order CHECK (player_a < player_b)
);

-- ── RLS ──────────────────────────────────────────────────────

ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pair_history    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON sessions        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON session_players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON matches         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON pair_history    FOR ALL USING (true) WITH CHECK (true);

-- ── Realtime 활성화 ───────────────────────────────────────────
-- Supabase 대시보드 > Database > Replication 에서 활성화 필요
-- 또는 아래 쿼리 실행 (supabase_realtime publication에 테이블 추가)

ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE session_players;
ALTER PUBLICATION supabase_realtime ADD TABLE matches;
