-- A proposal approval replaces a waiting court's roster. It does not start a match.
alter table public.match_proposals add column if not exists applied_team_id text;
alter table public.match_proposals drop constraint if exists match_proposals_status_check;
alter table public.match_proposals add constraint match_proposals_status_check
  check (status in ('pending', 'reviewed', 'withdrawn', 'rejected', 'started', 'applied'));

create or replace function public.apply_match_proposal_to_group(
  p_id uuid, p_updated_at timestamptz, p_team_id text, p_base_version bigint,
  p_client_id text, p_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions%rowtype;
  v_proposal public.match_proposals%rowtype;
  v_target jsonb;
  v_court_id int;
  v_drafts jsonb;
  v_version bigint;
begin
  if auth.uid() is null or public.is_admin() is not true or nullif(btrim(p_client_id), '') is null then
    raise exception 'not editor' using errcode = '42501';
  end if;
  -- Same session lock as match assignment: a concurrent start and an approval cannot both win.
  select s.* into v_session from public.sessions s join public.match_proposals p on p.session_id = s.id
    where p.id = p_id for update of s;
  if not found then raise exception 'proposal not found'; end if;
  perform public.board_assert_editor(v_session.id, p_client_id, p_name);
  select * into v_proposal from public.match_proposals where id = p_id for update;
  if v_proposal.status = 'applied' and v_proposal.applied_team_id = p_team_id then
    return jsonb_build_object('proposal', to_jsonb(v_proposal), 'drafts', v_session.board_drafts, 'version', v_session.board_drafts_version);
  end if;
  if not v_session.is_active or v_session.status <> 'active' then raise exception 'session closed'; end if;
  if v_proposal.status not in ('pending', 'reviewed') then raise exception 'proposal already closed'; end if;
  if v_proposal.updated_at is distinct from p_updated_at then raise exception 'proposal changed'; end if;
  if v_session.board_drafts_version is distinct from p_base_version then raise exception 'board changed'; end if;
  select t into v_target from jsonb_array_elements(coalesce(v_session.board_drafts->'teams', '[]'::jsonb)) t
    where t->>'id' = p_team_id;
  v_court_id := (v_target->>'courtId')::int;
  if v_target is null or v_court_id is null or v_court_id not between 1 and v_session.court_count then
    raise exception 'court group not found';
  end if;
  if exists(select 1 from public.matches where session_id = v_session.id and court_id = v_court_id and status = 'playing') then
    raise exception 'court already assigned';
  end if;
  if cardinality(v_proposal.player_ids) not between 1 and 4
    or (select count(*) from public.session_players where session_id = v_session.id and id = any(v_proposal.player_ids)
      and status = 'waiting' and (not v_session.cock_check_enabled or cock_checked)) <> cardinality(v_proposal.player_ids)
    or exists(select 1 from public.matches where session_id = v_session.id and status = 'playing'
      and array[team_a_p1, team_a_p2, team_b_p1, team_b_p2] && v_proposal.player_ids)
  then raise exception 'players not ready'; end if;
  -- Members already in the target are allowed. Other courts' selections remain untouched.
  if exists(select 1 from jsonb_array_elements(v_session.board_drafts->'teams') t,
    jsonb_array_elements_text(coalesce(t->'memberIds', '[]'::jsonb)) m
    where t->>'id' <> p_team_id and m::uuid = any(v_proposal.player_ids))
    or exists(select 1 from jsonb_array_elements(coalesce(v_session.board_drafts->'reservations', '[]'::jsonb)) r
      where r->>'teamId' <> p_team_id and (r->>'playerId')::uuid = any(v_proposal.player_ids))
  then raise exception 'players already grouped'; end if;
  v_target := (v_target - 'slots' - 'confirmedMs' - 'createdBy') || jsonb_build_object(
    'memberIds', to_jsonb(v_proposal.player_ids), 'createdBy', v_proposal.creator_name);
  v_drafts := v_session.board_drafts || jsonb_build_object(
    'teams', (select jsonb_agg(case when t->>'id' = p_team_id then v_target else t end order by n)
      from jsonb_array_elements(v_session.board_drafts->'teams') with ordinality x(t,n)),
    'reservations', (select coalesce(jsonb_agg(r order by n), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_session.board_drafts->'reservations', '[]'::jsonb)) with ordinality x(r,n)
      where r->>'teamId' <> p_team_id));
  update public.sessions set board_drafts = v_drafts, board_drafts_version = board_drafts_version + 1
    where id = v_session.id returning board_drafts_version into v_version;
  update public.match_proposals set status = 'applied', applied_team_id = p_team_id, updated_at = clock_timestamp()
    where id = p_id returning * into v_proposal;
  return jsonb_build_object('proposal', to_jsonb(v_proposal), 'drafts', v_drafts, 'version', v_version);
end;
$$;

revoke all on function public.apply_match_proposal_to_group(uuid, timestamptz, text, bigint, text, text) from public, anon;
grant execute on function public.apply_match_proposal_to_group(uuid, timestamptz, text, bigint, text, text) to authenticated;
