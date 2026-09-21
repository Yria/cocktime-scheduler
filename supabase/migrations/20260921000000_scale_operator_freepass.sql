-- 운영진 프리패스 기준을 세션 정원에 비례하도록 변경한다.
-- 확정 운영진 총수 < max(2, floor(capacity / 8)): 24·28명 → 3명, 32명 → 4명.
-- 정원 안 운영진도 총수에 포함하며, 장소의 대관비 게이트·정원 카운트 방식은 유지한다.
-- 무제한 정원(NULL)은 정원 여유 분기에서 처리하므로 프리패스 한도가 필요하지 않다.
-- 신청·승격·늦참 복귀·정원 재배분·티켓 안내가 동일한 기준을 사용한다.

create or replace function public.operator_freepass_limit(p_capacity int)
returns int
language sql immutable set search_path = ''
as $$
	select greatest(2, coalesce(p_capacity, 0) / 8);
$$;
revoke execute on function public.operator_freepass_limit(int) from public, anon, authenticated;
comment on function public.operator_freepass_limit(int) is
	'운영진 프리패스 기준 인원: max(2, floor(세션 정원 / 8)). 정원 안 운영진을 포함한 확정 운영진 총수와 비교한다.';

create or replace function public.join_session(
	p_session_id bigint,
	p_use_ticket boolean default false
)
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
	v_reason       text;
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
		-- 정원 여유 → 확정(회원/운영진 공통). 여기서는 티켓을 쓰지 않는다 —
		--   p_use_ticket=true 로 와도 공짜로 들어갈 수 있으면 소모하지 않는다(분기 순서가 곧 정책이다).
		v_new := 'confirmed';
		update public.session_counters set confirmed_count = v_count + 1
			where session_id = p_session_id;
	else
		-- 만석 — 예외 세 갈래를 **순서대로** 본다.
		if public.session_op_free(p_session_id) then
			-- 부과없음 일정의 두 프리패스(각자 별도 상한). 종전 그대로.
			select count(*) into v_ocount from public.attendances
			where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);

			if public.is_operator(v_member) and v_ocount < public.operator_freepass_limit(v_capacity) then
				-- ① 운영진 프리패스 — 종전대로 **정원 카운트에 든다**(초과분이 카운터에 남는다).
				v_new := 'confirmed';
				update public.session_counters set confirmed_count = v_count + 1
					where session_id = p_session_id;
			elsif public.session_newbie_grace(p_session_id, v_member) then
				-- ② 신규회원 2주 프리패스 — **정원 외 자리**. 카운터를 올리지 않는다.
				v_new := 'confirmed';
				v_exempt := true;
				v_reason := 'newbie';
			end if;
		end if;

		-- ③ 우선참여권(티켓) — **session_op_free 게이트 밖**이다(C5: 모든 일정).
		--    ①② 뒤에 오므로 공짜로 들어갈 수 있는 사람은 티켓을 절대 소모하지 않는다.
		--    상한·잔액 검사는 session_counters FOR UPDATE(session_counter_sync) 안쪽이라
		--    같은 회차의 동시 신청이 직렬화된다 — 게스트 상한과 같은 규약(20260712010000:15-22).
		if v_new is null and p_use_ticket then
			if public.wait_ticket_session_used(p_session_id) >= public.wait_ticket_session_cap() then
				raise exception 'ticket_session_cap';
			end if;
			if public.wait_points_recount(v_member) < public.wait_ticket_cost() then
				raise exception 'ticket_insufficient';
			end if;
			v_new := 'confirmed';
			v_exempt := true;
			v_reason := 'ticket';
			perform public.wait_points_write(
				v_member, p_session_id, 'spend', -public.wait_ticket_cost(),
				jsonb_build_object('reason', 'join'));
			-- 실패는 전부 **예외**다 → 트랜잭션이 통째로 롤백되므로
			--   "차감됐는데 자리를 못 받은" 상태는 구조적으로 존재할 수 없다.
		end if;

		if v_new is null then v_new := 'waitlisted'; end if;
	end if;

	v_pos := nextval('public.attendance_position_seq');

	if v_has_existing then
		update public.attendances set
			status = v_new, position = v_pos, requested_at = now(),
			confirmed_at = case when v_new = 'confirmed' then now() else null end,
			capacity_exempt = v_exempt,   -- 재신청이면 지난 자리의 성격을 물려받지 않게 항상 덮어쓴다
			exempt_reason = v_reason,     -- capacity_exempt 와 항상 쌍으로
			cancelled_at = null, updated_at = now()
		where session_id = p_session_id and member_id = v_member
		returning * into v_result;
	else
		insert into public.attendances(
			session_id, member_id, status, position, confirmed_at, capacity_exempt, exempt_reason)
		values (p_session_id, v_member, v_new, v_pos,
			case when v_new = 'confirmed' then now() else null end, v_exempt, v_reason)
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
revoke execute on function public.join_session(bigint, boolean) from anon;
grant execute on function public.join_session(bigint, boolean) to authenticated;

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
	--   게스트 상한 통과 && ( 정원 여유 || 부과없음 운영진 프리패스(확정 운영진 총수 < 정원별 기준 인원) ).
	--   신규 프리패스는 **여기에 없다** — 부여는 join_session / set_late_minutes 에서만.
	--   **우선참여권(티켓)도 여기에 없다**(20260904000000). 넣으면 정원 안 대기 1순위가 티켓 보유자에게
	--   영구 추월당해, 대기 구제가 목적인 기능이 대기 1번을 막는 역설이 된다. 재론 금지.
	select * into v_promote from public.attendances a
	where a.session_id = p_session_id and a.status = 'waitlisted'
		and (a.invited_by is null or v_gcap is null or v_gcount < v_gcap)
		and (
			(v_capacity is null or v_count < v_capacity)
			or (v_opfree and v_ocount < public.operator_freepass_limit(v_capacity) and public.is_operator(a.member_id))
		)
	order by a.position asc
	for update
	limit 1;
	if not found then return v_promote; end if;

	update public.attendances
	set status = 'confirmed', confirmed_at = now(), updated_at = now(),
		capacity_exempt = false,                     -- 승격은 언제나 '정원 안' 자리다
		exempt_reason = null                         -- 정원 외 사유도 함께 내려놓는다(쌍 규약)
	where session_id = v_promote.session_id and member_id = v_promote.member_id;
	update public.session_counters set confirmed_count = v_count + 1
	where session_id = p_session_id;
	return v_promote;
