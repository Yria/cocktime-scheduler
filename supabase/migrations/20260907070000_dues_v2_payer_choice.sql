-- Reconfirm the sender of a wholly unused receipt in the same payment command.
-- The existing three-argument matcher keeps its strict semantics for old clients.
-- No bank, legacy or financial rows are changed by installing this migration.
create or replace function public.dues_v2_match_position(
  p_position uuid,p_owner uuid,p_confirm boolean,p_reassign boolean
) returns void language plpgsql security definer set search_path='' as $$
declare pos public.dues_v2_positions; receipt public.bank_transactions;
begin
  select * into strict pos from public.dues_v2_positions where id=p_position;
  if not coalesce(p_reassign,false) or pos.owner_id is null or pos.owner_id=p_owner then
    perform public.dues_v2_match_position(p_position,p_owner,p_confirm);
    return;
  end if;
  if p_owner is null or not coalesce(p_confirm,false) then
    raise exception '변경할 실제 입금자를 선택하세요';
  end if;
  select * into strict receipt from public.bank_transactions where id=pos.bank_tx_id;
  if receipt.direction<>'in' or pos.amount<=0
    or exists(select 1 from public.dues_v2_allocations where bank_tx_id=pos.bank_tx_id)
    or exists(select 1 from public.dues_v2_refunds where in_tx_id=pos.bank_tx_id)
    or exists(select 1 from public.dues_v2_positions where bank_tx_id=pos.bank_tx_id
      and amount>0 and purpose not in ('unassigned','member_pending'))
    or receipt.amount<>(select coalesce(sum(amount),0) from public.dues_v2_positions where bank_tx_id=pos.bank_tx_id)
    then raise exception '납부·환불·이월 처리 전의 입금만 납부자를 변경할 수 있습니다';
  end if;
  if not exists(select 1 from public.members where id=p_owner) then
    raise exception '변경할 납부자를 다시 확인하세요';
  end if;
  -- Move the entire receipt, including exhausted positions, so it still has one
  -- sender. Do not rewrite allocations, refunds, bank paid_by or legacy history.
  update public.dues_v2_positions set owner_id=p_owner,
    purpose=case when purpose='unassigned' then 'member_pending' else purpose end
    where bank_tx_id=pos.bank_tx_id;
end $$;
revoke all on function public.dues_v2_match_position(uuid,uuid,boolean,boolean) from public,anon,authenticated;

