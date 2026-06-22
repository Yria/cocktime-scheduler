-- 회원 관리(운영진 전용): 운영진 승급/해제 + 회원 삭제 RPC + 현재 전 회원 운영진 일괄 승급.
-- 실력 편집은 members_admin_write RLS 로 직접 UPDATE 가능(별도 RPC 불필요).
-- 마지막 운영진 보호(잠금 방지) 가드 포함.

-- ① 운영진 승급
create or replace function public.grant_admin(p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	insert into public.user_roles (member_id, role)
		values (p_member_id, 'admin')
		on conflict (member_id, role) do nothing;
end; $$;

-- ② 운영진 해제 (마지막 운영진은 해제 불가)
create or replace function public.revoke_admin(p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admins int;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	select count(*) into v_admins from public.user_roles where role = 'admin';
	if v_admins <= 1 then raise exception 'last admin'; end if;
	delete from public.user_roles where member_id = p_member_id and role = 'admin';
end; $$;

-- ③ 회원 삭제 (운영진이 타 회원 삭제). 본인·마지막 운영진 삭제 방지.
--    members 삭제 → user_roles/attendances/notifications cascade, session_players/created_by set null.
--    auth.users 삭제 → 해당 회원 로그인 불가.
create or replace function public.delete_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
	v_target_auth uuid;
	v_is_admin boolean;
	v_admins int;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_member_id = public.current_member_id() then
		raise exception 'use account deletion for self';
	end if;
	select exists(
		select 1 from public.user_roles where member_id = p_member_id and role = 'admin'
	) into v_is_admin;
	if v_is_admin then
		select count(*) into v_admins from public.user_roles where role = 'admin';
		if v_admins <= 1 then raise exception 'last admin'; end if;
	end if;
	select auth_user_id into v_target_auth from public.members where id = p_member_id;
	delete from public.members where id = p_member_id;
	if v_target_auth is not null then
		delete from auth.users where id = v_target_auth;
	end if;
end; $$;

revoke execute on function public.grant_admin(uuid) from anon;
revoke execute on function public.revoke_admin(uuid) from anon;
revoke execute on function public.delete_member(uuid) from anon;
grant execute on function public.grant_admin(uuid) to authenticated;
grant execute on function public.revoke_admin(uuid) to authenticated;
grant execute on function public.delete_member(uuid) to authenticated;

-- ④ 일회성: 현재 가입한 모든 회원을 운영진으로 승급(요청). 이후 신규 회원은 관리 화면에서 승급.
insert into public.user_roles (member_id, role)
select id, 'admin' from public.members
on conflict (member_id, role) do nothing;
