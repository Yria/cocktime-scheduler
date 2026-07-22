-- ============================================================
-- load_session_state — session_players 를 스냅샷에 추가 (실시간 동기화 재설계 Stage 1)
--
-- 배경(docs/REALTIME_SYNC_REDESIGN.md): 지속 desync 의 지배 원인은 resyncFromServer 의 불완전성이다.
--   session_players(대기열/휴식/콕체크/입퇴장)는 delta 방식 postgres_changes 로만 전파되는데,
--   유일한 복구 경로인 이 RPC 가 board_drafts/matches/editor 만 반환하고 session_players 를 빼먹었다.
--   그래서 소켓 blip/백그라운드로 선수 이벤트 한 건을 놓치면 재포커스·재구독 어느 복구로도 backfill 되지
--   않아 새로고침 전까지 두 화면이 어긋난 채 남았다.
--
-- 변경: 반환 JSONB 에 'session_players' 배열(전체 컬럼, id 오름차순)을 추가한다. 나머지 필드는 그대로다.
--   이제 resyncFromServer 가 board_drafts + matches + session_players + editor 를 "한 MVCC 시점"으로 읽어
--   기존 복구 트리거(visibilitychange · 재구독 onResync · 충돌 복구 · foreground 워치독)가 선수까지 수렴시킨다.
--   반환 shape 는 키 추가뿐이라 구버전 클라(모르는 키 무시)와 100% 호환 — 무중단.
--
-- 보안/규율: 기존과 동일(SECURITY DEFINER + SET search_path = '' + public. 한정 + STABLE). replay-safe.
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
    ), '[]'::jsonb),
    'session_players', COALESCE((
      SELECT jsonb_agg(to_jsonb(sp) ORDER BY sp.id)
      FROM public.session_players sp
      WHERE sp.session_id = p_session_id
    ), '[]'::jsonb)
  )
  FROM public.sessions s
  WHERE s.id = p_session_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';
