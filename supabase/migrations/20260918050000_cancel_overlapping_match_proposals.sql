-- A started match wins over every pending proposal containing any of its players.
-- Reuse the existing terminal status so old clients also remove the cancelled cards.
create or replace function public.cancel_match_proposals_for_playing_match()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'playing' then return new; end if;
  if tg_op = 'UPDATE' then
    if old.status = new.status and old.session_id = new.session_id
      and array[old.team_a_p1, old.team_a_p2, old.team_b_p1, old.team_b_p2]
        = array[new.team_a_p1, new.team_a_p2, new.team_b_p1, new.team_b_p2]
    then return new; end if;
  end if;
  -- Same lock order as create/edit/start RPCs: session first, then proposals.
  perform 1 from public.sessions where id = new.session_id for update;
  update public.match_proposals
    set status = 'rejected', updated_at = clock_timestamp()
    where session_id = new.session_id and status in ('pending', 'reviewed')
      and player_ids && array[new.team_a_p1, new.team_a_p2, new.team_b_p1, new.team_b_p2];
  -- start_match_proposal marks its own source as 'started' after assign_match returns,
  -- in this same transaction. Every other overlapping proposal stays cancelled.
  return new;
end;
$$;

drop trigger if exists trg_match_cancel_overlapping_proposals on public.matches;
create trigger trg_match_cancel_overlapping_proposals
  after insert or update of status, session_id, team_a_p1, team_a_p2, team_b_p1, team_b_p2 on public.matches
  for each row execute function public.cancel_match_proposals_for_playing_match();

-- A create/edit request racing with a match start must not leave a fresh pending card.
create or replace function public.cancel_match_proposal_with_playing_members()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status not in ('pending', 'reviewed') then return new; end if;
  perform 1 from public.sessions where id = new.session_id for update;
  if exists(select 1 from public.matches where session_id = new.session_id and status = 'playing'
    and array[team_a_p1, team_a_p2, team_b_p1, team_b_p2] && new.player_ids) then
    new.status := 'rejected';
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proposal_cancel_playing_members on public.match_proposals;
-- Status-only review/dismiss calls do not need a new session lock: match start waits
-- for their proposal row and then cancels it. Avoid reversing that lock order here.
create trigger trg_proposal_cancel_playing_members
  before insert or update of session_id, player_ids on public.match_proposals
  for each row execute function public.cancel_match_proposal_with_playing_members();

revoke all on function public.cancel_match_proposals_for_playing_match() from public, anon, authenticated;
revoke all on function public.cancel_match_proposal_with_playing_members() from public, anon, authenticated;

-- Also remove already-stale proposals when this migration is applied.
update public.match_proposals p set status = 'rejected', updated_at = clock_timestamp()
  where p.status in ('pending', 'reviewed') and exists(
    select 1 from public.matches m where m.session_id = p.session_id and m.status = 'playing'
      and array[m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2] && p.player_ids
  );
