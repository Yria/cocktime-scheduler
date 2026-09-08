-- Historical migration fixture only; never run against a current deployment.
-- Database-owner deployment activation. The web admin activation remains available.
-- Capture stdout to a private file: the result includes the complete financial checkpoint.
-- No member is impersonated; the deployment audit actor is NULL.
-- Frontend and both migrations must already be installed. On any error the transaction rolls back.
begin;
set local lock_timeout='5s';
lock table public.bank_transactions,public.dues_charges,public.dues_allocations,public.dues_batches,public.dues_charge_drafts in share mode;
create temporary table accounting_deployment_checkpoint on commit drop as
select jsonb_build_object('bank_transactions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.bank_transactions t),'dues_charges',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_charges t),'dues_allocations',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_allocations t),'dues_batches',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_batches t),'dues_charge_drafts',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_charge_drafts t),'dues_settings',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_settings t),'member_honorary',(select coalesce(jsonb_agg(to_jsonb(t) order by member_id),'[]') from public.member_honorary t)) as legacy,public.dues_v2_snapshot() as previous_state;
do $$
declare ctl public.dues_v2_control; new_mode jsonb;
begin
  select * into strict ctl from public.dues_v2_control where id=1 for update;
  if ctl.enabled then raise exception '이미 새 부과를 사용 중입니다. 재이관하지 않습니다'; end if;
  if to_regprocedure('public.dues_v2_reference_members(bigint,boolean)') is null then raise exception 'TODO 보완 마이그레이션을 먼저 설치하세요'; end if;
  perform public.dues_v2_import();
  perform public.dues_v2_assert();
  if (select legacy from accounting_deployment_checkpoint) is distinct from jsonb_build_object('bank_transactions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.bank_transactions t),'dues_charges',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_charges t),'dues_allocations',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_allocations t),'dues_batches',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_batches t),'dues_charge_drafts',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_charge_drafts t),'dues_settings',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_settings t),'member_honorary',(select coalesce(jsonb_agg(to_jsonb(t) order by member_id),'[]') from public.member_honorary t)) then
    raise exception '기존 금융 원장이 변경되어 전환을 중단합니다';
  end if;
  update public.dues_v2_control set enabled=true,paused=false,epoch=gen_random_uuid(),activated_at=now(),revision=revision+1,baseline=public.dues_v2_snapshot() where id=1;
  select jsonb_build_object('enabled',enabled,'paused',paused,'revision',revision,'epoch',epoch) into new_mode from public.dues_v2_control where id=1;
  insert into public.dues_v2_operations(epoch,request_id,action,payload,actor_id,before_state,after_state,result)
    select epoch,gen_random_uuid(),'activate','{"reason":"사용자 요청에 따른 TODO 완성본 운영 전환 (DB 배포)"}',null,
      (select previous_state from accounting_deployment_checkpoint),public.dues_v2_snapshot(),new_mode from public.dues_v2_control where id=1;
end $$;
select jsonb_build_object('activated_at',now(),'legacy_unchanged',true,
  'control',(select to_jsonb(c)-'baseline' from public.dues_v2_control c where id=1),
  'backup',(select legacy from accounting_deployment_checkpoint),
  'state',public.dues_v2_snapshot(),
  'counts',jsonb_build_object('charges',(select count(*) from public.dues_v2_charges),'allocations',(select count(*) from public.dues_v2_allocations),
    'paid',(select coalesce(sum(amount-reversed),0) from public.dues_v2_allocations))) as deployment;
commit;
