-- 게스트 신청 가드 — 본인이 참석(확정/대기) 중일 때만 게스트를 데려올 수 있다.
--
-- 배경: add_guest_attendance 는 로그인한 회원이면 누구나 open 세션에 게스트를 추가할 수 있었다.
-- 본인은 참석하지 않으면서 게스트만 신청하는 경로가 열려 있었다(클라 버튼은 가렸지만 RPC는 무방비).
-- 요청: "게스트 신청은 참여해야만 가능". 클라(GuestSection)는 참석 중일 때만 버튼 노출,
-- 서버는 여기 inviter 참석 가드로 강제(우회 차단).
--
-- 본문은 최신본(20260624030000)을 그대로 두고 종료 가드 직후에 참석 가드만 추가.

create or replace function public.add_guest_attendance(
	p_session_id bigint, p_name text, p_gender text, p_skills jsonb
) returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_inviter      uuid := public.current_member_id();
	v_guest        uuid;
	v_capacity     int;
	v_status       text;
	v_scheduled_at timestamptz;
	v_ends_at      timestamptz;
	v_count        int;
	v_new          text;
	v_pos          bigint;
	v_result       public.attendances%rowtype;
begin
	if v_inviter is null then raise exception 'not authenticated'; end if;
	if p_name is null or btrim(p_name) = '' then raise exception 'guest name required'; end if;
	if p_gender not in ('M','F') then raise exception 'guest gender required'; end if;

	select capacity, status, scheduled_at, ends_at
		into v_capacity, v_status, v_scheduled_at, v_ends_at
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;
	if v_scheduled_at is not null and v_scheduled_at > now() + interval '7 days' then
		raise exception 'session not open yet';
	end if;
	-- 종료 시각 상한 가드 — 종료된 일정엔 게스트 신청 불가.
	if v_ends_at is not null and v_ends_at <= now() then
		raise exception 'session ended';
	end if;
	-- 참석 가드 — 본인이 확정/대기로 참석 중이어야 게스트 신청 가능.
	if not exists (
		select 1 from public.attendances
		where session_id = p_session_id
			and member_id = v_inviter
			and status in ('confirmed','waitlisted')
	) then
		raise exception 'must join first';
	end if;

	-- 게스트 member 생성(계정 없음). 회원관리/선수명단은 is_guest로 필터해 노출하지 않는다.
	insert into public.members(name, gender, skills, is_guest)
	values (btrim(p_name), p_gender, coalesce(p_skills, '{}'::jsonb), true)
	returning id into v_guest;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	if v_capacity is null or v_count < v_capacity then
		v_new := 'confirmed';
		update public.session_counters set confirmed_count = confirmed_count + 1
			where session_id = p_session_id;
	else
		v_new := 'waitlisted';
	end if;

	v_pos := nextval('public.attendance_position_seq');

	insert into public.attendances(session_id, member_id, status, position, confirmed_at, invited_by)
	values (p_session_id, v_guest, v_new, v_pos,
		case when v_new = 'confirmed' then now() else null end, v_inviter)
	returning * into v_result;

	return v_result;
end;
$$;

revoke execute on function public.add_guest_attendance(bigint, text, text, jsonb) from anon;
grant execute on function public.add_guest_attendance(bigint, text, text, jsonb) to authenticated;
