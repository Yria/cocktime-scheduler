-- 회계 Migration 6: 세션별 실지출 대관비(할인 반영). 회원 청구(6000/인)와 무관 — 수지(지출) 기록용.
-- 설계서: docs/ACCOUNTING_DESIGN.md §10. 코트요금×코트수×시간 자동값이 할인 때문에 안 맞아 세션마다 직접 입력.

alter table public.sessions add column if not exists court_fee integer;
comment on column public.sessions.court_fee is
  '이 세션의 실제 대관 지출(원, 할인 반영). NULL=미입력. 수지 지출 집계용. 회원 대관비 청구와는 무관(회원은 고정 인당액).';

-- 세션 대관 지출 입력(관리자). NULL 로 지우기 허용.
create or replace function public.dues_set_session_fee(p_session_id bigint, p_amount integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin uuid := public.current_member_id();
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_amount is not null and p_amount < 0 then raise exception 'invalid amount'; end if;
	update public.sessions set court_fee = p_amount where id = p_session_id;
	if not found then raise exception 'session % not found', p_session_id; end if;
	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'set_session_fee',
	        jsonb_build_object('session_id', p_session_id, 'amount', p_amount));
	return jsonb_build_object('session_id', p_session_id, 'court_fee', p_amount);
end $$;

revoke execute on function public.dues_set_session_fee(bigint, integer) from public;
grant execute on function public.dues_set_session_fee(bigint, integer) to authenticated;
