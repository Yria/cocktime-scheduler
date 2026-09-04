-- ============================================================
-- 대기 포인트: "이 회차가 실제로 열렸나" 게이트를 **경기 로그 → 보드 등록**으로 바꾼다.
--
-- 요청(2026-09-05 운영자): "보드에 올라간 인원까지만 생각해. 코트에 한 번도 못 들어간 사람은
--   아마 팀생성을 사용하지 않은 것일 테니 거기까진 판단하지 마라."
--
-- 20260904000000 의 wait_points_settle_session 은 두 곳에서 판정을 한다:
--   ① 회차 게이트   — `exists(matches)` = 경기 기록이 하나라도 있는가
--   ② 회원별 참여   — `exists(session_players)` = 보드(자석)에 올라갔는가
-- ②는 그대로 맞다. **①이 틀렸다** — 팀생성(자동 편성)을 쓰지 않고 진행한 회차는 matches 가 비어
--   있어 게이트가 닫히고, 그 회차의 대기자는 포인트를 **아예 받지 못한다**.
--
-- 게이트의 뜻은 "경기를 기록했는가"가 아니라 "회차가 실제로 진행됐는가"다. 그 증거는 보드다:
--   start_session_from_schedule 이 세션 시작 시 확정자 전원을 session_players 로 시드하므로,
--   session_players 가 한 행이라도 있으면 그 회차는 시작된 것이다. 반대로 sync A단계가 자동으로
--   닫아 버린 '유령 회차'는 시작된 적이 없어 session_players 가 비어 있다 → 여전히 걸러진다.
--
-- 실측(2026-09-05, 프로덕션 종료 회차 전체):
--   · 보드O 경기O(정상 진행)        55회차 — 대기로 끝난 행 77
--   · 보드O 경기X(팀생성 미사용)      2회차 — 대기로 끝난 행 0   ← 종전 게이트가 잘못 닫던 구간
--   · 보드X 경기X(유령 회차)          4회차 — 대기로 끝난 행 0   ← 계속 걸러져야 하는 구간
--   · 보드X 경기O                    0회차 (matches 가 session_players FK 라 구조적으로 불가)
--   → 팀생성 미사용 회차에 마침 대기자가 없어 **실제로 손해 본 회원은 아직 없다**. 규칙만 고친다.
--
-- **회원별 참여 판정(②)은 손대지 않는다 — 재론 금지.** 한때 이것도 경기 로그(matches 4인 구성)로
--   좁히려 했으나 폐기했다: 확정자 907행 중 38행이 '보드에 올랐지만 미출전'이었고, 그 원인은
--   본인 불참이 아니라 팀생성 미사용·보드 운용 방식이었다. 경기 로그까지 내려가면 판정이
--   운영진의 도구 사용 습관에 좌우된다. 보드 등록이 참여의 경계선이다.
--
-- 대상: wait_points_settle_session 한 함수. 트리거 배선(trg_session_wait_points_on_close)은
--       이 함수를 부르므로 다시 만들지 않는다.
-- 기준판: supabase/migrations/20260904000000_wait_points_ticket.sql 의 같은 함수(적용 완료).
-- ============================================================

