-- Read-only post-activation verification. Counts are expected to match immediately
-- after import; subsequent intentional V2 changes can differ from the legacy ledger.
with paid as (
  select charge_id,sum(amount-reversed) as amount from public.dues_v2_allocations group by charge_id
), months(ym) as (values ('2026-07'),('2026-08'),('2026-09'))
select jsonb_build_object(
  'mode',(select jsonb_build_object('enabled',enabled,'paused',paused,'revision',revision,'activated_at',activated_at) from public.dues_v2_control where id=1),
  'legacy_charge_count',(select count(*) from public.dues_charges),
  'imported_charge_count',(select count(*) from public.dues_v2_charges where legacy_id is not null),
  'legacy_allocation_count',(select count(*) from public.dues_allocations),
  'imported_allocation_count',(select count(*) from public.dues_v2_allocations where legacy_id is not null),
  'changed_imported_charge_facts',(select count(*) from public.dues_charges l join public.dues_v2_charges c on c.legacy_id=l.id left join paid p on p.charge_id=c.id
    where c.member_id<>l.member_id or c.amount<>l.amount_due or coalesce(p.amount,0)<>l.amount_paid
      or c.state<>case l.status when 'void' then 'cancelled' when 'waived' then 'waived' else 'live' end),
  'changed_imported_allocation_facts',(select count(*) from public.dues_allocations l join public.dues_v2_allocations a on a.legacy_id=l.id join public.dues_v2_charges c on c.id=a.charge_id
    where a.bank_tx_id<>l.bank_tx_id or a.owner_id<>l.member_id or c.legacy_id<>l.charge_id or a.amount-a.reversed<>l.amount),
  'months',(select jsonb_agg(jsonb_build_object('ym',m.ym,
    'income',(select coalesce(sum(t.amount),0) from public.bank_transactions t where t.direction='in' and to_char(t.occurred_at at time zone 'Asia/Seoul','YYYY-MM')=m.ym),
    'expense',(select coalesce(sum(t.amount),0) from public.bank_transactions t where t.direction='out' and to_char(t.occurred_at at time zone 'Asia/Seoul','YYYY-MM')=m.ym),
    'original_paid',(select coalesce(sum(l.amount_paid),0) from public.dues_charges l join public.dues_batches b on b.id=l.batch_id where to_char(b.occurred_on,'YYYY-MM')=m.ym),
    'imported_paid',(select coalesce(sum(p.amount),0) from public.dues_v2_charges c join public.dues_v2_groups g on g.id=c.group_id left join paid p on p.charge_id=c.id where c.legacy_id is not null and to_char(g.occurred_on,'YYYY-MM')=m.ym)
  ) order by m.ym) from months m),
  'scheduled_job',(select jsonb_agg(jsonb_build_object('active',active,'schedule',schedule)) from cron.job where jobname='dues-v2-month-and-carry')
) as verification;
