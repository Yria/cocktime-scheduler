-- 회계 Migration 8: 대관비는 "실제로 열린 세션"만 — 경기기록(matches) 있는 세션에만 부과.
-- 설계서 §7.2. 인원 미달 등으로 모임이 무산된 날은 status가 active/closed여도 경기가 없으므로 제외.
--   "경기기록이 아예 없으면 그 날은 세션 안 열린 것으로 간주"(2026-07-13 확정).

create or replace function public.generate_dues_charges(p_ym text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_fee     int;
	v_court   int;
	v_offset  int;
	v_monthly int := 0;
	v_courtn  int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_ym is null or p_ym !~ '^\d{4}-\d{2}$' then
		raise exception 'invalid ym (expected YYYY-MM): %', p_ym;
	end if;

	select monthly_fee, court_fee_default, offset_days into v_fee, v_court, v_offset
		from public.dues_settings where id = 1;
	if v_fee is null then raise exception 'dues_settings not initialized'; end if;

	-- ── 회비(monthly_fee) ─────────────────────────────────────────
	insert into public.dues_charges (kind, member_id, period_ym, amount_due)
	select 'monthly_fee', m.id, p_ym, v_fee
	from public.members m
	where m.is_active
	  and not m.is_guest
	  and not public.is_operator(m.id)
	  and p_ym >= to_char(
			date_trunc('month',
				(coalesce(m.membership_started_at,
				          (m.created_at at time zone 'Asia/Seoul')::date) + v_offset)::timestamp)
			+ interval '1 month',
			'YYYY-MM')
	on conflict (member_id, period_ym) where period_ym is not null
	do update set amount_due = excluded.amount_due, updated_at = now()
	where public.dues_charges.amount_paid = 0;
	get diagnostics v_monthly = row_count;

	-- 정리: 무자격(무산=경기기록없음 · 대관장소아님 · 취소 등) 세션의 "미납" 대관비 항목 제거(재실행 정합).
	--   납부 이력 있는 항목(amount_paid>0)은 보존.
	delete from public.dues_charges dc
	using public.sessions s
	where dc.kind = 'court_fee'
	  and dc.amount_paid = 0
	  and dc.session_id = s.id
	  and to_char((s.scheduled_at at time zone 'Asia/Seoul'), 'YYYY-MM') = p_ym
	  and (
	        s.status not in ('active', 'closed')
	     or s.place_id is null
	     or not exists (select 1 from public.places p where p.id = s.place_id and p.court_fee_per_hour is not null)
	     or not exists (select 1 from public.matches mt where mt.session_id = s.id)
	  );

	-- ── 대관비(court_fee) — 대관 장소 + active/closed + 경기기록 있는(실제 열린) 세션만 ──
	insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint)
	select 'court_fee', a.member_id, s.id, v_court,
	       case when mm.is_guest then a.invited_by else null end
	from public.sessions s
	join public.places p       on p.id = s.place_id
	join public.attendances a  on a.session_id = s.id
	join public.members mm     on mm.id = a.member_id
	where p.court_fee_per_hour is not null
	  and s.status in ('active', 'closed')
	  and s.scheduled_at is not null
	  and to_char((s.scheduled_at at time zone 'Asia/Seoul'), 'YYYY-MM') = p_ym
	  and exists (select 1 from public.matches mt where mt.session_id = s.id)  -- 경기기록 없으면 무산 → 제외
	  and not public.is_operator(a.member_id)
	  and (
	        a.status in ('confirmed', 'late_pool')
	     or ( a.status = 'cancelled'
	          and a.confirmed_at is not null
	          and (a.cancelled_at at time zone 'Asia/Seoul')::date
	            = (s.scheduled_at at time zone 'Asia/Seoul')::date )
	      )
	on conflict (member_id, session_id) where session_id is not null
	do update set amount_due = excluded.amount_due, updated_at = now()
	where public.dues_charges.amount_paid = 0;
	get diagnostics v_courtn = row_count;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (public.current_member_id(), 'generate_charges',
	        jsonb_build_object('ym', p_ym, 'monthly', v_monthly, 'court', v_courtn));

	return jsonb_build_object('ym', p_ym, 'monthly_charges', v_monthly, 'court_charges', v_courtn);
end $$;
