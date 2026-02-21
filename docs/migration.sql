-- ============================================================
-- 콕타임 DB 마이그레이션
-- 기존 테이블(sessions, session_participants, match_records) 제거 후 재설계
-- ============================================================

-- ── 기존 테이블 제거 ─────────────────────────────────────────

DROP TABLE IF EXISTS match_records CASCADE;
DROP TABLE IF EXISTS session_participants CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;

-- ── 신규 테이블 생성 ─────────────────────────────────────────

-- 1. sessions
CREATE TABLE sessions (
  id           BIGSERIAL    PRIMARY KEY,
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  court_count  INT          NOT NULL,
  script_url   TEXT,
  started_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at     TIMESTAMPTZ
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

  status              TEXT         NOT NULL DEFAULT 'waiting'
                                   CHECK (status IN ('waiting', 'playing', 'resting', 'reserved')),
  force_mixed         BOOLEAN      NOT NULL DEFAULT false,

  game_count          INT          NOT NULL DEFAULT 0,
  mixed_count         INT          NOT NULL DEFAULT 0,

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

-- 5. reserved_groups
CREATE TABLE reserved_groups (
  id          TEXT         PRIMARY KEY,
  session_id  BIGINT       NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  member_ids  UUID[]       NOT NULL,
  ready_ids   UUID[]       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rg_session ON reserved_groups(session_id);

-- ── RLS ──────────────────────────────────────────────────────

ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pair_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reserved_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON sessions        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON session_players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON matches         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON pair_history    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON reserved_groups FOR ALL USING (true) WITH CHECK (true);

-- ── Realtime 활성화 ───────────────────────────────────────────
-- Supabase 대시보드 > Database > Replication 에서 활성화 필요
-- 또는 아래 쿼리 실행 (supabase_realtime publication에 테이블 추가)

ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE session_players;
ALTER PUBLICATION supabase_realtime ADD TABLE matches;
