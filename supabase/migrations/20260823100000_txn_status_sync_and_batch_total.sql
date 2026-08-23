-- ============================================================
-- ① 묶음 연결을 해제하면 거래 status 를 되돌린다 + 유령 거래 정리
--
-- 증상: 오상진 +30,000(8/23)이 거래내역엔 "미정산"인데 정산함에는 안 보인다.
--   원인 — `dues_set_txn_batch` 가 붙일 때만 status 를 'matched' 로 올리고, **뗄 때 되돌리지 않았다**:
--     status = case when p_batch_id is not null and status='unmatched' then 'matched' else status end
--   그래서 해제 후 batch_id=null 인데 status='matched' 가 남았다.
--   · 거래내역: 축이 하나도 없어 "미정산"
--   · 정산함:   `status === 'matched'` 로 스킵 → 안 뜬다
--   → **어디서도 처리할 수 없는 유령**이 된다.
--
-- 고침: 해제 시 `dues_sync_bank_tx(tx)` 로 배분·환불 실태에 맞게 status 를 재계산한다.
--
-- 전수 재동기: 위 조건에 걸리는 거래 12건을 실측했는데, **실제 유령은 1건뿐**이었다.
--   · 16528 오상진 +30,000 — 내 해제 버그로 생긴 진짜 유령. 재동기로 unmatched 복귀 ✓
--   · 나머지 11건 — 전부 **전액 환불된 입금**이다(환불 출금이 `refund_of_tx_id` 로 그 입금을 가리킨다).
--     `dues_sync_bank_tx` 가 `배분 + 환불 >= 금액` 을 matched 로 보므로 지금 status 가 정확하고,
--     재동기를 돌려도 그대로 matched 다(= 이 정리는 그 11건에 무해하다).
--     거래내역에서 "환불 처리됨"으로 보여야 하는데, `refundOutByIn` 이 **그 달 거래만** 보므로
--     환불 출금이 다른 달이면 "미정산"으로 보인다(별건, 표시 이슈).
--   status 는 공개회계 산식에 쓰이지 않으므로(항목 판정은 batch/session/category) **회계 숫자는 안 바뀐다.**
--   달라지는 건 "정산함에 뜨는가"뿐이다.
-- ============================================================
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
	       -- 붙일 때: 정산함에서 '처리됨'으로 빠진다(카테고리가 하던 역할).
	       status = case when p_batch_id is not null and status = 'unmatched' then 'matched' else status end
	 where id = p_tx_id;
	if not found then raise exception 'tx % not found', p_tx_id; end if;

	-- 뗄 때: 배분·환불 실태에 맞게 되돌린다. 안 하면 matched 로 남아 어디서도 못 만지는 유령이 된다.
	if p_batch_id is null then
		perform public.dues_sync_bank_tx(p_tx_id);
	end if;

	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'set_txn_batch', p_tx_id,
	        jsonb_build_object('batch_id', p_batch_id, 'paid_by', p_paid_by));

	return jsonb_build_object('tx_id', p_tx_id, 'batch_id', p_batch_id, 'paid_by', p_paid_by);
end $function$;

revoke execute on function public.dues_set_txn_batch(bigint, bigint, uuid) from public, anon;
grant  execute on function public.dues_set_txn_batch(bigint, bigint, uuid) to authenticated;

-- 유령 정리 — 지우기 전 목록을 감사에 남긴다.
insert into public.dues_audit_log (actor_member_id, action, detail)
select null, 'ghost_txn_status_fix',
       jsonb_build_object(
         'why', 'status=matched 인데 배분·묶음·세션·환불연결이 없는 거래를 dues_sync_bank_tx 로 실태에 맞게 재동기. 대부분은 전액환불 입금이라 matched 가 유지되고, 진짜 유령(묶음 해제 후 status 미복원)만 unmatched 로 돌아온다.',
         'txs', jsonb_agg(jsonb_build_object('id', t.id, 'on', (t.occurred_at at time zone 'Asia/Seoul')::date,
                                             'dir', t.direction, 'amount', t.amount, 'name', t.counterparty_name)))
  from public.bank_transactions t
 where t.status = 'matched' and t.batch_id is null and t.category_id is null
   and t.session_id is null and t.refund_of_tx_id is null
   and not exists (select 1 from public.dues_allocations a where a.bank_tx_id = t.id)
having count(*) > 0;

do $$
declare r record; v_n int := 0;
begin
	for r in
		select t.id from public.bank_transactions t
		 where t.status = 'matched' and t.batch_id is null and t.category_id is null
		   and t.session_id is null and t.refund_of_tx_id is null
		   and not exists (select 1 from public.dues_allocations a where a.bank_tx_id = t.id)
	loop
		perform public.dues_sync_bank_tx(r.id);
		v_n := v_n + 1;
	end loop;
	raise notice '유령 거래 %건 status 재동기', v_n;
