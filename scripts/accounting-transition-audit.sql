-- 과거 납부 처리 보존 및 새 부과/이월 모델 전환을 위한 읽기 전용 조사.
-- 실행: supabase db query --linked --output json --file scripts/accounting-transition-audit.sql
-- 단일 SELECT의 동일 스냅샷에서 집계한다. 데이터/설정/마감 상태를 변경하지 않는다.
-- 이름, 계좌, 적요, 이메일 원문, 회원 UUID는 출력하지 않는다.
-- 결과는 현재 상태이며 당시 확정 장부나 전환용 전체 백업을 대신하지 않는다.
with
months(ym) as (values ('2026-07'), ('2026-08'), ('2026-09')),
tx as (
  select t.*, to_char(t.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM') as cash_ym
  from public.bank_transactions t
),
charges as (
  select c.*, coalesce(c.period_ym,
    to_char(s.scheduled_at at time zone 'Asia/Seoul', 'YYYY-MM'),
    to_char(c.charged_on, 'YYYY-MM'), to_char(b.occurred_on, 'YYYY-MM')) as origin_ym
  from public.dues_charges c
  left join public.sessions s on s.id = c.session_id
  left join public.dues_batches b on b.id = c.batch_id
),
alloc_tx as (
  select bank_tx_id, sum(amount) as used, count(*) as rows,
    count(distinct member_id) as payer_count
  from public.dues_allocations group by bank_tx_id
),
alloc_charge as (
  select charge_id, sum(case when kind = 'refund' then -amount else amount end) as paid
  from public.dues_allocations group by charge_id
),
refunds as (
  select refund_of_tx_id, sum(amount) as refunded, count(*) as rows
  from tx where direction = 'out' and refund_of_tx_id is not null
  group by refund_of_tx_id
),
funds as (
  select t.*, coalesce(a.used, 0) as used, coalesce(r.refunded, 0) as refunded,
    coalesce(a.payer_count, 0) as payer_count,
    t.amount - coalesce(a.used, 0) - coalesce(r.refunded, 0) as raw_remainder,
    (t.session_id is not null or t.batch_id is not null or t.category_id is not null) as tagged
  from tx t
  left join alloc_tx a on a.bank_tx_id = t.id
  left join refunds r on r.refund_of_tx_id = t.id
  where t.direction = 'in'
),
cash_by_month as (
  select cash_ym, count(*) as rows,
    count(*) filter (where direction = 'in') as incoming_rows,
    coalesce(sum(amount) filter (where direction = 'in'), 0) as income,
    count(*) filter (where direction = 'out') as outgoing_rows,
    coalesce(sum(amount) filter (where direction = 'out'), 0) as expense,
    count(*) filter (where status = 'unmatched') as unmatched_rows,
    count(*) filter (where created_at >= '2026-09-01T00:00:00+09') as imported_since_sep
  from tx where cash_ym in (select ym from months) group by cash_ym
),
charge_by_month as (
  select origin_ym, kind, status, count(*) as rows, sum(amount_due) as due,
    sum(amount_paid) as paid,
    sum(case when status not in ('void', 'waived')
      then greatest(amount_due - amount_paid, 0) else 0 end) as outstanding,
    count(*) filter (where deferred_to is not null) as deferred_rows
  from charges where origin_ym in (select ym from months)
  group by origin_ym, kind, status
),
allocation_edges as (
  select t.cash_ym, c.origin_ym, c.kind, count(*) as rows, sum(a.amount) as amount,
    count(*) filter (where a.created_at >= '2026-09-01T00:00:00+09') as linked_since_sep,
    coalesce(sum(a.amount) filter (where a.created_at >= '2026-09-01T00:00:00+09'), 0) as amount_linked_since_sep
  from public.dues_allocations a
  join tx t on t.id = a.bank_tx_id
  join charges c on c.id = a.charge_id
  where t.cash_ym in (select ym from months) or c.origin_ym in (select ym from months)
  group by t.cash_ym, c.origin_ym, c.kind
),
funds_by_month as (
  select cash_ym, count(*) as rows, sum(used) as used, sum(refunded) as refunded,
    count(*) filter (where raw_remainder > 0 and not tagged) as untagged_positive_rows,
    coalesce(sum(raw_remainder) filter (where raw_remainder > 0 and not tagged), 0) as untagged_positive_amount,
    count(*) filter (where raw_remainder > 0 and tagged) as tagged_positive_rows,
    coalesce(sum(raw_remainder) filter (where raw_remainder > 0 and tagged), 0) as tagged_positive_amount,
    count(*) filter (where raw_remainder < 0) as negative_rows,
    count(*) filter (where payer_count > 1) as multiple_payer_rows,
    count(*) filter (where raw_remainder > 0 and not tagged and paid_by is null and payer_count = 0) as no_owner_candidate_rows,
    count(*) filter (where session_id is not null and used > 0) as session_tag_plus_allocation_rows,
    coalesce(sum(used) filter (where session_id is not null and used > 0), 0) as session_tag_plus_allocation_amount,
    count(*) filter (where tagged and refunded > 0) as tagged_refund_rows,
    count(*) filter (where category_id is not null) as legacy_category_rows
  from funds where cash_ym in (select ym from months) group by cash_ym
),
refund_edges as (
  select i.cash_ym as source_ym, o.cash_ym as outgoing_ym, count(*) as rows,
    sum(o.amount) as amount
  from tx o join tx i on i.id = o.refund_of_tx_id
  where o.cash_ym in (select ym from months) or i.cash_ym in (select ym from months)
  group by i.cash_ym, o.cash_ym
),
drafts_by_month as (
  select coalesce(d.period_ym,
    to_char(s.scheduled_at at time zone 'Asia/Seoul', 'YYYY-MM')) as origin_ym,
    d.kind, count(*) as rows, sum(d.amount_due) as amount
  from public.dues_charge_drafts d left join public.sessions s on s.id = d.session_id
  group by 1, d.kind
),
audit_actions as (
  select to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MM') as action_ym,
    action, count(*) as rows
  from public.dues_audit_log
  where created_at >= '2026-07-01T00:00:00+09'
    and (action like '%cancel%' or action like '%void%' or action like '%waiv%'
      or action like '%reset%' or action like '%defer%' or action like '%deactiv%'
      or action like '%delete%' or action like '%refund%' or action like '%fee%')
  group by 1, action
)
select jsonb_build_object(
  'observed_at', now(),
  'scope', 'Current linked DB; KST months; SELECT only; remainder is not automatically member credit',
  'total_rows', jsonb_build_object('bank', (select count(*) from tx),
    'charges', (select count(*) from charges), 'allocations', (select count(*) from public.dues_allocations)),
  'cash_by_month', (select jsonb_agg(to_jsonb(x) order by cash_ym) from cash_by_month x),
  'charges_by_month', (select jsonb_agg(to_jsonb(x) order by origin_ym, kind, status) from charge_by_month x),
  'allocation_edges', (select jsonb_agg(to_jsonb(x) order by cash_ym, origin_ym, kind) from allocation_edges x),
  'funds_by_month', (select jsonb_agg(to_jsonb(x) order by cash_ym) from funds_by_month x),
  'refund_edges', (select jsonb_agg(to_jsonb(x) order by source_ym, outgoing_ym) from refund_edges x),
  'drafts', (select jsonb_agg(to_jsonb(x) order by origin_ym, kind) from drafts_by_month x),
  'deferred', (select jsonb_agg(jsonb_build_object('charge_id', id, 'origin_ym', origin_ym,
    'deferred_to', deferred_to, 'status', status, 'due', amount_due, 'paid', amount_paid) order by id)
    from charges where deferred_to is not null),
  'anomalies', jsonb_build_object(
    'paid_cache_mismatch', (select count(*) from charges c left join alloc_charge a on a.charge_id = c.id
      where c.amount_paid <> coalesce(a.paid, 0)),
    'void_or_waived_with_paid', (select count(*) from charges where status in ('void', 'waived') and amount_paid > 0),
    'prior_origin_changed_since_sep', (select count(*) from charges
      where origin_ym in ('2026-07', '2026-08') and updated_at >= '2026-09-01T00:00:00+09'),
    'missing_charge_origin', (select count(*) from charges where origin_ym is null),
    'non_payment_allocations', (select count(*) from public.dues_allocations where kind <> 'payment'),
    'allocation_without_bank_or_charge', (select count(*) from public.dues_allocations where bank_tx_id is null or charge_id is null),
    'allocation_from_outgoing', (select count(*) from public.dues_allocations a join tx t on t.id = a.bank_tx_id where t.direction <> 'in'),
    'paid_by_allocation_payer_disagreement', (select count(distinct t.id) from tx t join public.dues_allocations a on a.bank_tx_id = t.id
      where t.paid_by is not null and a.member_id <> t.paid_by),
    'multiple_tag_axes', (select count(*) from tx where
      (session_id is not null)::int + (batch_id is not null)::int + (category_id is not null)::int > 1),
    'negative_remainder_all_months', (select count(*) from funds where raw_remainder < 0)
  ),
  'audit_actions', (select jsonb_agg(to_jsonb(x) order by action_ym, action) from audit_actions x),
  'prior_unpaid', (select jsonb_agg(jsonb_build_object('charge_id', c.id,
    'origin_ym', c.origin_ym, 'kind', c.kind, 'due', c.amount_due, 'paid', c.amount_paid,
    'operator', exists(select 1 from public.user_roles r where r.member_id = c.member_id and r.role = 'admin')) order by c.id)
    from charges c where c.origin_ym in ('2026-07', '2026-08') and c.status in ('unpaid', 'partial')),
  'prior_void', (select jsonb_agg(jsonb_build_object('charge_id', id, 'origin_ym', origin_ym,
    'due', amount_due) order by id) from charges where origin_ym in ('2026-07', '2026-08') and status = 'void'),
  'aug_untagged_remainder', (select jsonb_agg(jsonb_build_object('bank_tx_id', id,
    'amount', amount, 'used', used, 'refunded', refunded, 'remaining', raw_remainder,
    'paid_by_set', paid_by is not null, 'payer_count', payer_count) order by id)
    from funds where cash_ym = '2026-08' and not tagged and raw_remainder > 0),
  'tagged_refunds', (select jsonb_agg(jsonb_build_object('bank_tx_id', id, 'cash_ym', cash_ym,
    'amount', amount, 'used', used, 'refunded', refunded, 'remaining', raw_remainder,
    'session_id', session_id, 'batch_id', batch_id, 'category_id', category_id) order by id)
    from funds where tagged and refunded > 0),
  'tag_axes', (select jsonb_agg(to_jsonb(x) order by cash_ym) from (
    select cash_ym, (session_id is not null) as session, (batch_id is not null) as batch,
      (category_id is not null) as category, count(*) as rows from tx
    where cash_ym in (select ym from months)
      and (session_id is not null)::int + (batch_id is not null)::int + (category_id is not null)::int > 1
    group by 1, 2, 3, 4) x),
  'other_charge_months', (select jsonb_agg(to_jsonb(x) order by origin_ym) from (
    select origin_ym, count(*) as rows, sum(amount_due) as due, sum(amount_paid) as paid
    from charges where origin_ym not in (select ym from months) group by origin_ym) x)
) as audit;
