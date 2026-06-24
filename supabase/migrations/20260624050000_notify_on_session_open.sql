-- 일정이 "열릴 때(open)" 전 회원 푸시:
-- sync_schedule_occurrences() 의 E단계(draft→open)를 CTE 로 감싸, 새로 open 된 회차마다
-- 로그인 회원 전원에게 'session_open' 알림을 INSERT 한다. notifications INSERT 트리거
-- (trg_notify_push_send)가 send-push Edge Function 을 호출해 웹푸시까지 이어진다.
--
-- 기존 '추가 시점'(notify_members_schedule_added) 알림은 호출부에서 제거되어, 알림 시점을
-- "회차가 실제 모집 공개되는 순간" 하나로 통일한다(이중 발송 없음).
--
-- 멱등성: draft→open 은 단방향(과거 회차는 A단계에서 closed)이라 RETURNING 만으로 1회성이
-- 보장되며, not exists 가드로 이중 안전. sync 는 authenticated 누구나(홈 진입 시) 호출하지만
-- 첫 호출에서만 전환·발송되고 이후 호출은 0건이다.

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
	--    새로 open 된 회차는 전 회원에게 'session_open' 알림(→ 웹푸시).
	with opened as (
		update public.sessions
			set status = 'open'
		where status = 'draft'
			and scheduled_at is not null
			and (scheduled_at at time zone 'Asia/Seoul')::date
				>= (now() at time zone 'Asia/Seoul')::date
			and scheduled_at <= now() + interval '7 days'
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
