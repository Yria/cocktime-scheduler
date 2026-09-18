-- Proposals are private messages on the board, never shared board_drafts or reservations.
create table if not exists public.match_proposals (
  id uuid primary key,
  session_id bigint not null references public.sessions(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  creator_name text not null,
  player_ids uuid[] not null check (cardinality(player_ids) between 1 and 4),
  player_names text[] not null,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists match_proposals_session_created_idx
  on public.match_proposals(session_id, created_at desc);

alter table public.match_proposals enable row level security;
revoke all on public.match_proposals from public, anon, authenticated;
grant select on public.match_proposals to authenticated;
drop policy if exists match_proposals_private_read on public.match_proposals;
create policy match_proposals_private_read on public.match_proposals
  for select to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));

create or replace function public.create_match_proposal(p_session_id bigint, p_id uuid, p_player_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_creator_name text;
  v_names text[];
  v_row public.match_proposals%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  -- Serialize retries with session closure and other submissions. No shared board state is changed.
  perform 1 from public.sessions where id = p_session_id and is_active and status = 'active' for update;
  if not found then raise exception 'session closed'; end if;
  select m.name into v_creator_name
  from public.members m join public.session_players sp on sp.member_id = m.id
  where m.auth_user_id = auth.uid() and m.is_active and sp.session_id = p_session_id limit 1;
  if v_creator_name is null then raise exception 'not participant' using errcode = '42501'; end if;
  if p_id is null or p_player_ids is null or cardinality(p_player_ids) not between 1 and 4
    or array_ndims(p_player_ids) <> 1
    or array_position(p_player_ids, null) is not null
    or (select count(distinct x) from unnest(p_player_ids) x) <> cardinality(p_player_ids)
  then raise exception 'select one to four distinct players'; end if;

  select * into v_row from public.match_proposals where id = p_id;
  if found then
    -- Retrying after a lost response must not send a duplicate or disclose another author's row.
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

create or replace function public.resolve_match_proposal(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.match_proposals%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_row from public.match_proposals
    where id = p_id and (created_by = auth.uid() or public.is_admin()) for update;
  if not found then raise exception 'proposal not found' using errcode = '42501'; end if;
  if (p_status = 'withdrawn' and v_row.created_by = auth.uid())
    or (p_status = 'reviewed' and public.is_admin() and v_row.status <> 'withdrawn') then
    update public.match_proposals set status = p_status, updated_at = now() where id = p_id;
  else raise exception 'forbidden' using errcode = '42501'; end if;
end;
$$;

revoke all on function public.create_match_proposal(bigint, uuid, uuid[]) from public, anon;
revoke all on function public.resolve_match_proposal(uuid, text) from public, anon;
grant execute on function public.create_match_proposal(bigint, uuid, uuid[]) to authenticated;
grant execute on function public.resolve_match_proposal(uuid, text) to authenticated;

-- Postgres Changes uses SELECT RLS per subscriber. Never broadcast proposal payloads on session-bc.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'match_proposals') then
    alter publication supabase_realtime add table public.match_proposals;
  end if;
end $$;
