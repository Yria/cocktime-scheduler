-- 단일 active 세션 불변식 강제 + 중복 active 정리.
--
-- 배경(버그): 세션을 is_active=true 로 만드는 경로가 둘이다.
--   1) setup 플로우 startSession(api.ts): "기존 active 끄기(UPDATE) → 새 행 INSERT" 가 비원자적이라
--      더블 서브밋(버튼 중복 클릭/StrictMode/멀티기기 동시 시작)에서 두 active 세션이 거의 동시에 생성될 수 있었다.
--   2) 일정 플로우 start_session_from_schedule: 대상 행만 is_active=true 로 set 하고 다른 active 는 끄지 않았다.
--   dbEndSession 은 .eq(id) 로 현재 세션 하나만 종료하므로, 쌍둥이/유령 active 행이 남으면
--   fetchActiveSession(is_active=true 1건)이 그 행을 반환 → 새로고침마다 /session 으로 자동 재입장하는 버그.
--
-- 본 마이그레이션:
--   ① 현재 남아 있는 중복 active 정리(가장 최근 1건만 유지, 나머지 종료) — 부분 유니크 인덱스 생성 전제.
--   ② start_session_from_schedule 이 활성화 직전 다른 active 를 모두 종료(단일 트랜잭션 내, 단일 active 유지).
--   ③ 부분 유니크 인덱스로 "active 세션은 최대 1개" 를 DB 차원에서 영구 보장(모든 경로/동시성 backstop).

-- ① 중복 active 정리 (idempotent). 가장 최근 started_at 1건만 남기고 나머지 종료.
update public.sessions
set is_active = false,
    status    = case when status = 'active' then 'closed' else status end,
    ended_at  = coalesce(ended_at, now())
where is_active = true
  and id not in (
    select id from public.sessions
    where is_active = true
    order by started_at desc nulls last
    limit 1
  );

-- ② 일정 → 세션 활성화 브릿지에 단일 active dedupe 추가(나머지는 20260624030000 정의와 동일).
create or replace function public.start_session_from_schedule(p_session_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_status  text;
	v_ends_at timestamptz;
	v_missing int;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	select status, ends_at into v_status, v_ends_at
	from public.sessions where id = p_session_id for update;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;
	-- 종료 시각 상한 가드 — 종료된 일정은 경기 시작 불가.
	if v_ends_at is not null and v_ends_at <= now() then
		raise exception 'session ended';
	end if;

	-- 편성 알고리즘은 gender 필수 → 프로필 미입력 confirmed 회원이 있으면 차단
	select count(*) into v_missing
	from public.attendances a
	join public.members m on m.id = a.member_id
	where a.session_id = p_session_id and a.status = 'confirmed' and m.gender is null;
	if v_missing > 0 then
		raise exception 'profile incomplete: % member(s) missing gender', v_missing;
	end if;

	-- 단일 active 불변식: 이미 진행 중인 다른 세션이 있으면 모두 종료한다(부분 유니크 인덱스 위반 방지 + 유령 active 누적 방지).
	update public.sessions
	set is_active = false, status = 'closed', ended_at = coalesce(ended_at, now())
	where is_active = true and id <> p_session_id;

	-- confirmed 참석자 → session_players (members 스냅샷). player_id는 member_id 기반.
	insert into public.session_players
		(session_id, player_id, member_id, name, gender, skills, status, wait_since)
	select
		p_session_id, m.id::text, m.id, m.name, m.gender,
		coalesce(m.skills, '{}'::jsonb), 'waiting', now()
	from public.attendances a
	join public.members m on m.id = a.member_id
	where a.session_id = p_session_id and a.status = 'confirmed'
	on conflict (session_id, player_id) do nothing;

	-- 세션 활성화 → subscribeSessionWatch(postgres_changes)가 감지해 보드 로드
	update public.sessions
	set status = 'active', is_active = true, started_at = now()
	where id = p_session_id;
end;
$$;

revoke execute on function public.start_session_from_schedule(bigint) from anon;
grant execute on function public.start_session_from_schedule(bigint) to authenticated;

-- ③ 부분 유니크 인덱스: is_active=true 인 행은 모두 같은 값을 색인 → 최대 1개만 허용.
--    이후 어떤 경로(레이스/멀티기기 포함)에서도 두 번째 active INSERT/UPDATE 는 유니크 위반으로 실패한다.
create unique index if not exists sessions_one_active
	on public.sessions ((is_active)) where is_active = true;
