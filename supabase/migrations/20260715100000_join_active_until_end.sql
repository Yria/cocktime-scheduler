-- 진행중(active) 세션도 종료(ends_at) 전까진 참여 허용 + 확정 시 보드(session_players) 반영.
--
-- 배경: 운영진이 '경기 시작'을 누르면 status='active' 가 되어 join_session 이 'session not open' 으로
-- 거부 → 늦게 온 회원이 참석(입장)할 수 없었다("참여 버튼이 사라짐").
-- 요청: 세션이 끝날 때까지(ends_at) 참여를 열어둔다. 2/3 지점 이후 입장은 클라에서 '완전 늦참'
-- 확인 다이얼로그로 안내하되(자리 있으면 확정, 없으면 대기), 서버 접수 로직은 기존과 동일
-- (정원 여유=confirmed, 초과=waitlisted). late_pool(정원 외 늦참)로 넣지 않는다.
--
-- active 로 confirmed 접수되면 브릿지(start_session_from_schedule)와 동일하게 members 스냅샷을
-- session_players(waiting)로 넣어 보드 명단에 즉시 반영한다(sessionChannels 가 session_players INSERT 를
-- '선수 추가'로 실시간 전파). 미채점 회원은 grade 5 기본(수동 시작 normalizeSkills·브릿지와 일치).
-- on conflict (session_id, player_id) do nothing 으로 멱등(이미 명단에 있으면 무시).
--
-- 본문은 20260703040000(join_open_only) 기준, ① status 게이트를 open→(open|active)로,
-- ② active·confirmed 접수 시 session_players 반영만 추가. add_guest_attendance 는 범위 밖(그대로 둔다).

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
	-- 참여 가능 = 모집중(open) 또는 진행중(active). 진행중이어도 종료 전까진 늦참 입장 허용.
	if v_status not in ('open', 'active') then raise exception 'session not open'; end if;
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

	-- 진행중(active) 세션에 confirmed 로 접수되면 members 스냅샷을 보드 명단(session_players)에 즉시 반영.
	-- (open 세션은 아직 보드 미시작이라 브릿지가 시작 시 일괄 스냅샷 → 여기서 넣지 않는다.)
	if v_status = 'active' and v_new = 'confirmed' then
		insert into public.session_players
			(session_id, player_id, member_id, name, gender, skills, status, wait_since)
		select
			p_session_id, m.id::text, m.id, m.name, m.gender,
			case when m.skills ? 'grade' then m.skills else jsonb_build_object('grade', 5) end,
			'waiting', now()
		from public.members m
		where m.id = v_member
		on conflict (session_id, player_id) do nothing;
	end if;

	return v_result;
end;
$$;

grant execute on function public.join_session(bigint) to authenticated;
