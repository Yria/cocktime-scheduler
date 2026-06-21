-- Phase 3+6: 선수↔회원 연결 + 참석확정 → 보드 편입 브릿지
-- 계약서: docs/EXPANSION_SPEC.md §5(브릿지), §6(스냅샷 격리막)
-- 기존 보드 무영향: session_players에 member_id 컬럼만 추가(nullable). 알고리즘은 여전히
--   session_players.gender/skills 스냅샷만 읽으므로 변경 없음.

-- ① 선수 ↔ 회원 연결 (게스트/구 Sheets 선수는 NULL)
alter table public.session_players
	add column if not exists member_id uuid references public.members(id) on delete set null;
create index if not exists idx_sp_member on public.session_players(member_id);

-- ② 브릿지 RPC: 일정(status='open')의 confirmed 참석자를 session_players로 일괄 생성하고
--    세션을 활성화(is_active=true)한다. members에서 gender/skills를 스냅샷 복사(격리막).
create or replace function public.start_session_from_schedule(p_session_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_status  text;
	v_missing int;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	select status into v_status from public.sessions where id = p_session_id for update;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;

	-- 편성 알고리즘은 gender 필수 → 프로필 미입력 confirmed 회원이 있으면 차단
	select count(*) into v_missing
	from public.attendances a
	join public.members m on m.id = a.member_id
	where a.session_id = p_session_id and a.status = 'confirmed' and m.gender is null;
	if v_missing > 0 then
		raise exception 'profile incomplete: % member(s) missing gender', v_missing;
	end if;

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
