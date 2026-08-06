-- ============================================================
-- 운영진 프리패스 판정 원복: '정원 초과 확정 인원 < 2'(20260806010000) → **'확정 운영진 총수 < 2'**.
--
-- 20260726110000 의 주석은 의도 문장("정원이 꽉 차도 운영진 2명까지는 추가 확정")과 검증 예시가 서로
-- 모순이었다. 2026-08-06 운영자 확인으로 **검증 예시(=확정 운영진 총수 기준)가 규칙**임이 확정됐다.
-- 정원 안에 들어와 있는 운영진도 그 2명에 포함된다.
--
-- 확정 규칙(정원 18 기준, 부과 없는 일정):
--   ① 회원16+운영진2=18(만석) + 대기에 운영진  → **대기**            (확정 운영진이 이미 2명)
--   ② ①에서 운영진 1명 취소 → 17               → 대기 1순위가 회원이든 운영진이든 **참여**(정원 여유)
--   ③ 회원17+운영진1=18(만석) + 운영진 참여     → **프리패스로 확정 → 19명**(확정 운영진 1명뿐)
--   ④ ③에서 회원 1명 취소 → 회원16+운영진2=18  → **아무도 승격 안 됨**(18=정원 && 확정 운영진 2명)
--
-- 20260806010000 의 나머지(감사 로그 ops_audit, session_counter_sync 자기치유, 빈자리만큼 승격 루프,
-- SKIP LOCKED 제거, open 아닌 세션 카운터 정합)는 **그대로 유지**하고 프리패스 조건만 되돌린다.
-- 대상: join_session / promote_next_waitlisted / set_late_minutes(풀 복귀) / set_session_capacity(그리디).
--
-- 승격 루프와의 상호작용: 루프가 돌면서 확정 운영진이 2명이 되는 순간 프리패스가 닫히고,
-- 정원 분기도 count=capacity 에서 멈추므로 종료는 보장된다(④가 곧 그 정지 상태).
-- ============================================================

-- ------------------------------------------------------------
-- promote_next_waitlisted — 프리패스 = 부과없음 && 대상이 운영진 && 확정 운영진 총수 < 2.
-- ------------------------------------------------------------
create or replace function public.promote_next_waitlisted(p_session_id bigint)
returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_capacity int;
	v_count    int;
	v_gcap     int := public.session_guest_cap(p_session_id);
	v_opfree   boolean := public.session_op_free(p_session_id);
	v_gcount   int;
	v_ocount   int;
	v_promote  public.attendances%rowtype;
begin
	select capacity into v_capacity from public.sessions where id = p_session_id;
	v_count := public.session_counter_sync(p_session_id);
	select count(*) into v_gcount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and invited_by is not null;
	select count(*) into v_ocount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);

	-- 대기 1순위(position ASC) 중 승급 자격자:
	--   게스트 상한 통과 && ( 정원 여유 || 부과없음 운영진 프리패스(확정 운영진 총수 < 2) ).
	select * into v_promote from public.attendances a
	where a.session_id = p_session_id and a.status = 'waitlisted'
		and (a.invited_by is null or v_gcap is null or v_gcount < v_gcap)
		and (
			(v_capacity is null or v_count < v_capacity)
			or (v_opfree and v_ocount < 2 and public.is_operator(a.member_id))
		)
	order by a.position asc
	for update
	limit 1;
	if not found then return v_promote; end if;

	update public.attendances
	set status = 'confirmed', confirmed_at = now(), updated_at = now()
	where session_id = v_promote.session_id and member_id = v_promote.member_id;
	update public.session_counters set confirmed_count = v_count + 1
	where session_id = p_session_id;
	return v_promote;
end;
$$;
revoke execute on function public.promote_next_waitlisted(bigint) from public;

