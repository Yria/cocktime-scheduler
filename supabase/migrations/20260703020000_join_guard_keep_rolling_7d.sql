-- 참석/게스트 노출 가드 롤백: 공개 상한(reveal_horizon_kst_date) → 기존 rolling +7d.
--
-- 배경: 20260703010000 에서 join_session·add_guest_attendance 의 노출 가드를
-- sync E단계의 새 공개 상한(일요일 18:00 일괄 공개)과 "정확히 일치"시켰는데, 이는 과했다.
--   ① 전환기 회귀: 옛 rolling 규칙으로 이미 open + 참석 진행 중인 회차(월~목)가
--      새 공개 창(이번 일요일까지) 밖에 남아, 홈에 보이는데 신규 참석만
--      'session not open yet' 으로 막혔다(운영 장애).
--   ② 가드의 목적은 "1주보다 먼 미래의 stale open 회차 차단" 백스톱이지 노출 시점
--      강제가 아니다. 노출 시점은 E단계(draft→open)가 결정하고, 공개 상한은 항상
--      오늘+7일 이내(직전 일요일+7 ≤ 오늘+7)이므로 rolling +7d 가드는 공개 창을
--      포함하는 상위 집합 — 보호 범위는 동일하고 전환기/개별 오버라이드에 안전하다.
--
-- 두 함수를 20260624030000 정의(가드: scheduled_at <= now()+7d)로 되돌린다.
-- sync E단계·pg_cron(일요일 18:00 일괄 공개)은 20260703010000 그대로 유지.

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
	-- 노출 하한 백스톱 — 서버시간 기준. 1주보다 먼 미래의 stale open 회차만 차단.
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
	-- 노출 하한 백스톱 — 서버시간 기준. 1주보다 먼 미래의 stale open 회차만 차단.
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
