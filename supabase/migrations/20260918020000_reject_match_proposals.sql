-- Rejection is terminal and remains visible to SELECT RLS so Realtime can notify
-- both the author and administrators to remove the private card.
alter table public.match_proposals drop constraint if exists match_proposals_status_check;
alter table public.match_proposals add constraint match_proposals_status_check
  check (status in ('pending', 'reviewed', 'withdrawn', 'rejected'));

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
  -- Retrying a lost response is harmless; late actions cannot revive a closed proposal.
  if v_row.status = p_status then return; end if;
  if v_row.status in ('withdrawn', 'rejected') then
    raise exception 'proposal already closed' using errcode = '42501';
  end if;
  update public.match_proposals set status = p_status, updated_at = now() where id = p_id;
end;
$$;

revoke all on function public.resolve_match_proposal(uuid, text) from public, anon;
grant execute on function public.resolve_match_proposal(uuid, text) to authenticated;
