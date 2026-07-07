-- 운영진이 참여목록에서 임의 참석자(회원/게스트)를 제거.
-- cancel_attendance / cancel_guest_attendance 패턴 복제 + is_admin() 게이팅.
--  - 대상이 confirmed 였고 세션이 open 이면 대기 1순위 자동 승급(+promoted 알림, 게스트면 초대회원에게 게스트 이름(guest_name)과 함께).
--  - 제거 당사자에게 'removed' 알림 발송(누가 제거했는지 by_name 포함). 게스트는 계정이 없어
--    초대 회원(invited_by)에게 게스트 이름(guest_name)과 함께 통지. 수신자가 운영진 본인이면 생략.
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

	-- 참석 취소 + 카풀 의향·늦참 오프셋 해제(재참석 시 오래된 값 부활 방지 — cancel_attendance 와 동일).
	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		late_minutes = 0, cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = p_member_id;

	-- 제거 알림: 게스트(invited_by 有)면 초대 회원에게 게스트 이름과 함께, 회원이면 본인에게.
	-- 수신자가 운영진 본인(본인 게스트를 본인이 제거 등)이면 통지 생략.
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

	-- 확정자였으면 카운터 감소 + open 이면 대기 1순위 자동 승급(cancel_attendance 와 동일).
	if v_self.status = 'confirmed' then
		update public.session_counters set confirmed_count = confirmed_count - 1
			where session_id = p_session_id;

		if v_status = 'open' then
			select * into v_promote from public.attendances
			where session_id = p_session_id and status = 'waitlisted'
			order by position asc
			for update skip locked
			limit 1;

			if found then
				update public.attendances set status = 'confirmed', confirmed_at = now(), updated_at = now()
				where session_id = v_promote.session_id and member_id = v_promote.member_id;
				update public.session_counters set confirmed_count = confirmed_count + 1
					where session_id = p_session_id;
				-- 승급 대상이 게스트(invited_by 有)면 payload 에 guest_name 을 실어, 초대 회원에게
				-- "내 게스트가 확정" 으로 렌더되게 한다(set_session_capacity 승급 알림과 동일 패턴).
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
