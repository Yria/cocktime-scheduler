-- Enable RLS on manual_match_logs
ALTER TABLE manual_match_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read manual match logs
CREATE POLICY "Enable read access for all users"
  ON manual_match_logs FOR SELECT
  USING (true);

-- Policy: Anyone can insert manual match logs
CREATE POLICY "Enable insert access for all users"
  ON manual_match_logs FOR INSERT
  WITH CHECK (true);

-- Policy: Anyone can delete manual match logs
CREATE POLICY "Enable delete access for all users"
  ON manual_match_logs FOR DELETE
  USING (true);
