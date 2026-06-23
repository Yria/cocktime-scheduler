-- join_session: 노출 시작(시작 1주 전) 서버시간 가드 추가.
-- 기존엔 status='open' 만 검사했는데, status 는 sync_schedule_occurrences(E단계) 가
-- 갱신하는 캐시성 값이다:
--   ① 운영진이 open 회차의 scheduled_at 을 1주보다 먼 미래로 옮겨도 status 는 'open' 으로 남고,
--   ② sync 가 아직 안 돈/stale 한 시점에 호출되면
-- "1주 전이 아닌데" 참석이 통과될 수 있다.
-- → 클라 시간이 아닌 Postgres 서버시간 now() 기준으로 scheduled_at 을 직접 재검증한다.
-- 경계는 sync E단계(scheduled_at <= now() + interval '7 days')와 동일하게 맞춘다.
-- 본문은 20260621050000(FOUND 버그 수정본) 을 그대로 두고 시각 가드만 추가.

create or replace function public.join_session(p_session_id bigint)
returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_member       uuid := public.current_member_id();
	v_capacity     int;
	v_status       text;
	v_scheduled_at timestamptz;
	v_count        int;
	v_existing     public.attendances%rowtype;
	v_result       public.attendances%rowtype;
	v_new          text;
	v_pos          bigint;
	v_has_existing boolean;
begin
	if v_member is null then raise exception 'not authenticated'; end if;

	select capacity, status, scheduled_at into v_capacity, v_status, v_scheduled_at
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;
	-- 노출(시작 1주 전) 직접 가드 — 서버시간 기준. status 가 stale/이동돼도 시각으로 차단.
	if v_scheduled_at is not null and v_scheduled_at > now() + interval '7 days' then
		raise exception 'session not open yet';
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
