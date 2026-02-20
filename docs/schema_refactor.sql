-- session_participants 테이블 신규 생성 (세션별 출석 인원 및 누적 게임 수 기록)
CREATE TABLE IF NOT EXISTS session_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id BIGINT REFERENCES sessions(id) ON DELETE CASCADE,
  player_id TEXT,
  player_name TEXT,
  gender TEXT,
  game_count INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- match_records 테이블 신규 생성 (경기당 매치업 기록)
CREATE TABLE IF NOT EXISTS match_records (
  id UUID PRIMARY KEY,
  session_id BIGINT REFERENCES sessions(id) ON DELETE CASCADE,
  court_id INT,
  game_type TEXT,
  team_a_1_id TEXT,
  team_a_1_name TEXT,
  team_a_2_id TEXT,
  team_a_2_name TEXT,
  team_b_1_id TEXT,
  team_b_1_name TEXT,
  team_b_2_id TEXT,
  team_b_2_name TEXT,
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  status TEXT, -- 'playing', 'completed'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS 활성화 및 임시 익명 접근 허용 (보안에 맞게 수정 필요)
ALTER TABLE session_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon insert to participants" ON session_participants FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon select to participants" ON session_participants FOR SELECT USING (true);

ALTER TABLE match_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon insert to match_records" ON match_records FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon select to match_records" ON match_records FOR SELECT USING (true);
