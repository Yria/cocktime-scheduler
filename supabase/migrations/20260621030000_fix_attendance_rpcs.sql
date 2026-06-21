-- Phase 5 hotfix: join_session/cancel_attendance/promote_waitlist 재정의(create or replace)
-- 사유: 직전 대시보드 직접 적용 시 함수 본문이 잘려 attendances INSERT가 누락된 채
--       session_counters만 증가하는 불일치가 관찰됨. 전체 함수를 다시 정의한다.
-- 테이블/정책/시퀀스는 20260621020000에서 이미 생성됨(여기서는 함수만).

create or replace function public.join_session(p_session_id bigint)
returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_member   uuid := public.current_member_id();
	v_capacity int;
	v_status   text;
	v_count    int;
	v_existing public.attendances%rowtype;
	v_result   public.attendances%rowtype;
	v_new      text;
	v_pos      bigint;
begin
	if v_member is null then raise exception 'not authenticated'; end if;

	select capacity, status into v_capacity, v_status
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	select * into v_existing from public.attendances
	where session_id = p_session_id and member_id = v_member for update;

	if found and v_existing.status in ('confirmed','waitlisted') then
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

	if found then
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

	return v_result;
end;
$$;

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

	update public.attendances set status = 'cancelled', cancelled_at = now(), updated_at = now()
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
				insert into public.notifications(recipient_member_id, type, session_id, payload)
				values (v_promote.member_id, 'promoted', p_session_id,
					jsonb_build_object('session_id', p_session_id));
			end if;
		end if;
	end if;
end;
$$;

create or replace function public.promote_waitlist(p_session_id bigint)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
	v_capacity int;
	v_count    int;
	v_att      public.attendances%rowtype;
	v_promoted int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	select capacity into v_capacity from public.sessions where id = p_session_id;
	if not found then raise exception 'session not found'; end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	loop
		exit when v_capacity is not null and v_count >= v_capacity;
		select * into v_att from public.attendances
		where session_id = p_session_id and status = 'waitlisted'
		order by position asc
		for update skip locked
		limit 1;
		exit when not found;

		update public.attendances set status = 'confirmed', confirmed_at = now(), updated_at = now()
		where session_id = v_att.session_id and member_id = v_att.member_id;
		v_count := v_count + 1;
		v_promoted := v_promoted + 1;
		insert into public.notifications(recipient_member_id, type, session_id, payload)
		values (v_att.member_id, 'promoted', p_session_id,
			jsonb_build_object('session_id', p_session_id));
	end loop;

	update public.session_counters set confirmed_count = v_count where session_id = p_session_id;
	return v_promoted;
end;
$$;

grant execute on function public.join_session(bigint) to authenticated;
grant execute on function public.cancel_attendance(bigint) to authenticated;
grant execute on function public.promote_waitlist(bigint) to authenticated;
