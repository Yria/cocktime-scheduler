-- 후반 늦참("8시 이후") = "정원 외 늦참 풀"(late_pool) — 정원 큐와 분리된 독립 접수.
--
-- 배경: 늦참 슬라이더(20260706030000)는 도착 오프셋만 표시할 뿐, 확정자는 그대로 정원(confirmed_count)을
--   점유했다. 요청: "경기 후반(2/3 지점) 이후 도착으로 슬라이드한 인원은 정원 큐와 분리해 독립 접수 —
--   실제 참석은 가능하되 도착 시 자리 있으면 참여, 없으면 대기". 시스템 모델:
--     · late_pool = 네 번째 attendance status. 정원(confirmed_count)에 미포함(독립).
--     · 확정자 → late_pool 전환 시 정원 1칸이 비므로 대기 1순위 자동 승급(cancel_attendance 패턴).
--     · late_pool → 정시/일반 복귀 시 여유 있으면 confirmed, 없으면 waitlisted(큐 뒤로 재진입).
--   "도착 시 자리 있으면 참여/없으면 대기"의 현장 판정은 보드(대기 로테이션)가 담당 — RSVP 단계는
--   정원 분리 + 상태 표기까지만 책임진다(start_session_from_schedule 은 confirmed 만 편입, 변경 없음).
--
-- 경계: 절대 시각이 아니라 세션 길이의 2/3 지점. 예) 18:00~21:00(3h) 세션이면 2/3 = +2h = 20:00("8시").
--   도착시각(scheduled_at + late_minutes)이 이 지점 이상이면 풀. 클라(latePool.ts)도 동일 타임스탬프로 판정.
--
-- 동시성: join_session/cancel_attendance 와 동일한 잠금 순서(sessions FOR SHARE → session_counters
--   FOR UPDATE → attendances FOR UPDATE). 정원 판정은 count(*) 금지, confirmed_count 가 권위.
--   상태 전환 + 승급 + 알림은 한 트랜잭션 → 롤백 시 알림 미발생(불일치 차단).

-- ① status 체크 제약에 late_pool 추가.
alter table public.attendances drop constraint if exists attendances_status_check;
alter table public.attendances add constraint attendances_status_check
	check (status in ('confirmed','waitlisted','cancelled','late_pool'));

-- ② 본인 늦참(도착 오프셋) 설정 + 8시 경계 풀 전환 — 원자 처리.
--    반환: { status: 반영된 상태, promoted: 자동 승급 인원 } — 클라가 권위 상태로 재동기화.
--    반환형이 void→jsonb 로 바뀌어 create or replace 가 불가 → 먼저 drop.
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

	-- 세션 길이(분)로 상한 — 종료 시각엔 늦참이 없으므로(도착=종료 무의미) "종료 미만" 최대 30분 스텝.
	-- 예) 3h 세션 → 150분(종료 30분 전)까지. 클라 슬라이더 max 와 동일 산식.
	if v_end is not null then
		v_max := greatest(
			0,
			floor((extract(epoch from (v_end - v_start)) / 60 - 1) / 30)::int * 30
		);
		if v_min > v_max then v_min := v_max; end if;
	end if;

	-- 경계 = 경기 후반 2/3 지점(길이 기준). 예) 18:00~21:00(3h) → +2h = 20:00("8시").
	-- 종료시각(v_end)이 있어야 계산 가능 — 없으면 풀 판정 없이 오프셋만 갱신.
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

	v_new := v_self.status;  -- 기본: 상태 불변(오프셋만 갱신)

	-- 정원 전환은 모집 중(open)에만. 그 외(active 등)는 오프셋만 갱신.
	if v_status = 'open' and v_pool and v_self.status in ('confirmed','waitlisted') then
		-- 큐 → 정원 외 풀. 확정자였으면 정원 1칸 반납 + 대기 1순위 승급.
		v_new := 'late_pool';
		update public.attendances
		set status = 'late_pool', late_minutes = v_min, confirmed_at = null, updated_at = now()
		where session_id = p_session_id and member_id = v_member;

		if v_self.status = 'confirmed' then
			update public.session_counters set confirmed_count = confirmed_count - 1
				where session_id = p_session_id;
			v_count := v_count - 1;

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
				v_count := v_count + 1;
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
		-- 정원 외 풀 → 정시/일반 복귀. 여유 있으면 확정, 없으면 대기(큐 뒤로 재진입).
		if v_capacity is null or v_count < v_capacity then
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
		-- 상태 전환 없음 — 오프셋만 갱신(같은 존 내 이동, 또는 비-open).
		update public.attendances
		set late_minutes = v_min, updated_at = now()
		where session_id = p_session_id and member_id = v_member;
	end if;

	return jsonb_build_object('status', v_new, 'promoted', v_promoted);
end;
$$;

-- ③ 게스트 신청 — late_pool 초대자 허용 + 초대자가 late_pool 이면 게스트도 late_pool(정원 외 상속).
--    본문은 20260703040000(join_open_only) 최신본 + 20260624040000 참석 가드를 계승, 풀 상속만 추가.
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
	v_new            text;
	v_pos            bigint;
	v_result         public.attendances%rowtype;
begin
	if v_inviter is null then raise exception 'not authenticated'; end if;
	if p_name is null or btrim(p_name) = '' then raise exception 'guest name required'; end if;
	if p_gender not in ('M','F') then raise exception 'guest gender required'; end if;

	select capacity, status, ends_at
		into v_capacity, v_status, v_ends_at
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;
	if v_ends_at is not null and v_ends_at <= now() then
		raise exception 'session ended';
	end if;

	-- 참석 가드 — 본인이 확정/대기/정원외늦참으로 참석 중이어야 게스트 신청 가능.
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

	if v_inviter_status = 'late_pool' then
		-- 초대자가 정원 외 늦참이면 게스트도 정원 외(정원 미점유).
		v_new := 'late_pool';
	elsif v_capacity is null or v_count < v_capacity then
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

revoke execute on function public.set_late_minutes(bigint, int) from anon;
grant execute on function public.set_late_minutes(bigint, int) to authenticated;
revoke execute on function public.add_guest_attendance(bigint, text, text, jsonb) from anon;
grant execute on function public.add_guest_attendance(bigint, text, text, jsonb) to authenticated;
