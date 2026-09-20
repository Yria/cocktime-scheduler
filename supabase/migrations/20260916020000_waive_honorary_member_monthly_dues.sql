-- Honorary designation includes already-issued, fully unpaid monthly dues.
-- Use the ledger's existing waiver operation so charges and audit history remain,
-- without applying balances to unrelated debt or reversing any paid amount.
create or replace function public.dues_waive_honorary_monthly(p_member uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare c record; cleared integer:=0;
begin
  perform 1 from public.dues_control where id=1 for update;
  for c in
    select dc.id,dc.member_id from public.dues_charges dc
    join public.dues_groups g on g.id=dc.group_id
    join public.members m on m.id=dc.member_id
    where m.is_honorary and (p_member is null or m.id=p_member)
      and g.kind='monthly' and dc.state='live'
      and not exists(select 1 from public.dues_allocations a where a.charge_id=dc.id and a.amount>a.reversed)
    order by dc.id
  loop
    perform public.dues_execute(
      jsonb_build_object('action','waive','charge_id',c.id,'member_id',c.member_id,
        'reason','명예회원 지정으로 미납 회비 면제','source','honorary_membership'),
      gen_random_uuid(),(select revision from public.dues_control where id=1));
    cleared:=cleared+1;
  end loop;
  return cleared;
end $$;
revoke all on function public.dues_waive_honorary_monthly(uuid) from public,anon,authenticated;

create or replace function public.dues_set_honorary(p_member_id uuid,p_honorary boolean,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cleared integer:=0;
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  perform 1 from public.dues_control where id=1 for update;
  update public.members set is_honorary=coalesce(p_honorary,false),updated_at=now() where id=p_member_id;
  if not found then raise exception '회원이 없습니다'; end if;
  if p_honorary then
    insert into public.member_honorary(member_id,reason) values(p_member_id,p_reason)
      on conflict(member_id) do update set reason=excluded.reason,updated_at=now();
    cleared:=public.dues_waive_honorary_monthly(p_member_id);
  else delete from public.member_honorary where member_id=p_member_id; end if;
  -- Waivers already advance the revision. Invalidate membership-only changes too.
  if cleared=0 then update public.dues_control set revision=revision+1 where id=1; end if;
  return jsonb_build_object('ok',true,'honorary',coalesce(p_honorary,false),'cleared_unpaid',cleared);
end $$;
revoke all on function public.dues_set_honorary(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.dues_set_honorary(uuid,boolean,text) to authenticated;

-- Repair the same omission for members designated before this change.
select public.dues_waive_honorary_monthly(null);
