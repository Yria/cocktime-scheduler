-- 마지막 운영진 보호 가드의 동시성 race 수정.
-- 두 운영진을 거의 동시에 해제/삭제하면 둘 다 count=2 를 읽고 통과 → 운영진 0명 잠금 가능.
-- pg_advisory_xact_lock 으로 운영진 역할 변경을 직렬화한다(트랜잭션 종료 시 자동 해제).

create or replace function public.revoke_admin(p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admins int;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	perform pg_advisory_xact_lock(hashtext('user_roles_admin')::bigint);
	select count(*) into v_admins from public.user_roles where role = 'admin';
	if v_admins <= 1 then raise exception 'last admin'; end if;
	delete from public.user_roles where member_id = p_member_id and role = 'admin';
end; $$;

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
	perform pg_advisory_xact_lock(hashtext('user_roles_admin')::bigint);
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
