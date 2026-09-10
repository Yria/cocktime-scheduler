-- HISTORICAL: pre-promotion V1 transition tooling only.
-- Current ledger validation: scripts/dues-verify.sql. Use a full PostgreSQL backup for recovery.
do $$ begin
 if to_regclass('public.dues_control') is not null then
  raise exception '이 스크립트는 최초 v1 이관용입니다. 정식 원장은 scripts/dues-verify.sql로 확인하세요';
 end if;
end $$;

-- Read-only export for accounting-v2-dry-run.mjs. Contains UUIDs and amounts;
-- keep the resulting JSON outside Git. No names, bank descriptions or account numbers.
select jsonb_build_object('observed_at',now(),'tables',jsonb_build_object(
  'members',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,'회원'::text as name,is_active,is_guest,is_honorary,null::text as gender,null::int as birth_year,updated_at from public.members
  ) x),
  'sessions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,'회차'::text as title,status,scheduled_at,ends_at,place_id,recurring_schedule_id,court_fee from public.sessions
  ) x),
  'dues_settings',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,monthly_fee,court_fee_default from public.dues_settings
  ) x),
  'txn_categories',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,'분류'::text as name from public.txn_categories
  ) x),
  'dues_batches',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,key,kind,'묶음'::text as label,occurred_on,session_id,period_ym,total_amount from public.dues_batches
  ) x),
  'bank_transactions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,direction,amount,occurred_at,created_at,paid_by,session_id,batch_id,category_id,refund_of_tx_id,null::text as counterparty_name from public.bank_transactions
  ) x),
  'dues_charges',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,kind,member_id,amount_due,amount_paid,status,batch_id,payer_hint,period_ym,deferred_to,is_day_cancel,created_at from public.dues_charges
  ) x),
  'dues_allocations',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,bank_tx_id,charge_id,member_id,amount,kind,created_at from public.dues_allocations
  ) x),
  'dues_charge_drafts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,draft_group,kind,'발행 대기'::text as label,period_ym,charged_on,session_id,member_id,amount_due,payer_hint,hold_reason from public.dues_charge_drafts
  ) x)
)) as snapshot;
