-- Post-promotion checks. Read only; run as the migration/database owner.
begin transaction isolation level repeatable read read only;
select enabled,paused,epoch,revision,activated_at from public.dues_control where id=1;
select public.dues_assert();
select (select count(*) from public.bank_transactions) bank_rows,
       (select count(*) from public.dues_charges) charge_rows,
       (select count(*) from public.dues_allocations) allocation_rows,
       (select count(*) from public.dues_refunds) refund_rows,
       (select count(*) from public.dues_operations) operation_rows,
       (select count(*) from dues_legacy.dues_charges) archived_charge_rows;
-- No stale V2 references in canonical financial function bodies.
select p.oid::regprocedure stale_reference from pg_proc p
where p.pronamespace='public'::regnamespace and p.prokind='f'
  and p.proname not like 'dues\_v2\_%' escape '\' and p.prosrc like '%dues_v2_%';
-- Only compatibility RPCs retain V2 function names; none may be anon-executable.
select p.oid::regprocedure rpc,has_function_privilege('anon',p.oid,'execute') anonymous_access
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'dues\_v2\_%' escape '\';
select tablename,rowsecurity from pg_tables where schemaname='public' and tablename in
('dues_control','dues_groups','dues_charges','dues_due','dues_positions','dues_allocations','dues_reversals','dues_refunds','dues_expenses','dues_operations','dues_drafts');
select tgname,tgenabled,tgfoid::regprocedure from pg_trigger
where tgrelid in ('public.bank_transactions'::regclass,'public.sessions'::regclass) and not tgisinternal;
-- Supabase only: keep the existing job name/ID; its command must call
-- public.dues_run_scheduled(). This block also works without pg_cron locally.
do $$ declare j record; begin
 if to_regclass('cron.job') is not null then
  for j in select jobid,jobname,schedule,command,active from cron.job where jobname in ('dues-month-and-carry','dues-v2-month-and-carry') loop
   raise notice 'dues schedule: %',row_to_json(j);
  end loop;
 end if;
end $$;
commit;
