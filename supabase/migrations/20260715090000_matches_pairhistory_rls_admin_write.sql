-- ============================================================
-- matches / pair_history RLS 전환 (EXPANSION Phase 9 마무리)
-- ------------------------------------------------------------
-- 부트스트랩 스키마(docs/migration.sql:104-110)가 4개 테이블
--   sessions / session_players / matches / pair_history
-- 에 남긴 permissive 정책
--   CREATE POLICY "anon_all" ... FOR ALL USING (true) WITH CHECK (true)
-- 중, sessions/session_players 는 20260713140000 에서 잠갔으나
-- matches/pair_history 는 그대로 남아 있었다(EXPANSION_SPEC.md:326 전환 대상 4테이블).
--
-- 결과: 비로그인 anon 키만으로 REST 직접 접근 시 matches/pair_history 를
--   전 세션 경기기록/페어기록 SELECT, 임의 INSERT/UPDATE(스코어·코트·선수 조작),
--   DELETE(테이블 전체 삭제) 까지 가능했다. pair_history 는 팀 추천 알고리즘 입력이라
--   오염/삭제 시 추천 왜곡·파괴로 이어진다(무결성/가용성 갭).
--
-- 조회는 로그인 사용자 전원(읽기 전용 보드 관람 포함)에게 열고, 쓰기는 운영진(is_admin)만.
-- 클라의 matches/pair_history 접근은 전부 SELECT(session.ts·board.ts·matchLog.ts)이고,
-- 실제 write 는 전부 SECURITY DEFINER RPC(assign_match·complete_match·set_match_roster 등)
-- 경유라 RLS 를 우회하므로 앱 동작에 영향 없다.
-- 정책 관용구는 sessions_select / sessions_admin_write(20260713140000)와 동일.
-- ============================================================

-- RLS 는 부트스트랩에서 이미 활성. 재확인(이미 켜져 있으면 no-op).
alter table public.matches      enable row level security;
alter table public.pair_history enable row level security;

-- 기존 permissive anon_all 제거 — 남으면 permissive 정책이 OR 로 결합돼 쓰기 게이팅이 무력화된다.
drop policy if exists "anon_all" on public.matches;
drop policy if exists "anon_all" on public.pair_history;

-- 재적용 안전(idempotent)
drop policy if exists matches_select           on public.matches;
drop policy if exists matches_admin_write       on public.matches;
drop policy if exists pair_history_select       on public.pair_history;
drop policy if exists pair_history_admin_write  on public.pair_history;

-- matches : 로그인 사용자 조회 / 운영진만 직접 쓰기(정상 쓰기는 SECURITY DEFINER RPC 경유)
create policy matches_select on public.matches
	for select to authenticated using (true);
create policy matches_admin_write on public.matches
	for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- pair_history : 로그인 사용자 조회 / 운영진만 직접 쓰기
create policy pair_history_select on public.pair_history
	for select to authenticated using (true);
create policy pair_history_admin_write on public.pair_history
	for all to authenticated using (public.is_admin()) with check (public.is_admin());