-- ------------------------------------------------------------
-- join_session — 만석일 때 부과없음 운영진은 확정 운영진 총수 < 2 면 정원 초과 확정.
-- ------------------------------------------------------------
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
	v_ocount       int;
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
	if v_status not in ('open', 'active') then raise exception 'session not open'; end if;
	if v_ends_at is not null and v_ends_at <= now() then
		raise exception 'session ended';
	end if;

	v_count := public.session_counter_sync(p_session_id);

	select * into v_existing from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	v_has_existing := found;

	if v_has_existing and v_existing.status in ('confirmed','waitlisted') then
		raise exception 'already joined';
	end if;

	if v_capacity is null or v_count < v_capacity then
		-- 정원 여유 → 확정(회원/운영진 공통).
		v_new := 'confirmed';
		update public.session_counters set confirmed_count = v_count + 1
			where session_id = p_session_id;
	elsif public.is_operator(v_member) and public.session_op_free(p_session_id) then
		-- 만석인 부과없음 일정 → 확정 운영진이 2명 미만이면 프리패스(정원 초과 확정).
		select count(*) into v_ocount from public.attendances
		where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);
		if v_ocount < 2 then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = v_count + 1
				where session_id = p_session_id;
		else
			v_new := 'waitlisted';
		end if;
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

-- ------------------------------------------------------------
-- set_late_minutes — 정원외늦참 → 정시 복귀 시 프리패스도 '확정 운영진 총수 < 2' 기준.
--   (풀 진입 시의 빈자리 루프 승격 등 20260806010000 동작은 유지)
-- ------------------------------------------------------------
create or replace function public.set_late_minutes(p_session_id bigint, p_minutes int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_member    uuid := public.current_member_id();
	v_start     timestamptz;
	v_end       timestamptz;
	v_capacity  int;
	v_status    text;
	v_max       int;
	v_min       int := p_minutes;
	v_cutoff    timestamptz;
	v_arrival   timestamptz;
	v_pool      boolean;
	v_count     int;
	v_ocount    int;
	v_self      public.attendances%rowtype;
	v_new       text;
	v_promoted  int := 0;
begin
	if v_member is null then raise exception 'not authenticated'; end if;
	if v_min is null or v_min < 0 or v_min % 30 <> 0 then
		raise exception 'invalid minutes';
	end if;

	select scheduled_at, ends_at, capacity, status
		into v_start, v_end, v_capacity, v_status
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_start is null then raise exception 'session has no schedule'; end if;
	if v_end is not null and v_end <= now() then raise exception 'session ended'; end if;

	-- 세션 길이(분)로 상한 — 종료 시각엔 늦참이 없으므로 "종료 미만" 최대 30분 스텝.
	if v_end is not null then
		v_max := greatest(
			0,
			floor((extract(epoch from (v_end - v_start)) / 60 - 1) / 30)::int * 30
		);
		if v_min > v_max then v_min := v_max; end if;
	end if;

	-- 경계 = 경기 후반 2/3 지점(길이 기준). 예) 18:00~21:00(3h) → +2h = 20:00("8시").
	v_arrival := v_start + make_interval(mins => v_min);
	if v_end is not null then
		v_cutoff := v_start + (v_end - v_start) * (2.0 / 3.0);
		v_pool   := v_arrival >= v_cutoff;
	else
		v_pool := false;
	end if;

	v_count := public.session_counter_sync(p_session_id);

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	if not found or v_self.status = 'cancelled' then raise exception 'not attending'; end if;

	v_new := v_self.status;

	if v_status = 'open' and v_pool and v_self.status in ('confirmed','waitlisted') then
		v_new := 'late_pool';
		update public.attendances
		set status = 'late_pool', late_minutes = v_min, confirmed_at = null, updated_at = now()
		where session_id = p_session_id and member_id = v_member;

		if v_self.status = 'confirmed' then
			perform public.session_counter_sync(p_session_id);   -- 정원 1칸 반납 반영
			v_promoted := public.promote_waitlist_fill(p_session_id);
		end if;

	elsif v_status = 'open' and not v_pool and v_self.status = 'late_pool' then
		-- 정원 외 풀 → 복귀. 여유면 확정, 만석이면 부과없음 운영진 프리패스(확정 운영진 2명 미만), 그 외 대기.
		if v_capacity is null or v_count < v_capacity then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = v_count + 1
				where session_id = p_session_id;
		elsif public.is_operator(v_member) and public.session_op_free(p_session_id) then
			select count(*) into v_ocount from public.attendances
			where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);
			if v_ocount < 2 then
				v_new := 'confirmed';
				update public.session_counters set confirmed_count = v_count + 1
					where session_id = p_session_id;
			else
				v_new := 'waitlisted';
			end if;
		else
			v_new := 'waitlisted';
		end if;
		update public.attendances
		set status = v_new, late_minutes = v_min,
			position = nextval('public.attendance_position_seq'),
			confirmed_at = case when v_new = 'confirmed' then now() else null end,
			updated_at = now()
		where session_id = p_session_id and member_id = v_member;

	else
		update public.attendances
		set late_minutes = v_min, updated_at = now()
		where session_id = p_session_id and member_id = v_member;
	end if;

	return jsonb_build_object('status', v_new, 'promoted', v_promoted);
