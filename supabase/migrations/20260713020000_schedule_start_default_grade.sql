-- 실력 등급 전환 후속: 일정 시작 브릿지(start_session_from_schedule)의 skills 스냅샷 기본값 보정.
-- 기존엔 미채점 회원(members.skills = null)을 '{}'로 스냅샷 → skillScore 0(1~10 밴드 밖)이 되어
-- 수동 시작 경로(fetchMembers→normalizeSkills, 기본 등급 5)와 불일치했다.
-- 미채점 회원을 등급 5로 스냅샷해 두 시작 경로의 기본 등급을 일치시킨다(계약: 미상 = grade 5).
-- 20260625010000_single_active_session_invariant.sql 의 최신 정의를 기반으로, skills 스냅샷 한 줄만 변경.

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
	-- 미채점(skills 에 grade 없음) 회원은 기본 등급 5로 스냅샷(수동 시작 normalizeSkills 와 일치).
	insert into public.session_players
		(session_id, player_id, member_id, name, gender, skills, status, wait_since)
	select
		p_session_id, m.id::text, m.id, m.name, m.gender,
		case when m.skills ? 'grade' then m.skills else jsonb_build_object('grade', 5) end,
		'waiting', now()
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
