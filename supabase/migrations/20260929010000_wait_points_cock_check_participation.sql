-- ============================================================
-- 대기 포인트: **콕 미제출 = 세션 미참여**로 본다.
--
-- 요청(2026-09-29 운영자): "불참이 '운영진이 뺀'으로만 되어 있다면 콕 미제출도 세션 미참여로 보게 수정해야 해."
--
-- 종전 참여 판정 = session_players 행이 **있는가**(20260905000000). 그런데 콕 체크 회차
--   (sessions.cock_check_enabled)에서는 start_session_from_schedule 이 확정자 전원을 보드에 시드한 뒤,
--   운영진이 콕 제출을 확인해야(session_players.cock_checked) 비로소 매칭 대기에 들어간다
--   — "매칭 대기 = (NOT cock_check_enabled) OR cock_checked"(20260619000000). 시드만 되고 확인이
--   안 된 사람은 오지 않은 사람인데, 행이 있다는 이유로 노쇼 −1 을 피했다.
--
-- 실측(프로덕션, 2026-08-01 이후 종료 회차 — 52회차 전부 콕 체크 on):
--   확정인데 보드에 콕 미확인으로 남은 회원 36행(10회차). **경기 출전 0 · 판수 0 · 상태 전원 waiting.**
--   즉 콕 미확인은 실제 불참이고 오탐이 없다.
--
-- 새 참여 판정 = 보드에 있고 **그 회차가 콕 체크를 안 쓰거나 콕이 확인됐다.** (b) 노쇼와 (a) 대기 적립에
--   같은 술어를 쓴다 — 대기자가 보드에 추가만 되고 콕을 안 냈다면 '들어가서 친 사람'이 아니므로 적립 대상이다.
--   판정 시점은 회차 종료 순간의 설정·확인 상태다.
--
-- 바꾸지 않는 것:
--   · 회차 게이트(보드 존재 = [경기 시작]을 눌렀는가)와 미진행 정산(20260928000000) — 콕 확인이 0명인
--     회차도 '시작된 회차'다.
--   · 경기 출전 여부로 내려가지 않는다(20260905000000 재론 금지). 콕 확인은 운영진이 명시적으로 누르는
--     '합류' 표시이고, 팀생성 사용 여부와 무관하다.
--   · 소급 없음 — 이미 종료된 회차의 콕 미확인 36행은 다시 정산하지 않는다.
--
-- 기준판: 20260928000000 ⑤ wait_points_settle_session.
-- ============================================================

-- 이 회차에 **실제로 합류했는가** — 적립·노쇼가 공유하는 단일 술어.
create or replace function public.wait_points_joined(p_session_id bigint, p_member uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
	select exists (
		select 1
		from public.session_players sp
		join public.sessions s on s.id = sp.session_id
		where sp.session_id = p_session_id
			and sp.member_id = p_member
			and (not s.cock_check_enabled or sp.cock_checked));
$$;
revoke execute on function public.wait_points_joined(bigint, uuid) from public, anon, authenticated;

comment on function public.wait_points_joined(bigint, uuid) is
	'대기 포인트 정산의 참여 판정: 보드에 있고 (콕 체크 off 이거나 콕 확인됨). 콕 미제출은 미참여(20260929010000). 경기 출전 여부는 보지 않는다.';

create or replace function public.wait_points_settle_session(p_session_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_started boolean;
	v_sched   timestamptz;
	v_row     record;
begin
	-- 회차 게이트 = **보드가 만들어졌는가**(= 세션이 시작됐는가). 경기 기록·콕 확인 유무가 아니다.
	--   보드가 없는 회차(sync A단계가 자동으로 닫은 미진행 회차)는 미진행 정산으로 넘긴다(20260928000000).
	select exists (select 1 from public.session_players sp where sp.session_id = p_session_id)
		into v_started;
	if not v_started then
		perform public.wait_points_settle_not_held(p_session_id);
		return;
	end if;

	select scheduled_at into v_sched from public.sessions where id = p_session_id;

	-- (a) 적립 — 대기인 채로 끝났고 합류하지 않은 회원. order by member_id 로 잠금 순서 고정.
	--   현장에서 보드에 투입돼 (콕 체크 회차면 콕까지 확인돼) 합류한 사람은 '못 나온 사람'이 아니다.
	--   7점 도달 알림은 wait_points_credit 이 '이번 적립으로 막 찼을 때'만 보낸다. 회차별 +1 알림은 없다.
	for v_row in
		select a.member_id
		from public.attendances a
		join public.members m on m.id = a.member_id
		where a.session_id = p_session_id
			and a.status = 'waitlisted'
			and a.invited_by is null
			and not m.is_guest
			and m.is_active
			and not public.wait_points_joined(p_session_id, a.member_id)
		order by a.member_id
	loop
		perform public.wait_points_credit(
			v_row.member_id, p_session_id, 'earn', 1,
			jsonb_build_object('reason', 'waitlisted_at_close', 'session_at', v_sched),
			p_session_id);
	end loop;

	-- (b) 노쇼 차감 — 확정인데 합류하지 않은 회원.
	--   보드에서 빠졌거나(운영진이 뺐다) 콕 체크 회차에서 끝까지 콕이 확인되지 않았다(콕 미제출 = 안 왔다).
	for v_row in
		select a.member_id
		from public.attendances a
		join public.members m on m.id = a.member_id
		where a.session_id = p_session_id
			and a.status = 'confirmed'
			and a.invited_by is null
			and not m.is_guest
			and m.is_active
			and not public.wait_points_joined(p_session_id, a.member_id)
		order by a.member_id
	loop
		perform public.wait_points_write(
			v_row.member_id, p_session_id, 'penalty', -1,
			jsonb_build_object('reason', 'noshow', 'session_at', v_sched));
	end loop;
end;
$$;
revoke execute on function public.wait_points_settle_session(bigint) from public, anon, authenticated;

comment on function public.wait_points_settle_session(bigint) is
	'회차 종료 시 대기 포인트 정산. 회차 게이트 = 보드(session_players) 존재. 보드가 없으면 미진행 정산(20260928000000). 참여 판정 = wait_points_joined(보드 + 콕 체크 회차면 콕 확인, 20260929010000) — 경기 출전 여부로 내려가지 않는다.';