create or replace function public.wait_points_settle_session(p_session_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_started boolean;
	v_sched   timestamptz;
	v_row     record;
	v_bal     int;
begin
	-- 회차 게이트 = **보드가 만들어졌는가**(= 세션이 시작됐는가). 경기 기록 유무가 아니다.
	--   팀생성을 쓰지 않고 진행한 회차도 여기서 통과해야 대기자가 포인트를 받는다.
	--   sync A단계가 자동으로 닫은 유령 회차는 시작된 적이 없어 보드가 비어 있고, 그대로 걸러진다.
	select exists (select 1 from public.session_players sp where sp.session_id = p_session_id)
		into v_started;
	if not v_started then return; end if;

	select scheduled_at into v_sched from public.sessions where id = p_session_id;

	-- (a) 적립 — 대기인 채로 끝난 회원. order by member_id 로 잠금 순서 고정.
	for v_row in
		select a.member_id
		from public.attendances a
		join public.members m on m.id = a.member_id
		where a.session_id = p_session_id
			and a.status = 'waitlisted'
			and a.invited_by is null
			and not m.is_guest
			and m.is_active
			-- 대기였는데 현장에서 보드에 직접 투입된 사람은 '못 나온 사람'이 아니다.
			-- 대기 행은 세션 시작 시 시드되지 않으므로, 이 방향에서 존재는 곧 현장 투입이다.
			-- **경기 출전 여부까지 내려가지 않는다**(위 헤더 — 재론 금지).
			and not exists (
				select 1 from public.session_players sp
				where sp.session_id = p_session_id and sp.member_id = a.member_id)
		order by a.member_id
	loop
		v_bal := public.wait_points_write(
			v_row.member_id, p_session_id, 'earn', 1,
			jsonb_build_object('reason', 'waitlisted_at_close', 'session_at', v_sched));

		-- 잔액이 방금 가득 찼다 → 우선참여권 획득 알림 1건.
		--   전이(6→7)에서만 발화하므로 earn 이 멱등인 한 중복되지 않는다. 회차별 +1 알림은 보내지 않는다
		--   — sync A단계는 여러 회차를 한 트랜잭션에서 닫고 알림 INSERT 마다 푸시가 나간다(호출 폭주 이력).
		if v_bal = public.wait_point_max() then
			insert into public.notifications(recipient_member_id, type, session_id, payload)
			values (v_row.member_id, 'wait_ticket_ready', p_session_id,
				jsonb_build_object('balance', v_bal));
		end if;
	end loop;

	-- (b) 노쇼 차감 — 확정인데 보드에 한 번도 오르지 않은 회원.
	--   start_session_from_schedule 이 확정자 전원을 시드하므로 부재는 '운영진이 보드에서 뺐다'는 뜻이고,
	--   실무에서 그것이 곧 '안 왔다'이다. 여기서도 경기 출전 여부는 보지 않는다.
	for v_row in
		select a.member_id
		from public.attendances a
		join public.members m on m.id = a.member_id
		where a.session_id = p_session_id
			and a.status = 'confirmed'
			and a.invited_by is null
			and not m.is_guest
			and m.is_active
			and not exists (
				select 1 from public.session_players sp
				where sp.session_id = p_session_id and sp.member_id = a.member_id)
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
	'회차 종료 시 대기 포인트 정산. 회차 게이트 = 보드(session_players) 존재 = 세션이 시작됐는가(20260905000000 — 종전 matches 존재 기준은 팀생성 미사용 회차를 잘못 걸러냈다). 참여 판정도 보드 등록까지만 본다 — 경기 출전 여부로 내려가지 않는다.';

-- ------------------------------------------------------------
-- 보정 백필 — 종전 게이트(matches 존재)에 막혀 적립되지 않은 회차를 새 게이트로 다시 훑는다.
--   범위는 20260904000000 과 같은 2026-08-01 이후. earn 이 (member,session) 유니크라 재실행 안전.
--   실측대로라면 0건이 정상이다(팀생성 미사용 8월 이후 1회차에 대기자가 없었다).
--   노쇼 차감은 소급하지 않고 알림도 보내지 않는다(종전 방침 유지).
-- ------------------------------------------------------------
do $$
declare
	v_row record;
	v_n   int := 0;
begin
	for v_row in
		select a.member_id, a.session_id, s.scheduled_at
		from public.attendances a
		join public.sessions s on s.id = a.session_id
		join public.members  m on m.id = a.member_id
		where s.status = 'closed'
			and s.scheduled_at is not null
			and (s.scheduled_at at time zone 'Asia/Seoul')::date >= date '2026-08-01'
			and a.status = 'waitlisted'
			and a.invited_by is null
			and not m.is_guest
			and m.is_active
			-- 새 게이트: 보드가 만들어진 회차
			and exists (select 1 from public.session_players sp2 where sp2.session_id = s.id)
			and not exists (
				select 1 from public.session_players sp
				where sp.session_id = s.id and sp.member_id = a.member_id)
			and not exists (
				select 1 from public.wait_point_ledger l
				where l.member_id = a.member_id and l.session_id = a.session_id and l.kind = 'earn')
		order by s.scheduled_at asc, a.member_id asc
	loop
		perform public.wait_points_write(
			v_row.member_id, v_row.session_id, 'earn', 1,
			jsonb_build_object('reason', 'backfill', 'session_at', v_row.scheduled_at,
			                   'note', 'board_gate_fix'));
		v_n := v_n + 1;
	end loop;
	raise notice '[wait_points] 보드 게이트 보정 적립 % 건(0 이 정상)', v_n;
end $$;
