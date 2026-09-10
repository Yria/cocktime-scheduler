-- Promote the installed ledger in place. No re-import, financial row rewrite or
-- request journal reset. Historical migrations remain executable on fresh DBs.
begin;
set local check_function_bodies = off;
set local lock_timeout = '5s';

-- Fail closed if the completed rollout/prepayment schema is not installed.
do $$ begin
  perform 1 from public.dues_v2_control where id=1 and enabled and not paused for update;
  if not found then raise exception '부과 승격은 활성 원장에서만 가능합니다'; end if;
  if to_regprocedure('public.dues_v2_prepay_due(bigint,uuid,integer)') is null
    or to_regprocedure('public.dues_v2_manage(text,bigint,text,uuid)') is not null then
    raise exception '운영복구 제거 및 예정 대관 선납 마이그레이션을 먼저 적용하세요';
  end if;
end $$;

create schema dues_legacy;
revoke all on schema dues_legacy from public, anon, authenticated;

-- Record exact row hashes inside this transaction, including retry results.
-- The snapshot contains only hashes/counts, never copied financial records.
create temporary table dues_promotion_facts(old_table text, new_table text, row_count bigint, digest text) on commit drop;
do $$ declare t text; dest text; n bigint; h text; begin
  foreach t in array array['dues_charges','dues_allocations','dues_batches','dues_charge_drafts','dues_audit_log',
    'bank_transactions','dues_v2_control','dues_v2_groups','dues_v2_charges','dues_v2_due','dues_v2_positions','dues_v2_allocations',
    'dues_v2_reversals','dues_v2_refunds','dues_v2_expenses','dues_v2_operations','dues_v2_drafts'] loop
    -- Block concurrent legacy writes / bank ingestion until the rename commits.
    execute format('lock table public.%I in access exclusive mode',t);
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)::text) from public.%I x',t) into n,h;
    dest:=case when t in ('dues_charges','dues_allocations','dues_batches','dues_charge_drafts','dues_audit_log')
      then 'dues_legacy.'||t else 'public.'||replace(t,'dues_v2_','dues_') end;
    insert into pg_temp.dues_promotion_facts values(t,dest,n,h);
  end loop;
end $$;

-- Preserve the installed, already patched financial implementation and its OIDs.
-- PostgreSQL does not rewrite SQL/PLpgSQL string bodies on ALTER ... RENAME.
create temporary table dues_promotion_functions on commit drop as
select p.oid, p.proname::text old_name, replace(p.proname,'dues_v2_','dues_') new_name,
  pg_get_function_identity_arguments(p.oid) args, pg_get_functiondef(p.oid) definition
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'dues\_v2\_%' escape '\';

-- Freeze the retired tables in an unexposed schema. Their FKs/IDs and history
-- survive. Old mutation triggers are disabled; the immutable guard below replaces them.
do $$ declare t text; begin
  foreach t in array array['dues_charges','dues_allocations','dues_batches','dues_charge_drafts','dues_audit_log'] loop
    execute format('alter table public.%I disable trigger user',t);
    execute format('alter table public.%I set schema dues_legacy',t);
    execute format('revoke all on table dues_legacy.%I from public,anon,authenticated',t);
  end loop;
end $$;

