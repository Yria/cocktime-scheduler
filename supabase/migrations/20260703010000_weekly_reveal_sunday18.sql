-- 노출(draft→open) 시점 변경: "시작 1주 전 rolling(+7d)" → "매주 일요일 18:00(KST) 일괄 공개".
-- 요청: 일요일 오후 6시에 다음 일주일(~다음 일요일) 회차가 한번에 open 되도록.
--
-- 공개 시점(reveal moment) = 매주 일요일 18:00 KST.
-- 공개 상한 날짜 = "직전 공개 시점의 일요일 + 7일"(= 다음 일요일).
--   예) 일 18:00 이후 ~ 다음 일 17:59 : 다음 일요일까지 공개
--       일요일 18:00 이전             : 오늘(이번 일요일)까지만 공개
--
-- 변경 내역:
--   ① reveal_horizon_kst_date(): 공개 상한 날짜 계산(단일 소스)
--   ② sync_schedule_occurrences E단계: rolling +7d → 공개 상한 날짜 기준
--      (본문은 20260624050000 최신본 유지, E 조건만 교체)
--   ③ join_session / add_guest_attendance 노출 가드: 동일 기준으로 교체
--      (본문은 20260624030000 최신본 유지, 가드 조건만 교체.
--       start_session_from_schedule 은 노출 가드가 없어 대상 아님)
--   ④ pg_cron: 매주 일요일 18:00 KST(= 09:00 UTC)에 sync 실행 — 앱 접속이 없어도
--      정각에 open 전환 + 'session_open' 웹푸시가 나간다. 앱 로드 시 멱등 호출은 유지.

-- ============================================================
-- ① 공개 상한 날짜 — 서버·가드가 공유하는 단일 기준
-- ============================================================
create or replace function public.reveal_horizon_kst_date()
returns date
language sql
stable
set search_path = ''
as $$
	select case
		when now() at time zone 'Asia/Seoul' >= d.last_sun + time '18:00'
			then d.last_sun + 7
		else d.last_sun
	end
	from (
		select (now() at time zone 'Asia/Seoul')::date
			- extract(dow from now() at time zone 'Asia/Seoul')::int as last_sun
	) d;
$$;

-- ============================================================
-- ② sync_schedule_occurrences : E단계 조건 교체
-- ============================================================
create or replace function public.sync_schedule_occurrences()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	-- A) 지난(어제 이전) 미진행 회차 종료
	update public.sessions
		set status = 'closed'
	where status in ('draft', 'open')
		and scheduled_at is not null
		and (scheduled_at at time zone 'Asia/Seoul')::date
			< (now() at time zone 'Asia/Seoul')::date;

	-- B) 누락 회차 생성(draft)
	insert into public.sessions
		(is_active, court_count, status, scheduled_at, ends_at, capacity, place_id,
		 carpool_enabled, created_by, recurring_schedule_id, occurrence_date, is_overridden)
	select
		false, v.court_count, 'draft', v.occ_at, v.occ_ends_at, v.capacity, v.place_id,
		v.carpool_enabled, v.created_by, v.rule_id, v.occ_date, false
	from public.recurring_valid_occurrences v
	where not exists (
		select 1 from public.sessions s
		where s.recurring_schedule_id = v.rule_id
			and s.occurrence_date = v.occ_date
	)
	on conflict (recurring_schedule_id, occurrence_date) do nothing;

	-- C) 미오버라이드 draft 회차를 규칙 최신값으로 갱신(규칙 수정 반영)
	update public.sessions s
		set scheduled_at    = v.occ_at,
			ends_at         = v.occ_ends_at,
			capacity        = v.capacity,
			place_id        = v.place_id,
			court_count     = v.court_count,
			carpool_enabled = v.carpool_enabled
	from public.recurring_valid_occurrences v
	where s.recurring_schedule_id = v.rule_id
		and s.occurrence_date = v.occ_date
		and s.status = 'draft'
		and s.is_overridden = false;

	-- D) 규칙 변경/비활성으로 더는 유효치 않은 미오버라이드 draft 삭제
	delete from public.sessions s
	where s.recurring_schedule_id is not null
		and s.status = 'draft'
		and s.is_overridden = false
		and s.scheduled_at is not null
		and (s.scheduled_at at time zone 'Asia/Seoul')::date
			>= (now() at time zone 'Asia/Seoul')::date
		and not exists (
			select 1 from public.recurring_valid_occurrences v
			where v.rule_id = s.recurring_schedule_id
				and v.occ_date = s.occurrence_date
		);

	-- E) 노출: 일요일 18:00 KST 공개 시점 기준, 공개 상한(다음 일요일)까지의
	--    draft → open (일회성 포함). 과거(어제 이전)는 A 에서 이미 종료.
	--    새로 open 된 회차는 전 회원에게 'session_open' 알림(→ 웹푸시).
	with opened as (
		update public.sessions
			set status = 'open'
		where status = 'draft'
			and scheduled_at is not null
			and (scheduled_at at time zone 'Asia/Seoul')::date
				>= (now() at time zone 'Asia/Seoul')::date
			and (scheduled_at at time zone 'Asia/Seoul')::date
				<= public.reveal_horizon_kst_date()
		returning id
	)
	insert into public.notifications (recipient_member_id, type, session_id, payload)
	select m.id, 'session_open', o.id, '{}'::jsonb
	from opened o
	cross join public.members m
	where m.auth_user_id is not null            -- 로그인 가능한 회원만
		and not exists (                        -- 멱등 가드(동일 세션 중복 방지)
			select 1 from public.notifications n
			where n.session_id = o.id
				and n.type = 'session_open'
				and n.recipient_member_id = m.id
		);
