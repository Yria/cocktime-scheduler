-- ============================================================
-- 운영진 정원 처리 재정의: "완전 정원외"(20260726100000) → "프리패스" 모델.
--
-- 요청(정정):
--   · confirmed_count = 전원(회원+운영진) 카운트로 되돌린다(원상). 운영진도 정원을 채운다.
--   · 단 "부과 없는 일정"에서는 운영진에게 프리패스: 정원이 꽉 차도 확정 운영진 2명까지는 추가 확정.
--   · 부과 있는 일정에서는 운영진도 일반 회원과 동일(프리패스 없음).
--
-- 확정 규칙(부과 없는 일정, op_free):
--   · 회원/부과있음-운영진: confirmed_count < capacity 면 확정, 아니면 대기.
--   · 부과없음-운영진: (confirmed_count < capacity) OR (확정 운영진 수 < 2) 면 확정, 아니면 대기.
--   · 게스트 상한(session_guest_cap: 주말 무제한/평일 2)은 그대로.
--   검증(정원 18):
--     회원10+운영진2(총12<18) → 3번째 운영진 확정(여유)  |  회원18(만석)+운영진2 → 프리패스로 확정, 3번째 대기
--     회원16+운영진2(총18) → 3번째 운영진 대기  |  회원15+운영진3(총18) → 4번째 운영진 대기
--
-- "부과 없는 일정" = 세션 장소가 대관비를 부과하지 않음 = places.charges_court_fee=false(또는 장소 없음).
--   → 헬퍼 session_op_free(session_id) (엔빵/정액 무관, charges_court_fee 게이트가 부과 유무의 단일 기준).
--
-- confirmed_count 는 전원 카운트라 프리패스로 capacity 를 최대 +2 초과할 수 있다(초과분은 항상 운영진).
-- 모든 증감 지점(join/cancel/admin_cancel/set_late/promote/set_capacity)에서 운영진 가드를 제거해
-- 전원이 대칭적으로 증감한다. promote/set_capacity 는 프리패스 자격까지 반영한다.
-- 백필: open 세션을 새 모델로 재정합(전원 카운트 + 프리패스, position 순 그리디, 알림 없음).
--
-- session_guest_cap(20260726100000)은 그대로 사용. add_guest_attendance/cancel_guest_attendance 는
-- 게스트(비운영진) 전용이라 20260726100000/20260712010000 정의로 이미 정합 → 재정의 안 함.
-- ============================================================

-- ------------------------------------------------------------
-- (0) 부과 없는 일정? = 장소가 대관비 부과 안 함(또는 장소 없음) → 운영진 프리패스 대상.
-- ------------------------------------------------------------
create or replace function public.session_op_free(p_session_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
	select not coalesce(
		(select p.charges_court_fee
		 from public.sessions s join public.places p on p.id = s.place_id
		 where s.id = p_session_id),
		false);
$$;
revoke execute on function public.session_op_free(bigint) from public;

-- ------------------------------------------------------------
-- join_session — 전원 카운트 복원 + 부과없음 운영진 프리패스.
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

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	select * into v_existing from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	v_has_existing := found;

	if v_has_existing and v_existing.status in ('confirmed','waitlisted') then
		raise exception 'already joined';
	end if;

	if v_capacity is null or v_count < v_capacity then
		-- 정원 여유 → 확정(회원/운영진 공통).
		v_new := 'confirmed';
		update public.session_counters set confirmed_count = confirmed_count + 1
			where session_id = p_session_id;
	elsif public.is_operator(v_member) and public.session_op_free(p_session_id) then
		-- 만석이지만 부과없음 운영진 → 확정 운영진 2명 미만이면 프리패스.
		select count(*) into v_ocount from public.attendances
		where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);
		if v_ocount < 2 then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = confirmed_count + 1
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
-- promote_next_waitlisted — 정원(전원 카운트) + 부과없음 운영진 프리패스 + 게스트 상한 자격 반영.
--   호출 규약: 세션 session_counters 를 FOR UPDATE 로 잠근 상태에서 호출(취소/강등으로 1칸 비운 직후).
--   confirmed_count 는 호출자가 감소시킨 뒤의 값을 본다(같은 트랜잭션).
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
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id;
	select count(*) into v_gcount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and invited_by is not null;
	select count(*) into v_ocount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);

	-- 대기 1순위(position ASC) 중 승급 자격자:
	--   게스트 상한 통과 && ( 정원 여유(전원 기준) || 부과없음 운영진 프리패스(확정 운영진<2) ).
	select * into v_promote from public.attendances a
	where a.session_id = p_session_id and a.status = 'waitlisted'
		and (a.invited_by is null or v_gcap is null or v_gcount < v_gcap)
		and (
			(v_capacity is null or v_count < v_capacity)
			or (v_opfree and public.is_operator(a.member_id) and v_ocount < 2)
		)
	order by a.position asc
	for update skip locked
	limit 1;
	if not found then return v_promote; end if;

	update public.attendances
	set status = 'confirmed', confirmed_at = now(), updated_at = now()
	where session_id = v_promote.session_id and member_id = v_promote.member_id;
	update public.session_counters set confirmed_count = confirmed_count + 1
	where session_id = p_session_id;
	return v_promote;
