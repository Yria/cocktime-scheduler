-- A fully reversed prepayment is no longer an issued obligation before play.
-- Preserve the charge and reversal history; a later payment/close issues a new
-- charge at the current rate and links it to this cancelled predecessor.
set local lock_timeout = '5s';

create function public.dues_restore_reversed_prepayment(p_charge uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.dues_charges; s public.sessions;
begin
  select * into c from public.dues_charges where id=p_charge for update;
  if not found or c.state<>'live' or c.basis->'prepayment' is distinct from 'true'::jsonb then return null; end if;
  select ss.* into s from public.sessions ss join public.dues_groups g on g.session_id=ss.id
    where g.id=c.group_id and g.kind='court' for share of ss;
  if not found or s.status<>'open' or s.scheduled_at is null or s.scheduled_at<=now()
    or exists(select 1 from public.matches where session_id=s.id) then return null; end if;
  if not exists(select 1 from public.dues_allocations where charge_id=c.id and reversed>0)
    or exists(select 1 from public.dues_allocations where charge_id=c.id and amount>reversed)
    or (select coalesce(sum(remaining),0) from public.dues_due where charge_id=c.id)<>c.amount then return null; end if;
  update public.dues_due set remaining=0 where charge_id=c.id;
  update public.dues_charges set state='cancelled',
    basis=basis||jsonb_build_object('prepayment_reversed',true,'prepayment_reversed_at',now()) where id=c.id;
  return c.id;
end $$;
revoke all on function public.dues_restore_reversed_prepayment(uuid) from public,anon,authenticated;

-- Patch the installed functions without replacing unrelated command branches.
-- Exact occurrence checks fail closed if another migration changes these bodies.
do $patch$
declare definition text; old text; replacement text;
begin
  definition:=pg_get_functiondef('public.dues_execute(jsonb,uuid,bigint)'::regprocedure);
  old:=$old$    position_id:=public.dues_release((p->>'allocation_id')::uuid,(p->>'amount')::integer);
    result:=jsonb_build_object('position_id',position_id);$old$;
  replacement:=$new$    position_id:=public.dues_release((p->>'allocation_id')::uuid,(p->>'amount')::integer);
    new_id:=public.dues_restore_reversed_prepayment((select charge_id from public.dues_allocations where id=(p->>'allocation_id')::uuid));
    result:=jsonb_build_object('position_id',position_id,'restored_prepayment',new_id);$new$;
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'Unexpected reverse_payment implementation'; end if;
  execute replace(definition,old,replacement);

  definition:=pg_get_functiondef('public.dues_candidates_internal(text,text,bigint)'::regprocedure);
  old:=$old$where not exists(select 1 from public.dues_charges c where c.group_id=g.id and c.member_id=t.member_id);$old$;
  replacement:=$new$where not exists(select 1 from public.dues_charges c where c.group_id=g.id and c.member_id=t.member_id
        and not (c.state='cancelled' and c.basis @> '{"prepayment":true,"prepayment_reversed":true}'::jsonb));$new$;
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>2 then raise exception 'Unexpected charge candidate implementation'; end if;
  execute replace(definition,old,replacement);

  definition:=pg_get_functiondef('public.dues_issue(jsonb)'::regprocedure);
  old:=$old$if exists(select 1 from public.dues_charges where group_id=g and member_id=(line->>'member_id')::uuid)$old$;
  replacement:=$new$if exists(select 1 from public.dues_charges where group_id=g and member_id=(line->>'member_id')::uuid
      and not (state='cancelled' and basis @> '{"prepayment":true,"prepayment_reversed":true}'::jsonb))$new$;
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'Unexpected issuance guard'; end if;
  definition:=replace(definition,old,replacement);
  old:=$old$insert into public.dues_charges(group_id,member_id,amount,payer_hint,basis)
      values(g,(line->>'member_id')::uuid,(line->>'amount')::integer,(line->>'payer_hint')::uuid,$old$;
  replacement:=$new$insert into public.dues_charges(group_id,member_id,amount,previous_id,payer_hint,basis)
      values(g,(line->>'member_id')::uuid,(line->>'amount')::integer,
        (select predecessor.id from public.dues_charges predecessor where group_id=g and member_id=(line->>'member_id')::uuid
          and state='cancelled' and basis @> '{"prepayment":true,"prepayment_reversed":true}'::jsonb
          and not exists(select 1 from public.dues_charges successor where successor.previous_id=predecessor.id)
          order by issued_at desc,predecessor.id desc limit 1),(line->>'payer_hint')::uuid,$new$;
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'Unexpected issuance insert'; end if;
  execute replace(definition,old,replacement);
end $patch$;
