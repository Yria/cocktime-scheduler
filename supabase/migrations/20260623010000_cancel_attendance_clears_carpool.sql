-- 참석 취소 시 카풀 의향(carpool_role/carpool_seats)도 함께 해제
-- 사유: cancel_attendance 가 status='cancelled' 만 찍고 carpool_role 은 그대로 둬서,
--   ① 취소했는데 카풀 신청/필요자로 데이터가 남고
--   ② join_session 으로 재참석하면 carpool_role 이 살아나 본인 의사와 무관하게 운전/탑승자로 복귀.
-- cancel_attendance 를 다시 정의(create or replace)하고, 기존 취소 행도 1회 정리한다.
-- 본문은 20260621030000 정의를 그대로 두고 취소 UPDATE 에 carpool 초기화만 추가.

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

	-- 참석 취소와 함께 카풀 의향도 해제(취소했는데 운전/탑승자로 남지 않도록)
	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		cancelled_at = now(), updated_at = now()
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

grant execute on function public.cancel_attendance(bigint) to authenticated;

-- 기존에 취소됐지만 carpool_role 이 남아있는 행 1회 정리(재참석 시 의향 부활 방지)
update public.attendances
set carpool_role = 'none', carpool_seats = null, updated_at = now()
where status = 'cancelled' and (carpool_role <> 'none' or carpool_seats is not null);