-- The old implementation is retained only as private historical source. Keep
-- shared eligibility/account helpers and replace live integration bridges below.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p where p.pronamespace='public'::regnamespace
    and ((p.proname like 'dues\_%' escape '\' and p.proname not like 'dues\_v2\_%' escape '\'
      and p.proname not in ('dues_monthly_targets','dues_court_targets','dues_is_day_cancel_chargeable',
        'dues_court_per_head','dues_norm_name','dues_club_account','dues_set_honorary','dues_set_session_fee',
        'dues_generate_monthly','dues_generate_session_court'))
      or p.proname in ('generate_dues_charges','generate_dues_charges_legacy','members_uncharge_dues_on_deactivate_legacy')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('alter function %s set schema dues_legacy',f.signature);
  end loop;
end $$;

-- Move the canonical financial tables. Sequences, index and constraint OIDs survive.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename like 'dues\_v2\_%' escape '\' loop
    execute format('alter table public.%I rename to %I',t.tablename,replace(t.tablename,'dues_v2_','dues_'));
  end loop;
  for t in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('i','S') and c.relname like 'dues\_v2\_%' escape '\' loop
    execute format('alter %s public.%I rename to %I',case when (select relkind from pg_class where oid=t.oid)='S' then 'sequence' else 'index' end,
      t.relname,replace(t.relname,'dues_v2_','dues_'));
  end loop;
  for t in select conrelid::regclass relation,conname from pg_constraint where connamespace='public'::regnamespace
    and conname like 'dues\_v2\_%' escape '\' loop
    execute format('alter table %s rename constraint %I to %I',t.relation,t.conname,replace(t.conname,'dues_v2_','dues_'));
  end loop;
end $$;

do $$ declare f record; begin
  for f in select * from pg_temp.dues_promotion_functions loop
    execute format('alter function public.%I(%s) rename to %I',f.old_name,f.args,f.new_name);
  end loop;
  for f in select * from pg_temp.dues_promotion_functions loop
    execute replace(f.definition,'dues_v2_','dues_');
  end loop;
end $$;

-- Every source-bank UPDATE/DELETE remains forbidden, including old clients and
-- accidental FK SET NULL actions. Keep the original trigger function OID.
alter function public.dues_legacy_guard() rename to dues_bank_guard;
create or replace function public.dues_bank_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.dues_control where id=1 for share;
  raise exception '통장 원본은 변경할 수 없습니다. 회비 관리에서 연결을 변경하세요';
end $$;
alter trigger z_dues_v2_bank_guard on public.bank_transactions rename to z_dues_bank_guard;
alter trigger dues_v2_bank_inserted on public.bank_transactions rename to dues_bank_inserted;

create function public.dues_archive_guard() returns trigger language plpgsql set search_path='' as $$
begin raise exception '이전 부과 원장은 보관 자료입니다'; end $$;
revoke all on function public.dues_archive_guard() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['dues_charges','dues_allocations','dues_batches','dues_charge_drafts','dues_audit_log'] loop
    execute format('create trigger dues_archive_guard before insert or update or delete on dues_legacy.%I for each row execute function public.dues_archive_guard()',t);
  end loop;
end $$;

-- Membership changes never erase issued debts. Eligibility helpers still read
-- members/dues_settings, including cancellation rules shared with wait points.
create or replace function public.members_uncharge_dues_on_deactivate() returns trigger
language plpgsql security definer set search_path='' as $$ begin return null; end $$;

create or replace function public.dues_set_honorary(p_member_id uuid,p_honorary boolean,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  perform 1 from public.dues_control where id=1 for update;
  update public.members set is_honorary=coalesce(p_honorary,false),updated_at=now() where id=p_member_id;
  if not found then raise exception '회원이 없습니다'; end if;
  if p_honorary then
    insert into public.member_honorary(member_id,reason) values(p_member_id,p_reason)
      on conflict(member_id) do update set reason=excluded.reason,updated_at=now();
  else delete from public.member_honorary where member_id=p_member_id; end if;
  update public.dues_control set revision=revision+1 where id=1;
  return jsonb_build_object('ok',true,'honorary',coalesce(p_honorary,false),'cleared_unpaid',0);
end $$;

create or replace function public.dues_set_session_fee(p_session_id bigint,p_amount integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  perform 1 from public.dues_control where id=1 for update;
  if exists(select 1 from public.dues_charges c join public.dues_groups g on g.id=c.group_id where g.session_id=p_session_id)
    then raise exception '발행 이력이 있는 회차입니다. 회비 관리에서 부과 금액을 변경해 주세요'; end if;
  if p_amount<0 then raise exception '금액을 확인하세요'; end if;
  update public.sessions set court_fee=p_amount where id=p_session_id;
  if not found then raise exception '회차가 없습니다'; end if;
  update public.dues_control set revision=revision+1 where id=1;
  return jsonb_build_object('court_fee',p_amount,'freed',0,'removed',0,'issued',0,'held',0);
end $$;

create or replace function public.dues_generate_monthly(p_ym text) returns integer language sql security definer set search_path='' as $$
  select public.dues_auto_issue('monthly',p_ym)
$$;
create or replace function public.dues_generate_session_court(p_session_id bigint,p_initial boolean) returns integer
language sql security definer set search_path='' as $$
  select public.dues_auto_issue('court',(select to_char(scheduled_at at time zone 'Asia/Seoul','YYYY-MM') from public.sessions where id=p_session_id),p_session_id,p_initial)
$$;
-- The existing one-argument bridge and session-close trigger call this signature.

-- Determine preservation from the current ledger, not obsolete amount_paid rows.
create function public.dues_session_deletion(p_session_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.sessions;
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  select * into s from public.sessions where id=p_session_id;
  if not found then raise exception '회차가 없습니다'; end if;
  return jsonb_build_object('preserve',s.recurring_schedule_id is not null
    or exists(select 1 from public.dues_groups where session_id=s.id)
    or exists(select 1 from public.bank_transactions where session_id=s.id),
    'paid_count',(select count(distinct c.id) from public.dues_charges c join public.dues_groups g on g.id=c.group_id
      join public.dues_allocations a on a.charge_id=c.id where g.session_id=s.id and a.amount>a.reversed));
end $$;

create function public.dues_delete_session(p_session_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare info jsonb;
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  -- Same lock order as prepayment/issuance. Recheck after the confirmation dialog.
  perform 1 from public.dues_control where id=1 for update;
  perform 1 from public.sessions where id=p_session_id for update;
  info:=public.dues_session_deletion(p_session_id);
  if (info->>'preserve')::boolean then
    update public.sessions set status='cancelled',is_active=false,is_overridden=true where id=p_session_id;
  else delete from public.sessions where id=p_session_id; end if;
  update public.dues_control set revision=revision+1 where id=1;
  return info;
end $$;
revoke all on function public.dues_session_deletion(bigint),public.dues_delete_session(bigint) from public,anon,authenticated;
grant execute on function public.dues_session_deletion(bigint),public.dues_delete_session(bigint) to authenticated;

-- Compatibility for already-open V2 clients. Only the eight former public RPCs
-- survive; private helpers are not exposed through wrappers.
create function public.dues_v2_mode() returns jsonb language sql stable security invoker set search_path='' as $$ select public.dues_mode() $$;
create function public.dues_v2_read() returns jsonb language sql stable security invoker set search_path='' as $$ select public.dues_read() $$;
create function public.dues_v2_ledger(p_ym text) returns jsonb language sql stable security invoker set search_path='' as $$ select public.dues_ledger(p_ym) $$;
create function public.dues_v2_preview(p_payload jsonb,p_request_id uuid,p_revision bigint) returns jsonb language sql security invoker set search_path='' as $$ select public.dues_preview(p_payload,p_request_id,p_revision) $$;
create function public.dues_v2_command(p_payload jsonb,p_request_id uuid,p_revision bigint) returns jsonb language sql security invoker set search_path='' as $$ select public.dues_command(p_payload,p_request_id,p_revision) $$;
create function public.dues_v2_candidates(p_kind text,p_ym text,p_session_id bigint default null) returns jsonb language sql stable security invoker set search_path='' as $$ select public.dues_candidates(p_kind,p_ym,p_session_id) $$;
create function public.dues_v2_sessions() returns jsonb language sql stable security invoker set search_path='' as $$ select public.dues_sessions() $$;
create function public.dues_v2_reference_members(p_session_id bigint,p_meal boolean default false) returns jsonb language sql stable security invoker set search_path='' as $$ select public.dues_reference_members(p_session_id,p_meal) $$;
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'dues\_v2\_%' escape '\' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
    execute format('comment on function %s is %L',f.signature,'Compatibility RPC for pre-promotion clients; delegates to the canonical dues ledger.');
  end loop;
end $$;

-- pg_cron stores SQL text, so renaming functions is insufficient. Preserve the
-- existing job ID/name, schedule and active flag. Supabase does not grant direct
-- writes to cron.job; alter_job is the supported API and cannot rename jobs.
do $$ declare j record; begin
  if to_regclass('cron.job') is not null then
    for j in select jobid from cron.job where jobname='dues-v2-month-and-carry' loop
      perform cron.alter_job(j.jobid,command:='select public.dues_run_scheduled()');
    end loop;
  end if;
end $$;

-- Refuse to commit if any financial record, source ID or retry result changed.
do $$ declare t record; n bigint; h text; begin
  for t in select * from pg_temp.dues_promotion_facts loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)::text) from %s x',t.new_table) into n,h;
    if n<>t.row_count or h<>t.digest then raise exception '승격 중 원장 변경 감지: %',t.old_table; end if;
  end loop;
  if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'
    and p.proname not like 'dues\_v2\_%' escape '\' and p.prosrc like '%dues_v2_%') then
    raise exception '정식 함수에 이전 V2 참조가 남아 있습니다. 승격을 중단합니다';
  end if;
  perform public.dues_assert();
end $$;
-- Preserve epoch and idempotency keys. Existing clients refresh the same ledger.
update public.dues_control set revision=revision+1 where id=1;
notify pgrst, 'reload schema';
commit;
