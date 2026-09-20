-- One-time data correction: unused 정모/이자 categories imported twice.
-- 20260823050000 moved categories to manual:cat:<id> batches; the 20260907
-- import copied those batches AND independently created category:<id> groups.
-- That import was retired on 20260908, so this path cannot recreate them.
-- Keep used groups, source bank rows, all financial rows and historical journals.
-- Run: supabase db query --linked --file scripts/cleanup-duplicate-income-groups.sql --output json
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create temporary table duplicate_income_cleanup_report (report jsonb) on commit drop;

do $$
declare
  ids uuid[];
  removed jsonb;
  before_facts jsonb := '{}';
  after_fact jsonb;
  t text;
  revision_before bigint;
begin
  -- Use the same lock as every accounting command and recheck usage under it.
  select revision into strict revision_before from public.dues_control where id=1 for update;
  select array_agg(g.id), jsonb_agg(to_jsonb(g) order by g.source_key)
    into ids, removed
  from public.dues_groups g
  join public.dues_groups kept on kept.source_key='manual:cat:'||substring(g.source_key from 10)
    and kept.label=g.label and kept.kind='manual' and kept.basis @> '{"legacy":true}'::jsonb
  where g.source_key ~ '^category:[0-9]+$'
    and g.label in ('정모','이자') and g.kind='manual' and g.session_id is null
    and g.basis @> '{"legacy":true}'::jsonb
    and not exists(select 1 from public.dues_charges c where c.group_id=g.id)
    and not exists(select 1 from public.dues_positions p where p.group_id=g.id)
    and not exists(select 1 from public.dues_expenses e where e.group_id=g.id)
    and not exists(select 1 from public.dues_drafts d where d.source_key=g.source_key
      or d.payload::text like '%'||g.id::text||'%' or d.payload::text like '%'||g.source_key||'%')
    and not exists(select 1 from public.dues_operations o
      where o.payload::text like '%'||g.id::text||'%' or o.result::text like '%'||g.id::text||'%'
        or o.payload::text like '%'||g.source_key||'%' or o.result::text like '%'||g.source_key||'%');

  if ids is null then
    insert into duplicate_income_cleanup_report values(jsonb_build_object('deleted','[]'::jsonb,'count',0,'revision',revision_before));
    return;
  end if;

  -- Exact row comparisons, not just totals: no money or journal can change.
  foreach t in array array['bank_transactions','dues_charges','dues_due','dues_positions',
    'dues_allocations','dues_reversals','dues_refunds','dues_expenses','dues_operations','dues_drafts'] loop
    execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)::text)) from public.%I x',t)
      into after_fact;
    before_facts := before_facts||jsonb_build_object(t,after_fact);
  end loop;

  delete from public.dues_groups where id=any(ids);
  perform public.dues_assert();

  foreach t in array array['bank_transactions','dues_charges','dues_due','dues_positions',
    'dues_allocations','dues_reversals','dues_refunds','dues_expenses','dues_operations','dues_drafts'] loop
    execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)::text)) from public.%I x',t)
      into after_fact;
    if before_facts->t is distinct from after_fact then
      raise exception 'Financial data changed during category cleanup: %',t;
    end if;
  end loop;

  -- Existing clients observe this revision and reload the picker data.
  update public.dues_control set revision=revision+1 where id=1;
  insert into duplicate_income_cleanup_report values(jsonb_build_object(
    'deleted',removed,'count',cardinality(ids),'financial_rows_unchanged',true,
    'revision_before',revision_before,'revision_after',revision_before+1));
end $$;

select report from duplicate_income_cleanup_report;
commit;
