-- At least one present administrator must remain outside the courts.
-- Serialize every match entry/roster change on the session, including legacy RPCs.
create or replace function public.assert_match_admin_coverage_for_roster(
  p_session_id bigint, p_player_ids uuid[], p_replacing_match_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare v_outside uuid[];
begin
  perform 1 from public.sessions where id = p_session_id for update;
  select coalesce(array_agg(distinct sp.id), '{}'::uuid[]) into v_outside
    from public.session_players sp
    join public.sessions s on s.id = sp.session_id
    join public.members m on m.id = sp.member_id and m.is_active
    join public.user_roles r on r.member_id = m.id and r.role = 'admin'
    where sp.session_id = p_session_id
      and (not s.cock_check_enabled or sp.cock_checked or sp.id = any(p_player_ids) or exists(
        select 1 from public.matches g where g.id = p_replacing_match_id and g.status = 'playing'
          and g.session_id = p_session_id
          and sp.id = any(array[g.team_a_p1, g.team_a_p2, g.team_b_p1, g.team_b_p2])))
      and not exists(select 1 from public.matches g
        where g.session_id = p_session_id and g.status = 'playing'
          and g.id is distinct from p_replacing_match_id
          and sp.id = any(array[g.team_a_p1, g.team_a_p2, g.team_b_p1, g.team_b_p2]));
  -- Existing absence cannot be repaired by holding ordinary members. Prevent the
  -- transition that sends the remaining staff onto a court; never end a live match.
  if cardinality(v_outside) > 0 and v_outside <@ p_player_ids then
    raise exception 'admin coverage required' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.assert_match_admin_coverage_for_roster(bigint, uuid[], uuid) from public, anon, authenticated;

-- Retain the old RPC signature for cached clients, but never honor its override.
create or replace function public.assert_match_admin_coverage(
  p_session_id bigint, p_player_ids uuid[], p_allow_admin_absence boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'not editor' using errcode = '42501';
  end if;
  perform public.assert_match_admin_coverage_for_roster(p_session_id, p_player_ids, null);
end;
$$;
revoke all on function public.assert_match_admin_coverage(bigint, uuid[], boolean) from public, anon, authenticated;

create or replace function public.guard_match_admin_coverage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[] := array[new.team_a_p1, new.team_a_p2, new.team_b_p1, new.team_b_p2];
begin
  if new.status is distinct from 'playing' then return new; end if;
  if tg_op = 'UPDATE' then
    -- Moving the same four players between sides creates no additional absence.
    if old.status = 'playing' and old.session_id = new.session_id
      and array[old.team_a_p1, old.team_a_p2, old.team_b_p1, old.team_b_p2] @> v_ids
      and array[old.team_a_p1, old.team_a_p2, old.team_b_p1, old.team_b_p2] <@ v_ids
    then return new; end if;
  end if;
  perform public.assert_match_admin_coverage_for_roster(new.session_id, v_ids, new.id);
  return new;
end;
$$;
revoke all on function public.guard_match_admin_coverage() from public, anon, authenticated;

drop trigger if exists require_admin_match_coverage on public.matches;
create trigger require_admin_match_coverage
before insert or update of session_id, status, team_a_p1, team_a_p2, team_b_p1, team_b_p2
on public.matches for each row execute function public.guard_match_admin_coverage();
