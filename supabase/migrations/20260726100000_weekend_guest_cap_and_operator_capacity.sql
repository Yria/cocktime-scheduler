-- ============================================================
-- (A) 주말 게스트 상한 해제 + (B) 운영진 정원 제외
--
-- 요청:
--   (A) 주말(토/일) 세션은 확정 게스트 "세션당 2명" 상한을 없앤다(정원 한도까지 무제한).
--       평일은 기존대로 2명 유지.
--   (B) 운영진(admin)은 "신청 자리(정원)"를 차지하지 않는다 — 항상 확정으로 접수하되
--       confirmed_count(정원 게이팅 기준)에 세지 않는다. 즉 confirmed_count = "비운영진 확정 인원".
--       코트총액(엔빵) 정산·표시는 별개 경로라 그대로(운영진 포함) 유지 — 이 마이그레이션은 정원만.
--
-- 설계 요약:
--   · (A) session_guest_cap(session_id): 주말=NULL(무제한), 평일=2. 게스트 상한을 쓰는 모든 곳
--         (add_guest_attendance / promote_next_waitlisted / set_session_capacity)이 이 헬퍼로 통일.
--         상한 조건은 `(v_gcap is null or v_gcount < v_gcap)`.
--   · (B) confirmed_count 의 정의를 "비운영진 확정 인원"으로 바꾼다. 규칙:
--         - 운영진은 정원과 무관하게 항상 confirmed 로 접수하되 confirmed_count 를 증가시키지 않는다.
--         - 운영진은 절대 waitlisted 가 되지 않는다(정원 게이트 통과) → 대기열엔 비운영진만 존재.
--         - 확정 운영진이 취소/강등돼도 confirmed_count 를 감소시키지 않고 승급도 트리거하지 않는다.
--         카운터를 증감하는 모든 지점(join/cancel/admin_cancel/late/capacity)에 is_operator 가드를 넣는다.
--         is_operator(member_id) 는 기존 함수(20260713040000) 재사용.
--   · 백필: open 세션의 confirmed_count 를 "비운영진 확정 인원"으로 재계산하고, 운영진 제외로 생긴
--         빈 정원은 대기자를 조용히(알림 없이) 승급시켜 채운다. active/closed 는 건드리지 않는다.
--
-- 가정/한계: is_operator 는 각 전이 시점에 동적 평가한다. "세션이 open 인 동안 특정 회원의 admin
--   role 이 바뀌는" 드문 경우엔 join(증가)과 cancel/late(감소) 시점의 판정이 달라 confirmed_count 가
--   1 어긋날 수 있다. 이 클럽은 운영진이 고정이라 실무상 발생하지 않으며, set_session_capacity 가
--   confirmed_count 를 비운영진 확정 수로 재계산하므로 정원 조정 시 자가치유된다.
-- ============================================================

-- ------------------------------------------------------------
-- (A-0) 세션별 게스트 상한: 주말=NULL(무제한), 평일=2. scheduled_at 없으면 평일 취급(2).
-- ------------------------------------------------------------
create or replace function public.session_guest_cap(p_session_id bigint)
returns int
language sql stable security definer set search_path = ''
as $$
	select case
		when extract(dow from (s.scheduled_at at time zone 'Asia/Seoul')) in (0, 6) then null  -- 토/일: 무제한
		else 2  -- 평일: 세션당 2명
	end
	from public.sessions s where s.id = p_session_id;
$$;
revoke execute on function public.session_guest_cap(bigint) from public;

-- ------------------------------------------------------------
-- (B) join_session — 운영진은 정원 무관 항상 확정(카운터 미증가). 본문은 20260715100000 계승, 게이트만 교체.
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

	-- 운영진은 정원 무관 항상 확정 — confirmed_count(=비운영진 확정 인원)에 세지 않는다.
	if public.is_operator(v_member) then
		v_new := 'confirmed';
	elsif v_capacity is null or v_count < v_capacity then
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

	-- 진행중(active) 세션에 confirmed 접수 시 보드(session_players) 즉시 반영(운영진 포함).
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
-- (A) promote_next_waitlisted — 게스트 상한을 session_guest_cap(주말 무제한)로. 본문은 20260712010000 계승.
--     대기열엔 비운영진만 존재(운영진은 waitlisted 안 됨)하므로 승급은 항상 confirmed_count +1.
-- ------------------------------------------------------------
create or replace function public.promote_next_waitlisted(p_session_id bigint)
returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_gcap    int := public.session_guest_cap(p_session_id);
	v_gcount  int;
	v_promote public.attendances%rowtype;