end;
$$;

revoke execute on function public.sync_schedule_occurrences() from anon;
grant execute on function public.sync_schedule_occurrences() to authenticated;

-- ============================================================
-- ③-1 join_session : 노출 가드 교체
-- ============================================================
create or replace function public.join_session(p_session_id bigint)
returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_member       uuid := public.current_member_id();
	v_capacity     int;
	v_status       text;
	v_scheduled_at timestamptz;
	v_ends_at      timestamptz;
	v_count        int;
	v_existing     public.attendances%rowtype;
	v_result       public.attendances%rowtype;
	v_new          text;
	v_pos          bigint;
	v_has_existing boolean;
begin
	if v_member is null then raise exception 'not authenticated'; end if;

	select capacity, status, scheduled_at, ends_at
		into v_capacity, v_status, v_scheduled_at, v_ends_at
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;
	-- 노출 가드 — 서버시간 기준. 공개 상한(일요일 18:00 KST 일괄 공개) 밖이면 차단.
	if v_scheduled_at is not null
		and (v_scheduled_at at time zone 'Asia/Seoul')::date > public.reveal_horizon_kst_date() then
		raise exception 'session not open yet';
	end if;
	-- 종료 시각 상한 가드 — 종료된 일정엔 신청 불가.
	if v_ends_at is not null and v_ends_at <= now() then
		raise exception 'session ended';
	end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	select * into v_existing from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	v_has_existing := found;  -- ★ 이후 UPDATE가 FOUND를 덮기 전에 캡처

	if v_has_existing and v_existing.status in ('confirmed','waitlisted') then
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

	if v_has_existing then
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

grant execute on function public.join_session(bigint) to authenticated;

-- ============================================================
-- ③-2 add_guest_attendance : 노출 가드 교체
-- ============================================================
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
	v_ends_at      timestamptz;
	v_count        int;
	v_new          text;
	v_pos          bigint;
	v_result       public.attendances%rowtype;
begin
	if v_inviter is null then raise exception 'not authenticated'; end if;
	if p_name is null or btrim(p_name) = '' then raise exception 'guest name required'; end if;
	if p_gender not in ('M','F') then raise exception 'guest gender required'; end if;

	select capacity, status, scheduled_at, ends_at
		into v_capacity, v_status, v_scheduled_at, v_ends_at
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;
	-- 노출 가드 — 서버시간 기준. 공개 상한(일요일 18:00 KST 일괄 공개) 밖이면 차단.
	if v_scheduled_at is not null
		and (v_scheduled_at at time zone 'Asia/Seoul')::date > public.reveal_horizon_kst_date() then
		raise exception 'session not open yet';
	end if;
	-- 종료 시각 상한 가드 — 종료된 일정엔 게스트 신청 불가.
	if v_ends_at is not null and v_ends_at <= now() then
		raise exception 'session ended';
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

-- ============================================================
-- ④ pg_cron : 일요일 18:00 KST(09:00 UTC) 정각 공개 — 앱 접속 없이도 open+푸시
-- ============================================================
create extension if not exists pg_cron;

-- cron.schedule 은 같은 이름이면 upsert(교체) — 마이그레이션 재적용에 안전.
select cron.schedule(
	'reveal-weekly-sessions',
	'0 9 * * 0',  -- UTC 09:00 일요일 = KST 18:00 일요일
	$cron$select public.sync_schedule_occurrences();$cron$
);
