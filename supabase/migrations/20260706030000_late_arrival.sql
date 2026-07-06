-- 늦참(late arrival) 체크: 참석자가 세션별로 "몇 시에 도착" 을 30분 단위로 표시.
-- carpool_role 과 동일 패턴 — attendances 에 개인 오프셋 컬럼 1개 + 설정 RPC.
-- 절대 도착시각이 아니라 scheduled_at 기준 오프셋(분)으로 저장해 시각이 바뀌어도 의미 유지.

-- ① 도착 오프셋 컬럼 (0 = 정시, 30·60·90… = 늦는 분)
alter table public.attendances
	add column if not exists late_minutes int not null default 0
		check (late_minutes >= 0 and late_minutes % 30 = 0);

-- ② 본인 늦참(도착 오프셋) 설정 — 참석자만. set_carpool_role 미러링 + 세션 길이 상한.
create or replace function public.set_late_minutes(p_session_id bigint, p_minutes int)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_member uuid := public.current_member_id();
	v_start  timestamptz;
	v_end    timestamptz;
	v_max    int;
	v_min    int := p_minutes;
begin
	if v_member is null then raise exception 'not authenticated'; end if;
	if v_min is null or v_min < 0 or v_min % 30 <> 0 then
		raise exception 'invalid minutes';
	end if;

	select scheduled_at, ends_at into v_start, v_end
	from public.sessions where id = p_session_id;
	if not found then raise exception 'session not found'; end if;
	if v_start is null then raise exception 'session has no schedule'; end if;
	if v_end is not null and v_end <= now() then raise exception 'session ended'; end if;

	-- 세션 길이(분)로 상한 — 도착이 종료를 넘지 않도록 30분 단위로 내림
	if v_end is not null then
		v_max := (floor(extract(epoch from (v_end - v_start)) / 60)::int / 30) * 30;
		if v_min > v_max then v_min := v_max; end if;
	end if;

	update public.attendances
	set late_minutes = v_min, updated_at = now()
	where session_id = p_session_id and member_id = v_member and status <> 'cancelled';
	if not found then raise exception 'not attending'; end if;
end;
$$;

-- ③ 취소 시 늦참도 해제 — carpool_role 과 같은 이유(재참석 시 오래된 도착시각 부활 방지).
--    본문은 20260623010000 정의 그대로 두고 취소 UPDATE 에 late_minutes = 0 만 추가.
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
				insert into public.notifications(recipient_member_id, type, session_id, payload)
				values (v_promote.member_id, 'promoted', p_session_id,
					jsonb_build_object('session_id', p_session_id));
			end if;
		end if;
	end if;
end;
$$;

revoke execute on function public.set_late_minutes(bigint, int) from anon;
grant execute on function public.set_late_minutes(bigint, int) to authenticated;
grant execute on function public.cancel_attendance(bigint) to authenticated;