end $$;

-- ============================================================
-- ② 묶음에 총액을 저장한다 — 수동 부과 편집 화면이 "총액 ÷ 인원" 맥락을 되살릴 수 있게
--
-- 처음엔 "부과합은 sum(amount_due)로 나오니 총액은 저장하지 않는다"고 판단했는데, 편집 화면을 다시
-- 열면 총액 칸이 비어 **초기화된 것처럼 보인다**(인당·명단·이름·날짜는 복원된다). 총액은 "얼마를
-- 나눴나"라는 원본 사실이고 부과합과 다를 수 있다(절상하면 더 걷힌다) → 저장하는 게 맞다.
-- ============================================================
alter table public.dues_batches add column if not exists total_amount integer;

comment on column public.dues_batches.total_amount is
	'엔빵 원본 총액(원). 부과합(sum(amount_due))과 다를 수 있다(절상하면 더 걷힌다). 편집 화면이 '
	'"총액 ÷ 인원" 맥락을 복원하는 데 쓴다. 인당 직접 입력이면 null. 2026-08-23.';

-- 총액을 함께 받는 새 시그니처. 기존 5인자 버전은 제거(호출부는 클라 하나뿐).
drop function if exists public.dues_upsert_manual_batch(text, text, date, integer, uuid[]);

create or replace function public.dues_upsert_manual_batch(
	p_batch_key  text,
	p_label      text,
	p_charged_on date,
	p_amount     integer,
	p_member_ids uuid[],
	p_total      integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_admin   uuid := public.current_member_id();
	v_charged int := 0;
	v_removed int := 0;
	v_locked  int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if coalesce(btrim(p_batch_key), '') = '' then raise exception 'batch_key required'; end if;
	if coalesce(btrim(p_label), '')     = '' then raise exception 'label required'; end if;
	if p_charged_on is null                  then raise exception 'charged_on required'; end if;
	if p_amount is null or p_amount <= 0     then raise exception 'amount must be > 0'; end if;
	if p_member_ids is null or array_length(p_member_ids, 1) is null then raise exception 'no members'; end if;

	if exists (
		select 1 from unnest(p_member_ids) x(id)
		where not exists (select 1 from public.members m where m.id = x.id)
	) then
		raise exception 'unknown member in list';
	end if;

	insert into public.dues_charges (kind, member_id, batch_key, label, charged_on, amount_due, payer_hint)
	select 'manual', m.id, btrim(p_batch_key), btrim(p_label), p_charged_on, p_amount,
	       case when m.is_guest then (
	           select a.invited_by from public.attendances a
	            where a.member_id = m.id and a.invited_by is not null
	            order by a.requested_at desc limit 1
	       ) else null end
	  from (select distinct id from unnest(p_member_ids) as t(id)) x
	  join public.members m on m.id = x.id
	on conflict (member_id, batch_key) where batch_key is not null
	do update set amount_due = excluded.amount_due,
	              label      = excluded.label,
	              charged_on = excluded.charged_on,
	              payer_hint = excluded.payer_hint,
	              updated_at = now()
	where public.dues_charges.amount_paid = 0;
	get diagnostics v_charged = row_count;

	delete from public.dues_charges dc
	where dc.kind = 'manual' and dc.batch_key = btrim(p_batch_key)
	  and dc.amount_paid = 0 and dc.status <> 'void'
	  and not (dc.member_id = any(p_member_ids));
	get diagnostics v_removed = row_count;

	select count(*) into v_locked
	  from public.dues_charges dc
	 where dc.kind = 'manual' and dc.batch_key = btrim(p_batch_key)
	   and not (dc.member_id = any(p_member_ids)) and dc.amount_paid > 0;

	-- 묶음 행에 원본 총액을 남긴다(트리거가 만든 묶음에 얹는다).
	update public.dues_batches
	   set total_amount = p_total
	 where key = 'manual:' || btrim(p_batch_key);

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'upsert_manual_batch', jsonb_build_object(
		'batch_key', btrim(p_batch_key), 'label', btrim(p_label), 'charged_on', p_charged_on,
		'amount', p_amount, 'total', p_total, 'head', array_length(p_member_ids, 1),
		'charged', v_charged, 'removed', v_removed, 'locked', v_locked));

	return jsonb_build_object('charged', v_charged, 'removed', v_removed, 'locked', v_locked);
end $function$;

revoke execute on function public.dues_upsert_manual_batch(text, text, date, integer, uuid[], integer) from public, anon;
grant  execute on function public.dues_upsert_manual_batch(text, text, date, integer, uuid[], integer) to authenticated;
