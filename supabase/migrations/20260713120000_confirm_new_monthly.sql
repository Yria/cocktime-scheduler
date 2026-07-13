-- 회계 Migration 9: 입금을 "회비로 처리"(항목 없으면 생성 후 배분) — 명백한 회비 입금 원탭 처리.
-- 설계서 §8. 부과 생성이 회원을 건너뛴 경우(당월 가입 면제·미생성 등)에도 관리자가 회비 입금을 바로 처리.
-- 항목 자동 생성 + 배분을 한 트랜잭션으로. 완전 자동확정은 아님(관리자가 [회비로 처리]를 누름).

create or replace function public.dues_confirm_new_monthly(p_tx_id bigint, p_member_id uuid, p_ym text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin   uuid := public.current_member_id();
	v_fee     int;
	v_charge  bigint;
	v_owed    int;
	v_txrem   int;
	v_alloc   int;
	v_isguest boolean;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_member_id is null then raise exception 'member required'; end if;
	if p_ym is null or p_ym !~ '^\d{4}-\d{2}$' then raise exception 'invalid ym: %', p_ym; end if;
	if not exists (select 1 from public.bank_transactions where id = p_tx_id) then
		raise exception 'bank_tx % not found', p_tx_id;
	end if;

	select monthly_fee into v_fee from public.dues_settings where id = 1;

	-- 회비 항목 없으면 생성(멱등).
	insert into public.dues_charges (kind, member_id, period_ym, amount_due)
	values ('monthly_fee', p_member_id, p_ym, v_fee)
	on conflict (member_id, period_ym) where period_ym is not null do nothing;

	select id, amount_due - amount_paid into v_charge, v_owed
	from public.dues_charges
	where member_id = p_member_id and period_ym = p_ym and kind = 'monthly_fee';

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
	values (v_admin, 'confirm_new_monthly', p_tx_id, v_charge,
	        jsonb_build_object('member', p_member_id, 'ym', p_ym, 'amount', v_alloc));

	select is_guest into v_isguest from public.members where id = p_member_id;
	if coalesce(v_isguest, true) = false then
		insert into public.notifications (recipient_member_id, type, session_id, payload)
		values (p_member_id, 'payment_confirmed', null, null);
	end if;

	return jsonb_build_object('charge_id', v_charge, 'allocated', v_alloc);
end $$;

revoke execute on function public.dues_confirm_new_monthly(bigint, uuid, text) from public;
grant execute on function public.dues_confirm_new_monthly(bigint, uuid, text) to authenticated;
