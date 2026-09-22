-- Administrators can propose available players even when they are not playing in the session.
-- Proposals remain private; this grants no shared-board editing or match-start authority.
create or replace function public.create_match_proposal(p_session_id bigint, p_id uuid, p_player_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_creator_name text;
  v_names text[];
  v_row public.match_proposals%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform 1 from public.sessions where id = p_session_id and is_active and status = 'active' for update;
  if not found then raise exception 'session closed'; end if;
  select m.name into v_creator_name from public.members m
  where m.auth_user_id = auth.uid() and m.is_active
    and (public.is_admin() or exists (
      select 1 from public.session_players sp where sp.member_id = m.id and sp.session_id = p_session_id
    )) limit 1;
  if v_creator_name is null then raise exception 'not participant' using errcode = '42501'; end if;
  if p_id is null or p_player_ids is null or cardinality(p_player_ids) not between 1 and 4
    or array_ndims(p_player_ids) <> 1
    or array_position(p_player_ids, null) is not null
    or (select count(distinct x) from unnest(p_player_ids) x) <> cardinality(p_player_ids)
  then raise exception 'select one to four distinct players'; end if;

  select * into v_row from public.match_proposals where id = p_id;
  if found then
    if v_row.created_by = auth.uid() and v_row.session_id = p_session_id
      and v_row.player_ids = p_player_ids and v_row.status <> 'withdrawn' then return to_jsonb(v_row); end if;
    raise exception 'proposal already exists';
  end if;

  select array_agg(sp.name order by p.ordinality) into v_names
  from unnest(p_player_ids) with ordinality p(id, ordinality)
  join public.session_players sp on sp.id = p.id and sp.session_id = p_session_id;
  if coalesce(cardinality(v_names), 0) <> cardinality(p_player_ids) then raise exception 'player left session'; end if;
  insert into public.match_proposals(id, session_id, created_by, creator_name, player_ids, player_names)
  values(p_id, p_session_id, auth.uid(), v_creator_name, p_player_ids, v_names)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.create_match_proposal(bigint, uuid, uuid[]) from public, anon;
grant execute on function public.create_match_proposal(bigint, uuid, uuid[]) to authenticated;
