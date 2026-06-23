-- ============================================================
-- 경기 RPC 서버측 편집 락(editor lease) 게이팅 (forward-only, replay-safe)
--
-- 배경(코드 검증된 근본 원인):
--   board_save_drafts(팀 편성)는 editor lease CAS로 보호되지만, 코트 배정 RPC
--   (assign_match / complete_match / set_match_roster)는 lease를 검증하지 않았다.
--   → 클라이언트측 isEditor가 "낙관적으로" 먼저 true가 되거나(claimEditingIfFree),
--     핸드오프/탈취 직후 stale 상태에서, 실제 lease를 보유하지 않은 기기가 경기 상태를
--     성공적으로 바꿀 수 있었다. 그 결과 짝이 되는 draft 해체(dissolve, board_save_drafts)는
--     CAS로 거부·롤백되어 "팀 편성중인데 게임중 뱃지"·"두 곳에 동시 존재" 중복이 발생했다.
--
-- 조치(불변식 "편집은 반드시 한 명만"의 서버측 강제):
--   세 경기 RPC에 board_assert_editor(self-claim CAS) 가드를 추가한다. board_save_drafts 와
--   동일한 관대한 술어(editor 없음 OR lease 만료 OR 본인)로 "혼자/heartbeat 공백" 정상 흐름은
--   통과시키되, 다른 기기가 유효 lease를 들고 있으면 'not editor' 예외로 거부한다(원자적 롤백).
--   가드는 같은 트랜잭션에서 lease를 self-claim(연장)하므로 board_save_drafts 와 동일한
--   단일 편집자 수렴 의미를 갖는다.
--
-- 시그니처: p_client_id/p_name/p_lease_seconds 3개 인자를 끝에 DEFAULT NULL/20 으로 추가.
--   p_client_id IS NULL(구버전 클라가 미전달)이면 가드를 생략해 무중단(앱은 함께 배포됨).
--   인자 추가는 새 오버로드를 만들어 PostgREST 후보 모호성을 일으키므로, 기존 8/7/8-인자
--   정의를 DROP 후 새 시그니처로 재생성한다(단일 함수 유지). DROP IF EXISTS + CREATE OR REPLACE 로 replay-safe.
-- ============================================================

