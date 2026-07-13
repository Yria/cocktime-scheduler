-- 회계 Migration 3: 대사·현금납부·미납알림 RPC (제안 only, 관리자 1-click 확정)
-- 설계서: docs/ACCOUNTING_DESIGN.md §8(대사·매칭·배분) · §9. 전부 SECURITY DEFINER + is_admin 가드 + 감사로그.
-- 배분(dues_allocations)은 가역 레코드 → charge/tx 캐시는 트리거(trg_dues_alloc_sync)가 유지.
-- ⚠️ 확정 취소(dues_cancel_match) 후 이미 나간 입금확인 푸시는 회수 불가 → 프론트 확인 다이얼로그에서 경고.

-- 입금자명 정규화(§8.2): NFC + 소문자 + 괄호부가문자 제거 + 접미 '님' 제거 + 공백 제거.
create or replace function public.dues_norm_name(p text)
returns text language sql immutable set search_path = ''
as $$
	select regexp_replace(
	         regexp_replace(
	           regexp_replace(normalize(lower(coalesce(p, '')), NFC), '\(.*?\)', '', 'g'),
	           '님$', ''),
	         '\s+', '', 'g')
$$;

-- ── 현금 납부(은행 미기록): bank_tx_id=NULL 배분 ─────────────────────────
create or replace function public.dues_manual_payment(p_member_id uuid, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin   uuid := public.current_member_id();
	v_elem    jsonb;
	v_charge  bigint;
	v_amount  int;
	v_count   int := 0;
	v_isguest boolean;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_member_id is null then raise exception 'member required'; end if;
	if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
		raise exception 'lines required';
	end if;

	for v_elem in select value from jsonb_array_elements(p_lines) loop
		v_charge := (v_elem->>'charge_id')::bigint;
		v_amount := (v_elem->>'amount')::int;
		if v_charge is null or v_amount is null or v_amount <= 0 then
			raise exception 'invalid line: %', v_elem;
		end if;
		if not exists (select 1 from public.dues_charges where id = v_charge) then
			raise exception 'charge % not found', v_charge;
		end if;
		insert into public.dues_allocations (bank_tx_id, charge_id, member_id, amount, kind, matched_by, note)
		values (null, v_charge, p_member_id, v_amount, 'payment', v_admin, 'cash');
		v_count := v_count + 1;
	end loop;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'manual_payment', jsonb_build_object('member_id', p_member_id, 'lines', p_lines));

	-- 입금확인 푸시(비게스트만; 게스트는 auth_user_id 없어 수신 불가 → 대납/수동 안내)
	select is_guest into v_isguest from public.members where id = p_member_id;
	if coalesce(v_isguest, true) = false then
		insert into public.notifications (recipient_member_id, type, session_id, payload)
		values (p_member_id, 'payment_confirmed', null, null);
	end if;

	return jsonb_build_object('allocations', v_count);
end $$;

-- ── 은행 거래 대사 확정: bank_tx → charges 배분 + 학습 + 알림 ─────────────
create or replace function public.dues_confirm_match(p_tx_id bigint, p_payer_member_id uuid, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin     uuid := public.current_member_id();
	v_elem      jsonb;
	v_charge    bigint;
	v_amount    int;
	v_count     int := 0;
	v_isguest   boolean;
	v_cpname    text;
	v_norm      text;
	v_payernorm text;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if not exists (select 1 from public.bank_transactions where id = p_tx_id) then
		raise exception 'bank_tx % not found', p_tx_id;
	end if;
	if p_payer_member_id is null then raise exception 'payer required'; end if;
	if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
		raise exception 'lines required';
	end if;

	for v_elem in select value from jsonb_array_elements(p_lines) loop
		v_charge := (v_elem->>'charge_id')::bigint;
		v_amount := (v_elem->>'amount')::int;
		if v_charge is null or v_amount is null or v_amount <= 0 then
			raise exception 'invalid line: %', v_elem;
		end if;
		if not exists (select 1 from public.dues_charges where id = v_charge) then
			raise exception 'charge % not found', v_charge;
		end if;
		insert into public.dues_allocations (bank_tx_id, charge_id, member_id, amount, kind, matched_by)
		values (p_tx_id, v_charge, p_payer_member_id, v_amount, 'payment', v_admin);
		v_count := v_count + 1;
	end loop;

	-- 학습(§8.3): 입금자명 norm ≠ 회원명 norm 이고 별칭 없으면 자동 등록(source='learned').
	select counterparty_name into v_cpname from public.bank_transactions where id = p_tx_id;
	if v_cpname is not null then
		v_norm := public.dues_norm_name(v_cpname);
		select public.dues_norm_name(name) into v_payernorm from public.members where id = p_payer_member_id;
		if v_norm <> '' and v_norm is distinct from v_payernorm
		   and not exists (select 1 from public.member_name_aliases
		                   where alias_norm = v_norm and member_id = p_payer_member_id) then
			insert into public.member_name_aliases (member_id, alias_norm, source, created_by_txn)
			values (p_payer_member_id, v_norm, 'learned', p_tx_id)
			on conflict (alias_norm, member_id) do nothing;
		end if;
	end if;

	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'confirm_match', p_tx_id,
	        jsonb_build_object('payer', p_payer_member_id, 'lines', p_lines));

	select is_guest into v_isguest from public.members where id = p_payer_member_id;
	if coalesce(v_isguest, true) = false then
		insert into public.notifications (recipient_member_id, type, session_id, payload)
		values (p_payer_member_id, 'payment_confirmed', null, null);
	end if;

	return jsonb_build_object('allocations', v_count, 'tx_id', p_tx_id);