end;
$$;
revoke execute on function public.promote_next_waitlisted(bigint) from public, anon, authenticated;

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
	v_reason    text;
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
			capacity_exempt = false,       -- 확정 자리를 떠나므로 '정원 외 확정' 성격도 함께 내려놓는다
			exempt_reason = null           -- 쌍 규약. **티켓은 환원하지 않는다** — 원장 spend 가 남아
		                                   --   자리가 그 회차에 묶여 있고, 정시 복귀하면 되찾는다(아래).
		where session_id = p_session_id and member_id = v_member;

		if v_self.status = 'confirmed' then
			perform public.session_counter_sync(p_session_id);   -- 정원 1칸 반납 반영
			v_promoted := public.promote_waitlist_fill(p_session_id);
		end if;

	elsif v_status = 'open' and not v_pool and v_self.status = 'late_pool' then
		-- 정원 외 풀 → 복귀. 여유면 확정, 만석이면 부과없음 프리패스(운영진 총수 < 정원별 기준 인원 / 신규 상한 없음),
		--   그다음 **이미 지불한 티켓 자리 되찾기**, 그 외 대기.
		if v_capacity is null or v_count < v_capacity then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = v_count + 1
				where session_id = p_session_id;
		elsif public.session_op_free(p_session_id) then
			select count(*) into v_ocount from public.attendances
			where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);

			if public.is_operator(v_member) and v_ocount < public.operator_freepass_limit(v_capacity) then
				v_new := 'confirmed';                  -- 운영진 프리패스 = 정원 카운트에 든다
				update public.session_counters set confirmed_count = v_count + 1
					where session_id = p_session_id;
			elsif public.session_newbie_grace(p_session_id, v_member) then
				v_new := 'confirmed';                  -- 신규 프리패스 = 정원 외 자리
				v_exempt := true;
				v_reason := 'newbie';
			end if;
		end if;

		if v_new = 'late_pool' and public.wait_ticket_spent(p_session_id, v_member) then
			-- 이 회차에 이미 티켓을 낸 사람이 정시로 돌아왔다 → **재차감 없이** 자리를 되찾는다.
			--   회차당 상한도 다시 걸지 않는다(이미 산 자리라, 다시 걸면 자기 자리를 남에게 뺏긴다).
			v_new := 'confirmed';
			v_exempt := true;
			v_reason := 'ticket';
		end if;

		if v_new = 'late_pool' then v_new := 'waitlisted'; end if;

		update public.attendances
		set status = v_new, late_minutes = v_min,
			position = nextval('public.attendance_position_seq'),
			confirmed_at = case when v_new = 'confirmed' then now() else null end,
			capacity_exempt = v_exempt,
			exempt_reason = v_reason,
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
	v_exempt   boolean;
	v_reason   text;
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

		if v_att.capacity_exempt and v_att.status = 'confirmed' then
			-- 정원 외 확정 자리(신규 프리패스 · 우선참여권)는 **재배분 대상이 아니다**.
			-- 정원을 소비하지 않으므로 그대로 둔다 — 사유도 그대로 물려받는다.
			v_want := 'confirmed';
			v_exempt := true;
			v_reason := v_att.exempt_reason;
		elsif (p_capacity is null or v_cc < p_capacity)
		   and (not v_isguest or v_gcap is null or v_g < v_gcap) then
			v_want := 'confirmed';                                   -- 정원 여유 + 게스트 상한 여유
			v_exempt := false;
			v_reason := null;
		elsif v_opfree and v_isop and v_o < public.operator_freepass_limit(p_capacity) then
			v_want := 'confirmed';                                   -- 부과없음 운영진 프리패스
			v_exempt := false;
			v_reason := null;
		else
			-- 대기자에게 정원 외 자리를 **새로 주지는 않는다** — 부여는 본인이 누른 순간에만.
			v_want := 'waitlisted';
			v_exempt := false;
			v_reason := null;
		end if;

		if v_want = 'confirmed' then
			if not v_exempt then v_cc := v_cc + 1; end if;           -- 정원 외 자리는 정원을 소비하지 않는다
			if v_isop then v_o := v_o + 1; end if;                   -- 운영진 총수는 정원 외도 포함(기존 규칙)
			if v_isguest then v_g := v_g + 1; end if;
		end if;

		if v_want <> v_att.status
			or v_exempt is distinct from v_att.capacity_exempt
			or v_reason is distinct from v_att.exempt_reason then
			update public.attendances
			set status = v_want,
				capacity_exempt = v_exempt,
				exempt_reason = v_reason,
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
revoke execute on function public.set_session_capacity(bigint, int) from anon;
grant execute on function public.set_session_capacity(bigint, int) to authenticated;

