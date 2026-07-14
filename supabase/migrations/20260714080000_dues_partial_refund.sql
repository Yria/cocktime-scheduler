-- 부분 환불 처리: 환불은 입금액에서 '마이너스'로 빠지고, 남은 금액이 있으면 입금은 미정산으로 유지.
--  · 전체 환불: 입금액 전부 환불 → 남은 것 없음 → matched(정산 완료).
--  · 부분 환불: 일부만 환불 → 남은 금액(입금 − 환불 − 배분) > 0 → 배분 없으면 unmatched(미정산)로 남김.
-- 입금 status 규칙 변경 + 확정 RPC의 거래 잔여(txrem)에서 환불분 차감.

-- ① 입금/거래 status 재계산: 환불은 amount에서 차감. 남으면(배분 없이) 미정산.
create or replace function public.dues_sync_bank_tx(p_tx_id bigint)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_alloc int; v_refunded int; v_amt int; v_cur text;
begin
	if p_tx_id is null then return; end if;
	select coalesce(sum(amount), 0) into v_alloc from public.dues_allocations where bank_tx_id = p_tx_id;
	select coalesce(sum(amount), 0) into v_refunded from public.bank_transactions where refund_of_tx_id = p_tx_id;
	select amount, status into v_amt, v_cur from public.bank_transactions where id = p_tx_id;
	if v_amt is null then return; end if;
	update public.bank_transactions set status = case
			when v_cur = 'ignored'                  then 'ignored'
			when (v_alloc + v_refunded) >= v_amt    then 'matched'   -- 배분+환불이 입금액 이상 = 완결
			when v_alloc > 0                        then 'partial'   -- 일부 배분됨(부분납)
			else                                         'unmatched' -- 배분 없음(부분환불만이면 미정산 유지)
		end
		where id = p_tx_id;
end $$;

