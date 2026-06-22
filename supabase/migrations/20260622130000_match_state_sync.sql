-- ============================================================
-- 코트 배정(matches) 동기화 신뢰성 — match_state_version 우산 (forward-only, replay-safe)
--
-- 확정된 근본 원인(코드 검증):
--   board_drafts(팀 편성)는 broadcast + sessions postgres_changes catch-up + 재구독 refetch +
--   단조 version CAS의 다중 안전장치로 모든 클라가 수렴한다. 그러나 matches(코트 배정)는
--   match_started/match_completed broadcast(self:false, fire-and-forget) "단일 경로"에만 의존한다:
--     · H1: matches 테이블이 realtime publication에 없고 postgres_changes 구독도 없음 → broadcast
--           한 번 유실되면 관전자는 영영 옛 코트 상태(= "누구는 팀/경기가 보이고 누구는 안 보임").
--     · H2: assign_match 만 sessions.match_assign_count++ 로 신호를 만들고, complete_match/로스터
--           변경은 sessions 를 안 건드려 catch-up 신호가 0. onResync 도 matches 를 안 읽음.
--     · H3: 경기 로스터 수정은 RPC 없이 직접 UPDATE 라 broadcast/원자성/catch-up 모두 없음.
--
-- 해결(설계 옵션 A): board_drafts 패턴을 matches 로 확장한다.
--   (1) sessions.match_state_version 단조 카운터 신설 — 코트 배정 상태의 "단일 version 우산".
--   (2) 모든 매치 변경 RPC(assign/complete/set_match_roster)가 같은 트랜잭션에서 ++ →
--       이미 publication 에 등록된 sessions row 의 postgres_changes UPDATE 가 신뢰성 있는
--       change-detection 신호가 된다(broadcast 유실과 무관). 수신측은 version 갭이면 matches refetch.
--   (3) set_match_roster 를 직접 UPDATE 에서 원자적 RPC 로 승격(H3) + version++.
--
-- match_assign_count 와 분리한 이유: match_assign_count 는 deficit(기대 경기수) 계산의 의미가 있어
--   완료/로스터 변경에서 올리면 통계가 왜곡된다. 순수 동기화 신호는 별도 카운터로 둔다.
--
-- 호환성: 컬럼은 NOT NULL DEFAULT 0 이라 기존 클라(컬럼 무시)와 100% 호환. RPC 는 반환 시그니처를
--   바꾸지 않거나(assign=VOID, complete=SETOF session_players) 신규 추가라 구버전 클라도 무중단.
-- replay-safe: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE FUNCTION.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 단조 카운터 컬럼
-- ------------------------------------------------------------
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS match_state_version BIGINT NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 2. assign_match 재정의 — 기존 동작(20260615120000) 보존 + match_state_version++
--    (코트 이중배정 부분 유니크 인덱스/예외 처리는 그대로 유지)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_match(
  p_match_id UUID,
  p_session_id BIGINT,
  p_court_id INT,
  p_game_type TEXT,
  p_team_a_p1 UUID,
  p_team_a_p2 UUID,
  p_team_b_p1 UUID,
  p_team_b_p2 UUID
) RETURNS VOID AS $$
BEGIN
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
-- 3. complete_match 재정의 — 기존 동작(20260618000100: 6쌍 pair_history + player_snapshot) 보존 +
--    match_state_version++ (완료도 코트 상태 변경이므로 동기화 신호 필요)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION complete_match(
  p_match_id UUID,
  p_session_id BIGINT,
  p_game_type TEXT,
  p_team_a_p1 UUID,
  p_team_a_p2 UUID,
  p_team_b_p1 UUID,
  p_team_b_p2 UUID
) RETURNS SETOF session_players AS $$
DECLARE
  v_updated_count INT;
  v_now TIMESTAMPTZ := NOW();
  v_is_mixed BOOLEAN := (p_game_type = '혼복');
  v_ids UUID[] := ARRAY[p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2];
  i INT;
  j INT;
BEGIN
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
-- 4. set_match_roster — 경기 로스터 수정의 원자적 RPC (H3 해결)
--    기존: 클라가 matches + session_players 를 직접 순차 UPDATE(원자성 없음, broadcast/catch-up 없음).
--    변경: 단일 트랜잭션으로 (a) 진행중 매치의 4슬롯 교체, (b) 빠진 선수→waiting, (c) 들어온 선수→playing,
--          (d) match_state_version++ (동기화 신호). 변경된 선수(removed+added)를 반환 → 클라 broadcast 용.
--    game_count/mixed_count 는 완료 시점(complete_match)에만 최종 로스터 기준으로 집계하므로 여기선 미변경.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_match_roster(
  p_match_id   UUID,
  p_session_id BIGINT,
  p_team_a_p1  UUID,
  p_team_a_p2  UUID,
  p_team_b_p1  UUID,
  p_team_b_p2  UUID,
  p_removed_ids UUID[],
  p_added_ids   UUID[]
) RETURNS SETOF session_players AS $$
DECLARE
  v_updated_count INT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
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
