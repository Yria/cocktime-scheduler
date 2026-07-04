-- 참여 가능 판정 단순화: 노출 시간 가드(+7d) 제거 → "status='open' 인가"로 단일화.
--
-- 배경: 노출 시점이 "일요일 18:00 일괄 공개"(20260703010000)로 바뀌면서, 시간 가드와
-- status 가 서로 다른 기준을 갖는 이중 구조가 전환기 회귀(20260703020000 롤백)까지 낳았다.
-- open 은 오직 sync E단계(공개 창 안에서만)가 만들므로, 공개 창 밖 open 은 운영진의
-- 의도적 조작(개별 오버라이드)뿐 — 그 경우 참여를 막을 이유가 없다.
-- → status 를 노출·참여의 단일 진실원천으로 두고 시간 재검증을 없앤다.
--
-- 유지: 종료 가드(ends_at <= now() → 'session ended'). 이는 "열렸니"가 아니라 "끝났니"로,
-- 종료 시각에 status 가 실시간으로 closed 로 바뀌지 않아(sync A단계는 일 단위 정리)
-- 시간 가드 없이는 종료된 당일 일정에 참석이 통과된다. 클라 "이미 종료된 일정입니다"
-- 처리와 짝을 이루는 가드라 그대로 둔다.
--
-- 본문은 20260703020000 정의에서 v_scheduled_at 노출 가드 블록만 제거.
-- start_session_from_schedule 은 원래 노출 가드가 없어 대상 아님.

-- ① 참석 신청
create or replace function public.join_session(p_session_id bigint)
returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_member       uuid := public.current_member_id();
	v_capacity     int;
	v_status       text;
	v_ends_at      timestamptz;
	v_count        int;
	v_existing     public.attendances%rowtype;
	v_result       public.attendances%rowtype;
	v_new          text;
	v_pos          bigint;
	v_has_existing boolean;
begin
	if v_member is null then raise exception 'not authenticated'; end if;

	select capacity, status, ends_at
		into v_capacity, v_status, v_ends_at
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	-- 참여 가능 = status 가 open (노출은 sync E단계가 status 로 단일 관리).
	if v_status <> 'open' then raise exception 'session not open'; end if;
	-- 종료 시각 상한 가드 — 종료된 일정엔 신청 불가.
	if v_ends_at is not null and v_ends_at <= now() then
		raise exception 'session ended';
	end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	select * into v_existing from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	v_has_existing := found;  -- ★ 이후 UPDATE가 FOUND를 덮기 전에 캡처

	if v_has_existing and v_existing.status in ('confirmed','waitlisted') then
		raise exception 'already joined';
	end if;

	if v_capacity is null or v_count < v_capacity then
		v_new := 'confirmed';
		update public.session_counters set confirmed_count = confirmed_count + 1
			where session_id = p_session_id;
	else
		v_new := 'waitlisted';
	end if;

	v_pos := nextval('public.attendance_position_seq');

	if v_has_existing then
		update public.attendances set
			status = v_new, position = v_pos, requested_at = now(),
			confirmed_at = case when v_new = 'confirmed' then now() else null end,
			cancelled_at = null, updated_at = now()
		where session_id = p_session_id and member_id = v_member
		returning * into v_result;
	else
		insert into public.attendances(session_id, member_id, status, position, confirmed_at)
		values (p_session_id, v_member, v_new, v_pos,
			case when v_new = 'confirmed' then now() else null end)
		returning * into v_result;
	end if;

	return v_result;
end;
$$;

grant execute on function public.join_session(bigint) to authenticated;

-- ② 게스트 신청
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
	v_ends_at      timestamptz;
	v_count        int;
	v_new          text;
	v_pos          bigint;
	v_result       public.attendances%rowtype;
begin
	if v_inviter is null then raise exception 'not authenticated'; end if;
	if p_name is null or btrim(p_name) = '' then raise exception 'guest name required'; end if;
	if p_gender not in ('M','F') then raise exception 'guest gender required'; end if;

	select capacity, status, ends_at
		into v_capacity, v_status, v_ends_at
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	-- 참여 가능 = status 가 open (노출은 sync E단계가 status 로 단일 관리).
	if v_status <> 'open' then raise exception 'session not open'; end if;
	-- 종료 시각 상한 가드 — 종료된 일정엔 게스트 신청 불가.
	if v_ends_at is not null and v_ends_at <= now() then
		raise exception 'session ended';
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
