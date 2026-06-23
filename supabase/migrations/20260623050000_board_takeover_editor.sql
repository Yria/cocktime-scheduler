-- ============================================================
-- board_takeover_editor — 편집권 강제 탈취(명시 "편집 권한 가져오기")
--
-- 배경: board_claim_editor 는 CAS(editor IS NULL OR lease<now() OR editor=client)라 다른 사람이 유효
--   lease 를 들고 있으면 점유에 실패한다(이중 편집권 원천 차단). 그래서 "편집 권한 가져오기"가 활성
--   편집자에게서 권한을 가져오지 못하고, 낙관적으로 잠깐 잡았다가 상대 heartbeat/resync 로 되돌아간다.
--
-- 조치: 명시 탈취 전용 함수를 둔다. lease 조건 없이 무조건 호출자를 편집자로 덮어쓴다. 탈취 후 직전
--   보유자의 heartbeat(board_claim_editor)는 editor=client 가 더는 본인이 아니라 CAS 실패 → 직전
--   보유자는 다음 tick/실시간 수신에서 읽기 모드로 떨어진다(단일 편집자 수렴). 자동 heartbeat(연장)는
--   여전히 board_claim_editor(CAS) 라 탈취는 사용자가 버튼을 누른 명시 동작에서만 일어난다.
--
-- 보안 규율: SECURITY DEFINER + search_path='' + public.sessions 한정. 권한은 기존 보드 RPC와 동일하게
--   기본 PUBLIC EXECUTE 유지(명시 grant/revoke 두지 않음).
-- ============================================================

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
  RETURNING s.editor_client_id, s.editor_name, s.editor_lease_until;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = '';
