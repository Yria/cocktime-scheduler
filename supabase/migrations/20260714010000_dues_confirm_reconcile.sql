-- 회계 재정비 1: 입금확인 통합 확정 RPC (ACCOUNTING_SPEC §9-A).
-- 한 입금을 ①기존 미납 부과(본인+대납 게스트, 월무관) 배분 + ②신규(회비/세션 대관비) 생성·배분을
-- 한 트랜잭션으로. confirm_match + compose 통합 → 게스트 몫 고아(§9-B)·크로스먼스(§9-C)·완납 프리셀렉트(§9-D) 해소.
--   p_charge_ids : 배분할 기존 부과 id 배열(프론트가 회원 미납에서 선택; 대납/타월 포함).
--   p_ym         : 회비 신규 생성 대상 월('YYYY-MM'), 없으면 '' / null.
--   p_sessions   : [{ "id": <session_id>, "units": <인원=본인+게스트> }] 대관비 신규 생성.
-- 배분은 거래 잔여 내에서만(초과 방지). waived/void 부과는 건너뜀. 배분 주체(member_id)=납부자.

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

	-- 거래 잔여 재계산 헬퍼(매 배분 전).
	-- ① 기존 미납 부과 배분(본인/대납/월무관) — waived/void·완납은 스킵.
	if p_charge_ids is not null then
		foreach v_cid in array p_charge_ids loop
			select status, amount_due - amount_paid into v_status, v_owed
				from public.dues_charges where id = v_cid;
			if v_status is null or v_status in ('waived','void') or coalesce(v_owed,0) <= 0 then
				continue;
			end if;
			select bt.amount - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
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
			select bt.amount - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
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
				select bt.amount - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
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

revoke execute on function public.dues_confirm_reconcile(bigint, uuid, bigint[], text, jsonb) from public;
grant execute on function public.dues_confirm_reconcile(bigint, uuid, bigint[], text, jsonb) to authenticated;
