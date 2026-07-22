-- ============================================================
-- 실시간 동기화 재설계 Stage 2 — sync_version 단일 시계 + 트리거 강제 bump + Broadcast from Database
--   (설계: docs/REALTIME_SYNC_REDESIGN.md §5)
--
-- 목표: realtime을 "뭔가 바뀌었다"는 힌트로 강등하고, 정합성은 버전 비교 후 load_session_state pull로
--   보장한다. 이 마이그레이션은 그 전송 기반을 additive(부가)로 깐다 — postgres_changes는 그대로 두어
--   구버전 클라 무중단. postgres_changes 제거 + publication drop(비가역)은 클라 버전 텔레메트리 확인 후
--   별도 단계(Stage 2b)에서 한다.
--
-- 구성:
--   1) sessions.sync_version — 세션 공유상태의 단조 리비전 시계(신설).
--   2) bump 강제 = 트리거(RPC 규율 아님): 공유상태 write가 SECURITY DEFINER RPC + 직접 PostgREST write +
--      종료 트리거로 3원화돼 "모든 RPC가 bump" 규율로는 못 잡는다. 자식(session_players/matches) 문장
--      트리거가 부모 sessions.sync_version을 올리고, sessions BEFORE UPDATE 트리거가 board 관련 컬럼
--      변경 시 올린다 → 모든 경로가 같은 초크포인트를 통과(구조적 보장).
--   3) Broadcast from DB: sessions.sync_version이 바뀌면 AFTER 트리거가 realtime.send로 topic
--      'session-bc:{id}'(기존 브로드캐스트 채널 재사용, public)에 {v:N} 힌트 1건 발신. 비치명(예외 삼킴).
--   4) load_session_state에 sync_version 추가(클라가 힌트 v와 비교할 권위 값).
--
-- 안전성: broadcast_session_sync는 EXCEPTION WHEN OTHERS로 감싼다 — realtime.send 시그니처/스키마
--   문제가 있어도 write 트랜잭션을 물지 않고 조용히 no-op(=Stage 1 동작으로 우아하게 강등, 워치독이 최후
--   그물). sync_version bump 자체는 순수 정수 증가라 실패 여지 없음. 모두 replay-safe(IF NOT EXISTS /
--   CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
-- ============================================================

-- ------------------------------------------------------------
-- 1. sync_version 컬럼(단조 시계). 기존 두 버전의 max로 백필(시작값 의미는 없음 — 단조성만 중요).
-- ------------------------------------------------------------
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 0;

UPDATE public.sessions
  SET sync_version = GREATEST(board_drafts_version, match_state_version)
  WHERE sync_version = 0;

-- ------------------------------------------------------------
-- 2a. sessions BEFORE UPDATE — board 관련 컬럼이 바뀌면 sync_version++.
--     sync_version만 바뀌는 UPDATE(자식 트리거발)는 감시 컬럼 미변경이라 재bump하지 않는다(재귀·이중카운트
--     차단). 감시 대상: 라이브 보드 상태(편성/코트/편집락/코트수/콕체크모드/세션상태). schedule·accounting·
--     carpool 등 board 무관 컬럼은 제외 → 그런 편집엔 힌트가 안 나간다. 새 board 컬럼 추가 시 여기 반영할 것.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sessions_bump_sync_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.board_drafts         IS DISTINCT FROM OLD.board_drafts
   OR NEW.board_drafts_version IS DISTINCT FROM OLD.board_drafts_version
   OR NEW.match_state_version  IS DISTINCT FROM OLD.match_state_version
   OR NEW.court_count          IS DISTINCT FROM OLD.court_count
   OR NEW.cock_check_enabled   IS DISTINCT FROM OLD.cock_check_enabled
   OR NEW.editor_client_id     IS DISTINCT FROM OLD.editor_client_id
   OR NEW.editor_name          IS DISTINCT FROM OLD.editor_name
   -- editor_lease_until 은 감시 제외: sticky 락에서 lease 는 만료판정 미사용이고 매 op 갱신되면 bump 증폭.
   OR NEW.status               IS DISTINCT FROM OLD.status
   OR NEW.is_active            IS DISTINCT FROM OLD.is_active)
  THEN
    NEW.sync_version := OLD.sync_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_bump_sync ON public.sessions;
CREATE TRIGGER trg_sessions_bump_sync
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.sessions_bump_sync_version();

