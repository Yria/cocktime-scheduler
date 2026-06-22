-- 일정 끝시간 + 카풀 on/off 토글
-- 계약서: docs/EXPANSION_SPEC.md §4 (일정=세션)
--
-- 변경:
--   ① recurring_schedules.end_time     : 반복 규칙의 종료 시각(Asia/Seoul 벽시계)
--   ② recurring_schedules.carpool_enabled : 이 규칙으로 깔린 회차의 카풀 노출 on/off
--   ③ sessions.ends_at                 : 회차의 종료 시각(timestamptz)
--   ④ sessions.carpool_enabled         : 회차 카풀 노출 on/off (on이면 참석자가 카풀 가능/필요 선택)
--
-- 백필 정책(기존 데이터):
--   - 종료 시각 = 시작 + 3시간 (운영진이 일정관리에서 개별 조정)
--   - 카풀 = 주말(토/일)만 on, 평일은 off (요청 기본값)
--
-- 회차의 ends_at/carpool_enabled 는 규칙 기반(미오버라이드 draft)이면 sync 가 규칙값으로 갱신,
-- 운영진이 회차를 개별 수정(is_overridden=true)했으면 sync 가 건드리지 않는다.

-- ============================================================
-- ① 컬럼 추가
-- ============================================================
alter table public.recurring_schedules
	add column if not exists end_time       time,
	add column if not exists carpool_enabled boolean not null default false;

alter table public.sessions
	add column if not exists ends_at         timestamptz,
	add column if not exists carpool_enabled boolean not null default false;

-- ============================================================
-- ② 백필 (1회성)
-- ============================================================
-- 종료 시각 = 시작 + 3시간 (time 산술은 24h 모듈로 — 심야 회차는 다음날로 래핑되나 클럽 일정상 무관)
update public.recurring_schedules
	set end_time = start_time + interval '3 hours'
	where end_time is null;

-- 카풀: 주말 규칙만 on
update public.recurring_schedules
	set carpool_enabled = (day_of_week in (0, 6));

-- 회차 종료 시각 = 시작 + 3시간
update public.sessions
	set ends_at = scheduled_at + interval '3 hours'
	where scheduled_at is not null and ends_at is null;

-- 회차 카풀: 주말(KST 기준 토/일)만 on. 즉석 세션(scheduled_at NULL)은 off 유지.
update public.sessions
	set carpool_enabled = (
		extract(dow from (scheduled_at at time zone 'Asia/Seoul'))::int in (0, 6)
	)
	where scheduled_at is not null;

-- ============================================================
-- ③ 유효 발생 뷰 재정의: occ_ends_at · carpool_enabled 추가
--    (기존 컬럼 이름/순서/타입 동일 + 끝에 신규 컬럼 추가 → CREATE OR REPLACE 가능)
-- ============================================================
create or replace view public.recurring_valid_occurrences as
select
	r.id as rule_id,
	g.d::date as occ_date,
	((g.d::date)::text || ' ' || r.start_time::text)::timestamp
		at time zone 'Asia/Seoul' as occ_at,
	r.capacity,
	r.place_id,
	4 as court_count, -- 코트 수는 보드에서 결정(장소 기본값 폐지)
	r.created_by,
	-- 종료 시각: end_time(없으면 시작+3h). 종료가 시작보다 이르면 다음날로(자정 넘김 가드).
	case
		when coalesce(r.end_time, r.start_time + interval '3 hours') > r.start_time
			then ((g.d::date)::text || ' '
				|| coalesce(r.end_time, r.start_time + interval '3 hours')::text)::timestamp
				at time zone 'Asia/Seoul'
		else (((g.d::date) + 1)::text || ' '
				|| coalesce(r.end_time, r.start_time + interval '3 hours')::text)::timestamp
				at time zone 'Asia/Seoul'
	end as occ_ends_at,
	r.carpool_enabled
from public.recurring_schedules r
cross join lateral generate_series(
	(now() at time zone 'Asia/Seoul')::date::timestamp,
	((now() at time zone 'Asia/Seoul')::date + 56)::timestamp,
	interval '1 day'
) g(d)
where r.is_active
	and extract(dow from g.d)::int = r.day_of_week
	and (
		((((extract(day from g.d)::int - 1) / 7) + 1) = any (r.week_ordinals))
		or (
			r.include_last
			and (g.d::date + 7)
				> (date_trunc('month', g.d)::date + interval '1 month' - interval '1 day')::date
		)
	);

-- ============================================================
-- ④ 동기화 RPC 갱신: ends_at · carpool_enabled 전파
--    (A/D/E 단계는 기존과 동일. B 생성·C 갱신에 신규 컬럼 추가)
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

	-- E) 노출: 1주 이내 draft → open (일회성 포함). 과거(어제 이전)는 A 에서 이미 종료.
	update public.sessions
		set status = 'open'
	where status = 'draft'
		and scheduled_at is not null
		and (scheduled_at at time zone 'Asia/Seoul')::date
			>= (now() at time zone 'Asia/Seoul')::date
		and scheduled_at <= now() + interval '7 days';
end;
$$;

revoke execute on function public.sync_schedule_occurrences() from anon;
grant execute on function public.sync_schedule_occurrences() to authenticated;
