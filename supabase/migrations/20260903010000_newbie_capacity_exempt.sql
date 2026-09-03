-- ============================================================
-- 신규회원 프리패스 자리를 **정원 카운트에서 완전히 빼낸다**(정원 외 자리).
--
-- 왜: 지금까지 프리패스 자리는 confirmed_count 에 섞여 있었다. 그래서 정원 5 + 신규 1 = 확정 6 인
--   상태에서 정원 안 회원이 취소되면 확정이 5(=정원)로 떨어질 뿐 **정원 미달이 아니어서 아무도
--   승격되지 않았다** — 빠진 자리가 신규의 초과분을 상쇄하는 데 쓰인 셈이다.
--   대기 1번 입장에서는 "확정자가 취소했는데 왜 내 순서가 오지 않나"가 되어 불만이 컸다(운영자 보고).
--
-- 바꾸는 것: `attendances.capacity_exempt` 를 두고, 신규 프리패스로 들어온 자리는 이 값을 true 로 남긴다.
--   `session_counter_sync` 가 이 행을 **세지 않으므로** 정원 안 자리는 언제나 capacity 칸이 그대로 있다.
--     · 정원 5 + 신규 1(정원 외) → 참석 6명, 카운터 5
--     · 정원 안 회원 1명 취소   → 카운터 4 < 5 → **대기 1번 즉시 승격** → 참석 6명 유지
--   즉 프리패스는 "정원 안 빈자리를 흡수하는 것"이 아니라 "정원 밖에 자리를 하나 더 만드는 것"이 된다.
--   정원외늦참(late_pool)이 이미 쓰는 모델과 같다 — 다만 늦참은 confirmed 가 아니어서 자동으로 빠지고,
--   이쪽은 confirmed 이면서 정원만 소비하지 않으므로 플래그가 필요하다.
--
-- **운영진 프리패스는 손대지 않는다**(재론 금지 — 20260806020000). 운영진 초과 확정은 종전대로
--   카운터에 들어가고 '확정 운영진 총수 < 2' 로 판정한다. 두 프리패스의 성격이 갈리는 것은 의도다:
--   운영진은 정원을 함께 쓰는 구성원이고, 신규 유예는 정원과 무관한 한시적 예외다.
--
-- 파생이 아니라 **기록**으로 바꾼 부수 효과(전부 이득):
--   · 취소가 나도 신규가 정원 안으로 슬며시 들어오지 않는다(자리 성격이 고정된다).
--   · 정원을 낮춰도 정원 외 자리는 살아남고, 정원 안 자리들끼리만 다시 줄을 선다.
--     (종전에는 position 순 파생이라 정원을 낮추면 더 늦게 신청한 신규가 남고 먼저 신청한 회원이
--      강등되는 순서 역전이 보였다.)
--   · 유예가 끝나도 이미 받은 자리는 재계산으로 사라지지 않는다.
--
-- 부여 지점은 그대로 본인이 누른 순간뿐이다 — join_session, set_late_minutes(정시 복귀).
--   승격 루프(promote_next_waitlisted)는 신규 분기가 없고, 승격은 언제나 정원 안 자리다.
--
-- attendances 에는 SELECT 정책만 있어 모든 쓰기가 SECURITY DEFINER RPC 를 통과한다
--   (20260621020000) → 새 컬럼을 클라이언트가 직접 세팅할 경로가 없다. 별도 가드 불필요.
--
-- 대상: attendances(+컬럼) / session_counter_sync / join_session / promote_next_waitlisted
--       / set_late_minutes / set_session_capacity. 백필 없음 — 적용 시점에 정원 초과 확정 행이 0건이었다.
-- ============================================================

alter table public.attendances
	add column if not exists capacity_exempt boolean not null default false;

comment on column public.attendances.capacity_exempt is
	'true = 정원을 소비하지 않는 확정 자리(정원 외). session_counter_sync 가 이 행을 세지 않는다. 현재 유일한 생성 경로는 신규회원 2주 프리패스(join_session / set_late_minutes 정시 복귀). 운영진 프리패스는 종전대로 정원 카운트에 든다.';

