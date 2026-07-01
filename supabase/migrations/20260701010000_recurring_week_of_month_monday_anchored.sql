-- 반복 규칙 "주차" 정의 변경: N번째 해당요일 → 월요일 기준 주차(week-of-month)
--
-- 문제:
--   기존 recurring_valid_occurrences 뷰의 주차 매칭식은
--     floor((day-1)/7)+1  = "그 달의 N번째 해당 요일"
--   이었다. 이는 앱 달력에서 사용자가 보는 "몇 번째 주"와 매월 1일 시작 요일에
--   따라 어긋났고(달이 늦게 시작할수록 홀/짝이 통째로 뒤집힘), 홀수주/짝수주가
--   달마다 다르게 동작하는 것처럼 보였다.
--
-- 새 정의(월요일 기준 주차):
--   주(週)는 월~일 블록. 그 달의 '첫 월요일'이 드는 주 = 1주차, 이후 7일마다 2·3·4·5주차.
--   각 날짜의 주차 = "그 날이 속한 월~일 주의 월요일"이 며칠(day-of-month)인지로 계산한다.
--     week_monday = 그 날 - ((dow + 6) % 7)   -- dow: 0=일..6=토
--     week        = floor((day(week_monday) - 1) / 7) + 1   -- 항상 1..5
--   선행 부분주(1일이 월요일이 아니어서 첫 월요일 이전에 오는 날)는 그 주의 월요일이
--   '전달'에 있으므로 전달의 마지막 주(4·5주)로 편입된다. 따라서 어떤 날짜도 누락되지
--   않아 "매주"({1,2,3,4,5})는 모든 발생을 빠짐없이 포함한다.
--   예) 2026-08 은 1일이 토 → 첫 월요일 8/3 이 1주차. 8/1(토)은 그 주 월요일이 7/27이라
--       7월 4주로 편입(매주 토요일이면 포함). 8/5(수)=1주, 8/12=2주, 8/19=3주, 8/26=4주.
--
-- 뷰 정의 본문은 최신본(20260623020000)과 동일 — WHERE 의 주차식과 week_monday
-- lateral 만 교체. security_invoker=on 및 anon/authenticated REVOKE 유지.

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
-- 그 날이 속한 월~일 주의 '월요일' 날짜(전달로 넘어갈 수 있음).
cross join lateral (
	select (g.d::date - ((extract(dow from g.d)::int + 6) % 7)) as week_monday
) k
where r.is_active
	and extract(dow from g.d)::int = r.day_of_week
	and (
		-- 주차 = 그 주 월요일의 (day-1)/7+1. 첫 월요일 주=1주. 선행 부분주는 전달 마지막주로 편입.
		((((extract(day from k.week_monday)::int - 1) / 7) + 1) = any (r.week_ordinals))
		or (
			r.include_last
			and (g.d::date + 7)
				> (date_trunc('month', g.d)::date + interval '1 month' - interval '1 day')::date
		)
	);

-- API 표면에서 제거(20260623020000 과 동일). SECURITY DEFINER RPC 만 소비.
revoke select on public.recurring_valid_occurrences from anon;
revoke select on public.recurring_valid_occurrences from authenticated;
