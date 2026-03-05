-- Team candidates table: pre-generated teams stored as a queue
CREATE TABLE team_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  queue_position INTEGER NOT NULL, -- 0, 1, 2, ... (순서)
  game_type TEXT NOT NULL, -- '남복', '여복', '혼복', '혼합'

  -- Team A
  team_a_p1 UUID NOT NULL REFERENCES session_players(id) ON DELETE CASCADE,
  team_a_p2 UUID NOT NULL REFERENCES session_players(id) ON DELETE CASCADE,

  -- Team B
  team_b_p1 UUID NOT NULL REFERENCES session_players(id) ON DELETE CASCADE,
  team_b_p2 UUID NOT NULL REFERENCES session_players(id) ON DELETE CASCADE,

  created_at TIMESTAMP DEFAULT NOW(),

  -- Unique constraint: 같은 세션 내에서 queue_position은 중복 불가
  UNIQUE(session_id, queue_position)
);

-- Index for fast queue queries
CREATE INDEX idx_team_candidates_session_queue
  ON team_candidates(session_id, queue_position);

-- Enable RLS
ALTER TABLE team_candidates ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read team candidates
CREATE POLICY "Enable read access for all users"
  ON team_candidates FOR SELECT
  USING (true);

-- Policy: Anyone can insert team candidates
CREATE POLICY "Enable insert access for all users"
  ON team_candidates FOR INSERT
  WITH CHECK (true);

-- Policy: Anyone can delete team candidates
CREATE POLICY "Enable delete access for all users"
  ON team_candidates FOR DELETE
  USING (true);
