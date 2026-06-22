-- ============================================================
-- 보드 동기화 v2 함수 수렴 (forward-only, replay-safe)
--
-- 배경: 20260622000000 이 원격에 적용된 뒤(다른 마이그레이션과 함께 db push) 그 파일의 함수 정의가
--   이후 수정됐다(특히 board_save_drafts: 4인자 → 6인자 self-claim). db push 는 이미 적용된 버전을
--   재실행하지 않으므로 원격에는 구버전 함수가 남아 있다(probe 확인: board_save_drafts 가 4인자
--   (p_session_id,p_client_id,p_payload,p_base_version) 형태로 존재). 클라이언트는 6인자로 호출하므로
--   그대로면 모든 board_drafts 저장이 PGRST202(함수 없음)→충돌로 처리되어 편집이 반영되지 않는다.
--
-- 조치: 구 4인자 board_save_drafts 를 DROP 하고, 보드 락/저장 4개 함수를 현재(최종) 정의로
--   CREATE OR REPLACE 하여 원격을 코드와 일치시킨다. 컬럼/publication 은 이미 적용됨(여기선 손대지 않음).
--   모든 정의는 20260622000000 의 최종 내용과 동일하다(단일 출처 유지).
-- ============================================================

-- 구 4인자 board_save_drafts 제거(존재할 때만). 6인자 self-claim 버전으로 대체된다.
DROP FUNCTION IF EXISTS public.board_save_drafts(BIGINT, TEXT, JSONB, BIGINT);

-- board_claim_editor — 편집권 획득/연장(heartbeat) CAS
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
    AND (s.editor_client_id IS NULL
         OR s.editor_lease_until < now()
         OR s.editor_client_id = p_client_id)
  RETURNING s.editor_client_id, s.editor_name, s.editor_lease_until;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = '';

-- board_handoff_editor — 편집권 명시 양도(보유자 본인만)
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
    AND s.editor_client_id = p_from_client_id
  RETURNING s.editor_client_id, s.editor_name, s.editor_lease_until;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = '';

-- board_release_editor — 편집권 해제(정상 이탈)
CREATE OR REPLACE FUNCTION board_release_editor(
  p_session_id BIGINT,
  p_client_id  TEXT
) RETURNS VOID AS $$
  UPDATE public.sessions s
  SET editor_client_id   = NULL,
      editor_name        = NULL,
      editor_lease_until = NULL
  WHERE s.id = p_session_id
    AND s.editor_client_id = p_client_id;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = '';

-- board_save_drafts — board_drafts 낙관적 버전 CAS 쓰기 + self-claim (6인자)
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
    AND s.board_drafts_version = p_base_version
    AND (s.editor_client_id IS NULL
         OR s.editor_lease_until < now()
         OR s.editor_client_id = p_client_id)
  RETURNING s.board_drafts_version;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = '';
