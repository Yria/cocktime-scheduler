-- 회계 Migration 16: 조합 처리 — 미리 정의된 금액(회비/대관비 1건)이 아닌 입금을,
-- 회비 + 여러 세션 대관비를 골라 한 번에 항목 생성 + 배분. 예: 12,000 = 대관비 2세션, 11,000 = 회비+대관비.
--   "가격이 기존 정의한 가격이 아닐 경우 모든 선택지가 나와야 함"(2026-07-13 확정).
-- dues_confirm_new_monthly + dues_confirm_new_court 의 일반화(멱등 생성 후 거래 잔여 내 순차 배분).

create or replace function public.dues_confirm_compose(
	p_tx_id bigint, p_member_id uuid, p_ym text, p_session_ids bigint[]
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin   uuid := public.current_member_id();
	v_fee     int;
	v_court   int;
	v_charge  bigint;
	v_owed    int;
	v_txrem   int;
	v_alloc   int;
	v_isguest boolean;
	v_hint    uuid;
	v_sid     bigint;
	v_total   int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_member_id is null then raise exception 'member required'; end if;
	if not exists (select 1 from public.bank_transactions where id = p_tx_id) then
		raise exception 'bank_tx % not found', p_tx_id;
	end if;

	select monthly_fee, court_fee_default into v_fee, v_court from public.dues_settings where id = 1;

	-- ── 회비(선택 시) ──
	if coalesce(p_ym, '') <> '' then
		if p_ym !~ '^\d{4}-\d{2}$' then raise exception 'invalid ym: %', p_ym; end if;
		insert into public.dues_charges (kind, member_id, period_ym, amount_due)
		values ('monthly_fee', p_member_id, p_ym, v_fee)
		on conflict (member_id, period_ym) where period_ym is not null do nothing;
		select id, amount_due - amount_paid into v_charge, v_owed
			from public.dues_charges where member_id = p_member_id and period_ym = p_ym and kind = 'monthly_fee';
		select bt.amount - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
			into v_txrem from public.bank_transactions bt where bt.id = p_tx_id;
		v_alloc := least(v_owed, v_txrem);
		if v_alloc > 0 then
			insert into public.dues_allocations (bank_tx_id, charge_id, member_id, amount, kind, matched_by)
			values (p_tx_id, v_charge, p_member_id, v_alloc, 'payment', v_admin);
			v_total := v_total + v_alloc;
		end if;
	end if;

	-- ── 대관비(선택된 세션들) ──
	if p_session_ids is not null then
		foreach v_sid in array p_session_ids loop
			if not exists (select 1 from public.sessions where id = v_sid) then
				raise exception 'session % not found', v_sid;
			end if;
			select case when mm.is_guest then a.invited_by else null end into v_hint
				from public.attendances a join public.members mm on mm.id = a.member_id
				where a.session_id = v_sid and a.member_id = p_member_id limit 1;
			insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint)
			values ('court_fee', p_member_id, v_sid, v_court, v_hint)
			on conflict (member_id, session_id) where session_id is not null do nothing;
			select id, amount_due - amount_paid into v_charge, v_owed
				from public.dues_charges where member_id = p_member_id and session_id = v_sid and kind = 'court_fee';
			select bt.amount - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
				into v_txrem from public.bank_transactions bt where bt.id = p_tx_id;
			v_alloc := least(v_owed, v_txrem);
			if v_alloc > 0 then
				insert into public.dues_allocations (bank_tx_id, charge_id, member_id, amount, kind, matched_by)
				values (p_tx_id, v_charge, p_member_id, v_alloc, 'payment', v_admin);
				v_total := v_total + v_alloc;
			end if;
		end loop;
	end if;

	if v_total = 0 then raise exception 'nothing to allocate'; end if;

	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'confirm_compose', p_tx_id,
	        jsonb_build_object('member', p_member_id, 'ym', p_ym, 'sessions', p_session_ids, 'total', v_total));

	select is_guest into v_isguest from public.members where id = p_member_id;
	if coalesce(v_isguest, true) = false then
		insert into public.notifications (recipient_member_id, type, session_id, payload)
		values (p_member_id, 'payment_confirmed', null, null);
	end if;

	return jsonb_build_object('allocated', v_total);
end $$;

revoke execute on function public.dues_confirm_compose(bigint, uuid, text, bigint[]) from public;
grant execute on function public.dues_confirm_compose(bigint, uuid, text, bigint[]) to authenticated;
