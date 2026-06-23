-- Supabase lint 해소: public.recurring_valid_occurrences "Security Definer View"
--
-- 문제:
--   이 뷰는 security_invoker 옵션 없이 생성되어 기본값(SECURITY DEFINER)으로 동작한다.
--   → 뷰가 소유자(postgres) 권한으로 실행되어 recurring_schedules RLS 를 우회하고,
--     PostgREST 기본 grant 로 anon/authenticated 에 API 노출된다. (security_definer_view lint)
--
-- 수정(2단계):
--   ① security_invoker = on 으로 재정의 → 조회자 권한으로 평가되어 RLS 를 따른다.
--   ② anon·authenticated 의 SELECT 회수 → API 표면에서 완전히 제거.
--
-- 안전성:
--   유일한 소비자인 public.sync_schedule_occurrences() 는 SECURITY DEFINER 함수로,
--   뷰를 "소유자" 권한으로 읽으므로 위 REVOKE/invoker 전환에 영향받지 않는다.
--   클라이언트는 이 뷰를 직접 조회하지 않는다(calendar.ts 가 동일 규칙을 미러링하고 sessions 를 읽음).
--
-- 뷰 정의 본문은 최신본(20260622120000)과 동일 — security_invoker 옵션만 추가.

create or replace view public.recurring_valid_occurrences
with (security_invoker = on) as
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

-- API 표면에서 제거. 서버 측 SECURITY DEFINER RPC(sync_schedule_occurrences)는
-- 소유자 권한으로 뷰를 읽으므로 아래 REVOKE 의 영향을 받지 않는다.
revoke select on public.recurring_valid_occurrences from anon;
revoke select on public.recurring_valid_occurrences from authenticated;
