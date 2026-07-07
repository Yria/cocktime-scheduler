-- 대기 승급 'promoted' 알림의 수신자·문구 버그 수정 — cancel_attendance / cancel_guest_attendance.
-- 두 함수 모두 set_session_capacity / admin_cancel_attendance 와 알림 발송 패턴을 통일한다.
-- (승급 로직·잠금·카운터는 기존과 동일 — 알림 INSERT 만 교체)
--
-- ① cancel_attendance(20260706030000): 승급 알림을 recipient = v_promote.member_id 로 "직접"
--    보내고 guest_name 도 싣지 않았다. 승급 대상이 게스트면 게스트는 계정·푸시구독이 없고
--    RLS 로 본인 것만 조회되므로, 초대 회원은 "내 게스트가 확정됐다"는 알림을 영영 받지 못했다(유실).
--    → recipient = coalesce(invited_by, member_id) 로 라우팅 + 게스트면 guest_name 실음.
--
-- ② cancel_guest_attendance(20260624010000): 수신자 라우팅(coalesce)은 이미 맞으나 guest_name 누락
--    → 초대 회원에게 "대기자에서 확정" 이라는 (본인이 확정된 듯한) 문구가 갔다.
--    → 게스트면 guest_name 실어 "게스트 X 확정" 으로 렌더되게 한다.
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

	-- 참석 취소와 함께 카풀 의향·늦참 오프셋도 해제
	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		late_minutes = 0, cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = v_member;

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
				-- 승급 대상이 게스트(invited_by 有)면 초대 회원에게 guest_name 과 함께 통지
				-- (게스트는 계정·푸시구독 없음 → 직접 보내면 유실). set_session_capacity 와 동일 패턴.
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

-- ② cancel_guest_attendance: 라우팅은 유지, 승급 알림 payload 에 guest_name 만 병합.
create or replace function public.cancel_guest_attendance(
	p_session_id bigint, p_guest_member_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_inviter uuid := public.current_member_id();
	v_status  text;
	v_self    public.attendances%rowtype;
	v_promote public.attendances%rowtype;
begin
	if v_inviter is null then raise exception 'not authenticated'; end if;

	select status into v_status from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status in ('closed','cancelled') then raise exception 'session ended'; end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	perform 1 from public.session_counters where session_id = p_session_id for update;

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = p_guest_member_id for update;
	if not found then raise exception 'guest not found'; end if;
	-- 소유권: 내가 데려온 게스트만 취소 가능
	if v_self.invited_by is distinct from v_inviter then raise exception 'not your guest'; end if;
	if v_self.status = 'cancelled' then return; end if;

	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = p_guest_member_id;

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
				-- 승급 알림: 회원이면 본인, 게스트면 초대 회원(계정 없는 게스트는 푸시 수신 불가) + guest_name.
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

grant execute on function public.cancel_guest_attendance(bigint, uuid) to authenticated;