-- ② 확정(배분) RPC: 거래 잔여 = 입금 − 환불 − 기배분. (환불된 만큼은 배분 못 하게)
create or replace function public.dues_confirm_reconcile(
	p_tx_id bigint,
	p_payer_member_id uuid,
	p_charge_ids bigint[],
	p_ym text,
	p_sessions jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin   uuid := public.current_member_id();
	v_fee     int;
	v_court   int;
	v_isguest boolean;
	v_cid     bigint;
	v_owed    int;
	v_txrem   int;
	v_refund  int;
	v_alloc   int;
	v_status  text;
	v_hint    uuid;
	v_elem    jsonb;
	v_sid     bigint;
	v_units   int;
	v_due     int;
	v_total   int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_payer_member_id is null then raise exception 'payer required'; end if;
	if not exists (select 1 from public.bank_transactions where id = p_tx_id) then
		raise exception 'bank_tx % not found', p_tx_id;
	end if;
	select monthly_fee, court_fee_default into v_fee, v_court from public.dues_settings where id = 1;
	-- 이 입금에 연결된 환불 합계(잔여에서 차감).
	select coalesce(sum(amount), 0) into v_refund from public.bank_transactions where refund_of_tx_id = p_tx_id;

	-- ① 기존 미납 부과 배분(본인/대납/월무관) — waived/void·완납은 스킵.
	if p_charge_ids is not null then
		foreach v_cid in array p_charge_ids loop
			select status, amount_due - amount_paid into v_status, v_owed
				from public.dues_charges where id = v_cid;
			if v_status is null or v_status in ('waived','void') or coalesce(v_owed,0) <= 0 then
				continue;
			end if;
			select bt.amount - v_refund - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
				into v_txrem from public.bank_transactions bt where bt.id = p_tx_id;
			v_alloc := least(v_owed, v_txrem);
			if v_alloc > 0 then
				insert into public.dues_allocations (bank_tx_id, charge_id, member_id, amount, kind, matched_by)
				values (p_tx_id, v_cid, p_payer_member_id, v_alloc, 'payment', v_admin);
				v_total := v_total + v_alloc;
			end if;
		end loop;
	end if;

	-- ② 회비 신규(선택 시): 항목 없으면 생성 후 배분.
	if coalesce(p_ym, '') <> '' then
		if p_ym !~ '^\d{4}-\d{2}$' then raise exception 'invalid ym: %', p_ym; end if;
		insert into public.dues_charges (kind, member_id, period_ym, amount_due)
		values ('monthly_fee', p_payer_member_id, p_ym, v_fee)
		on conflict (member_id, period_ym) where period_ym is not null do nothing;
		select id, amount_due - amount_paid into v_cid, v_owed
			from public.dues_charges where member_id = p_payer_member_id and period_ym = p_ym and kind = 'monthly_fee'
			  and status not in ('waived','void');
		if v_cid is not null and coalesce(v_owed,0) > 0 then
			select bt.amount - v_refund - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
				into v_txrem from public.bank_transactions bt where bt.id = p_tx_id;
			v_alloc := least(v_owed, v_txrem);
			if v_alloc > 0 then
				insert into public.dues_allocations (bank_tx_id, charge_id, member_id, amount, kind, matched_by)
				values (p_tx_id, v_cid, p_payer_member_id, v_alloc, 'payment', v_admin);
				v_total := v_total + v_alloc;
			end if;
		end if;
	end if;

	-- ③ 대관비 신규(선택된 세션·인원): 항목 없으면 생성 후 배분.
	if p_sessions is not null and jsonb_typeof(p_sessions) = 'array' then
		for v_elem in select value from jsonb_array_elements(p_sessions) loop
			v_sid   := (v_elem->>'id')::bigint;
			v_units := greatest(coalesce((v_elem->>'units')::int, 1), 1);
			if not exists (select 1 from public.sessions where id = v_sid) then
				raise exception 'session % not found', v_sid;
			end if;
			v_due := v_units * v_court;
			select case when mm.is_guest then a.invited_by else null end into v_hint
				from public.attendances a join public.members mm on mm.id = a.member_id
				where a.session_id = v_sid and a.member_id = p_payer_member_id limit 1;
			insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint)
			values ('court_fee', p_payer_member_id, v_sid, v_due, v_hint)
			on conflict (member_id, session_id) where session_id is not null do nothing;
			update public.dues_charges set amount_due = v_due, updated_at = now()
				where member_id = p_payer_member_id and session_id = v_sid and kind = 'court_fee'
				  and status not in ('waived','void') and amount_due < v_due;
			select id, amount_due - amount_paid into v_cid, v_owed
				from public.dues_charges where member_id = p_payer_member_id and session_id = v_sid and kind = 'court_fee'
				  and status not in ('waived','void');
			if v_cid is not null and coalesce(v_owed,0) > 0 then
				select bt.amount - v_refund - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
					into v_txrem from public.bank_transactions bt where bt.id = p_tx_id;
				v_alloc := least(v_owed, v_txrem);
				if v_alloc > 0 then
					insert into public.dues_allocations (bank_tx_id, charge_id, member_id, amount, kind, matched_by)
					values (p_tx_id, v_cid, p_payer_member_id, v_alloc, 'payment', v_admin);
					v_total := v_total + v_alloc;
				end if;
			end if;
		end loop;
	end if;

	if v_total = 0 then raise exception 'nothing to allocate'; end if;

	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'confirm_reconcile', p_tx_id,
	        jsonb_build_object('payer', p_payer_member_id, 'charges', p_charge_ids, 'ym', p_ym, 'sessions', p_sessions, 'total', v_total));

	select is_guest into v_isguest from public.members where id = p_payer_member_id;
	if coalesce(v_isguest, true) = false then
		insert into public.notifications (recipient_member_id, type, session_id, payload)
		values (p_payer_member_id, 'payment_confirmed', null, null);
	end if;

	return jsonb_build_object('allocated', v_total);
end $$;
