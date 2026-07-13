-- ============================================================
-- sessions / session_players RLS 전환 (EXPANSION Phase 9)
-- ------------------------------------------------------------
-- 부트스트랩 스키마(docs/migration.sql)가 두 테이블에 남긴 permissive 정책
--   CREATE POLICY "anon_all" ... FOR ALL USING (true) WITH CHECK (true)
-- 때문에 비로그인·비운영진을 포함한 누구나 sessions/session_players 를 직접
-- INSERT/UPDATE/DELETE 할 수 있었다(권한 감사 확정 HIGH 갭: 회원이 /setup 에서
-- 세션 시작/로스터 변경/기존 활성세션 강제 종료 가능).
--
-- 조회는 로그인 사용자 전원(읽기 전용 보드 관람 포함)에게 열되, 쓰기는 운영진(is_admin)만
-- 으로 좁힌다. 모든 회원 대면 write(join/carpool/late/cock check/board match ops 등)는
-- SECURITY DEFINER RPC 경유라 RLS 를 우회하므로 영향 없음. 직접 PostgREST write
-- (startSession·updateSession·dbUpdateSessionPlayer·dbEndSession·일정 CRUD)는 전부
-- 운영진 전용 UI(SessionSetup·보드 편집권) 뒤에 있어 정상 동작한다.
-- 정책 관용구는 places_select / places_admin_write(20260621010000)와 동일.
-- ============================================================

-- RLS 는 부트스트랩에서 이미 활성. 재확인(이미 켜져 있으면 no-op).
alter table public.sessions        enable row level security;
alter table public.session_players enable row level security;

-- 기존 permissive anon_all 제거 — 남으면 permissive 정책이 OR 로 결합돼 쓰기 게이팅이 무력화된다.
drop policy if exists "anon_all" on public.sessions;
drop policy if exists "anon_all" on public.session_players;

-- 재적용 안전(idempotent)
drop policy if exists sessions_select             on public.sessions;
drop policy if exists sessions_admin_write        on public.sessions;
drop policy if exists session_players_select      on public.session_players;
drop policy if exists session_players_admin_write on public.session_players;

-- sessions : 로그인 사용자 조회 / 운영진만 쓰기
create policy sessions_select on public.sessions
	for select to authenticated using (true);
create policy sessions_admin_write on public.sessions
	for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- session_players : 로그인 사용자 조회 / 운영진만 쓰기
create policy session_players_select on public.session_players
	for select to authenticated using (true);
create policy session_players_admin_write on public.session_players
	for all to authenticated using (public.is_admin()) with check (public.is_admin());
