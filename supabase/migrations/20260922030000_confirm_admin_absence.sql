-- Restore an editor's explicit, single-match confirmation for all-admin starts.
-- Ordinary starts, legacy RPCs and roster edits still require an outside admin.
create or replace function public.assert_match_admin_coverage(
  p_session_id bigint, p_player_ids uuid[], p_allow_admin_absence boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'not editor' using errcode = '42501';
  end if;
  if p_allow_admin_absence is not true then
    perform public.assert_match_admin_coverage_for_roster(p_session_id, p_player_ids, null);
  end if;
end;
$$;

create or replace function public.guard_match_admin_coverage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[] := array[new.team_a_p1, new.team_a_p2, new.team_b_p1, new.team_b_p2];
  v_approval jsonb := nullif(current_setting('cocktime.admin_absence_approval', true), '')::jsonb;
begin
  if new.status is distinct from 'playing' then return new; end if;
  if tg_op = 'UPDATE' then
    if old.status = 'playing' and old.session_id = new.session_id
      and array[old.team_a_p1, old.team_a_p2, old.team_b_p1, old.team_b_p2] @> v_ids
      and array[old.team_a_p1, old.team_a_p2, old.team_b_p1, old.team_b_p2] <@ v_ids
    then return new; end if;
  end if;
  -- The guarded RPC sets this only after checking the editor lock and admin role.
  -- Match, session and exact roster must agree; it cannot approve another write.
  if auth.uid() is not null and public.is_admin() is true
    and v_approval->>'matchId' = new.id::text
    and v_approval->>'sessionId' = new.session_id::text
    and v_approval->'playerIds' @> to_jsonb(v_ids)
    and v_approval->'playerIds' <@ to_jsonb(v_ids)
  then return new; end if;
  perform public.assert_match_admin_coverage_for_roster(new.session_id, v_ids, new.id);
  return new;
end;
$$;

create or replace function public.assign_match_with_admin_coverage(
  p_match_id uuid, p_session_id bigint, p_court_id int, p_game_type text,
  p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid,
  p_client_id text, p_name text, p_allow_admin_absence boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[] := array[p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2];
begin
  perform public.board_assert_editor(p_session_id, p_client_id, p_name);
  perform public.assert_match_admin_coverage(p_session_id, v_ids, p_allow_admin_absence);
  perform set_config('cocktime.admin_absence_approval', case when p_allow_admin_absence is true then
    jsonb_build_object('matchId', p_match_id, 'sessionId', p_session_id, 'playerIds', v_ids)::text else '' end, true);
  perform public.assign_match(p_match_id, p_session_id, p_court_id, p_game_type,
    p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2, p_client_id, p_name);
  perform set_config('cocktime.admin_absence_approval', '', true);
end;
$$;

create or replace function public.start_match_proposal_with_admin_coverage(
  p_id uuid, p_updated_at timestamptz, p_match_id uuid, p_court_id int, p_game_type text,
  p_team_a uuid[], p_team_b uuid[], p_client_id text, p_name text,
  p_allow_admin_absence boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session_id bigint; v_proposal public.match_proposals%rowtype; v_result jsonb;
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'not editor' using errcode = '42501';
  end if;
  select session_id into v_session_id from public.match_proposals where id = p_id;
  perform public.board_assert_editor(v_session_id, p_client_id, p_name);
  select * into v_proposal from public.match_proposals where id = p_id for update;
  if v_proposal.status = 'started' then return to_jsonb(v_proposal); end if;
  perform public.assert_match_admin_coverage(v_session_id, p_team_a || p_team_b, p_allow_admin_absence);
  perform set_config('cocktime.admin_absence_approval', case when p_allow_admin_absence is true then
    jsonb_build_object('matchId', p_match_id, 'sessionId', v_session_id, 'playerIds', p_team_a || p_team_b)::text else '' end, true);
  v_result := public.start_match_proposal(p_id, p_updated_at, p_match_id, p_court_id, p_game_type,
    p_team_a, p_team_b, p_client_id, p_name);
  perform set_config('cocktime.admin_absence_approval', '', true);
  return v_result;
end;
$$;

revoke all on function public.assert_match_admin_coverage(bigint, uuid[], boolean) from public, anon, authenticated;
revoke all on function public.guard_match_admin_coverage() from public, anon, authenticated;
revoke all on function public.assign_match_with_admin_coverage(uuid, bigint, int, text, uuid, uuid, uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.start_match_proposal_with_admin_coverage(uuid, timestamptz, uuid, int, text, uuid[], uuid[], text, text, boolean) from public, anon;
grant execute on function public.assign_match_with_admin_coverage(uuid, bigint, int, text, uuid, uuid, uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.start_match_proposal_with_admin_coverage(uuid, timestamptz, uuid, int, text, uuid[], uuid[], text, text, boolean) to authenticated;
