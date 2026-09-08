-- Match the schedule's meal roster: confirmed/late_pool attendees who did not opt out.
-- meal_joining defaults to true even on sessions where meal attendance was never collected.
-- Such sessions must not be used as a meal preset. Existing charges are never modified.
create or replace function public.dues_v2_reference_members(p_session_id bigint,p_meal boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  if p_meal and not exists(
    select 1 from public.sessions where id=p_session_id and is_regular and meal_enabled
  ) then raise exception '이 회차는 회식 참석을 기록하지 않았습니다'; end if;
  return (select coalesce(jsonb_agg(member_id order by member_id),'[]') from (
    select a.member_id from public.attendances a
      where a.session_id=p_session_id and a.status in ('confirmed','late_pool')
        and (not coalesce(p_meal,false) or a.meal_joining is true)
    union select sp.member_id from public.session_players sp
      where sp.session_id=p_session_id and sp.member_id is not null and not coalesce(p_meal,false)
  ) roster);
end $$;
revoke all on function public.dues_v2_reference_members(bigint,boolean) from public,anon;
grant execute on function public.dues_v2_reference_members(bigint,boolean) to authenticated;
notify pgrst, 'reload schema';
