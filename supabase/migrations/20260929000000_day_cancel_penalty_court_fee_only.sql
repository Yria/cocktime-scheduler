-- ============================================================
-- 대기 포인트: 당일 취소 −1 을 **대관 장소 회차에만** 적용한다.
--
-- 요청(2026-09-29 운영자): "당일 취소 감점도 부과와 마찬가지로 대관장소에만 적용해야 해."
--   당일 취소 대관비 부과(dues_generate_session_court)는 places.charges_court_fee 게이트를 거치는데,
--   포인트 감점(wait_ticket_on_cancel)은 같은 판정 술어(dues_is_day_cancel_chargeable)만 쓰고 장소를
--   보지 않아 비대관 모임에서도 −1 이 났다(프로덕션 실측: 비대관 평일 113건, 실제 감점 합 −12).
--
-- 바꾸는 것: **penalty(−1) 분기 하나**. 장소가 없거나 비대관이면 감점하지 않는다.
--   판정 시점은 취소하는 순간의 장소다(원장은 append-only 라 나중에 장소를 바꿔도 소급하지 않는다).
-- 바꾸지 않는 것:
--   · 티켓 몰수/환원 — 당일 취소 몰수(C10)는 장소와 무관하게 그대로다(운영자는 감점만 지정했다).
--   · 노쇼 −1(wait_points_settle_session) — 요청 범위 밖.
--   · 회계의 '경기 기록 있음' 조건 — 감점은 취소 순간 기록되므로 그 시점에는 경기 기록이 없다.
--     열리지 않은 회차의 감점은 미진행 정산(20260928000000)이 되돌린다.
--   · 소급 없음 — 이미 기록된 비대관 감점은 그대로 둔다.
--
-- 기준판: 20260904000000 ⑫ wait_ticket_on_cancel (이후 재정의 없음, 프로덕션 정의와 동일 확인).
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
	v_ticket := public.wait_ticket_spent(p_session_id, p_member);

	if v_ticket and not v_day_cancel then
		-- 사전 취소 · 운영진 제거 → 전액 환원. (당일 취소는 몰수 — C10, 장소 무관)
		perform public.wait_points_write(
			p_member, p_session_id, 'refund', public.wait_ticket_cost(),
			jsonb_build_object('reason', case when p_by_admin then 'admin_cancel' else 'early_cancel' end));
	end if;

	-- 불참 −1 은 **본인이 당일에 뺀 경우**, 그리고 **대관 장소 회차**만이다(20260929000000).
	--   운영진 제거는 귀책이 불분명하므로 벌하지 않는다.
	--   대관 게이트는 당일 취소 대관비 부과(dues_generate_session_court)의 charges_court_fee 와 같은 선이다.
	if v_day_cancel and v_court and not p_by_admin then
		perform public.wait_points_write(
			p_member, p_session_id, 'penalty', -1,
			jsonb_build_object('reason', 'day_cancel'));
	end if;
end;
$$;
revoke execute on function public.wait_ticket_on_cancel(bigint, uuid, boolean)
	from public, anon, authenticated;
