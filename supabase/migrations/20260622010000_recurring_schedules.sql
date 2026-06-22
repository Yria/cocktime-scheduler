-- Phase 4+: 반복 일정(요일·주차 규칙) → 회차(sessions) 자동 생성 + 1주 전 노출
-- 계약서: docs/EXPANSION_SPEC.md §4 (일정=세션) 확장
--
-- 모델 (2계층):
--   ① recurring_schedules : 운영진이 정의하는 "반복 규칙"(요일 + 주차패턴 + 시간 + 인원 + 장소).
--      예) 매주 수 19:00 / 1·3주 화 A체육관 / 2·4주 화 B체육관
--   ② sessions(기존) : 규칙이 자동으로 깔아두는 "실제 회차". 참석·카풀·보드가 붙는 단위.
--      - recurring_schedule_id / occurrence_date 로 규칙↔회차 연결(멱등 키)
--      - status: draft(운영진만) → open(1주 전 노출·참석시작) → active(보드) → closed / cancelled(명절 등 건너뜀)
--      - is_overridden: 운영진이 그 회차만 개별 수정(장소/시간/인원/취소)했음 → sync 가 덮어쓰지 않음
--
-- sessions RLS 는 아직 anon_all(Phase 9 미착수)이라 회차 개별 수정/취소/일회성 추가는
-- 클라이언트 직접 쓰기로 처리. 규칙 CRUD 와 회차 자동 생성/노출만 본 마이그레이션이 담당.

-- ============================================================
-- ① recurring_schedules : 반복 규칙
-- ============================================================
create table if not exists public.recurring_schedules (
	id            bigserial primary key,
	day_of_week   smallint  not null check (day_of_week between 0 and 6), -- 0=일 .. 6=토 (postgres dow)
	week_ordinals smallint[] not null default '{1,2,3,4,5}',              -- 발생 주차(매주=1~5). 예) 홀수주 {1,3,5}, 짝수주 {2,4}
	include_last  boolean   not null default false,                       -- '마지막주' 추가 포함(주차 길이 무관)
	start_time    time      not null,                                     -- 시작 시각(Asia/Seoul 벽시계)
	capacity      int,                                                    -- 최대 인원(NULL=무제한)
	place_id      bigint    references public.places(id) on delete set null,
	is_active     boolean   not null default true,
	created_by    uuid      references public.members(id) on delete set null,
	created_at    timestamptz not null default now(),
	updated_at    timestamptz not null default now()
);

alter table public.recurring_schedules enable row level security;
create policy rsched_select on public.recurring_schedules
	for select to authenticated using (true);
create policy rsched_admin on public.recurring_schedules
	for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- ② sessions 확장 : 규칙 연결 + 개별 수정 플래그
-- ============================================================
alter table public.sessions
	add column if not exists recurring_schedule_id bigint
		references public.recurring_schedules(id) on delete set null,
	add column if not exists occurrence_date date,
	add column if not exists is_overridden boolean not null default false;

-- 규칙↔회차 멱등 키. (NULL, NULL)은 서로 distinct → 즉석/일회성 세션 다수 공존 가능.
create unique index if not exists uq_sessions_rule_occurrence
	on public.sessions(recurring_schedule_id, occurrence_date);

-- 달력 조회(월 범위) 가속
create index if not exists idx_sessions_scheduled_at
	on public.sessions(scheduled_at);

-- ============================================================
-- ③ 유효 발생 뷰 : 활성 규칙 × 향후 56일(약 2개월) 중 매칭 날짜
--    (달력에서 다음 달까지 미리 보고 명절 등 예외를 편집할 수 있도록 넉넉히)
-- ============================================================
create or replace view public.recurring_valid_occurrences as
select
	r.id as rule_id,
	g.d::date as occ_date,
	((g.d::date)::text || ' ' || r.start_time::text)::timestamp
		at time zone 'Asia/Seoul' as occ_at,
	r.capacity,
	r.place_id,
	coalesce(p.default_court_count, 4) as court_count,
	r.created_by
from public.recurring_schedules r
left join public.places p on p.id = r.place_id
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
-- ④ 동기화 RPC : 회차 생성/갱신/정리 + 노출(draft→open)
--    앱 로드 시 호출(멱등). 운영진·회원 모두 호출 가능(노출 신선도 보장).
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
		(is_active, court_count, status, scheduled_at, capacity, place_id,
		 created_by, recurring_schedule_id, occurrence_date, is_overridden)
	select
		false, v.court_count, 'draft', v.occ_at, v.capacity, v.place_id,
		v.created_by, v.rule_id, v.occ_date, false
	from public.recurring_valid_occurrences v
	where not exists (
		select 1 from public.sessions s
		where s.recurring_schedule_id = v.rule_id
			and s.occurrence_date = v.occ_date
	)
	on conflict (recurring_schedule_id, occurrence_date) do nothing;

	-- C) 미오버라이드 draft 회차를 규칙 최신값으로 갱신(규칙 수정 반영)
	update public.sessions s
		set scheduled_at = v.occ_at,
			capacity     = v.capacity,
			place_id     = v.place_id,
			court_count  = v.court_count
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
	--    하한은 KST '오늘'로: 당일 오전 회차도 빠짐없이 노출(now()-12h 하한이면 누락 가능).
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