-- ------------------------------------------------------------
-- session_counter_sync — confirmed_count 의 뜻을 '정원을 소비하는 확정 인원'으로 좁힌다.
--   정원 외 자리(capacity_exempt)는 빠지므로, 모든 정원 판정 지점이 자동으로 새 규칙을 따른다.
--   자가 치유 성질(실제 행 수로 덮어쓰기)은 그대로 — 20260806010000 의 유령 자리 사고 방지책이다.
-- ------------------------------------------------------------
create or replace function public.session_counter_sync(p_session_id bigint)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
	v_stored int;
	v_actual int;
begin
	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_stored
	from public.session_counters where session_id = p_session_id for update;

	select count(*)::int into v_actual from public.attendances
	where session_id = p_session_id and status = 'confirmed'
		and not capacity_exempt;

	if v_stored is distinct from v_actual then
		update public.session_counters set confirmed_count = v_actual
		where session_id = p_session_id;
	end if;
	return v_actual;
end;
$$;
revoke execute on function public.session_counter_sync(bigint) from public, anon, authenticated;

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
	--   신규 프리패스는 위 주석대로 **여기에 없다** — 부여는 join_session / set_late_minutes 에서만.
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
	set status = 'confirmed', confirmed_at = now(), updated_at = now(),
		capacity_exempt = false                      -- 승격은 언제나 '정원 안' 자리다
	where session_id = v_promote.session_id and member_id = v_promote.member_id;
	update public.session_counters set confirmed_count = v_count + 1
	where session_id = p_session_id;
	return v_promote;
end;
$$;

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
	v_exempt       boolean := false;
