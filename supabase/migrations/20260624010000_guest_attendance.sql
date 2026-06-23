-- ============================================================
-- 게스트 RSVP — 회원이 일정에 게스트(계정 없는 선수)를 신청
--
-- 모델: 게스트 = is_guest member 행 + 자기 attendance 행 + attendances.invited_by(데려온 회원).
--  - members 테이블에 이미 is_guest/nullable auth_user_id가 있어 "계정 없는 회원"으로 표현(EXPANSION_SPEC §1).
--  - 보드 편입 브릿지(start_session_from_schedule)가 members를 JOIN하므로 게스트도 자동 편입(코드 변경 0).
--  - 게스트도 정원/대기 규칙을 회원과 동일하게(session_counters) 적용.
--  - 일반 회원이 게스트 member를 만들어야 하므로 RPC는 SECURITY DEFINER(직접 INSERT 정책 추가 안 함).
-- ============================================================

-- ① 게스트를 데려온 회원(본인 참석은 NULL).
alter table public.attendances
	add column if not exists invited_by uuid references public.members(id) on delete set null;
create index if not exists idx_att_invited_by on public.attendances(session_id, invited_by);

-- ② 게스트 신청: is_guest member 생성 + 정원 판정 attendance(invited_by=초대 회원).
--    join_session 패턴(노출 시각 가드 + session_counters FOR UPDATE 정원 판정)을 복제.
create or replace function public.add_guest_attendance(
	p_session_id bigint, p_name text, p_gender text, p_skills jsonb
) returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_inviter      uuid := public.current_member_id();
	v_guest        uuid;
	v_capacity     int;
	v_status       text;
	v_scheduled_at timestamptz;
	v_count        int;
	v_new          text;
	v_pos          bigint;
	v_result       public.attendances%rowtype;
begin
	if v_inviter is null then raise exception 'not authenticated'; end if;
	if p_name is null or btrim(p_name) = '' then raise exception 'guest name required'; end if;
	if p_gender not in ('M','F') then raise exception 'guest gender required'; end if;

	select capacity, status, scheduled_at into v_capacity, v_status, v_scheduled_at
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;
	if v_scheduled_at is not null and v_scheduled_at > now() + interval '7 days' then
		raise exception 'session not open yet';
	end if;

	-- 게스트 member 생성(계정 없음). 회원관리/선수명단은 is_guest로 필터해 노출하지 않는다.
	insert into public.members(name, gender, skills, is_guest)
	values (btrim(p_name), p_gender, coalesce(p_skills, '{}'::jsonb), true)
	returning id into v_guest;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	if v_capacity is null or v_count < v_capacity then
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

-- ③ 게스트 취소: 초대 회원(invited_by) 본인만. 취소 + 카풀 해제 + 대기 1순위 승급.
--    cancel_attendance 패턴 복제. 승급 알림은 게스트면 초대 회원에게(게스트는 계정 없음).
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
				-- 승급 알림: 회원이면 본인, 게스트면 초대 회원(계정 없는 게스트는 푸시 수신 불가).
				insert into public.notifications(recipient_member_id, type, session_id, payload)
				values (coalesce(v_promote.invited_by, v_promote.member_id), 'promoted', p_session_id,
					jsonb_build_object('session_id', p_session_id));
			end if;
		end if;
	end if;
end;
$$;

revoke execute on function public.cancel_guest_attendance(bigint, uuid) from anon;
grant execute on function public.cancel_guest_attendance(bigint, uuid) to authenticated;
