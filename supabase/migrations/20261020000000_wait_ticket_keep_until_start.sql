-- ============================================================
-- 우선참여권(티켓): **세션이 시작되기 전까지는** 당일에 취소해도 환원한다.
--
-- 요청(2026-10-20 운영자): "티켓 써서 입장했을 때 실제로 세션이 시작하기 전에 취소하면 티켓이 증발하는데,
--   시작하기 전까진 취소해도 유지하게 해줘. 서버 기록 확인해서 위와 같은 이유로 날아간 티켓 있으면 보상해줘."
--
-- 종전(C10, 20260904000000): 당일 취소(dues_is_day_cancel_chargeable = 당일 KST + 확정 후 1시간) → 몰수.
--   그래서 모임 당일 오후에 사정이 생겨 미리 뺀 회원도 7점을 통째로 잃었다(실사고 1건, 아래 ③).
--
-- ① 몰수선 = **세션이 시작된 뒤의 취소**(확정 후 1시간 안의 철회는 오조작 유예로 환원 — 회계 술어와 같은 유예).
--    날짜(당일 KST) 조건은 몰수선에서 뺐다 — 자정을 넘겨 진행 중인 회차의 취소가 환원되는 구멍이 된다.
--    시작 = 보드(session_players) 존재 — 포인트 세계의 기존 회차
--    게이트(20260905000000 · 20260928000000 N1)와 같은 증거다. sessions.started_at 은 쓰지 않는다:
--    시작 전 회차에도 값이 채워져 있어(프로덕션 draft/open 전부 not null) '시작'의 증거가 못 된다.
--    운영진 제거도 같은 선을 탄다(시작 전이면 환원, 시작 뒤면 몰수 — 종전에도 운영진 당일 제거는 몰수였다).
--    노쇼 몰수(취소 없이 안 옴)는 그대로다.
--
-- ② 당일 취소 −1(대관 장소, 20260929000000)은 그대로 두되 **감점을 환원보다 먼저** 적는다.
--    환원 → 감점 순서면 7 → 6 이 되어 티켓(7점)이 결국 또 사라진다 — 요청이 막으려는 바로 그 결과다.
--    티켓 사용 직후 잔액은 항상 0(비용 7 = 상한 7)이라 감점은 0으로 기록되고(하한), 환원으로 7이 된다.
--    즉 '시작 전 당일 취소한 티켓 사용자'는 사실상 감점이 없다 — 의도된 결과다. 미진행 정산의
--    reversal 은 '실제 깎인 양'만 되돌리므로(20260928000000) 0 감점과 충돌하지 않는다.
--
-- ③ 보상(소급): 이 사유로 이미 증발한 티켓을 환원한다. 대상 =
--    지불 상태(wait_ticket_spent)로 남은 spend 중, 티켓 자리를 **시작 전에 놓은** 것:
--      · 지금 취소 상태이고 cancelled_at < 보드 시작(보드 없으면 무한대), 또는
--      · 취소 후 **다시 신청**한 행(requested_at > spend 시각)이고 그 재신청이 보드 시작 전(지금 상태 무관 —
--        시작 뒤 또 취소했어도 첫 몰수는 시작 전이었다),
--        그리고 지금 행이 티켓 자리가 아님(exempt_reason <> 'ticket').
--        — 재신청이 시작 전이면 그 앞의 취소도 시작 전이다. requested_at 은 늦참 전환에서 바뀌지 않아
--          '늦참으로 사유만 잃은 티켓'(취소 아님)은 걸리지 않는다.
--    2026-10-20 프로덕션 조회 결과 해당 1건: 세션 246(2026-10-15 18:00, 비대관) — 10-14 04:05 KST 티켓 사용,
--    당일 취소로 몰수, 15:48 KST 일반 재신청, 보드 시작 18:14 KST. 현재 잔액 0 → 환원 후 7.
--    환원 detail 에 compensation 표식을 남긴다. 재적용해도 wait_ticket_spent 가 false 가 되어 다시 걸리지 않는다.
--    7점 알림은 보내지 않는다 — refund 는 알림 대상이 아니다(쓸 때 이미 7점이었다, 20260928000000).
--
-- 기준판: 20260929000000 wait_ticket_on_cancel (프로덕션 정의와 동일 확인, 2026-10-20).
-- ============================================================

