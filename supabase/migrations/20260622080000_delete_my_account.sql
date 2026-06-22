-- 회원 탈퇴: 본인 회원 데이터 + 인증 사용자 삭제(되돌릴 수 없음).
--   members 삭제 → user_roles/attendances/notifications cascade,
--                  session_players.member_id / sessions.created_by / recurring_schedules.created_by 는 set null(기록 보존).
--   auth.users 삭제 → 더는 로그인 불가(auth.identities/sessions cascade).
-- SECURITY DEFINER(owner=postgres)라 auth 스키마 삭제 권한 보유.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_uid uuid := auth.uid();
begin
	if v_uid is null then
		raise exception 'not authenticated';
	end if;
	delete from public.members where auth_user_id = v_uid;
	delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
