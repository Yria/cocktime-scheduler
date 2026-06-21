-- Phase 7: 카풀 — 의향 표시 + 운영진 집결 공지
-- 컬럼은 기존(attendances.carpool_role, sessions.carpool_muster_place_id/at). RPC만 추가.

-- ① 본인 카풀 의향 설정 (참석자만)
create or replace function public.set_carpool_role(p_session_id bigint, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_member uuid := public.current_member_id();
begin
	if v_member is null then raise exception 'not authenticated'; end if;
	if p_role not in ('none', 'can_drive', 'need_ride') then
		raise exception 'invalid role';
	end if;
	update public.attendances
	set carpool_role = p_role, updated_at = now()
	where session_id = p_session_id and member_id = v_member and status <> 'cancelled';
	if not found then raise exception 'not attending'; end if;
end;
$$;

-- ② 운영진 집결 공지: 집결지/시각 설정 + confirmed 참석자에게 알림
create or replace function public.announce_carpool_muster(
	p_session_id bigint,
	p_place_id bigint,
	p_at timestamptz
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	update public.sessions
	set carpool_muster_place_id = p_place_id, carpool_muster_at = p_at
	where id = p_session_id;
	if not found then raise exception 'session not found'; end if;

	insert into public.notifications(recipient_member_id, type, session_id, payload)
	select a.member_id, 'carpool_muster', p_session_id,
		jsonb_build_object('place_id', p_place_id, 'at', p_at)
	from public.attendances a
	where a.session_id = p_session_id and a.status = 'confirmed';
end;
$$;

revoke execute on function public.set_carpool_role(bigint, text) from anon;
revoke execute on function public.announce_carpool_muster(bigint, bigint, timestamptz) from anon;
grant execute on function public.set_carpool_role(bigint, text) to authenticated;
grant execute on function public.announce_carpool_muster(bigint, bigint, timestamptz) to authenticated;
