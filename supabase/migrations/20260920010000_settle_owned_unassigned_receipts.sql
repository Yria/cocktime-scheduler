-- A receipt can retain its confirmed owner when its remaining money is moved
-- from club income back to unassigned. Matching the same owner must make the
-- selected balance payable again. Install changes no ledger rows; conversion
-- happens only inside an explicitly confirmed, atomic pay/carry command.
create or replace function public.dues_match_position(p_position uuid,p_owner uuid,p_confirm boolean) returns void
language plpgsql security definer set search_path='' as $$
declare pos public.dues_positions;
begin
  select * into strict pos from public.dues_positions where id=p_position;
  if p_owner is null then raise exception '납부자를 선택하세요'; end if;
  if pos.owner_id is not null then
    if pos.owner_id<>p_owner then raise exception '입금의 납부자를 바꿀 수 없습니다'; end if;
    if pos.purpose='unassigned' then
      update public.dues_positions set purpose='member_pending' where id=pos.id;
    end if;
    return;
  end if;
  if pos.purpose<>'unassigned' or not coalesce(p_confirm,false) then
    raise exception '미매칭 입금의 납부자를 먼저 선택하세요';
  end if;
  if exists(select 1 from (
    select owner_id from public.dues_positions where bank_tx_id=pos.bank_tx_id
    union all select owner_id from public.dues_allocations where bank_tx_id=pos.bank_tx_id
    union all select owner_id from public.dues_refunds where in_tx_id=pos.bank_tx_id
  ) owners where owner_id is not null and owner_id<>p_owner) then
    raise exception '이미 다른 납부자로 확인된 입금입니다';
  end if;
  update public.dues_positions set owner_id=p_owner,
    purpose=case when purpose='unassigned' then 'member_pending' else purpose end
    where bank_tx_id=pos.bank_tx_id and owner_id is null;
  update public.dues_refunds set owner_id=p_owner where in_tx_id=pos.bank_tx_id and owner_id is null;
end $$;
revoke all on function public.dues_match_position(uuid,uuid,boolean) from public,anon,authenticated;

notify pgrst, 'reload schema';
