-- ============================================================
-- 편집 락: sticky 소유 + 하트비트 제거 (Realtime 메시지 감축)  [forward-only, replay-safe]
--
-- 배경: 편집 락은 sessions.editor_* 단일 row가 진실. 기존엔 lease(20s)를 클라 하트비트(7s)가
--   계속 갱신하고, lease 만료 시 자동으로 락이 풀려(lockFree) 다른 클라가 자동 점유/이어받기 했다.
--   문제: 편집 안 해도 편집자가 화면에 떠 있는 한 7초마다 sessions row UPDATE → session-meta
--   postgres_changes 로 접속자 전원에게 팬아웃(사용자 활동과 무관한 연속 트래픽). Realtime 메시지
--   초과의 최대 주범.
--
-- 변경(기획 확정): 편집권은 "명시적 행동으로만" 이동한다.
--   · 최초 오픈/자유 상태에서 (혼자면) 자동 점유는 유지.
--   · 한번 점유되면 lease 만료로 자동 해제/이어받기 없음(sticky) — 오직 board_takeover_editor
--     (수동 "편집 권한 가져오기") / board_handoff_editor(명시 양도) 로만 이동.
--   · 하트비트가 불필요해져 클라에서 제거 → 연속 sessions UPDATE 스트림 소멸.
--
-- 서버 조치:
--   1) board_claim_editor / board_save_drafts CAS 에서 `editor_lease_until < now()` (만료 시
--      탈취 허용) 조항 제거 → 점유된 락은 claim 으로 못 뺏음(자유이거나 나일 때만). takeover 는
--      무조건 덮어쓰므로 크래시로 붙잡힌 락도 "가져오기" 한 번으로 회수 가능.
--   2) board_assert_editor(경기 RPC 가드): 이미 편집자면 sessions WRITE 없이 통과하도록 재작성
--      (기존엔 매 경기 조작마다 lease 갱신 UPDATE → 팬아웃 2배). 자유면 self-claim(운영진만),
--      남이 보유면 'not editor'. 운영진(is_admin) 재검증은 유지(write 아닌 read라 팬아웃 없음).
--
-- editor_lease_until 컬럼은 잔존(claim/takeover/save/self-claim 시 계속 세팅)하나 더는 만료
--   판정에 쓰이지 않는다(클라 computeLockFromRow 도 신원만 사용). 컬럼 제거는 별도 정리로 미룸.
-- 시그니처 불변 → CREATE OR REPLACE 재정의(단일 출처 유지, replay-safe).
-- 계약서: docs/EXPANSION_SPEC.md §편집 락, docs 보드 동기화 불변식(단일 편집자·뷰어 수렴).
-- ============================================================

-- board_claim_editor — 획득/자기연장 CAS. sticky: 만료 조항 제거(자유이거나 나일 때만 성공).
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
         OR s.editor_client_id = p_client_id)
  RETURNING s.editor_client_id, s.editor_name, s.editor_lease_until;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = '';

-- board_save_drafts — board_drafts 버전 CAS + self-claim. sticky: 만료 조항 제거.
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
         OR s.editor_client_id = p_client_id)
  RETURNING s.board_drafts_version;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = '';

-- board_assert_editor — 경기 RPC(assign/complete/set_roster) 편집자 가드.
--   이미 편집자면 sessions WRITE 없이 통과(팬아웃 제거). 자유면 self-claim(운영진만), 남이 보유면 거부.
CREATE OR REPLACE FUNCTION board_assert_editor(
  p_session_id    BIGINT,
  p_client_id     TEXT,
  p_name          TEXT,
  p_lease_seconds INT DEFAULT 20
) RETURNS VOID AS $$
DECLARE
  v_editor TEXT;
BEGIN
  IF p_client_id IS NULL THEN
    RETURN; -- 구버전 클라(미전달) 호환: 가드 생략
  END IF;
  SELECT s.editor_client_id INTO v_editor FROM public.sessions s WHERE s.id = p_session_id;
  -- 이미 편집자(신원 일치) → sessions UPDATE 없이 통과. 단 운영진 여부는 계속 확인(권한 회수 반영).
  IF v_editor IS NOT NULL AND v_editor = p_client_id THEN
    IF public.is_admin() THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'not editor';
  END IF;
  -- 미보유: 자유(NULL)면 self-claim(운영진만), 남이 보유면 0행 → 거부. 만료 조항 없음(sticky).
  UPDATE public.sessions s
  SET editor_client_id   = p_client_id,
      editor_name        = COALESCE(p_name, s.editor_name),
      editor_lease_until = now() + make_interval(secs => coalesce(p_lease_seconds, 20))
  WHERE s.id = p_session_id
    AND public.is_admin()
    AND s.editor_client_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not editor';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
