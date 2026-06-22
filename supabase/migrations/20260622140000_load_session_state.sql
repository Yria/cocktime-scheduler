-- ============================================================
-- load_session_state — board_drafts + matches + 버전을 단일 트랜잭션 스냅샷으로 반환 (옵션 B)
--
-- 배경: 코트 배정 동기화(20260622130000)로 catch-up 은 해결됐으나, 재연결/충돌 복구 시 클라가
--   board_drafts(dbLoadSessionRow)와 matches(dbLoadMatches)를 "두 번의 쿼리"로 읽어 미세한 시점차가
--   생길 수 있다(그 사이 다른 기기의 변경). 두 권위를 한 SELECT(단일 MVCC 스냅샷)로 묶어 반환하면
--   board_drafts 와 matches 가 "항상 같은 시점"으로 수렴한다 — 완벽 동기화의 마지막 빈틈 제거.
--
-- 용도: sessionStore.resyncFromServer(재구독 onResync · board_save_drafts 충돌 복구)에서 호출.
--   매 매치 변경의 version 갭 catch-up 은 여전히 가벼운 dbLoadMatches(refetchMatches)를 쓴다
--   (전체 스냅샷 과조회 회피). 즉 "드문 전체 복구 = load_session_state, 잦은 코트 갭 = dbLoadMatches".
--
-- 보안: 20260622000000 board_* RPC 와 동일 규율 — SECURITY DEFINER + SET search_path = '' +
--   public. 스키마 한정. STABLE(read-only). EXECUTE 는 기본 PUBLIC(보드 anon 정책 유지, Phase 9에서 일괄 전환).
-- replay-safe: CREATE OR REPLACE.
-- ============================================================
CREATE OR REPLACE FUNCTION load_session_state(p_session_id BIGINT)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'board_drafts',          s.board_drafts,
    'board_drafts_version',  s.board_drafts_version,
    'match_state_version',   s.match_state_version,
    'court_count',           s.court_count,
    'editor_client_id',      s.editor_client_id,
    'editor_name',           s.editor_name,
    'editor_lease_until',    s.editor_lease_until,
    'matches', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.court_id)
      FROM public.matches m
      WHERE m.session_id = p_session_id AND m.status = 'playing'
    ), '[]'::jsonb)
  )
  FROM public.sessions s
  WHERE s.id = p_session_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';
