-- 매치 로그에 "경기 시작(편성)한 사람" 기록
--
-- 경기 시작 버튼(handleAssign → assign_match)을 누른 편집자의 실명(p_name = auth.myName)을
-- matches 행에 함께 저장해, 완료 로그(MatchCard)에서 "누가 편성했는지"를 볼 수 있게 한다.
--   - p_name 은 이미 편집 lease 가드용으로 assign_match 로 전달되고 있었으나 버려졌다(저장만 안 함).
--   - 이후 set_match_roster(팀 편집)는 assigned_by 를 건드리지 않는다 → "최초 편성자" 의미 고정.
--   - nullable: 기존 매치/미전달(구버전 클라)은 NULL → UI 미표시. 백워드 세이프.

alter table public.matches
	add column if not exists assigned_by text;

-- assign_match 재정의 — 시그니처 동일(인자 변경 없음, CREATE OR REPLACE 로 단일 함수 유지, replay-safe).
-- 기존 동작(20260624020000: 편집 락 가드 + 코트 점유 가드 + 카운터 증가) 그대로 보존하고,
-- INSERT 에 assigned_by = p_name 한 컬럼만 추가한다.
CREATE OR REPLACE FUNCTION assign_match(
  p_match_id UUID,
  p_session_id BIGINT,
  p_court_id INT,
  p_game_type TEXT,
  p_team_a_p1 UUID,
  p_team_a_p2 UUID,
  p_team_b_p1 UUID,
  p_team_b_p2 UUID,
  p_client_id TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_lease_seconds INT DEFAULT 20
) RETURNS VOID AS $$
BEGIN
  -- 0. 편집 락 가드(유효 lease 보유자/자유만 — 아니면 'not editor' 예외로 롤백)
  PERFORM board_assert_editor(p_session_id, p_client_id, p_name, p_lease_seconds);

  -- 1. 매치 레코드 삽입 (코트가 이미 점유면 부분 유니크 인덱스가 unique_violation 발생)
  --    assigned_by = 경기 시작 누른 편집자 실명(p_name).
  INSERT INTO matches (id, session_id, court_id, game_type, team_a_p1, team_a_p2, team_b_p1, team_b_p2, status, assigned_by)
  VALUES (p_match_id, p_session_id, p_court_id, p_game_type, p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2, 'playing', p_name);

  -- 2. 선수 상태 업데이트 (같은 트랜잭션)
  UPDATE session_players
  SET status = 'playing'
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);

  -- 3. 세션 카운터: match_assign_count(deficit 계산용) + match_state_version(동기화 신호) 동시 증가
  UPDATE sessions
  SET match_assign_count = match_assign_count + 1,
      match_state_version = match_state_version + 1
  WHERE id = p_session_id;
EXCEPTION
  WHEN unique_violation THEN
    -- 코트가 이미 다른 기기에 의해 배정됨 → 블록 내 변경 롤백 후 명시적 예외 전파
    RAISE EXCEPTION 'court already assigned';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
