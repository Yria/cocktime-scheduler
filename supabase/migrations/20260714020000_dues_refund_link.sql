-- 회계 재정비 2: 환불 연결 (ACCOUNTING_SPEC §3.2 환불).
-- 초과입금 차액 환불 / 전액 오입금 환불 = 입금(IN) ↔ 환불 출금(OUT) 연결.
-- 입금의 해결 = 배분합 + 환불합 == 입금액. 환불 출금은 미스터리 지출이 아니라 'matched'.

alter table public.bank_transactions
	add column if not exists refund_of_tx_id bigint references public.bank_transactions(id) on delete set null;
create index if not exists idx_bank_tx_refund on public.bank_transactions(refund_of_tx_id);

-- 은행거래 status 재계산: 배분(dues_allocations) + 환불(refund_of 가리키는 출금) 합으로.
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
			when (v_alloc + v_refunded) = 0         then 'unmatched'
			when (v_alloc + v_refunded) < v_amt     then 'partial'
			else                                         'matched'
		end
		where id = p_tx_id;
end $$;

-- alloc sync 트리거: 거래 status 계산을 공용 함수로(환불 포함).
create or replace function public.dues_alloc_sync()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
	v_charge_ids bigint[];
	v_tx_ids     bigint[];
	v_cid        bigint;
	v_tid        bigint;
	v_paid       int;
	v_due        int;
	v_status     text;
begin
	v_charge_ids := array_remove(array[
		case when TG_OP <> 'INSERT' then OLD.charge_id end,
		case when TG_OP <> 'DELETE' then NEW.charge_id end
	], null);
	v_tx_ids := array_remove(array[
		case when TG_OP <> 'INSERT' then OLD.bank_tx_id end,
		case when TG_OP <> 'DELETE' then NEW.bank_tx_id end
	], null);

	foreach v_cid in array v_charge_ids loop
		select coalesce(sum(amount), 0) into v_paid from public.dues_allocations where charge_id = v_cid;
		select amount_due, status into v_due, v_status from public.dues_charges where id = v_cid;
		if v_status not in ('waived', 'void') then
			v_status := case when v_paid = 0 then 'unpaid' when v_paid < v_due then 'partial' when v_paid = v_due then 'paid' else 'overpaid' end;
		end if;
		update public.dues_charges set amount_paid = v_paid, status = v_status, updated_at = now() where id = v_cid;
	end loop;

	foreach v_tid in array v_tx_ids loop
		perform public.dues_sync_bank_tx(v_tid);
	end loop;
	return null;
end $$;

-- 환불 연결: 출금(OUT)이 입금(IN)의 차액/전액을 환불함.
create or replace function public.dues_link_refund(p_out_tx_id bigint, p_in_tx_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
	v_admin uuid := public.current_member_id();
	v_outdir text; v_indir text; v_out int; v_inamt int; v_alloc int; v_refunded int; v_linked bigint;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	select direction, amount, refund_of_tx_id into v_outdir, v_out, v_linked from public.bank_transactions where id = p_out_tx_id;
	select direction, amount into v_indir, v_inamt from public.bank_transactions where id = p_in_tx_id;
	if v_outdir is null or v_indir is null then raise exception 'tx not found'; end if;
	if v_outdir <> 'out' then raise exception 'refund must be a withdrawal (out)'; end if;
	if v_indir <> 'in' then raise exception 'target must be a deposit (in)'; end if;
	if v_linked is not null then raise exception 'out tx % already linked', p_out_tx_id; end if;
	-- 초과 방지: 배분 + 기존환불 + 이번환불 ≤ 입금액.
	select coalesce(sum(amount), 0) into v_alloc from public.dues_allocations where bank_tx_id = p_in_tx_id;
	select coalesce(sum(amount), 0) into v_refunded from public.bank_transactions where refund_of_tx_id = p_in_tx_id;
	if v_alloc + v_refunded + v_out > v_inamt then
		raise exception 'refund exceeds deposit remainder (deposit=%, allocated=%, refunded=%, this=%)', v_inamt, v_alloc, v_refunded, v_out;
	end if;
	update public.bank_transactions set refund_of_tx_id = p_in_tx_id, status = 'matched' where id = p_out_tx_id;
	perform public.dues_sync_bank_tx(p_in_tx_id);
	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'link_refund', p_out_tx_id, jsonb_build_object('in', p_in_tx_id, 'amount', v_out));
	return jsonb_build_object('out', p_out_tx_id, 'in', p_in_tx_id, 'amount', v_out);
end $$;

create or replace function public.dues_unlink_refund(p_out_tx_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_admin uuid := public.current_member_id(); v_in bigint;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	select refund_of_tx_id into v_in from public.bank_transactions where id = p_out_tx_id;
	update public.bank_transactions set refund_of_tx_id = null where id = p_out_tx_id;
	perform public.dues_sync_bank_tx(p_out_tx_id); -- 출금 상태 복원(unmatched)
	if v_in is not null then perform public.dues_sync_bank_tx(v_in); end if; -- 입금 상태 재계산
	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'unlink_refund', p_out_tx_id, jsonb_build_object('in', v_in));
	return jsonb_build_object('out', p_out_tx_id);
end $$;

revoke execute on function public.dues_link_refund(bigint, bigint) from public;
revoke execute on function public.dues_unlink_refund(bigint) from public;
grant execute on function public.dues_link_refund(bigint, bigint) to authenticated;
grant execute on function public.dues_unlink_refund(bigint) to authenticated;
