-- Supabase Performance Advisor 2건 정리.
--   multiple_permissive_policies 10건
--   auth_rls_initplan            2건
--
-- 같은 커맨드에 permissive 정책이 둘 이상이면 Postgres 는 행마다 모든 표현식을 평가한 뒤 OR 한다.
-- 즉 단순 조회에도 is_admin() 이 덤으로 돌았다. 커맨드당 정책 하나로 합치면 판정 결과는 그대로 두고
-- 평가 횟수만 줄일 수 있다 — 아래 변경은 전부 "보이는 행/허용되는 쓰기 집합 불변"이다.
--
-- 원인은 `*_admin_write` 를 FOR ALL 로 선언해 둔 것이다. FOR ALL 은 SELECT 에도 걸리기 때문에
-- `*_select` 와 늘 겹쳤다. 쓰기 커맨드만 담당하도록 쪼갠다.

-- ── 1. admin_write(FOR ALL) → INSERT/UPDATE/DELETE 로 분리 ─────────
-- 대상 테이블의 `*_select` 는 전부 `to authenticated using (true)` 라 SELECT 커버리지 손실이 없다
-- (운영진도 authenticated 다). FOR ALL 의 USING/WITH CHECK 는 커맨드별로 그대로 옮긴다.
do $$
declare t text;
begin
	foreach t in array array['group_settings','matches','places','session_players','sessions','user_roles']
	loop
		execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
		execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', t || '_admin_insert', t);
		execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_update', t);
		execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', t || '_admin_delete', t);
	end loop;
end $$;

-- recurring_schedules 만 정책 이름 규칙이 다르다(rsched_admin).
drop policy if exists rsched_admin on public.recurring_schedules;
create policy rsched_admin_insert on public.recurring_schedules
	for insert to authenticated with check (public.is_admin());
create policy rsched_admin_update on public.recurring_schedules
	for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy rsched_admin_delete on public.recurring_schedules
	for delete to authenticated using (public.is_admin());

-- ── 2. members — 운영진 정책과 본인 정책을 커맨드별로 하나씩 합친다 ──
-- members 는 admin(FOR ALL) 외에 self_insert·self_update 가 따로 있어, 위처럼 쪼개기만 하면
-- INSERT·UPDATE 에서 여전히 둘씩 남는다. Postgres 가 어차피 OR 하므로 그 OR 를 정책 하나에 적는다.
--   INSERT : is_admin() OR 본인 행           (종전 members_admin_write + members_self_insert)
--   UPDATE : is_admin() OR 본인 행           (종전 members_admin_write + members_self_update)
--   DELETE : is_admin()                      (종전 members_admin_write. 하드삭제는 20260721000000 이 별도 차단)
--   SELECT : members_select(using true) 유지
-- auth.uid() 는 (select auth.uid()) 로 감싼다 — 아래 3번과 같은 이유(행마다 재평가 방지).
drop policy if exists members_admin_write on public.members;
drop policy if exists members_self_insert on public.members;
drop policy if exists members_self_update on public.members;

create policy members_insert on public.members
	for insert to authenticated
	with check (public.is_admin() or auth_user_id = (select auth.uid()));

create policy members_update on public.members
	for update to authenticated
	using (public.is_admin() or auth_user_id = (select auth.uid()))
	with check (public.is_admin() or auth_user_id = (select auth.uid()));

create policy members_delete on public.members
	for delete to authenticated
	using (public.is_admin());

-- ── 3. user_roles — SELECT 정책 둘을 하나로 ────────────────────────
-- 원래 SELECT 정책이 둘이라(자기 역할 조회 + '운영진이 누구인가' 공개 조회) 1번 분리만으로는
-- 중복이 남는다. OR 로 합치면 보이는 행 집합은 완전히 동일하다.
--   user_roles_select              : is_admin() OR member_id = current_member_id()
--   user_roles_select_admin_public : role = 'admin'
drop policy if exists user_roles_select on public.user_roles;
drop policy if exists user_roles_select_admin_public on public.user_roles;
create policy user_roles_select on public.user_roles
	for select to authenticated
	using (
		role = 'admin'                            -- 운영진이 누구인지는 전 회원 공개
		or member_id = public.current_member_id() -- 본인 역할
		or public.is_admin()                      -- 운영진은 전부
	);
