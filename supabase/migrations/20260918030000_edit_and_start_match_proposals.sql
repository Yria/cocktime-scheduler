-- Keep proposal editing private until the match is actually started.
alter table public.match_proposals add column if not exists match_id uuid;
alter table public.match_proposals drop constraint if exists match_proposals_status_check;
alter table public.match_proposals add constraint match_proposals_status_check
  check (status in ('pending', 'reviewed', 'withdrawn', 'rejected', 'started'));

create or replace function public.edit_match_proposals(p_updates jsonb, p_client_id text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session_id bigint;
  v_ids uuid[];
  v_names text[];
  v_change jsonb;
  v_row public.match_proposals%rowtype;
  v_result jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or public.is_admin() is not true or nullif(btrim(p_client_id), '') is null then
    raise exception 'not editor' using errcode = '42501';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then raise exception 'invalid updates'; end if;
  if jsonb_array_length(p_updates) not between 1 and 2
    or (select count(distinct x->>'id') from jsonb_array_elements(p_updates) x) <> jsonb_array_length(p_updates)
  then raise exception 'invalid updates'; end if;
  select session_id into v_session_id from public.match_proposals where id = (p_updates->0->>'id')::uuid;
  perform 1 from public.sessions where id = v_session_id and is_active and status = 'active' for update;
  if not found then raise exception 'session closed'; end if;
  perform public.board_assert_editor(v_session_id, p_client_id, p_name);
  -- A transfer/swap between two private groups succeeds or fails as one transaction.
  for v_change in select value from jsonb_array_elements(p_updates) order by value->>'id' loop
    select * into v_row from public.match_proposals
      where id = (v_change->>'id')::uuid and session_id = v_session_id for update;
    if not found then raise exception 'proposal not found'; end if;
    if v_row.status not in ('pending', 'reviewed') then raise exception 'proposal already closed'; end if;
    if v_row.updated_at is distinct from (v_change->>'updated_at')::timestamptz then raise exception 'proposal changed'; end if;
    if v_change->'player_ids' is null or jsonb_typeof(v_change->'player_ids') <> 'array' then raise exception 'invalid players'; end if;
    select coalesce(array_agg(value::uuid order by ordinality), '{}'::uuid[]) into v_ids
      from jsonb_array_elements_text(v_change->'player_ids') with ordinality;
    if cardinality(v_ids) > 4 or array_position(v_ids, null) is not null
      or (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids)
    then raise exception 'select up to four distinct players'; end if;
    if cardinality(v_ids) = 0 then
      update public.match_proposals set status = 'rejected', updated_at = clock_timestamp()
        where id = v_row.id returning * into v_row;
    else
      select array_agg(sp.name order by p.ordinality) into v_names
        from unnest(v_ids) with ordinality p(id, ordinality)
        join public.session_players sp on sp.id = p.id and sp.session_id = v_session_id;
      if coalesce(cardinality(v_names), 0) <> cardinality(v_ids) then raise exception 'player left session'; end if;
      update public.match_proposals set player_ids = v_ids, player_names = v_names,
        status = 'pending', updated_at = clock_timestamp() where id = v_row.id returning * into v_row;
    end if;
    v_result := v_result || jsonb_build_array(to_jsonb(v_row));
  end loop;
  return v_result;
end;
$$;

create or replace function public.start_match_proposal(
  p_id uuid, p_updated_at timestamptz, p_match_id uuid, p_court_id int, p_game_type text,
  p_team_a uuid[], p_team_b uuid[], p_client_id text, p_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions%rowtype;
  v_row public.match_proposals%rowtype;
  v_ids uuid[];
begin
  if auth.uid() is null or public.is_admin() is not true or nullif(btrim(p_client_id), '') is null then
    raise exception 'not editor' using errcode = '42501';
  end if;
  select s.* into v_session from public.sessions s join public.match_proposals p on p.session_id = s.id
    where p.id = p_id for update of s;
  if not found then raise exception 'proposal not found'; end if;
  select * into v_row from public.match_proposals where id = p_id for update;
  -- A retry after a lost response must never create a second match.
  if v_row.status = 'started' then return to_jsonb(v_row); end if;
  if not v_session.is_active or v_session.status <> 'active' then raise exception 'session closed'; end if;
  if v_row.status not in ('pending', 'reviewed') then raise exception 'proposal already closed'; end if;
  if v_row.updated_at is distinct from p_updated_at then raise exception 'proposal changed'; end if;
  if p_match_id is null or p_court_id is null or p_court_id not between 1 and v_session.court_count
    or p_game_type is null or p_game_type not in ('남복', '여복', '혼복', '혼합') then raise exception 'invalid match'; end if;
  if p_team_a is null or p_team_b is null or cardinality(p_team_a) <> 2 or cardinality(p_team_b) <> 2
    or array_ndims(p_team_a) <> 1 or array_ndims(p_team_b) <> 1
    or array_lower(p_team_a, 1) <> 1 or array_lower(p_team_b, 1) <> 1 then raise exception 'four players required'; end if;
  v_ids := p_team_a || p_team_b;
  if cardinality(v_row.player_ids) <> 4 or array_position(v_ids, null) is not null
    or (select count(distinct x) from unnest(v_ids) x) <> 4
    or not (v_ids @> v_row.player_ids and v_ids <@ v_row.player_ids) then raise exception 'proposal roster changed'; end if;
  if (select count(*) from public.session_players where session_id = v_session.id and id = any(v_ids)
    and status = 'waiting' and (not v_session.cock_check_enabled or cock_checked)) <> 4
  then raise exception 'players not ready'; end if;
  if exists(select 1 from public.matches where session_id = v_session.id and status = 'playing'
    and array[team_a_p1, team_a_p2, team_b_p1, team_b_p2] && v_ids)
  then raise exception 'players already playing'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(v_session.board_drafts->'teams', '[]'::jsonb)) t,
    jsonb_array_elements_text(coalesce(t->'memberIds', '[]'::jsonb)) m where m::uuid = any(v_ids))
    or exists(select 1 from jsonb_array_elements(coalesce(v_session.board_drafts->'reservations', '[]'::jsonb)) r
      where (r->>'playerId')::uuid = any(v_ids)) then raise exception 'players already grouped'; end if;
  perform public.assign_match(p_match_id, v_session.id, p_court_id, p_game_type,
    p_team_a[1], p_team_a[2], p_team_b[1], p_team_b[2], p_client_id, p_name);
  update public.match_proposals set status = 'started', match_id = p_match_id, updated_at = clock_timestamp()
    where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- Existing dismiss/review calls may not resurrect a group that already started.
create or replace function public.resolve_match_proposal(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.match_proposals%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_row from public.match_proposals
    where id = p_id and (created_by = auth.uid() or public.is_admin()) for update;
  if not found then raise exception 'proposal not found' using errcode = '42501'; end if;
  if not ((p_status = 'withdrawn' and v_row.created_by = auth.uid())
    or (p_status in ('reviewed', 'rejected') and public.is_admin())) or p_status is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_row.status = p_status then return; end if;
  if v_row.status not in ('pending', 'reviewed') then raise exception 'proposal already closed' using errcode = '42501'; end if;
  update public.match_proposals set status = p_status, updated_at = clock_timestamp() where id = p_id;
end;
$$;

revoke all on function public.edit_match_proposals(jsonb, text, text) from public, anon;
revoke all on function public.start_match_proposal(uuid, timestamptz, uuid, int, text, uuid[], uuid[], text, text) from public, anon;
grant execute on function public.edit_match_proposals(jsonb, text, text) to authenticated;
grant execute on function public.start_match_proposal(uuid, timestamptz, uuid, int, text, uuid[], uuid[], text, text) to authenticated;