-- ------------------------------------------------------------
-- 2b. 자식(session_players/matches) 문장 트리거 — 변경된 행들의 부모 세션 sync_version을 올린다.
--     문장당 1회(transition table로 distinct session_id) → 다중행 op(예: complete_match 4행)도 과다 bump
--     안 함. SECURITY DEFINER + search_path='' 로 RLS 무관하게 인프라 bump가 항상 성공. 이로써 직접
--     PostgREST write(dbUpdateSessionPlayer 등)·종료 트리거·미래 신규 RPC까지 전부 포섭(구조적 보장).
--     (board_save_drafts/편집락/updateSessionSettings의 sessions 직접 변경은 2a가 커버.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_session_sync_from_children()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    UPDATE public.sessions s SET sync_version = sync_version + 1
     WHERE s.id IN (SELECT DISTINCT session_id FROM old_rows);
  ELSE
    UPDATE public.sessions s SET sync_version = sync_version + 1
     WHERE s.id IN (SELECT DISTINCT session_id FROM new_rows);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- 비치명: sync bump는 인프라 신호일 뿐이라, 실패해도 실제 write(경기 배정/완료/세션 종료 등)를
  -- 중단시키면 안 된다. 놓친 신호는 postgres_changes(overlap) + 워치독(25s)이 보완한다.
  -- 단 조용히 삼키지 말고 WARNING 을 남겨 락 회귀·타임아웃 등 실제 결함을 관측 가능하게 한다.
  RAISE WARNING 'bump_session_sync_from_children failed (%): %', TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END;
$$;

-- session_players
DROP TRIGGER IF EXISTS trg_sp_bump_sync_ins ON public.session_players;
CREATE TRIGGER trg_sp_bump_sync_ins AFTER INSERT ON public.session_players
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_session_sync_from_children();
DROP TRIGGER IF EXISTS trg_sp_bump_sync_upd ON public.session_players;
CREATE TRIGGER trg_sp_bump_sync_upd AFTER UPDATE ON public.session_players
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_session_sync_from_children();
DROP TRIGGER IF EXISTS trg_sp_bump_sync_del ON public.session_players;
CREATE TRIGGER trg_sp_bump_sync_del AFTER DELETE ON public.session_players
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_session_sync_from_children();

-- matches
DROP TRIGGER IF EXISTS trg_m_bump_sync_ins ON public.matches;
CREATE TRIGGER trg_m_bump_sync_ins AFTER INSERT ON public.matches
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_session_sync_from_children();
DROP TRIGGER IF EXISTS trg_m_bump_sync_upd ON public.matches;
CREATE TRIGGER trg_m_bump_sync_upd AFTER UPDATE ON public.matches
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_session_sync_from_children();
DROP TRIGGER IF EXISTS trg_m_bump_sync_del ON public.matches;
CREATE TRIGGER trg_m_bump_sync_del AFTER DELETE ON public.matches
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_session_sync_from_children();

-- ------------------------------------------------------------
-- 3. Broadcast from Database — sync_version이 실제로 바뀌면(값 비교, BEFORE 트리거 반영 후) topic
--    'session-bc:{id}'로 {v:N} 힌트 1건 발신. 기존 세션 브로드캐스트 채널(public) 재사용 → 클라는 그
--    채널에 event 'sync' 리스너만 추가하면 됨(별도 채널/인증 불필요, 힌트는 무의미 정수라 비민감).
--    realtime.send(payload jsonb, event text, topic text, private boolean) — public이라 private=false.
--    EXCEPTION: realtime 스키마/시그니처 문제로 실패해도 write를 물지 않고 no-op(Stage 1로 강등, 워치독 보완).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.broadcast_session_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('v', NEW.sync_version),
    'sync',
    'session-bc:' || NEW.id::text,
    false
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- 비치명: realtime.send 시그니처/스키마/권한 문제로 실패해도 write 를 물지 않는다(Stage 1 동작으로 강등,
  -- 워치독이 최후 그물). 단 WARNING 을 남겨 Stage 2b(postgres_changes 제거) 게이팅 전에 브로드캐스트가
  -- 실제로 동작하는지 로그로 확인 가능하게 한다 — silent no-op 이면 desync 가 워치독 25s 로만 치유됨.
  RAISE WARNING 'broadcast_session_sync failed for session %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_broadcast_sync ON public.sessions;
CREATE TRIGGER trg_sessions_broadcast_sync
  AFTER UPDATE ON public.sessions
  FOR EACH ROW WHEN (NEW.sync_version IS DISTINCT FROM OLD.sync_version)
  EXECUTE FUNCTION public.broadcast_session_sync();

-- ------------------------------------------------------------
-- 4. load_session_state — sync_version 추가(권위 pull 시 클라 로컬 syncVersion 확정). session_players는
--    Stage 1(20260722000000)에서 이미 추가됨. 반환 키 추가뿐이라 구버전 클라 100% 호환.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION load_session_state(p_session_id BIGINT)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'board_drafts',          s.board_drafts,
    'board_drafts_version',  s.board_drafts_version,
    'match_state_version',   s.match_state_version,
    'sync_version',          s.sync_version,
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

-- ------------------------------------------------------------
-- 5. load_session_state EXECUTE 잠금 — 로그인 사용자 전용(EXPANSION Phase 9 예고 조치).
--    이 RPC는 SECURITY DEFINER라 RLS를 우회하는데 EXECUTE가 기본 PUBLIC이라 비로그인 anon 키만으로도
--    임의 세션의 board_drafts/matches + (Stage 1 이후) session_players 전체(member_id·name·gender·skills)를
--    읽을 수 있었다. 앱은 로그인 필수 열람이라 정당한 호출자는 모두 authenticated → anon EXECUTE 회수 안전.
--    (다른 board RPC들(assign/complete/save_drafts 등)의 anon EXECUTE도 별도 감사·전환 필요 — 이번 범위 밖.)
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION load_session_state(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION load_session_state(BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION load_session_state(BIGINT) TO authenticated;