end;
$$;
revoke execute on function public.set_late_minutes(bigint, int) from anon;
grant execute on function public.set_late_minutes(bigint, int) to authenticated;

-- ------------------------------------------------------------
-- set_session_capacity — 그리디의 프리패스도 '확정 운영진 누계 < 2'(정원 안 운영진 포함) 기준.
--   position 순으로 훑으며 v_o(확정 운영진 누계)를 세고, 만석 이후엔 v_o < 2 인 운영진만 초과 확정.
-- ------------------------------------------------------------
create or replace function public.set_session_capacity(
	p_session_id bigint, p_capacity int
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_status   text;
	v_opfree   boolean := public.session_op_free(p_session_id);
	v_gcap     int     := public.session_guest_cap(p_session_id);
	v_cc       int := 0;   -- 확정 누계(회원+운영진+게스트)
	v_o        int := 0;   -- 확정 운영진 누계(정원 안·초과 모두 포함)
	v_g        int := 0;   -- 확정 게스트 누계
	v_att      public.attendances%rowtype;
	v_want     text;
	v_isop     boolean;
	v_isguest  boolean;
	v_promoted int := 0;
	v_demoted  int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	update public.sessions set capacity = p_capacity
	where id = p_session_id
	returning status into v_status;
	if not found then raise exception 'session not found'; end if;

	if v_status <> 'open' then
		perform public.session_counter_sync(p_session_id);   -- 진행/종료 세션도 카운터는 실제값으로
		return jsonb_build_object('promoted', 0, 'demoted', 0);
	end if;

	perform public.session_counter_sync(p_session_id);

	for v_att in
		select * from public.attendances
		where session_id = p_session_id and status in ('confirmed', 'waitlisted')
		order by position asc
		for update
	loop
		v_isop := public.is_operator(v_att.member_id);
		v_isguest := v_att.invited_by is not null;

		if (p_capacity is null or v_cc < p_capacity)
		   and (not v_isguest or v_gcap is null or v_g < v_gcap) then
			v_want := 'confirmed';                                   -- 정원 여유 + 게스트 상한 여유
		elsif v_opfree and v_isop and v_o < 2 then
			v_want := 'confirmed';                                   -- 부과없음 운영진 프리패스
		else
			v_want := 'waitlisted';
		end if;

		if v_want = 'confirmed' then
			v_cc := v_cc + 1;
			if v_isop then v_o := v_o + 1; end if;
			if v_isguest then v_g := v_g + 1; end if;
		end if;

		if v_want <> v_att.status then
			update public.attendances
			set status = v_want,
				confirmed_at = case when v_want = 'confirmed' then now() else null end,
				updated_at = now()
			where session_id = p_session_id and member_id = v_att.member_id;

			if v_want = 'confirmed' then v_promoted := v_promoted + 1;
			else v_demoted := v_demoted + 1; end if;

			insert into public.notifications(recipient_member_id, type, session_id, payload)
			values (
				coalesce(v_att.invited_by, v_att.member_id),
				case when v_want = 'confirmed' then 'promoted' else 'demoted' end,
				p_session_id,
				jsonb_build_object('session_id', p_session_id)
					|| case when v_att.invited_by is not null then jsonb_build_object(
						'guest_name', (select name from public.members where id = v_att.member_id))
						else '{}'::jsonb end
			);
		end if;
	end loop;

	update public.session_counters set confirmed_count = v_cc where session_id = p_session_id;
	return jsonb_build_object('promoted', v_promoted, 'demoted', v_demoted);
end;
$$;
revoke execute on function public.set_session_capacity(bigint, int) from anon;
grant execute on function public.set_session_capacity(bigint, int) to authenticated;