begin
	select count(*) into v_gcount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and invited_by is not null;

	-- 대기 1순위(position ASC) — 게스트는 상한 미만일 때만(주말=무제한이면 항상).
	-- 운영진은 정원 미점유 → 승급 대상에서 제외(세션 중 role 변경으로 대기 운영진이 생겨도 카운트 오염 방지).
	select * into v_promote from public.attendances
	where session_id = p_session_id and status = 'waitlisted'
		and not public.is_operator(member_id)
		and (invited_by is null or v_gcap is null or v_gcount < v_gcap)
	order by position asc
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
-- (A) add_guest_attendance — 게스트 상한을 session_guest_cap 로. 본문은 20260712010000 계승, 상한만 교체.
--     (게스트는 비운영진이라 confirmed_count 증감은 기존 그대로.)
-- ------------------------------------------------------------
create or replace function public.add_guest_attendance(
	p_session_id bigint, p_name text, p_gender text, p_skills jsonb
) returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_inviter        uuid := public.current_member_id();
	v_inviter_status text;
	v_guest          uuid;
	v_capacity       int;
	v_status         text;
	v_ends_at        timestamptz;
	v_count          int;
	v_gcount         int;
	v_gcap           int := public.session_guest_cap(p_session_id);
	v_new            text;
	v_pos            bigint;
	v_result         public.attendances%rowtype;
begin
	if v_inviter is null then raise exception 'not authenticated'; end if;
	if p_name is null or btrim(p_name) = '' then raise exception 'guest name required'; end if;
	if p_gender not in ('M','F') then raise exception 'guest gender required'; end if;

	if exists (
		select 1 from public.members
		where is_guest = false and is_active = true
			and btrim(lower(name)) = btrim(lower(p_name))
	) then
		raise exception 'name_is_member';
	end if;

	select capacity, status, ends_at
		into v_capacity, v_status, v_ends_at
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;
	if v_ends_at is not null and v_ends_at <= now() then
		raise exception 'session ended';
	end if;

	select status into v_inviter_status from public.attendances
	where session_id = p_session_id and member_id = v_inviter
		and status in ('confirmed','waitlisted','late_pool')
	limit 1;
	if not found then raise exception 'must join first'; end if;

	insert into public.members(name, gender, skills, is_guest)
	values (btrim(p_name), p_gender, coalesce(p_skills, '{}'::jsonb), true)
	returning id into v_guest;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	select count(*) into v_gcount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and invited_by is not null;

	if v_inviter_status = 'late_pool' then
		v_new := 'late_pool';
	elsif (v_capacity is null or v_count < v_capacity) and (v_gcap is null or v_gcount < v_gcap) then
		-- 정원 여유 + 게스트 상한 여유(주말=무제한)면 확정. 그 외 대기.
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

