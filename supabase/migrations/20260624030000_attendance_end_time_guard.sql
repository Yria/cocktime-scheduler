-- 종료 시각(ends_at) 상한 가드 — 일정 종료 후에는 참석/게스트신청/경기시작 불가.
--
-- 배경: 기존 RPC들은 "노출 시작(시작 1주 전)" 하한만 검사했고 상한(종료)은 없었다.
-- 그래서 시작 1주 전~무한정 사이엔 status='open' 인 한 계속 참석/시작이 통과됐다.
-- 운영진이 '경기 시작'을 누르지 않은 open 회차는 종료 시각이 지나도 open 으로 남아
-- 종료된 일정에 계속 참석 신청이 들어올 수 있었다(노출도 유지됨 — Home 필터로 별도 처리).
--
-- 요청: "일정시간(=종료 시각)이 넘어가면 참석 불가 + 미노출". 미노출은 클라(Home) 필터,
-- 참석/시작 차단은 여기 서버시간 now() 기준 가드로 강제한다(클라 30초 tick stale 윈도우 방지).
-- 경계: ends_at <= now() 면 종료로 본다(즉석/미정 일정은 ends_at NULL 이라 가드 통과).
-- 본문은 각 함수의 최신본(join_session=20260623040000, add_guest_attendance=20260624010000,
-- start_session_from_schedule=20260621060000)을 그대로 두고 종료 가드만 추가.

-- ① 참석 신청
create or replace function public.join_session(p_session_id bigint)
returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_member       uuid := public.current_member_id();
	v_capacity     int;
	v_status       text;
	v_scheduled_at timestamptz;
	v_ends_at      timestamptz;
	v_count        int;
	v_existing     public.attendances%rowtype;
	v_result       public.attendances%rowtype;
	v_new          text;
	v_pos          bigint;
	v_has_existing boolean;
begin
	if v_member is null then raise exception 'not authenticated'; end if;

	select capacity, status, scheduled_at, ends_at
		into v_capacity, v_status, v_scheduled_at, v_ends_at
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;
	-- 노출(시작 1주 전) 하한 가드 — 서버시간 기준.
	if v_scheduled_at is not null and v_scheduled_at > now() + interval '7 days' then
		raise exception 'session not open yet';
	end if;
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

-- ③ 경기 시작(브릿지) — 종료된 일정은 시작 불가.
create or replace function public.start_session_from_schedule(p_session_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_status  text;
	v_ends_at timestamptz;
	v_missing int;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	select status, ends_at into v_status, v_ends_at
	from public.sessions where id = p_session_id for update;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;
	-- 종료 시각 상한 가드 — 종료된 일정은 경기 시작 불가.
	if v_ends_at is not null and v_ends_at <= now() then
		raise exception 'session ended';
	end if;

	-- 편성 알고리즘은 gender 필수 → 프로필 미입력 confirmed 회원이 있으면 차단
	select count(*) into v_missing
	from public.attendances a
	join public.members m on m.id = a.member_id
	where a.session_id = p_session_id and a.status = 'confirmed' and m.gender is null;
	if v_missing > 0 then
		raise exception 'profile incomplete: % member(s) missing gender', v_missing;
	end if;

	-- confirmed 참석자 → session_players (members 스냅샷). player_id는 member_id 기반.
	insert into public.session_players
		(session_id, player_id, member_id, name, gender, skills, status, wait_since)
	select
		p_session_id, m.id::text, m.id, m.name, m.gender,
		coalesce(m.skills, '{}'::jsonb), 'waiting', now()
	from public.attendances a
	join public.members m on m.id = a.member_id
	where a.session_id = p_session_id and a.status = 'confirmed'
	on conflict (session_id, player_id) do nothing;

	-- 세션 활성화 → subscribeSessionWatch(postgres_changes)가 감지해 보드 로드
	update public.sessions
	set status = 'active', is_active = true, started_at = now()
	where id = p_session_id;
end;
$$;

revoke execute on function public.start_session_from_schedule(bigint) from anon;
grant execute on function public.start_session_from_schedule(bigint) to authenticated;
