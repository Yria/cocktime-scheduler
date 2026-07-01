-- ============================================================
-- 편집 권한 획득을 운영진(is_admin)만으로 서버측 강제 (forward-only, replay-safe)
--
-- 배경: 클라이언트(sessionStore.claimEditor/claimEditingIfFree, BoardToolbar)에서 편집권 획득을
--   운영진(isAdmin)만 가능하도록 막았지만, 이는 UI/클라 계층 방어일 뿐이다. RPC를 직접 호출하면
--   비운영진도 editor lease 를 점유하거나 board_drafts/경기 상태를 바꿀 수 있었다.
--
-- 조치: 편집권을 "설정(획득/self-claim/양도)"하는 모든 서버 함수의 갱신 조건에 public.is_admin() 를
--   추가한다. is_admin()=false 면 UPDATE 가 0행 → 기존과 동일한 실패 경로로 수렴한다:
--     · board_claim_editor / takeover / handoff / save_drafts(SQL): RETURNING 빈 결과 → 클라는
--       null 처리 후 resync(보기 전용 유지). heartbeat 실패도 조용해 콘솔 에러가 쌓이지 않는다.
--     · board_assert_editor(경기 RPC 가드, plpgsql): 0행 → 기존 'not editor' 예외로 롤백.
--   board_release_editor(해제)는 권한 포기이므로 게이팅하지 않는다(누구나 자기 client 락 정리 가능).
--
-- 보안 규율: is_admin() 은 SECURITY DEFINER + auth.uid() 기반이라, 같은 SECURITY DEFINER 안에서
--   중첩 호출해도 auth.uid()(JWT sub)는 원 호출자를 가리킨다 → 실제 요청자의 운영진 여부로 판정.
--   각 함수는 SET search_path='' 이므로 반드시 public.is_admin() 로 스키마 한정 호출한다.
--   시그니처는 그대로라 CREATE OR REPLACE 로 재정의(단일 출처 유지, replay-safe).
-- ============================================================

-- board_claim_editor — 편집권 획득/연장(heartbeat) CAS + 운영진 강제
CREATE OR REPLACE FUNCTION board_claim_editor(
  p_session_id    BIGINT,
  p_client_id     TEXT,
  p_name          TEXT,
  p_lease_seconds INT DEFAULT 20
) RETURNS TABLE(o_client_id TEXT, o_name TEXT, o_lease_until TIMESTAMPTZ) AS $$
  UPDATE public.sessions s
  SET editor_client_id   = p_client_id,
      editor_name        = p_name,
      editor_lease_until = now() + make_interval(secs => coalesce(p_lease_seconds, 20))
  WHERE s.id = p_session_id
    AND public.is_admin()
    AND (s.editor_client_id IS NULL
         OR s.editor_lease_until < now()
         OR s.editor_client_id = p_client_id)
  RETURNING s.editor_client_id, s.editor_name, s.editor_lease_until;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = '';

-- board_takeover_editor — 편집권 강제 탈취 + 운영진 강제
CREATE OR REPLACE FUNCTION board_takeover_editor(
  p_session_id    BIGINT,
  p_client_id     TEXT,
  p_name          TEXT,
  p_lease_seconds INT DEFAULT 20
) RETURNS TABLE(o_client_id TEXT, o_name TEXT, o_lease_until TIMESTAMPTZ) AS $$
  UPDATE public.sessions s
  SET editor_client_id   = p_client_id,
      editor_name        = p_name,
      editor_lease_until = now() + make_interval(secs => coalesce(p_lease_seconds, 20))
  WHERE s.id = p_session_id
    AND public.is_admin()
  RETURNING s.editor_client_id, s.editor_name, s.editor_lease_until;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = '';

-- board_handoff_editor — 편집권 명시 양도(보유자 본인 + 운영진만)
CREATE OR REPLACE FUNCTION board_handoff_editor(
  p_session_id     BIGINT,
  p_from_client_id TEXT,
  p_to_client_id   TEXT,
  p_to_name        TEXT,
  p_lease_seconds  INT DEFAULT 20
) RETURNS TABLE(o_client_id TEXT, o_name TEXT, o_lease_until TIMESTAMPTZ) AS $$
  UPDATE public.sessions s
  SET editor_client_id   = p_to_client_id,
      editor_name        = p_to_name,
      editor_lease_until = now() + make_interval(secs => coalesce(p_lease_seconds, 20))
  WHERE s.id = p_session_id
    AND public.is_admin()
    AND s.editor_client_id = p_from_client_id
  RETURNING s.editor_client_id, s.editor_name, s.editor_lease_until;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = '';

-- board_save_drafts — board_drafts 낙관적 버전 CAS 쓰기 + self-claim + 운영진 강제
CREATE OR REPLACE FUNCTION board_save_drafts(
  p_session_id    BIGINT,
  p_client_id     TEXT,
  p_name          TEXT,
  p_payload       JSONB,
  p_base_version  BIGINT,
  p_lease_seconds INT DEFAULT 20
) RETURNS BIGINT AS $$
  UPDATE public.sessions s
  SET board_drafts         = p_payload,
      board_drafts_version = s.board_drafts_version + 1,
      editor_client_id     = p_client_id,
      editor_name          = p_name,
      editor_lease_until   = now() + make_interval(secs => coalesce(p_lease_seconds, 20))
  WHERE s.id = p_session_id
    AND public.is_admin()
    AND s.board_drafts_version = p_base_version
    AND (s.editor_client_id IS NULL
         OR s.editor_lease_until < now()
         OR s.editor_client_id = p_client_id)
  RETURNING s.board_drafts_version;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = '';

-- board_assert_editor — 경기 RPC(assign/complete/set_roster) self-claim 가드 + 운영진 강제.
--   is_admin()=false 면 UPDATE 0행 → 'not editor' 예외로 경기 조작 롤백(세 RPC는 이 헬퍼만 PERFORM).
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
    AND public.is_admin()
    AND (s.editor_client_id IS NULL
         OR s.editor_lease_until < now()
         OR s.editor_client_id = p_client_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'not editor';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
