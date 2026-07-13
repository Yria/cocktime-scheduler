-- 회계 Migration 15: 정산 전용 세션 노출 플래그 + 거래-세션 매칭.
-- ① sessions.dues_include: 실제 status(취소 등)는 그대로 두고 '정산(회비관리) 세션 목록'에만 노출.
--    무산됐지만 실제로 대관·정산이 필요한 세션(예: 0705)을 status 변경 없이 라디오에 띄우기 위함.
--    "정산에만 적용, 실제 세션데이터엔 안 넣어도 됨"(2026-07-13 확정).
-- ② dues_set_txn_session: 수지의 대관비 지출(출금) 등을 세션에 매칭 → 언제 날짜 대관인지 파악.

alter table public.sessions
	add column if not exists dues_include boolean not null default false;

create or replace function public.dues_set_txn_session(p_tx_id bigint, p_session_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin uuid := public.current_member_id();
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if not exists (select 1 from public.bank_transactions where id = p_tx_id) then
		raise exception 'bank_tx % not found', p_tx_id;
	end if;
	if p_session_id is not null and not exists (select 1 from public.sessions where id = p_session_id) then
		raise exception 'session % not found', p_session_id;
	end if;

	update public.bank_transactions set session_id = p_session_id where id = p_tx_id;

	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'set_txn_session', p_tx_id, jsonb_build_object('session', p_session_id));
	return jsonb_build_object('tx_id', p_tx_id, 'session', p_session_id);
end $$;

revoke execute on function public.dues_set_txn_session(bigint, bigint) from public;
grant execute on function public.dues_set_txn_session(bigint, bigint) to authenticated;
