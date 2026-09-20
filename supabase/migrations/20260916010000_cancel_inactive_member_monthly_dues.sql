-- Deactivation cancels fully unpaid monthly dues, including carried debt.
-- Keep issued rows and an audit entry. Paid/part-paid charges, court fees,
-- manual charges and actual money are preserved. Reactivation does not undo it.
set local lock_timeout = '5s';

create or replace function public.dues_cancel_inactive_monthly(p_member uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare
  ctl public.dues_control;
  charge_ids uuid[];
  items jsonb;
  outstanding_before bigint;
  v_result jsonb;
  op_id bigint;
  reason text := '회원 비활성화로 미납 회비 부과 취소';
begin
  -- Serialize selection and cancellation with payment, issuance and carry.
  select * into strict ctl from public.dues_control where id=1 for update;
  select array_agg(c.id order by c.id),
    jsonb_agg(jsonb_build_object('charge_id',c.id,'member_id',c.member_id,
      'group_id',g.id,'ym',to_char(g.occurred_on,'YYYY-MM'),'amount',c.amount) order by c.id)
    into charge_ids,items
  from public.dues_charges c
  join public.dues_groups g on g.id=c.group_id
  join public.members m on m.id=c.member_id
  where not m.is_active and (p_member is null or m.id=p_member)
    and g.kind='monthly' and c.state='live'
    and not exists(select 1 from public.dues_allocations a where a.charge_id=c.id and a.amount>a.reversed);

  if charge_ids is null then return 0; end if;
  if not ctl.enabled or ctl.paused then raise exception '회계 처리가 일시 중지되었습니다'; end if;
  select coalesce(sum(remaining),0) into outstanding_before from public.dues_due;

  update public.dues_due set remaining=0 where charge_id=any(charge_ids);
  update public.dues_charges set state='cancelled',
    basis=basis||jsonb_build_object('member_deactivated',true,'cancelled_at',now(),'cancellation_reason',reason)
    where id=any(charge_ids);
  perform public.dues_assert();

  -- This is a cancellation-only replacement. Do not apply other member money.
  v_result:=jsonb_build_object('charges','[]'::jsonb,'cancelled',to_jsonb(charge_ids),
    'count',cardinality(charge_ids),'items',items,'reused',0,'released_positions','[]'::jsonb,
    'auto_applied',0,'outstanding_before',outstanding_before,
    'outstanding_after',(select coalesce(sum(remaining),0) from public.dues_due),
    'revision',ctl.revision+1);
  insert into public.dues_operations(epoch,request_id,action,payload,actor_id,result)
    values(ctl.epoch,gen_random_uuid(),'replace',
      jsonb_build_object('action','replace','reason',reason,'source','member_deactivation',
        'member_id',p_member,'charge_ids',to_jsonb(charge_ids),'lines','[]'::jsonb),
      public.current_member_id(),v_result) returning id into op_id;
  update public.dues_operations set result=v_result||jsonb_build_object('operation_id',op_id) where id=op_id;
  update public.dues_control set revision=revision+1 where id=1;
  return cardinality(charge_ids);
end $$;
revoke all on function public.dues_cancel_inactive_monthly(uuid) from public,anon,authenticated;

create or replace function public.members_uncharge_dues_on_deactivate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform public.dues_cancel_inactive_monthly(new.id);
  return null;
end $$;
revoke all on function public.members_uncharge_dues_on_deactivate() from public,anon,authenticated;

drop trigger if exists trg_members_uncharge_dues_on_deactivate on public.members;
create trigger trg_members_uncharge_dues_on_deactivate after update of is_active on public.members
  for each row when (old.is_active and not new.is_active)
  execute function public.members_uncharge_dues_on_deactivate();

-- Apply the same policy to members who were already inactive at installation.
select public.dues_cancel_inactive_monthly(null);
