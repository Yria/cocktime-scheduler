-- 임시 디버그: 적용된 함수 소스 확인용 (진단 후 제거 예정)
create or replace function public.debug_get_src(p_name text)
returns text language sql security definer set search_path = ''
as $$
	select pg_get_functiondef(p_name::regprocedure)
$$;
grant execute on function public.debug_get_src(text) to service_role;