end;
$$;

revoke execute on function public.promote_next_waitlisted(bigint) from public;

-- ------------------------------------------------------------
-- cancel_attendance — 전원 카운트 복원(운영진 가드 제거). 본문은 20260712010000 원상.
-- ------------------------------------------------------------
create or replace function public.cancel_attendance(p_session_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_member  uuid := public.current_member_id();
	v_status  text;
	v_self    public.attendances%rowtype;
	v_promote public.attendances%rowtype;
begin
	if v_member is null then raise exception 'not authenticated'; end if;

	select status into v_status from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status in ('closed', 'cancelled') then raise exception 'session ended'; end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	perform 1 from public.session_counters where session_id = p_session_id for update;

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	if not found or v_self.status = 'cancelled' then return; end if;

	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		late_minutes = 0, cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = v_member;

	if v_self.status = 'confirmed' then
		update public.session_counters set confirmed_count = confirmed_count - 1
			where session_id = p_session_id;

		if v_status = 'open' then
			v_promote := public.promote_next_waitlisted(p_session_id);
			if v_promote.member_id is not null then
				insert into public.notifications(recipient_member_id, type, session_id, payload)
				values (coalesce(v_promote.invited_by, v_promote.member_id), 'promoted', p_session_id,
					jsonb_build_object('session_id', p_session_id)
						|| case when v_promote.invited_by is not null then jsonb_build_object(
							'guest_name', (select name from public.members where id = v_promote.member_id))
							else '{}'::jsonb end);
			end if;
		end if;
	end if;
end;
$$;

grant execute on function public.cancel_attendance(bigint) to authenticated;

-- ------------------------------------------------------------
-- admin_cancel_attendance — 전원 카운트 복원(대상 운영진 가드 제거). 본문은 20260712010000 원상.
-- ------------------------------------------------------------
create or replace function public.admin_cancel_attendance(
	p_session_id bigint, p_member_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_actor      uuid := public.current_member_id();
	v_by_name    text;
	v_status     text;
	v_self       public.attendances%rowtype;
	v_promote    public.attendances%rowtype;
	v_recipient  uuid;
	v_guest_name text;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	select name into v_by_name from public.members where id = v_actor;

	select status into v_status from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status in ('closed', 'cancelled') then raise exception 'session ended'; end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	perform 1 from public.session_counters where session_id = p_session_id for update;

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = p_member_id for update;
	if not found then raise exception 'attendance not found'; end if;
	if v_self.status = 'cancelled' then return; end if;

	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		late_minutes = 0, cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = p_member_id;

	v_recipient := coalesce(v_self.invited_by, p_member_id);
	if v_self.invited_by is not null then
		select name into v_guest_name from public.members where id = p_member_id;
	end if;
	if v_recipient is not null and v_recipient <> v_actor then
		insert into public.notifications(recipient_member_id, type, session_id, payload)
		values (v_recipient, 'removed', p_session_id,
			jsonb_build_object('session_id', p_session_id, 'by_name', v_by_name)
			|| case when v_guest_name is not null
				then jsonb_build_object('guest_name', v_guest_name) else '{}'::jsonb end);
	end if;

	if v_self.status = 'confirmed' then
		update public.session_counters set confirmed_count = confirmed_count - 1
			where session_id = p_session_id;

		if v_status = 'open' then
			v_promote := public.promote_next_waitlisted(p_session_id);
			if v_promote.member_id is not null then
				insert into public.notifications(recipient_member_id, type, session_id, payload)
				values (coalesce(v_promote.invited_by, v_promote.member_id), 'promoted', p_session_id,
					jsonb_build_object('session_id', p_session_id)
						|| case when v_promote.invited_by is not null then jsonb_build_object(
							'guest_name', (select name from public.members where id = v_promote.member_id))
							else '{}'::jsonb end);
			end if;
		end if;
	end if;
end;
$$;

revoke execute on function public.admin_cancel_attendance(bigint, uuid) from anon;
grant execute on function public.admin_cancel_attendance(bigint, uuid) to authenticated;

-- ------------------------------------------------------------
-- set_late_minutes — 전원 카운트 복원 + late_pool→confirmed 복귀 시 부과없음 운영진 프리패스.
-- ------------------------------------------------------------
drop function if exists public.set_late_minutes(bigint, int);
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
	v_promote   public.attendances%rowtype;
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

	if v_end is not null then
		v_max := greatest(
			0,
			floor((extract(epoch from (v_end - v_start)) / 60 - 1) / 30)::int * 30
		);
		if v_min > v_max then v_min := v_max; end if;
	end if;

	v_arrival := v_start + make_interval(mins => v_min);
	if v_end is not null then
		v_cutoff := v_start + (v_end - v_start) * (2.0 / 3.0);
		v_pool   := v_arrival >= v_cutoff;
	else
		v_pool := false;
	end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

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
			update public.session_counters set confirmed_count = confirmed_count - 1
				where session_id = p_session_id;

			v_promote := public.promote_next_waitlisted(p_session_id);
			if v_promote.member_id is not null then
				v_promoted := 1;
				insert into public.notifications(recipient_member_id, type, session_id, payload)
				values (coalesce(v_promote.invited_by, v_promote.member_id), 'promoted', p_session_id,
					jsonb_build_object('session_id', p_session_id)
						|| case when v_promote.invited_by is not null then jsonb_build_object(
							'guest_name', (select name from public.members where id = v_promote.member_id))
							else '{}'::jsonb end);
			end if;
		end if;

	elsif v_status = 'open' and not v_pool and v_self.status = 'late_pool' then
		-- 정원 외 풀 → 복귀. 여유면 확정, 만석이면 부과없음 운영진 프리패스(확정 운영진<2), 그 외 대기.
		if v_capacity is null or v_count < v_capacity then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = confirmed_count + 1
				where session_id = p_session_id;
			v_count := v_count + 1;
		elsif public.is_operator(v_member) and public.session_op_free(p_session_id) then
			select count(*) into v_ocount from public.attendances
			where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);
			if v_ocount < 2 then
				v_new := 'confirmed';
				update public.session_counters set confirmed_count = confirmed_count + 1
					where session_id = p_session_id;
				v_count := v_count + 1;
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
-- set_session_capacity — 새 모델로 재정합(position 순 그리디). 전원 카운트 + 부과없음 운영진 프리패스 + 게스트 상한.
--   confirmed/waitlisted 를 position 오름차순으로 훑어 원하는 상태를 계산·반영하고 알림을 보낸다.
--   late_pool/cancelled 는 건드리지 않는다. 최종 confirmed_count = 확정 총원.
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
	v_gcap     int := public.session_guest_cap(p_session_id);
	v_cc       int := 0;   -- 확정 누계(회원+운영진)
	v_o        int := 0;   -- 확정 운영진 누계
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
		return jsonb_build_object('promoted', 0, 'demoted', 0);
	end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	perform 1 from public.session_counters where session_id = p_session_id for update;

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

-- ------------------------------------------------------------
-- 백필 — open 세션을 새 모델(전원 카운트 + 프리패스)로 재정합. position 순 그리디, 알림 없음.
--   20260726100000(운영진 완전 정원외 + 대기 승급)로 어긋난 상태를 바로잡는다. active/closed 미접촉.
-- ------------------------------------------------------------
do $$
declare
	v_sess record;
	v_att  record;
	v_opfree  boolean;
	v_gcap    int;
	v_cc int; v_o int; v_g int;
	v_isop boolean; v_isguest boolean; v_want text;
begin
	for v_sess in select id, capacity from public.sessions where status = 'open' loop
		insert into public.session_counters(session_id) values (v_sess.id)
			on conflict (session_id) do nothing;
		perform 1 from public.session_counters where session_id = v_sess.id for update;

		v_opfree := public.session_op_free(v_sess.id);
		v_gcap   := public.session_guest_cap(v_sess.id);
		v_cc := 0; v_o := 0; v_g := 0;

		for v_att in
			select * from public.attendances
			where session_id = v_sess.id and status in ('confirmed', 'waitlisted')
			order by position asc
			for update
		loop
			v_isop := public.is_operator(v_att.member_id);
			v_isguest := v_att.invited_by is not null;

			if (v_sess.capacity is null or v_cc < v_sess.capacity)
			   and (not v_isguest or v_gcap is null or v_g < v_gcap) then
				v_want := 'confirmed';
			elsif v_opfree and v_isop and v_o < 2 then
				v_want := 'confirmed';
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
				where session_id = v_sess.id and member_id = v_att.member_id;
			end if;
		end loop;

		update public.session_counters set confirmed_count = v_cc where session_id = v_sess.id;
	end loop;
end $$;

-- active/closed 세션: attendances 는 절대 건드리지 않고 confirmed_count 숫자만 "전원 확정" 기준으로 재정합.
--   직전(20260726100000)이 confirmed_count 를 "비운영진 확정"으로 시드해 둔 세션이 open→active 로
--   전이했을 수 있는데, 이번엔 의미가 "전원 확정"으로 바뀌고 모든 증감이 운영진 포함 대칭이라, 재정합
--   없이는 카운터가 과소/음수로 흘러 late-join 게이트(join_session active 경로)가 무력화된다.
--   보드/정산이 이미 형성된 상태라 상태 재배치는 하지 않고 숫자만 count(confirmed)로 맞춘다.
update public.session_counters sc
set confirmed_count = (
	select count(*) from public.attendances a
	where a.session_id = sc.session_id and a.status = 'confirmed'
)
from public.sessions s
where s.id = sc.session_id and s.status in ('active', 'closed');
