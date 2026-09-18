-- Coverage is checked inside the same session-row lock as match assignment.
-- Existing match RPCs remain compatible; the new client uses these guarded entry points.
create or replace function public.assert_match_admin_coverage(
  p_session_id bigint, p_player_ids uuid[], p_allow_admin_absence boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare v_outside uuid[];
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'not editor' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct sp.id), '{}'::uuid[]) into v_outside
    from public.session_players sp
    join public.sessions s on s.id = sp.session_id
    join public.members m on m.id = sp.member_id and m.is_active
    join public.user_roles r on r.member_id = m.id and r.role = 'admin'
    where sp.session_id = p_session_id and (not s.cock_check_enabled or sp.cock_checked)
      and not exists(select 1 from public.matches g where g.session_id = p_session_id and g.status = 'playing'
        and sp.id = any(array[g.team_a_p1, g.team_a_p2, g.team_b_p1, g.team_b_p2]));
  -- If nobody is outside already, ordinary members cannot restore coverage by waiting.
  if cardinality(v_outside) > 0 and v_outside <@ p_player_ids and p_allow_admin_absence is not true then
    raise exception 'admin coverage required' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.assert_match_admin_coverage(bigint, uuid[], boolean) from public, anon, authenticated;

create or replace function public.assign_match_with_admin_coverage(
  p_match_id uuid, p_session_id bigint, p_court_id int, p_game_type text,
  p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid,
  p_client_id text, p_name text, p_allow_admin_absence boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.board_assert_editor(p_session_id, p_client_id, p_name);
  perform public.assert_match_admin_coverage(p_session_id,
    array[p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2], p_allow_admin_absence);
  perform public.assign_match(p_match_id, p_session_id, p_court_id, p_game_type,
    p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2, p_client_id, p_name);
end;
$$;

create or replace function public.start_match_proposal_with_admin_coverage(
  p_id uuid, p_updated_at timestamptz, p_match_id uuid, p_court_id int, p_game_type text,
  p_team_a uuid[], p_team_b uuid[], p_client_id text, p_name text,
  p_allow_admin_absence boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session_id bigint; v_proposal public.match_proposals%rowtype;
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'not editor' using errcode = '42501';
  end if;
  select session_id into v_session_id from public.match_proposals where id = p_id;
  perform public.board_assert_editor(v_session_id, p_client_id, p_name);
  select * into v_proposal from public.match_proposals where id = p_id for update;
  -- Preserve the original lost-response retry behavior.
  if v_proposal.status = 'started' then return to_jsonb(v_proposal); end if;
  perform public.assert_match_admin_coverage(v_session_id, p_team_a || p_team_b, p_allow_admin_absence);
  return public.start_match_proposal(p_id, p_updated_at, p_match_id, p_court_id, p_game_type,
    p_team_a, p_team_b, p_client_id, p_name);
end;
$$;

revoke all on function public.assign_match_with_admin_coverage(uuid, bigint, int, text, uuid, uuid, uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.start_match_proposal_with_admin_coverage(uuid, timestamptz, uuid, int, text, uuid[], uuid[], text, text, boolean) from public, anon;
grant execute on function public.assign_match_with_admin_coverage(uuid, bigint, int, text, uuid, uuid, uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.start_match_proposal_with_admin_coverage(uuid, timestamptz, uuid, int, text, uuid[], uuid[], text, text, boolean) to authenticated;
