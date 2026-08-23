-- 새 묶음 생성 + 그 거래 연결을 한 번에(원자적). 정산함 [+ 새 묶음] 이 쓴다.
-- 클라에서 두 번 부르면 "묶음만 만들어지고 연결은 실패"한 반쪽 상태가 남을 수 있다.
create or replace function public.dues_create_batch_for_txn(
	p_tx_id   bigint,
	p_label   text,
	p_paid_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_admin uuid := public.current_member_id();
	v_id bigint;
	v_on date;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if coalesce(btrim(p_label), '') = '' then raise exception 'label required'; end if;

	-- 묶음 발생일 = 그 거래일(KST). 묶음이 어느 달 항목인지의 기준.
	select (bt.occurred_at at time zone 'Asia/Seoul')::date into v_on
	  from public.bank_transactions bt where bt.id = p_tx_id;
	if v_on is null then raise exception 'tx % not found', p_tx_id; end if;

	insert into public.dues_batches (kind, key, label, occurred_on)
	values ('manual', 'manual:tmp:' || gen_random_uuid()::text, btrim(p_label), v_on)
	returning id into v_id;
	update public.dues_batches set key = 'manual:b' || v_id::text where id = v_id;

	update public.bank_transactions
	   set batch_id = v_id,
	       paid_by = coalesce(p_paid_by, paid_by),
	       status = case when status = 'unmatched' then 'matched' else status end
	 where id = p_tx_id;

	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'create_batch_for_txn', p_tx_id,
	        jsonb_build_object('batch_id', v_id, 'label', btrim(p_label), 'on', v_on, 'paid_by', p_paid_by));

	return jsonb_build_object('batch_id', v_id, 'label', btrim(p_label), 'occurred_on', v_on);
end $function$;

revoke execute on function public.dues_create_batch_for_txn(bigint, text, uuid) from public, anon;
grant  execute on function public.dues_create_batch_for_txn(bigint, text, uuid) to authenticated;
