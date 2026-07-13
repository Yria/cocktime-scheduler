-- 회계 Migration 7: generate_dues_charges — 미납 항목 금액 자동 교정.
-- 설계서 §7. 기존엔 on conflict do nothing(스냅샷)이라, 정책액이 바뀌어도 이미 만든 미납 항목은 옛 금액 유지.
-- 문제: 옛 모델(장소=인당액)로 13,000 등으로 잘못 생성된 대관비 항목이 그대로 남음.
-- 해결: 재생성 시 amount_paid=0(완전 미납) 항목의 amount_due 를 현재 정책액으로 갱신(update).
--   납부 이력 있는(paid/partial/overpaid) 항목은 스냅샷 그대로 보존 → 확정 금액 불변.

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
	where public.dues_charges.amount_paid = 0;   -- 미납만 현재가로 교정
	get diagnostics v_monthly = row_count;

	-- ── 대관비(court_fee) = 고정 인당액(court_fee_default) ─────────
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
	where public.dues_charges.amount_paid = 0;   -- 미납만 현재가로 교정
	get diagnostics v_courtn = row_count;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (public.current_member_id(), 'generate_charges',
	        jsonb_build_object('ym', p_ym, 'monthly', v_monthly, 'court', v_courtn));

	return jsonb_build_object('ym', p_ym, 'monthly_charges', v_monthly, 'court_charges', v_courtn);
end $$;
