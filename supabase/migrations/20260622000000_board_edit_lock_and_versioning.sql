-- ============================================================
-- 보드 편집 락(서버 권위) + board_drafts 낙관적 버전 동기화 (forward-only, replay-safe)
--
-- 배경(확정된 근본 원인):
--   원인1: board_drafts(팀 멤버십)가 broadcast(self:false, fire-and-forget) 단일 경로로만
--          전파되고, sessions postgres_changes 핸들러가 board_drafts를 무시해 DB-레벨 catch-up이
--          없다 → 관전자가 broadcast 한 번 놓치면 영영 못 받음.
--   원인2: 편집 락이 서버 권위 없이 100% presence 파생이라, presence 미수렴 시 두 기기가 동시에
--          편집자가 됨(이중 편집권).
--   원인3/5: dbSaveBoardDrafts가 board_drafts를 통째 last-writer-wins로 덮어쓰고(부분병합 없음),
--          .select()/count 없이 error만 보고 항상 true 반환(조용한 쓰기 실패 미탐지).
--
-- 이 마이그레이션(Phase 0)은 스키마/RPC/publication만 추가한다. 컬럼은 nullable/DEFAULT라
-- 기존 클라이언트(컬럼 무시)와 100% 호환되고, RPC는 아직 아무도 호출하지 않는 dormant 상태다.
-- 클라이언트 전환은 후속 Phase(2=catch-up, 3=쓰기 CAS, 4=서버 락)에서 한다.
--
-- 배포 순서: board_save_drafts는 self-claim(락이 비었거나/만료/본인이면 쓰면서 락 획득)이라
--    editor_client_id가 NULL이어도 첫 쓰기가 락을 잡는다 → Phase 3/4 배포 순서 데드존 없음.
--    board_claim_editor(명시 점유/heartbeat)는 "편집권 가져오기" 버튼·idle 보유 연장용.
--
-- replay-safe: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE FUNCTION / 멱등 publication 가드.
-- ============================================================

-- ------------------------------------------------------------
-- 1. sessions 컬럼 추가
--    editor_*: 서버 권위 편집 락(누가 편집자인가를 presence가 아니라 이 row 값이 결정).
--      "보유자" = editor_client_id IS NOT NULL AND editor_lease_until > now().
--    board_drafts_version: 낙관적 동시성(쓰기 CAS) + 수신측 단조성 가드 기준.
-- ------------------------------------------------------------
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS editor_client_id    TEXT,
  ADD COLUMN IF NOT EXISTS editor_name         TEXT,
  ADD COLUMN IF NOT EXISTS editor_lease_until  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS board_drafts_version BIGINT NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 2. sessions realtime 구독(postgres_changes) 정식 승격
--    원인1 catch-up의 전제. 기존엔 docs/migration.sql 수동 스크립트로만 추가돼 환경 드리프트가
--    있었다(추적 마이그레이션엔 없음). 멱등 가드로 정식화한다.
--    REPLICA IDENTITY: sessions는 DELETE 필터(session_id=eq.X)를 쓰지 않고 UPDATE만 구독하며,
--    postgres_changes의 payload.new는 replica identity와 무관하게 전체 컬럼이 채워지므로
--    board_drafts/editor_* 읽기엔 DEFAULT로 충분하다(FULL은 old row 비교/DELETE 필터용이라 불필요).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 보안 규율(20260621* 시리즈와 통일): 모든 SECURITY DEFINER 함수는
--   - SET search_path = '' (search_path 하이재킹 차단; 함수 소유자 권한으로 도는 definer 보호)
--   - public.sessions 로 테이블 스키마 한정(빈 search_path에서 비정규화 이름은 안 풀림)
--   pg_catalog(now/make_interval/coalesce/타입)은 search_path와 무관하게 항상 암시 검색됨.
--
-- 권한(EXECUTE): 명시 grant/revoke를 두지 않아 기본 PUBLIC EXECUTE를 유지한다 — 기존 보드 RPC
--   (assign_match/complete_match/set_player_resting)와 동일 정책이다. 보드는 아직 anon 접근이고
--   sessions RLS도 anon_all(로그인 필수 열람은 EXPANSION Phase 9 미착수)이므로 여기서 anon을
--   revoke하면 Phase 3/4 배선 시 보드 쓰기가 끊긴다. **인증 모델 전환(Phase 9) 시 이 4개 RPC에
--   revoke from anon + grant to authenticated를 함께 적용할 것**(20260621* 신규 기능 RPC 패턴).
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 3. board_claim_editor — 편집권 획득/연장(heartbeat) CAS
--    조건부 UPDATE: 락이 비었거나(NULL), 만료됐거나(lease<now()), 호출자 본인이면 획득/연장 성공.
--    단일 row 조건부 UPDATE라 Postgres row-lock이 동시 호출을 직렬화 → 정확히 한쪽만 비-0행 수신
--    (이중 편집권 원천 차단). 0행 반환 = 다른 사람이 유효 lease 보유 중(획득 실패).
--    호출자 본인 분기(editor_client_id=p_client_id)로 heartbeat 연장도 같은 RPC로 처리.
--    p_lease_seconds NULL/음수 방어: coalesce로 기본 20초 보정(NULL이면 lease_until=NULL이 되어
--    다른 사람이 영구 점유 못 하게 됨 — 막아야 함).
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 4. board_handoff_editor — 편집권 명시 양도
--    보유자 본인(editor_client_id=p_from_client_id)만 대상에게 이전 가능(CAS). 0행 = 양도 권한 없음.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 5. board_release_editor — 편집권 해제(정상 이탈: unsubscribe/pagehide)
--    보유자 본인만 해제. crash/강제종료로 호출 못 해도 lease 자연 만료가 백업.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 6. board_save_drafts — board_drafts 낙관적 버전 CAS 쓰기 (+ self-claim)
--    단일 WHERE에서 원자 검증: (a) version 일치(내가 본 이후 아무도 안 씀),
--    (b) 락이 비었거나/만료/본인 — self-claim(쓰면서 편집 락 획득·연장).
--    통과 시 board_drafts 교체 + version+1 + editor_*=호출자(락 점유/연장).
--    반환 = 새 version(스칼라). 0행이면 SQL 함수는 NULL 반환 → 클라가 충돌로 판정:
--      · version 불일치(그 사이 다른 쓰기) → last-writer-wins 손실 차단(원인3)
--      · 다른 사람이 유효 lease 보유 → "편집자만 쓴다"가 DB 강제(원인2의 데이터 영향 차단)
--    self-claim이라 사전 board_claim_editor 없이 첫 쓰기가 락을 잡는다(데드존/claim-save 레이스 제거).
-- ------------------------------------------------------------
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