create or replace function public.dues_v2_execute(p jsonb,p_request uuid,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
<<mutation>>
declare ctl public.dues_v2_control; prior public.dues_v2_operations; before_data jsonb; after_data jsonb;
  result jsonb:='{}'; action text:=p->>'action'; line jsonb; item jsonb; part jsonb; schedule jsonb; slice record;
  pos public.dues_v2_positions; due public.dues_v2_due; old public.dues_v2_charges; a record;
  out_tx public.bank_transactions; refund public.dues_v2_refunds;
  amount integer; used integer; remaining integer; total integer:=0; applied integer:=0;
  new_id uuid; position_id uuid; due_id uuid; source_id bigint; owner uuid; purpose text; target text;
  released jsonb:='[]'; created jsonb:='[]'; op_id bigint;
begin
  select * into strict ctl from public.dues_v2_control where id=1 for update;
  if not ctl.enabled then raise exception '새 부과 기능이 꺼져 있습니다'; end if;
  if ctl.paused then raise exception '회계 처리가 일시 중지되었습니다'; end if;
  if p_request is null then raise exception '요청 ID가 필요합니다'; end if;
  select * into prior from public.dues_v2_operations where epoch=ctl.epoch and request_id=p_request;
  if found then
    if prior.payload<>p or prior.reverted_at is not null then raise exception '이미 사용하거나 되돌린 요청 ID입니다'; end if;
    return prior.result;
  end if;
  if p_revision is null or ctl.revision<>p_revision then raise exception '다른 처리가 반영되었습니다. 새로고침 후 다시 확인하세요' using errcode='40001'; end if;
  if nullif(btrim(p->>'reason'),'') is null then raise exception '처리 사유를 입력하세요'; end if;
  perform public.dues_v2_sync_bank();
  before_data:=public.dues_v2_snapshot();

  if action='issue' then
    if p->>'rule'='court' then
      item:=public.dues_v2_candidates_internal('court',p->>'ym',(p->>'session_id')::bigint);
      for line in select value from jsonb_array_elements(p->'lines') loop
        if not exists(select 1 from jsonb_array_elements(item->'payload'->'lines') fresh
          where fresh->>'member_id'=line->>'member_id' and fresh->>'amount'=line->>'amount'
            and (fresh->>'payer_hint') is not distinct from (line->>'payer_hint'))
          then raise exception '대관 대상 또는 금액이 변경됐습니다. 다시 계산하세요'; end if;
      end loop;
    end if;
    result:=public.dues_v2_issue(p);
    delete from public.dues_v2_drafts where source_key=(select source_key from public.dues_v2_groups where id=(result->>'group_id')::uuid);
  elsif action='draft' then
    insert into public.dues_v2_drafts(source_key,payload,hold_reason) values(p->>'source_key',p->'draft',p->>'hold_reason')
      on conflict(source_key) do update set payload=excluded.payload,hold_reason=excluded.hold_reason,updated_at=now();
  elsif action='replace' then
    if jsonb_array_length(coalesce(p->'charge_ids','[]'))=0 then raise exception '취소할 부과를 선택하세요'; end if;
    for item in select value from jsonb_array_elements(p->'charge_ids') loop
      select * into strict old from public.dues_v2_charges where id=(item#>>'{}')::uuid;
      if old.state<>'live' then raise exception '유효한 부과만 취소할 수 있습니다'; end if;
      for a in select * from public.dues_v2_allocations where charge_id=old.id and amount>reversed order by created_at,id loop
        position_id:=public.dues_v2_release(a.id,a.amount-a.reversed);
        released:=released||jsonb_build_array(jsonb_build_object('id',position_id,'previous_id',old.id));
      end loop;
      update public.dues_v2_due set remaining=0 where charge_id=old.id;
      update public.dues_v2_charges set state='cancelled' where id=old.id;
    end loop;
    for line in select value from jsonb_array_elements(coalesce(p->'lines','[]')) loop
      if not (p->'charge_ids' @> jsonb_build_array(line->>'previous_id')) then raise exception '선택하지 않은 원부과입니다'; end if;
      select * into strict old from public.dues_v2_charges where id=(line->>'previous_id')::uuid;
      insert into public.dues_v2_charges(group_id,member_id,amount,previous_id,payer_hint,basis)
        values(old.group_id,(line->>'member_id')::uuid,(line->>'amount')::integer,old.id,
          case when old.member_id=(line->>'member_id')::uuid then old.payer_hint else (line->>'payer_hint')::uuid end,
          (coalesce(p->'basis','{}')-'members')||jsonb_build_object('reason',p->>'reason','previous_basis',old.basis)) returning id into new_id;
      schedule:=coalesce(line->'due_schedule',jsonb_build_array(jsonb_build_object('due_ym',line->>'due_ym','amount',line->'amount')));
      if (select coalesce(sum((x->>'amount')::integer),0) from jsonb_array_elements(schedule) x)<>(line->>'amount')::integer
        then raise exception '납기별 금액 합이 새 부과액과 다릅니다'; end if;
      for part in select value from jsonb_array_elements(schedule) loop
        if (part->>'amount')::integer is null or (part->>'amount')::integer<0 then raise exception '납기별 금액을 확인하세요'; end if;
        if (part->>'amount')::integer>0 then
          insert into public.dues_v2_due(charge_id,due_ym,remaining) values(new_id,part->>'due_ym',(part->>'amount')::integer);
        end if;
      end loop;
      -- Only reuse funds released from the selected predecessor, with explicit proxy consent.
      for item in select value from jsonb_array_elements(released) where value->>'previous_id'=line->>'previous_id' loop
        for slice in select d.* from public.dues_v2_due d where d.charge_id=new_id and d.remaining>0 order by d.due_ym,d.id loop
          select * into strict pos from public.dues_v2_positions where id=(item->>'id')::uuid;
          amount:=least(pos.amount,slice.remaining);
          if amount>0 and (pos.owner_id=(line->>'member_id')::uuid or old.member_id=(line->>'member_id')::uuid or coalesce((p->>'proxy')::boolean,false)) then
            perform public.dues_v2_allocate(pos.id,slice.id,amount,old.member_id=(line->>'member_id')::uuid or coalesce((p->>'proxy')::boolean,false));
            total:=total+amount;
          end if;
        end loop;
      end loop;
      created:=created||jsonb_build_array(new_id);
    end loop;
    result:=jsonb_build_object('charges',created,'reused',total,'released_positions',released);
  elsif action='carry' then
    owner:=(p->>'member_id')::uuid; target:=p->>'target_ym';
    if jsonb_array_length(coalesce(p->'debts','[]'))+jsonb_array_length(coalesce(p->'money','[]'))=0 then raise exception '이월할 내역이 없습니다'; end if;
    if owner is null or target is null or target !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception '회원과 이월 월을 확인하세요'; end if;
    for line in select value from jsonb_array_elements(coalesce(p->'debts','[]')) loop
      select * into strict due from public.dues_v2_due where id=(line->>'due_id')::uuid;
      select * into strict old from public.dues_v2_charges where id=due.charge_id;
      amount:=(line->>'amount')::integer;
      if old.member_id<>owner or old.state<>'live' or amount is null or amount<=0 or amount>due.remaining
        or (target<=due.due_ym and not coalesce((p->>'change_month')::boolean,false)) then raise exception '이월할 미납 금액과 납기를 확인하세요'; end if;
      update public.dues_v2_due set remaining=remaining-amount where id=due.id;
      insert into public.dues_v2_due(charge_id,due_ym,remaining) values(due.charge_id,target,amount);
    end loop;
    for line in select value from jsonb_array_elements(coalesce(p->'money','[]')) loop
      perform public.dues_v2_match_position((line->>'position_id')::uuid,owner,coalesce((p->>'confirm_owner')::boolean,false));
      select * into strict pos from public.dues_v2_positions where id=(line->>'position_id')::uuid;
      amount:=(line->>'amount')::integer;
      if pos.owner_id is distinct from owner or pos.purpose not in ('member_pending','carry')
        or amount is null or amount<=0 or amount>pos.amount then raise exception '이월할 입금 소유자와 잔액을 확인하세요'; end if;
      update public.dues_v2_positions set amount=pos.amount-(line->>'amount')::integer where id=pos.id;
      insert into public.dues_v2_positions(bank_tx_id,owner_id,amount,purpose,available_ym)
        values(pos.bank_tx_id,owner,amount,'carry',target);
    end loop;
  elsif action='position' then
    select * into strict pos from public.dues_v2_positions where id=(p->>'position_id')::uuid;
    amount:=(p->>'amount')::integer; purpose:=p->>'purpose'; owner:=coalesce(pos.owner_id,(p->>'owner_id')::uuid);
    if amount is null or amount<=0 or amount>pos.amount or purpose not in ('member_pending','refund_pending','club','unassigned')
      or (pos.owner_id is not null and p->>'owner_id' is not null and pos.owner_id<>(p->>'owner_id')::uuid)
      then raise exception '변경할 금액·소유자·용도를 확인하세요'; end if;
    update public.dues_v2_positions set amount=pos.amount-(p->>'amount')::integer where id=pos.id;
    insert into public.dues_v2_positions(bank_tx_id,owner_id,amount,purpose,group_id)
      values(pos.bank_tx_id,owner,amount,purpose,case when purpose='club' then (p->>'group_id')::uuid end);
  elsif action='pay' then
    if jsonb_array_length(coalesce(p->'lines','[]'))=0 then raise exception '납부할 내역이 없습니다'; end if;
    for line in select value from jsonb_array_elements(p->'lines') loop
      if p->>'owner_id' is not null then
        perform public.dues_v2_match_position((line->>'position_id')::uuid,(p->>'owner_id')::uuid,coalesce((p->>'confirm_owner')::boolean,false),coalesce((p->>'reassign_owner')::boolean,false));
      end if;
      perform public.dues_v2_allocate((line->>'position_id')::uuid,(line->>'due_id')::uuid,(line->>'amount')::integer,coalesce((p->>'proxy')::boolean,false));
      total:=total+(line->>'amount')::integer;
    end loop;
    result:=jsonb_build_object('paid',total);
  elsif action='reverse_payment' then
    position_id:=public.dues_v2_release((p->>'allocation_id')::uuid,(p->>'amount')::integer);
    result:=jsonb_build_object('position_id',position_id);
  elsif action='refund' then
    owner:=(p->>'owner_id')::uuid;
    if owner is null and not coalesce((p->>'external_refund')::boolean,false) then raise exception '환불받는 납부자를 선택하세요'; end if;
    if owner is not null and coalesce((p->>'external_refund')::boolean,false) then raise exception '등록 납부자와 미등록 환불을 함께 지정할 수 없습니다'; end if;
    select * into strict out_tx from public.bank_transactions where id=(p->>'out_tx_id')::bigint;
    if out_tx.direction<>'out' or exists(select 1 from public.dues_v2_refunds where out_tx_id=out_tx.id)
      or exists(select 1 from public.dues_v2_expenses where bank_tx_id=out_tx.id and group_id is not null)
      then raise exception '이미 처리했거나 환불 출금이 아닌 거래입니다'; end if;
    for line in select value from jsonb_array_elements(p->'lines') loop
      select * into strict pos from public.dues_v2_positions where id=(line->>'position_id')::uuid;
      amount:=(line->>'amount')::integer;
      if pos.purpose='club' or amount is null or amount<=0 or amount>pos.amount
        or (source_id is not null and source_id<>pos.bank_tx_id) then raise exception '한 원입금의 환불 가능한 잔액만 선택하세요'; end if;
      source_id:=pos.bank_tx_id;
      update public.dues_v2_positions set amount=pos.amount-(line->>'amount')::integer where id=pos.id;
      total:=total+amount;
    end loop;
    if source_id is null or total<>out_tx.amount then raise exception '선택한 환불액이 실제 출금액과 다릅니다'; end if;
    -- Include exhausted positions and reversed payments: matching is by sender ID,
    -- never by bank description or by the beneficiary of a proxy payment.
    if exists(select 1 from (
      select owner_id from public.dues_v2_positions where bank_tx_id=source_id
      union all select owner_id from public.dues_v2_allocations where bank_tx_id=source_id
      union all select owner_id from public.dues_v2_refunds where in_tx_id=source_id
    ) owners where owner_id is not null and owner_id is distinct from owner)
      then raise exception '선택한 납부자의 원입금이 아닙니다'; end if;
    if not exists(select 1 from (
      select owner_id from public.dues_v2_positions where bank_tx_id=source_id
      union all select owner_id from public.dues_v2_allocations where bank_tx_id=source_id
      union all select owner_id from public.dues_v2_refunds where in_tx_id=source_id
    ) owners where owner_id is not null) and not coalesce((p->>'confirm_owner')::boolean,false)
      then raise exception '미매칭 원입금의 실제 납부자를 확인해 주세요'; end if;
    -- The ownership decision and refund share the same preview, transaction and undo.
    if owner is not null then
      update public.dues_v2_positions set owner_id=owner,purpose=case when purpose='unassigned' then 'member_pending' else purpose end where bank_tx_id=source_id and owner_id is null;
      update public.dues_v2_refunds set owner_id=owner where in_tx_id=source_id and owner_id is null;
    end if;
    insert into public.dues_v2_refunds(out_tx_id,in_tx_id,owner_id,amount) values(out_tx.id,source_id,owner,total);
    result:=jsonb_build_object('refunded',total,'owner_id',owner);
  elsif action='reverse_refund' then
    delete from public.dues_v2_refunds where out_tx_id=(p->>'out_tx_id')::bigint returning * into refund;
    if not found then raise exception '연결된 환불이 없습니다'; end if;
    insert into public.dues_v2_positions(bank_tx_id,owner_id,amount,purpose)
      values(refund.in_tx_id,refund.owner_id,refund.amount,'refund_pending');
    result:=jsonb_build_object('reserved',refund.amount);
  elsif action='expense' then
    select * into strict out_tx from public.bank_transactions where id=(p->>'out_tx_id')::bigint;
    if out_tx.direction<>'out' or exists(select 1 from public.dues_v2_refunds where out_tx_id=out_tx.id)
      then raise exception '환불을 제외한 출금만 지출로 지정할 수 있습니다'; end if;
    insert into public.dues_v2_expenses(bank_tx_id,group_id) values(out_tx.id,(p->>'group_id')::uuid)
      on conflict(bank_tx_id) do update set group_id=excluded.group_id;
  elsif action='waive' then
    select * into strict old from public.dues_v2_charges where id=(p->>'charge_id')::uuid;
    if old.state<>'live' or exists(select 1 from public.dues_v2_allocations where charge_id=old.id and amount>reversed)
      then raise exception '납부가 있는 부과는 취소 후 발행으로 처리하세요'; end if;
    update public.dues_v2_charges set state='waived' where id=old.id;
    update public.dues_v2_due set remaining=0 where charge_id=old.id;
  elsif action<>'apply' then raise exception '알 수 없는 회계 작업입니다';
  end if;
  if action in ('issue','replace','carry','apply') then applied:=public.dues_v2_apply(); end if;
  perform public.dues_v2_assert();
  after_data:=public.dues_v2_snapshot();
  result:=result||jsonb_build_object('auto_applied',applied,
    'outstanding_before',(select coalesce(sum((x->>'remaining')::bigint),0) from jsonb_array_elements(before_data->'due') x),
    'outstanding_after',(select coalesce(sum(remaining),0) from public.dues_v2_due),
    'member_balance_before',(select coalesce(sum((x->>'amount')::bigint),0) from jsonb_array_elements(before_data->'positions') x where x->>'purpose' in ('member_pending','carry')),
    'member_balance_after',(select coalesce(sum(amount),0) from public.dues_v2_positions where purpose in ('member_pending','carry')),
    'revision',ctl.revision+1);
  insert into public.dues_v2_operations(epoch,request_id,action,payload,actor_id,before_state,after_state,result)
    values(ctl.epoch,p_request,action,p,public.current_member_id(),public.dues_v2_delta(before_data,after_data),public.dues_v2_delta(after_data,before_data),result) returning id into op_id;
  result:=result||jsonb_build_object('operation_id',op_id);
  update public.dues_v2_operations o set result=mutation.result where o.id=op_id;
  update public.dues_v2_control set revision=revision+1 where id=1;
  return result;
end $$;

notify pgrst, 'reload schema';