begin
	if v_member is null then raise exception 'not authenticated'; end if;
	-- 비활성 회원은 신청할 수 없다. 게이트가 없던 동안, 정지된 사람이(또는 본인 탈퇴 후 다시 로그인한
	--   사람이) 신청하면 attendances 에는 남는데 명단·편성(fetchMembers 가 is_active 로 걸러냄)에는
	--   안 나오는 유령 행이 됐다 — 20260819030000 이 게스트 쪽에서 지적한 "신청은 됐는데 보드에 없는"
	--   상태와 같은 종류다. 게스트는 add_guest_attendance 를 쓰고 그쪽은 이미 is_active 를 본다.
	--   (20260821020000 에서 들어온 게이트 — join_session 재정의 시 반드시 함께 옮긴다.)
	if not exists (select 1 from public.members where id = v_member and is_active) then
		raise exception 'member inactive';
	end if;

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
	elsif public.session_op_free(p_session_id) then
		-- 만석인 부과없음 일정 → 프리패스 두 갈래(각자 별도 상한).
		select count(*) into v_ocount from public.attendances
		where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);

		if public.is_operator(v_member) and v_ocount < 2 then
			-- ① 운영진 프리패스 — 종전대로 **정원 카운트에 든다**(초과분이 카운터에 남는다).
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = v_count + 1
				where session_id = p_session_id;
		elsif public.session_newbie_grace(p_session_id, v_member) then
			-- ② 신규회원 2주 프리패스 — **정원 외 자리**. 카운터를 올리지 않는다(위 헤더 참고).
			v_new := 'confirmed';
			v_exempt := true;
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
			capacity_exempt = v_exempt,   -- 재신청이면 지난 자리의 성격을 물려받지 않게 항상 덮어쓴다
			cancelled_at = null, updated_at = now()
		where session_id = p_session_id and member_id = v_member
		returning * into v_result;
	else
		insert into public.attendances(
			session_id, member_id, status, position, confirmed_at, capacity_exempt)
		values (p_session_id, v_member, v_new, v_pos,
			case when v_new = 'confirmed' then now() else null end, v_exempt)
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
	v_exempt    boolean := false;
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
		set status = 'late_pool', late_minutes = v_min, confirmed_at = null, updated_at = now(),
			capacity_exempt = false        -- 확정 자리를 떠나므로 '정원 외 확정' 성격도 함께 내려놓는다
		where session_id = p_session_id and member_id = v_member;

		if v_self.status = 'confirmed' then
			perform public.session_counter_sync(p_session_id);   -- 정원 1칸 반납 반영
			v_promoted := public.promote_waitlist_fill(p_session_id);
		end if;

	elsif v_status = 'open' and not v_pool and v_self.status = 'late_pool' then
		-- 정원 외 풀 → 복귀. 여유면 확정, 만석이면 부과없음 프리패스(운영진 총수 < 2 / 신규 상한 없음), 그 외 대기.
		if v_capacity is null or v_count < v_capacity then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = v_count + 1
				where session_id = p_session_id;
		elsif public.session_op_free(p_session_id) then
			select count(*) into v_ocount from public.attendances
			where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);

			if public.is_operator(v_member) and v_ocount < 2 then
				v_new := 'confirmed';                  -- 운영진 프리패스 = 정원 카운트에 든다
				update public.session_counters set confirmed_count = v_count + 1
					where session_id = p_session_id;
			elsif public.session_newbie_grace(p_session_id, v_member) then
				v_new := 'confirmed';                  -- 신규 프리패스 = 정원 외 자리
				v_exempt := true;
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
			capacity_exempt = v_exempt,
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
	v_isnew    boolean;
	v_exempt   boolean;
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
		v_isnew := not v_isguest
			and public.session_newbie_grace(p_session_id, v_att.member_id);

		if v_att.capacity_exempt and v_att.status = 'confirmed' then
			-- 정원 외 확정 자리(신규 프리패스)는 **재배분 대상이 아니다**. 정원을 소비하지 않고 그대로 둔다.
			-- 그래서 정원을 낮춰도 이 자리는 살아남고, 정원 안 자리들끼리만 다시 줄을 선다.
			v_want := 'confirmed';
			v_exempt := true;
		elsif (p_capacity is null or v_cc < p_capacity)
		   and (not v_isguest or v_gcap is null or v_g < v_gcap) then
			v_want := 'confirmed';                                   -- 정원 여유 + 게스트 상한 여유
			v_exempt := false;
		elsif v_opfree and v_isop and v_o < 2 then
			v_want := 'confirmed';                                   -- 부과없음 운영진 프리패스
			v_exempt := false;
		else
			-- 대기 신규에게 정원 외 자리를 **새로 주지는 않는다** — 부여는 본인이 누른 순간에만.
			v_want := 'waitlisted';
			v_exempt := false;
		end if;

		if v_want = 'confirmed' then
			if not v_exempt then v_cc := v_cc + 1; end if;           -- 정원 외 자리는 정원을 소비하지 않는다
			if v_isop then v_o := v_o + 1; end if;                   -- 운영진 총수는 정원 외도 포함(기존 규칙)
			if v_isguest then v_g := v_g + 1; end if;
		end if;

		if v_want <> v_att.status or v_exempt is distinct from v_att.capacity_exempt then
			update public.attendances
			set status = v_want,
				capacity_exempt = v_exempt,
				confirmed_at = case when v_want = 'confirmed' then now() else null end,
				updated_at = now()
			where session_id = p_session_id and member_id = v_att.member_id;
		end if;

		-- 알림은 **상태가 실제로 바뀔 때만**(정원 외 플래그만 정리된 경우는 알리지 않는다).
		if v_want <> v_att.status then

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
revoke execute on function public.promote_next_waitlisted(bigint) from public, anon, authenticated;
grant execute on function public.join_session(bigint) to authenticated;
revoke execute on function public.set_late_minutes(bigint, int) from anon;
grant execute on function public.set_late_minutes(bigint, int) to authenticated;
revoke execute on function public.set_session_capacity(bigint, int) from anon;
grant execute on function public.set_session_capacity(bigint, int) to authenticated;
