-- 회계 Migration 12: 입금을 "대관비로 처리" — 금액이 대관비(court_fee_default)인데 매칭 항목이 없을 때,
-- 관리자가 그 달 열린 세션 중 하나를 지목하면 그 세션 대관비 항목을 만들고 배분.
-- dues_confirm_new_monthly(§8)의 대관비 판. 부과 생성이 회원을 건너뛴 세션(수동 참석·생성 갭)도 즉시 처리.
--   "가격을 보고 어디에 매칭할지 제안 — 6천원인데 못 찾으면 그 달 세션목록에서 지목"(2026-07-13 확정).

create or replace function public.dues_confirm_new_court(p_tx_id bigint, p_member_id uuid, p_session_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin   uuid := public.current_member_id();
	v_court   int;
	v_charge  bigint;
	v_owed    int;
	v_txrem   int;
	v_alloc   int;
	v_isguest boolean;
	v_hint    uuid;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_member_id is null then raise exception 'member required'; end if;
	if p_session_id is null then raise exception 'session required'; end if;
	if not exists (select 1 from public.bank_transactions where id = p_tx_id) then
		raise exception 'bank_tx % not found', p_tx_id;
	end if;
	if not exists (select 1 from public.sessions where id = p_session_id) then
		raise exception 'session % not found', p_session_id;
	end if;

	select court_fee_default into v_court from public.dues_settings where id = 1;

	-- 게스트면 대납자(payer_hint) 계산 — 대관비 부과 생성 규칙과 동일.
	select case when mm.is_guest then a.invited_by else null end into v_hint
	from public.attendances a
	join public.members mm on mm.id = a.member_id
	where a.session_id = p_session_id and a.member_id = p_member_id
	limit 1;

	-- 대관비 항목 없으면 생성(멱등, (member_id, session_id) 유니크).
	insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint)
	values ('court_fee', p_member_id, p_session_id, v_court, v_hint)
	on conflict (member_id, session_id) where session_id is not null do nothing;

	select id, amount_due - amount_paid into v_charge, v_owed
	from public.dues_charges
	where member_id = p_member_id and session_id = p_session_id and kind = 'court_fee';

	-- 거래 잔여(초과배분 방지) 내에서 배분.
	select bt.amount - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
	into v_txrem from public.bank_transactions bt where bt.id = p_tx_id;

	v_alloc := least(v_owed, v_txrem);
	if v_alloc <= 0 then
		raise exception 'nothing to allocate (owed=%, tx_remaining=%)', v_owed, v_txrem;
	end if;

	insert into public.dues_allocations (bank_tx_id, charge_id, member_id, amount, kind, matched_by)
	values (p_tx_id, v_charge, p_member_id, v_alloc, 'payment', v_admin);

	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, charge_id, detail)
	values (v_admin, 'confirm_new_court', p_tx_id, v_charge,
	        jsonb_build_object('member', p_member_id, 'session', p_session_id, 'amount', v_alloc));

	select is_guest into v_isguest from public.members where id = p_member_id;
	if coalesce(v_isguest, true) = false then
		insert into public.notifications (recipient_member_id, type, session_id, payload)
		values (p_member_id, 'payment_confirmed', p_session_id, null);
	end if;

	return jsonb_build_object('charge_id', v_charge, 'allocated', v_alloc);
end $$;

revoke execute on function public.dues_confirm_new_court(bigint, uuid, bigint) from public;
grant execute on function public.dues_confirm_new_court(bigint, uuid, bigint) to authenticated;
