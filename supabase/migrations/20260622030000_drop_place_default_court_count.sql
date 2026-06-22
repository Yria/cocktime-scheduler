-- 장소에서 코트 수 제거: 코트 수는 "가봐야 아는" 값이라 보드에서 결정한다.
-- places.default_court_count 는 더 이상 입력/사용하지 않으므로 제거.
-- 단, recurring_valid_occurrences 뷰가 이 컬럼으로 회차 초기 court_count 를 정했으므로,
-- 먼저 뷰를 상수 4(보드에서 조정)로 교체한 뒤 컬럼을 드롭한다(의존성 순서).

-- ① 뷰 재정의: court_count 를 장소 기본값 대신 상수 4 로(컬럼 목록/순서/타입 동일 → REPLACE 가능).
--    places 조인도 더는 필요 없어 제거.
create or replace view public.recurring_valid_occurrences as
select
	r.id as rule_id,
	g.d::date as occ_date,
	((g.d::date)::text || ' ' || r.start_time::text)::timestamp
		at time zone 'Asia/Seoul' as occ_at,
	r.capacity,
	r.place_id,
	4 as court_count, -- 코트 수는 보드에서 결정(장소 기본값 폐지)
	r.created_by
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

-- ② 컬럼 제거(이제 의존 객체 없음)
alter table public.places
	drop column if exists default_court_count;