-- ------------------------------------------------------------
-- 0. 편집 락 단언 헬퍼 — self-claim CAS. 보유자/자유/만료면 lease 연장 후 통과, 아니면 'not editor' 예외.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION board_assert_editor(
  p_session_id    BIGINT,
  p_client_id     TEXT,
  p_name          TEXT,
  p_lease_seconds INT DEFAULT 20
) RETURNS VOID AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_client_id IS NULL THEN
    RETURN; -- 구버전 클라(미전달) 호환: 가드 생략
  END IF;
  UPDATE public.sessions s
  SET editor_client_id   = p_client_id,
      editor_name        = COALESCE(p_name, s.editor_name),
      editor_lease_until = now() + make_interval(secs => coalesce(p_lease_seconds, 20))
  WHERE s.id = p_session_id
    AND (s.editor_client_id IS NULL
         OR s.editor_lease_until < now()
         OR s.editor_client_id = p_client_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'not editor';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- ------------------------------------------------------------
-- 1. assign_match — 기존(20260622130000) 동작 보존 + 편집 락 가드
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS assign_match(UUID, BIGINT, INT, TEXT, UUID, UUID, UUID, UUID);
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
  INSERT INTO matches (id, session_id, court_id, game_type, team_a_p1, team_a_p2, team_b_p1, team_b_p2, status)
  VALUES (p_match_id, p_session_id, p_court_id, p_game_type, p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2, 'playing');

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

-- ------------------------------------------------------------
-- 2. complete_match — 기존 동작 보존 + 편집 락 가드
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS complete_match(UUID, BIGINT, TEXT, UUID, UUID, UUID, UUID);
CREATE OR REPLACE FUNCTION complete_match(
  p_match_id UUID,
  p_session_id BIGINT,
  p_game_type TEXT,
  p_team_a_p1 UUID,
  p_team_a_p2 UUID,
  p_team_b_p1 UUID,
  p_team_b_p2 UUID,
  p_client_id TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_lease_seconds INT DEFAULT 20
) RETURNS SETOF session_players AS $$
DECLARE
  v_updated_count INT;
  v_now TIMESTAMPTZ := NOW();
  v_is_mixed BOOLEAN := (p_game_type = '혼복');
  v_ids UUID[] := ARRAY[p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2];
  i INT;
  j INT;
BEGIN
  -- 0. 편집 락 가드
  PERFORM board_assert_editor(p_session_id, p_client_id, p_name, p_lease_seconds);

  -- 1. 매치 완료 처리 + 선수 스냅샷 기록(동시성 제어: playing인 경우만)
  UPDATE matches
  SET status = 'completed',
      ended_at = v_now,
      player_snapshot = jsonb_build_array(
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM session_players sp WHERE sp.id = p_team_a_p1),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM session_players sp WHERE sp.id = p_team_a_p2),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM session_players sp WHERE sp.id = p_team_b_p1),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM session_players sp WHERE sp.id = p_team_b_p2)
      )
  WHERE id = p_match_id AND status = 'playing';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Match already completed or not found';
  END IF;

  -- 2. pair_history upsert — 같은 경기 4명 그룹의 모든 쌍(C(4,2)=6쌍)을 +1.
  FOR i IN 1..4 LOOP
    FOR j IN (i + 1)..4 LOOP
      INSERT INTO pair_history (session_id, player_a, player_b, count)
      VALUES (
        p_session_id,
        LEAST(v_ids[i], v_ids[j]),
        GREATEST(v_ids[i], v_ids[j]),
        1
      )
      ON CONFLICT (session_id, player_a, player_b)
      DO UPDATE SET count = pair_history.count + 1;
    END LOOP;
  END LOOP;

  -- 3. 선수 상태 업데이트: waiting 복귀 + game_count 증가 + (혼복 남자) mixed_count 증가
  UPDATE session_players
  SET status = 'waiting',
      wait_since = v_now,
      game_count = game_count + 1,
      mixed_count = CASE
        WHEN v_is_mixed AND gender = 'M' THEN mixed_count + 1
        ELSE mixed_count
      END
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);

  -- 4. 동기화 신호: 코트가 비워졌음을 catch-up 으로 알린다.
  UPDATE sessions SET match_state_version = match_state_version + 1 WHERE id = p_session_id;

  -- 5. 업데이트된 선수 데이터 반환
  RETURN QUERY
  SELECT * FROM session_players
  WHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 3. set_match_roster — 기존 동작 보존 + 편집 락 가드
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS set_match_roster(UUID, BIGINT, UUID, UUID, UUID, UUID, UUID[], UUID[]);
CREATE OR REPLACE FUNCTION set_match_roster(
  p_match_id   UUID,
  p_session_id BIGINT,
  p_team_a_p1  UUID,
  p_team_a_p2  UUID,
  p_team_b_p1  UUID,
  p_team_b_p2  UUID,
  p_removed_ids UUID[],
  p_added_ids   UUID[],
  p_client_id TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_lease_seconds INT DEFAULT 20
) RETURNS SETOF session_players AS $$
DECLARE
  v_updated_count INT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 0. 편집 락 가드
  PERFORM board_assert_editor(p_session_id, p_client_id, p_name, p_lease_seconds);

  -- 1. 진행중 매치의 로스터 교체 (playing 인 경우만 — 이미 완료/삭제된 매치 보호)
  UPDATE matches
  SET team_a_p1 = p_team_a_p1,
      team_a_p2 = p_team_a_p2,
      team_b_p1 = p_team_b_p1,
      team_b_p2 = p_team_b_p2
  WHERE id = p_match_id AND session_id = p_session_id AND status = 'playing';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Match not found or already completed';
  END IF;

  -- 2. 빠진 선수 → 대기(완료 전 이탈이라 game_count 변동 없음, 대기 시작 갱신)
  IF array_length(p_removed_ids, 1) IS NOT NULL THEN
    UPDATE session_players
    SET status = 'waiting', wait_since = v_now
    WHERE id = ANY(p_removed_ids);
  END IF;

  -- 3. 들어온 선수 → 경기중
  IF array_length(p_added_ids, 1) IS NOT NULL THEN
    UPDATE session_players
    SET status = 'playing'
    WHERE id = ANY(p_added_ids);
  END IF;

  -- 4. 동기화 신호
  UPDATE sessions SET match_state_version = match_state_version + 1 WHERE id = p_session_id;

  -- 5. 변경된 선수 반환(broadcast player 동기화 + 발신측 로컬 반영용)
  RETURN QUERY
  SELECT * FROM session_players
  WHERE id = ANY(p_removed_ids) OR id = ANY(p_added_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
