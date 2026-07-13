-- 주말 일괄 공개 시 푸시 폭주 완화: 한 번의 sync 호출에서 여러 회차가 동시에
-- draft→open 되면(예: 일요일 18:00 일괄 공개), 회원당 세션별 'session_open' 알림을
-- N개 만드는 대신 "일정이 여러 개 열렸다"는 간단한 알림 1건('sessions_opened')으로 합친다.
--
-- 배경: 기존 E단계는 opened(N) × members(M) 데카르트 곱으로 N×M 알림을 만들고,
--   trg_notify_push_send 가 FOR EACH ROW 로 발송해 회원이 세션당 1개씩(N개) 푸시를 받았다.
--
-- 규칙:
--   · 이번 호출에서 새로 열린 회차가 1개  → 기존과 동일: 세션 정보(장소·시각) 담은 'session_open'.
--   · 2개 이상                            → 회원당 'sessions_opened' 1건(payload.count=N), session_id 없음.
--
-- 멱등성: opened CTE 는 WHERE status='draft' 로 "이번에 새로 flip 된" 회차만 반환하고
--   한 회차는 한 번만 draft→open 되므로, bulk 알림도 배치당 정확히 1회만 생성된다
--   (동시 sync 는 행 잠금으로 한 트랜잭션만 flip → 나머지는 0건). 별도 가드 불필요.
--
-- 변경 범위: sync_schedule_occurrences() 의 E단계만 교체. A~D 는 20260703010000 최신본 그대로.

create or replace function public.sync_schedule_occurrences()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_opened bigint[];
	v_count  int;
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
	--    draft → open. 이번 호출에서 새로 열린 회차 id 를 모아 개수로 분기한다.
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
	select coalesce(array_agg(id), '{}'::bigint[]) into v_opened from opened;

	v_count := coalesce(array_length(v_opened, 1), 0);

	if v_count = 1 then
		-- 1개만 열림: 기존과 동일하게 세션 정보(장소·시각)를 담은 개별 'session_open'.
		insert into public.notifications (recipient_member_id, type, session_id, payload)
		select m.id, 'session_open', v_opened[1], '{}'::jsonb
		from public.members m
		where m.auth_user_id is not null            -- 로그인 가능한 회원만
			and not exists (                        -- 멱등 가드(동일 세션 중복 방지)
				select 1 from public.notifications n
				where n.session_id = v_opened[1]
					and n.type = 'session_open'
					and n.recipient_member_id = m.id
			);
	elsif v_count >= 2 then
		-- 2개 이상 한번에 열림(주말 일괄 공개 등): 회원당 알림 1건으로 합쳐
		-- "일정이 여러 개 열렸다"는 간단한 메시지만 보낸다(세션별 개별 푸시 폭주 방지).
		insert into public.notifications (recipient_member_id, type, session_id, payload)
		select m.id, 'sessions_opened', null, jsonb_build_object('count', v_count)
		from public.members m
		where m.auth_user_id is not null;
	end if;
end;
$$;

revoke execute on function public.sync_schedule_occurrences() from anon;
grant execute on function public.sync_schedule_occurrences() to authenticated;
