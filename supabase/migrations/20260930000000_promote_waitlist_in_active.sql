-- 진행중(active) 세션에서도 대기 승격.
--
-- 배경(2026-09-30 세션 219 사고): 20260715100000 이 진행중 세션 참여(join_session)를 열면서
--   승격 경로(cancel_attendance / admin_cancel_attendance / set_session_capacity)의 `status='open'`
--   게이트는 그대로 남았다. '경기 시작' 뒤로는 취소가 나와도 아무도 안 올라가(정원 16·확정 14·대기 8),
--   그 빈자리를 **새로 신청한 사람이 대기 8명을 건너뛰고** 가져갔다(join_session 은 active 도 여유면 확정).
--
-- 변경:
--   ① cancel_attendance / admin_cancel_attendance — 승격 게이트 open → (open|active). 본문은 20260904000000 그대로.
--   ② set_session_capacity — active 면 카운터 치유 + **빈자리만큼 승격만** 한다(재배분·강등 없음:
--      경기 중인 사람을 대기로 내리지 않는다). 본문의 open 분기는 20260921000000 그대로.
--   ③ promote_waitlist_fill — 세션이 active 면 승격자를 보드 명단(session_players, waiting)에 넣는다.
--      join_session 의 active·confirmed 반영과 같은 스냅샷·멱등(on conflict do nothing).
--      승격 자격식(promote_next_waitlisted)은 손대지 않는다.
--   ④ 백필 — 지금 진행중인 세션의 빈자리를 채운다.
--   set_late_minutes 는 원래 open 에서만 동작하므로 범위 밖.

create or replace function public.promote_waitlist_fill(p_session_id bigint)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
	v_promote public.attendances%rowtype;
	v_active  boolean;
	v_n       int := 0;
	v_i       int;
begin
	select status = 'active' into v_active from public.sessions where id = p_session_id;
	for v_i in 1..200 loop   -- 폭주 방지 상한(정상 상황에선 0~2회)
		v_promote := public.promote_next_waitlisted(p_session_id);
		exit when v_promote.member_id is null;
		v_n := v_n + 1;
		insert into public.notifications(recipient_member_id, type, session_id, payload)
		values (coalesce(v_promote.invited_by, v_promote.member_id), 'promoted', p_session_id,
			jsonb_build_object('session_id', p_session_id)
				|| case when v_promote.invited_by is not null then jsonb_build_object(
					'guest_name', (select name from public.members where id = v_promote.member_id))
					else '{}'::jsonb end);
		-- 진행중이면 보드 명단에 즉시 반영(join_session 의 active·confirmed 반영과 동일).
		if v_active then
			insert into public.session_players
				(session_id, player_id, member_id, name, gender, skills, status, wait_since)
			select
				p_session_id, m.id::text, m.id, m.name, m.gender,
				case when m.skills ? 'grade' then m.skills else jsonb_build_object('grade', 5) end,
				'waiting', now()
			from public.members m
			where m.id = v_promote.member_id
			on conflict (session_id, player_id) do nothing;
		end if;
	end loop;
	return v_n;
end;
$$;
revoke execute on function public.promote_waitlist_fill(bigint) from public, anon, authenticated;

create or replace function public.cancel_attendance(p_session_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_member uuid := public.current_member_id();
	v_status text;
	v_self   public.attendances%rowtype;
begin
	if v_member is null then raise exception 'not authenticated'; end if;

	select status into v_status from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status in ('closed', 'cancelled') then raise exception 'session ended'; end if;

	perform public.session_counter_sync(p_session_id);   -- 카운터 잠금 + 드리프트 치유

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	if not found or v_self.status = 'cancelled' then return; end if;

	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		late_minutes = 0, cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = v_member;

	-- 티켓 환원/불참 차감. capacity_exempt·exempt_reason 은 **지우지 않는다** — 취소된 행의
	--   자리 성격은 기록으로 남긴다. 회차 상한 계수는 status 로 취소 행을 걸러내므로
	--   (wait_ticket_session_used) 취소하면 슬롯이 저절로 돌아온다.
	perform public.wait_ticket_on_cancel(p_session_id, v_member, false);

	perform public.session_counter_sync(p_session_id);   -- 취소 반영(±1 산술 대신 재계산)

	-- 확정자였는지와 무관하게 open·active 세션이면 빈자리를 채운다(치유로 자리가 드러날 수 있음).
	if v_status in ('open', 'active') then
		perform public.promote_waitlist_fill(p_session_id);
	end if;
end;
$$;
grant execute on function public.cancel_attendance(bigint) to authenticated;

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
	v_recipient  uuid;
	v_guest_name text;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	select name into v_by_name from public.members where id = v_actor;

	select status into v_status from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status in ('closed', 'cancelled') then raise exception 'session ended'; end if;

	perform public.session_counter_sync(p_session_id);

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = p_member_id for update;
	if not found then raise exception 'attendance not found'; end if;
	if v_self.status = 'cancelled' then return; end if;

	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		late_minutes = 0, cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = p_member_id;

	perform public.wait_ticket_on_cancel(p_session_id, p_member_id, true);

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

	perform public.session_counter_sync(p_session_id);

	if v_status in ('open', 'active') then
		perform public.promote_waitlist_fill(p_session_id);
	end if;
end;
$$;
revoke execute on function public.admin_cancel_attendance(bigint, uuid) from public, anon;
grant execute on function public.admin_cancel_attendance(bigint, uuid) to authenticated;

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

	if v_status = 'active' then
		-- 진행중: 재배분·강등 없이 빈자리만큼 승격만(경기 중인 사람을 대기로 내리지 않는다).
		perform public.session_counter_sync(p_session_id);
		v_promoted := public.promote_waitlist_fill(p_session_id);
		return jsonb_build_object('promoted', v_promoted, 'demoted', 0);
	end if;

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

-- ④ 백필: 진행중 세션의 멈춘 대기를 지금 채운다.
do $$
declare r record;
begin
	for r in select id from public.sessions where status = 'active' loop
		perform public.promote_waitlist_fill(r.id);
	end loop;
end;
$$;