end $$;

-- ── 대사 취소: 거래 배분 전부 삭제 + 자동학습 별칭 회수 ────────────────────
create or replace function public.dues_cancel_match(p_tx_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin uuid := public.current_member_id();
	v_del   int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	delete from public.dues_allocations where bank_tx_id = p_tx_id;  -- 트리거가 charge/tx 캐시 복원
	get diagnostics v_del = row_count;
	delete from public.member_name_aliases where created_by_txn = p_tx_id and source = 'learned';
	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'cancel_match', p_tx_id, jsonb_build_object('deleted', v_del));
	return jsonb_build_object('deleted', v_del);
end $$;

-- ── 단일 배분 되돌리기(현금 납부 정정 등) ─────────────────────────────────
create or replace function public.dues_reverse_allocation(p_alloc_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin uuid := public.current_member_id();
	v_charge bigint;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	select charge_id into v_charge from public.dues_allocations where id = p_alloc_id;
	if not found then raise exception 'allocation % not found', p_alloc_id; end if;
	delete from public.dues_allocations where id = p_alloc_id;  -- 트리거가 charge 캐시 복원
	insert into public.dues_audit_log (actor_member_id, action, charge_id, detail)
	values (v_admin, 'reverse_allocation', v_charge, jsonb_build_object('alloc_id', p_alloc_id));
	return jsonb_build_object('reversed', p_alloc_id);
end $$;

-- ── 부과 면제/무효/재산정 (waive/void/reset) ─────────────────────────────
create or replace function public.dues_set_charge_status(p_charge_id bigint, p_status text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin uuid := public.current_member_id();
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_status = 'reset' then
		-- 배분 캐시 기준으로 상태 재산정(면제 해제 등)
		update public.dues_charges set status = case
				when amount_paid = 0            then 'unpaid'
				when amount_paid < amount_due   then 'partial'
				when amount_paid = amount_due   then 'paid'
				else                                 'overpaid'
			end, updated_at = now()
		where id = p_charge_id;
	elsif p_status in ('waived', 'void') then
		update public.dues_charges set status = p_status, updated_at = now() where id = p_charge_id;
	else
		raise exception 'invalid status (waived|void|reset): %', p_status;
	end if;
	if not found then raise exception 'charge % not found', p_charge_id; end if;
	insert into public.dues_audit_log (actor_member_id, action, charge_id, detail)
	values (v_admin, 'set_charge_status', p_charge_id, jsonb_build_object('status', p_status));
	return jsonb_build_object('charge_id', p_charge_id, 'status', p_status);
end $$;

-- ── 미납자 일괄 알림(subset-insert + not-exists 멱등, 게스트 제외) ─────────
create or replace function public.dues_notify_unpaid(p_ym text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin uuid := public.current_member_id();
	v_n     int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_ym is null or p_ym !~ '^\d{4}-\d{2}$' then raise exception 'invalid ym: %', p_ym; end if;

	insert into public.notifications (recipient_member_id, type, session_id, payload)
	select m.id, 'dues_unpaid', null, jsonb_build_object('ym', p_ym)
	from public.members m
	where m.auth_user_id is not null                                   -- 게스트/미로그인 제외(푸시 불가)
	  and exists (select 1 from public.dues_charges c
	              where c.member_id = m.id and c.kind = 'monthly_fee'
	                and c.period_ym = p_ym and c.status in ('unpaid', 'partial'))
	  and not exists (select 1 from public.notifications n             -- 같은 달 중복 알림 방지
	                  where n.recipient_member_id = m.id and n.type = 'dues_unpaid'
	                    and n.payload->>'ym' = p_ym);
	get diagnostics v_n = row_count;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'notify_unpaid', jsonb_build_object('ym', p_ym, 'notified', v_n));
	return jsonb_build_object('notified', v_n);
end $$;

-- ── 권한: 암묵적 PUBLIC EXECUTE 제거(anon 차단) + authenticated 재부여(내부 is_admin 가드가 실제 방어) ──
revoke execute on function public.dues_manual_payment(uuid, jsonb)          from public;
revoke execute on function public.dues_confirm_match(bigint, uuid, jsonb)   from public;
revoke execute on function public.dues_cancel_match(bigint)                 from public;
revoke execute on function public.dues_reverse_allocation(bigint)           from public;
revoke execute on function public.dues_set_charge_status(bigint, text)      from public;
revoke execute on function public.dues_notify_unpaid(text)                  from public;
grant execute on function public.dues_manual_payment(uuid, jsonb)          to authenticated;
grant execute on function public.dues_confirm_match(bigint, uuid, jsonb)   to authenticated;
grant execute on function public.dues_cancel_match(bigint)                 to authenticated;
grant execute on function public.dues_reverse_allocation(bigint)           to authenticated;
grant execute on function public.dues_set_charge_status(bigint, text)      to authenticated;
grant execute on function public.dues_notify_unpaid(text)                  to authenticated;