create or replace function public.wait_ticket_options(p_session_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_member   uuid := public.current_member_id();
	v_bal      int;
	v_cost     int := public.wait_ticket_cost();
	v_cap      int := public.wait_ticket_session_cap();
	v_used     int;
	v_capacity int;
	v_status   text;
	v_count    int;
	v_reason   text;
begin
	if v_member is null then raise exception 'not authenticated'; end if;
	v_bal  := public.wait_points_recount(v_member);
	v_used := public.wait_ticket_session_used(p_session_id);

	select capacity, status into v_capacity, v_status
	from public.sessions where id = p_session_id;
	if not found then raise exception 'session not found'; end if;

	-- 여기서는 카운터를 **읽기만** 한다(session_counter_sync 는 쓰기 잠금이라 조회 RPC 에서 부르지 않는다).
	select count(*)::int into v_count from public.attendances
	where session_id = p_session_id and status = 'confirmed' and not capacity_exempt;

	if public.wait_ticket_spent(p_session_id, v_member) then v_reason := 'already_spent';
	elsif v_status not in ('open', 'active')                then v_reason := 'not_open';
	elsif v_capacity is null or v_count < v_capacity        then v_reason := 'not_full';
	elsif public.session_op_free(p_session_id)
		and (public.session_newbie_grace(p_session_id, v_member)
			or (public.is_operator(v_member) and (
				select count(*) from public.attendances
				where session_id = p_session_id and status = 'confirmed'
					and public.is_operator(member_id)) < public.operator_freepass_limit(v_capacity)))
	                                                        then v_reason := 'free_pass';
	elsif v_bal < v_cost                                    then v_reason := 'insufficient';
	elsif v_used >= v_cap                                   then v_reason := 'session_cap';
	else                                                         v_reason := 'ok';
	end if;

	return jsonb_build_object(
		'reason',      v_reason,
		'balance',     v_bal,
		'cost',        v_cost,
		'used',        v_used,
		'session_cap', v_cap
	);
end;
$$;
revoke execute on function public.wait_ticket_options(bigint) from public, anon;
grant execute on function public.wait_ticket_options(bigint) to authenticated;