create or replace function public.wait_ticket_on_cancel(
	p_session_id bigint, p_member uuid, p_by_admin boolean
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_self       public.attendances%rowtype;
	v_sched      timestamptz;
	v_court      boolean;
	v_day_cancel boolean;
	v_started    boolean;
	v_grace      boolean;
	v_ticket     boolean;
begin
	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = p_member;
	if not found then return; end if;
	-- 게스트 행은 포인트 세계에 존재하지 않는다.
	if v_self.invited_by is not null then return; end if;
	if exists (select 1 from public.members where id = p_member and is_guest) then return; end if;

	select s.scheduled_at, coalesce(p.charges_court_fee, false)
		into v_sched, v_court
	from public.sessions s
	left join public.places p on p.id = s.place_id
	where s.id = p_session_id;
	v_day_cancel := public.dues_is_day_cancel_chargeable(
		v_self.status, v_self.confirmed_at, v_self.cancelled_at, v_sched);
	-- 시작 = 보드 존재(회차 게이트와 같은 증거, 20260905000000).
	v_started := exists (select 1 from public.session_players sp where sp.session_id = p_session_id);
	-- 확정 직후 1시간 안의 철회 = 오조작(dues_is_day_cancel_chargeable 의 유예와 같은 선).
	v_grace := v_self.confirmed_at is not null and v_self.cancelled_at is not null
		and v_self.cancelled_at - v_self.confirmed_at < interval '1 hour';
	v_ticket := public.wait_ticket_spent(p_session_id, p_member);

	-- 불참 −1 은 **본인이 당일에 뺀 경우**, 그리고 **대관 장소 회차**만이다(20260929000000).
	--   운영진 제거는 귀책이 불분명하므로 벌하지 않는다.
	--   환원보다 **먼저** 적는다 — 반대 순서면 환원한 7점에서 깎여 티켓이 다시 사라진다(20261020000000 ②).
	if v_day_cancel and v_court and not p_by_admin then
		perform public.wait_points_write(
			p_member, p_session_id, 'penalty', -1,
			jsonb_build_object('reason', 'day_cancel'));
	end if;

	-- 몰수는 **시작된 뒤의 취소**만(C10 을 20261020000000 에서 바꿈). 그 전에는 당일이어도 전액 환원.
	if v_ticket and not (v_started and not v_grace) then
		perform public.wait_points_write(
			p_member, p_session_id, 'refund', public.wait_ticket_cost(),
			jsonb_build_object('reason', case when p_by_admin then 'admin_cancel' else 'early_cancel' end));
	end if;
end;
$$;
revoke execute on function public.wait_ticket_on_cancel(bigint, uuid, boolean)
	from public, anon, authenticated;

-- ③ 소급 보상 — 시작 전 당일 취소로 몰수된 티켓.
do $$
declare
	r record;
begin
	for r in
		select a.member_id, a.session_id
		from public.attendances a
		join public.members m on m.id = a.member_id and not m.is_guest
		cross join lateral (
			select max(l.created_at) as spent_at
			from public.wait_point_ledger l
			where l.member_id = a.member_id and l.session_id = a.session_id and l.kind = 'spend'
		) sp
		cross join lateral (
			select coalesce(min(p.joined_at), 'infinity'::timestamptz) as board_at
			from public.session_players p where p.session_id = a.session_id
		) b
		where a.invited_by is null
			and sp.spent_at is not null
			and public.wait_ticket_spent(a.session_id, a.member_id)
			and (
				(a.status = 'cancelled' and a.cancelled_at < b.board_at)
				-- 재신청 행은 지금 상태와 무관하다(시작 뒤 다시 취소했어도 앞선 몰수는 시작 전이었다).
				or (a.exempt_reason is distinct from 'ticket'
					and a.requested_at > sp.spent_at
					and a.requested_at < b.board_at)
			)
		order by a.session_id, a.member_id
	loop
		perform public.wait_points_write(
			r.member_id, r.session_id, 'refund', public.wait_ticket_cost(),
			jsonb_build_object('reason', 'early_cancel', 'compensation', '20261020000000'));
	end loop;
end;
$$;