-- ------------------------------------------------------------
-- (B) cancel_attendance — 운영진 취소는 카운터 미감소·승급 미트리거. 본문은 20260712010000 계승.
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

	-- 확정자였고 비운영진이면 카운터 감소 + 승급(운영진은 정원 미점유라 감소·승급 없음).
	if v_self.status = 'confirmed' and not public.is_operator(v_member) then
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
-- (B) admin_cancel_attendance — 대상이 운영진이면 카운터 미감소·승급 미트리거. 본문은 20260712010000 계승.
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

	-- 확정자였고 대상이 비운영진이면 카운터 감소 + 승급(운영진은 정원 미점유).
	if v_self.status = 'confirmed' and not public.is_operator(p_member_id) then
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
-- (B) set_late_minutes — 운영진은 정원 게이트/카운터 무관. 본문은 20260712010000 계승, 카운터 분기에 가드.
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
	v_is_op     boolean := public.is_operator(public.current_member_id());
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

		-- 확정자였고 비운영진이면 정원 1칸 반납 + 승급(운영진은 정원 미점유).
		if v_self.status = 'confirmed' and not v_is_op then
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
		-- 정원 외 풀 → 복귀. 운영진은 정원 무관 확정(카운터 미증가), 그 외 여유면 확정/없으면 대기.
		if v_is_op then
			v_new := 'confirmed';
		elsif v_capacity is null or v_count < v_capacity then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = confirmed_count + 1
				where session_id = p_session_id;
			v_count := v_count + 1;
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
-- (A+B) set_session_capacity — 강등 대상에서 운영진 제외(정원 미점유), 게스트 상한은 session_guest_cap.
--       v_count(=비운영진 확정 인원)는 confirmed_count 에서 시작. 본문은 20260712010000 계승.
-- ------------------------------------------------------------
create or replace function public.set_session_capacity(
	p_session_id bigint, p_capacity int
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_status   text;
	v_count    int;
	v_gcount   int;
	v_gcap     int := public.session_guest_cap(p_session_id);
	v_att      public.attendances%rowtype;
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
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	select count(*) into v_gcount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and invited_by is not null;

	-- ① 강등: 정원 초과분만큼 최근 신청 confirmed(position DESC)를 대기로. 운영진은 정원 미점유 → 제외.
	if p_capacity is not null then
		loop
			exit when v_count <= p_capacity;
			select * into v_att from public.attendances
			where session_id = p_session_id and status = 'confirmed'
				and not public.is_operator(member_id)
			order by position desc
			for update skip locked
			limit 1;
			exit when not found;

			update public.attendances
			set status = 'waitlisted', confirmed_at = null, updated_at = now()
			where session_id = v_att.session_id and member_id = v_att.member_id;
			v_count := v_count - 1;
			if v_att.invited_by is not null then v_gcount := v_gcount - 1; end if;
			v_demoted := v_demoted + 1;
			insert into public.notifications(recipient_member_id, type, session_id, payload)
			values (
				coalesce(v_att.invited_by, v_att.member_id), 'demoted', p_session_id,
				jsonb_build_object('session_id', p_session_id)
					|| case when v_att.invited_by is not null then jsonb_build_object(
						'guest_name', (select name from public.members where id = v_att.member_id))
						else '{}'::jsonb end
			);
		end loop;
	end if;

	-- ② 승격: 여유만큼 대기자(position ASC)를 참석으로. 게스트는 상한 미만일 때만(주말=무제한).
	loop
		exit when p_capacity is not null and v_count >= p_capacity;
		select * into v_att from public.attendances
		where session_id = p_session_id and status = 'waitlisted'
			and (invited_by is null or v_gcap is null or v_gcount < v_gcap)
		order by position asc
		for update skip locked
		limit 1;
		exit when not found;

		update public.attendances
		set status = 'confirmed', confirmed_at = now(), updated_at = now()
		where session_id = v_att.session_id and member_id = v_att.member_id;
		v_count := v_count + 1;
		if v_att.invited_by is not null then v_gcount := v_gcount + 1; end if;
		v_promoted := v_promoted + 1;
		insert into public.notifications(recipient_member_id, type, session_id, payload)
		values (
			coalesce(v_att.invited_by, v_att.member_id), 'promoted', p_session_id,
			jsonb_build_object('session_id', p_session_id)
				|| case when v_att.invited_by is not null then jsonb_build_object(
					'guest_name', (select name from public.members where id = v_att.member_id))
					else '{}'::jsonb end
		);
	end loop;

	update public.session_counters set confirmed_count = v_count where session_id = p_session_id;
	return jsonb_build_object('promoted', v_promoted, 'demoted', v_demoted);
end;
$$;

revoke execute on function public.set_session_capacity(bigint, int) from anon;
grant execute on function public.set_session_capacity(bigint, int) to authenticated;

-- ------------------------------------------------------------
-- (B) 백필 — open 세션의 confirmed_count 를 "비운영진 확정 인원"으로 재계산하고,
--     운영진 제외로 생긴 빈 정원은 대기자를 조용히(알림 없이) 승급시켜 채운다.
--     active/closed 는 건드리지 않는다(보드 편입/정산 이후라 정합성 위험).
--     또한 과거 규칙에서 대기(waitlisted)로 접수됐을 수 있는 운영진은 확정으로 되돌린다(정원 미점유).
-- ------------------------------------------------------------
do $$
declare
	v_sess record;
	v_prom public.attendances%rowtype;
begin
	for v_sess in select id, capacity from public.sessions where status = 'open' loop
		insert into public.session_counters(session_id) values (v_sess.id)
			on conflict (session_id) do nothing;
		perform 1 from public.session_counters where session_id = v_sess.id for update;

		-- 과거 대기로 잡힌 운영진 → 확정(카운터엔 안 셈).
		update public.attendances a
		set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), updated_at = now()
		where a.session_id = v_sess.id and a.status = 'waitlisted'
			and public.is_operator(a.member_id);

		-- confirmed_count = 비운영진 확정 인원.
		update public.session_counters sc
		set confirmed_count = (
			select count(*) from public.attendances a
			where a.session_id = v_sess.id and a.status = 'confirmed'
				and not public.is_operator(a.member_id)
		)
		where sc.session_id = v_sess.id;

		-- 빈 정원을 대기자로 조용히 채움(알림 없음).
		loop
			exit when v_sess.capacity is not null
				and (select confirmed_count from public.session_counters
					where session_id = v_sess.id) >= v_sess.capacity;
			v_prom := public.promote_next_waitlisted(v_sess.id);
			exit when v_prom.member_id is null;
		end loop;
	end loop;
end $$;
