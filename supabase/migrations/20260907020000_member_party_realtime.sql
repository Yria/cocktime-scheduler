-- Reuse session-bc:<id> for committed party changes. The public payload is
-- only an invalidation hint: participant identities/eligibility stay behind RPC auth.
-- A failed realtime transport cannot roll back a valid hold or team creation.
create or replace function public.broadcast_member_party_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_session_id bigint;
  v_now timestamptz := clock_timestamp();
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'member_party_holds' then
      -- Renewing a still-valid lease does not change visible participation.
      -- A revived/explicitly expired lease or changed identity does need a hint.
      if new.round_id is not distinct from old.round_id
        and new.player_id is not distinct from old.player_id
        and new.board_client_id is not distinct from old.board_client_id
        and new.lease_until > v_now and old.lease_until > v_now then
        return null;
      end if;
    elsif new.round_id is not distinct from old.round_id
      and new.ends_at is not distinct from old.ends_at
      and new.last_result is not distinct from old.last_result then
      return null;
    end if;
  end if;
  if tg_op = 'DELETE' then v_session_id := old.session_id;
  else v_session_id := new.session_id;
  end if;
  perform realtime.send('{}'::jsonb, 'member_party_changed', 'session-bc:' || v_session_id::text, false);
  return null;
exception when others then
  raise warning 'broadcast_member_party_change failed for session %: %', v_session_id, sqlerrm;
  return null;
end;
$$;
revoke all on function public.broadcast_member_party_change() from public, anon, authenticated;

drop trigger if exists trg_member_party_rounds_broadcast on public.member_party_rounds;
create trigger trg_member_party_rounds_broadcast
  after insert or update or delete on public.member_party_rounds
  for each row execute function public.broadcast_member_party_change();

drop trigger if exists trg_member_party_holds_broadcast on public.member_party_holds;
create trigger trg_member_party_holds_broadcast
  after insert or update or delete on public.member_party_holds
  for each row execute function public.broadcast_member_party_change();

-- Capability marker: clients using an older database keep their existing polling
-- intervals. The RPC's authentication, row locking, cancellation and grants stay intact.
create or replace function public.member_party_state(p_session_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_state jsonb;
  v_now timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  -- 모든 RPC가 같은 세션 행을 먼저 잠근다. board_save_drafts의 CAS 갱신과도 직렬화한다.
  perform 1 from public.sessions where id = p_session_id for update;
  if not found then raise exception 'session not found'; end if;
  v_state := public._member_party_snapshot(p_session_id);
  v_now := clock_timestamp();
  if v_state->>'roundId' is not null and (
    not (v_state->>'available')::boolean
    or v_now >= (v_state->>'endsAt')::timestamptz + interval '10 seconds'
    or (v_now >= (v_state->>'endsAt')::timestamptz and jsonb_array_length(v_state->'participants') < 4)
  ) then
    perform public._member_party_close(p_session_id, jsonb_build_object(
      'roundId', v_state->>'roundId', 'status', 'cancelled'
    ));
    v_state := public._member_party_snapshot(p_session_id);
  end if;
  return v_state || jsonb_build_object('realtimeEnabled', true);
end;
$$;
