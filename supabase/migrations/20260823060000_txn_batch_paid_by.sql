-- 거래를 묶음에 붙일 때 '누가 낸 돈인지'도 같이 기록한다.
-- 종전 dues_set_txn_category 는 p_paid_by 를 받아 회원 납부 이력(dues_my_payments)에 남겼다.
-- 묶음으로 옮기면서 그 기능이 빠지면 공구 입금이 회원 이력에서 사라진다 → 같은 인자를 이어받는다.
drop function if exists public.dues_set_txn_batch(bigint, bigint);

create or replace function public.dues_set_txn_batch(
	p_tx_id    bigint,
	p_batch_id bigint,
	p_paid_by  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_admin uuid := public.current_member_id();
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_batch_id is not null and not exists (select 1 from public.dues_batches where id = p_batch_id) then
		raise exception 'batch % not found', p_batch_id;
	end if;
	if p_paid_by is not null and not exists (select 1 from public.members where id = p_paid_by) then
		raise exception 'member % not found', p_paid_by;
	end if;

	update public.bank_transactions
	   set batch_id = p_batch_id,
	       paid_by  = coalesce(p_paid_by, paid_by),
	       -- 묶음에 붙으면 정산함에서 '처리됨'으로 빠진다(카테고리가 하던 역할).
	       status = case when p_batch_id is not null and status = 'unmatched' then 'matched' else status end
	 where id = p_tx_id;
	if not found then raise exception 'tx % not found', p_tx_id; end if;

	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'set_txn_batch', p_tx_id,
	        jsonb_build_object('batch_id', p_batch_id, 'paid_by', p_paid_by));

	return jsonb_build_object('tx_id', p_tx_id, 'batch_id', p_batch_id, 'paid_by', p_paid_by);
end $function$;

revoke execute on function public.dues_set_txn_batch(bigint, bigint, uuid) from public, anon;
grant  execute on function public.dues_set_txn_batch(bigint, bigint, uuid) to authenticated;
