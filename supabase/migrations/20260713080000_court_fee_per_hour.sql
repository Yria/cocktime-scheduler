-- 회계 Migration 5: 대관비 모델 정정 — 장소 필드 = "코트 시간당 요금"(수지용), 회원 청구 = 고정 인당액.
-- 설계서: docs/ACCOUNTING_DESIGN.md §6.3, §7.2. (2026-07-13 확정)
--   · places.court_fee_per_head → court_fee_per_hour : 코트 1개 시간당 요금(예 13,000). NULL=대관비 없는 장소.
--     클럽 지출(수지) = 요금 × 코트수(sessions.court_count) × 시간(ends_at-scheduled_at). (수지 §10에서 집계)
--   · 회원 대관비 청구액 = dues_settings.court_fee_default (고정 6,000/인). 장소가 대관 장소일 때만 부과.
-- 아직 부과(dues_charges)를 생성하지 않은 시점이라 컬럼 rename·로직 변경에 데이터 마이그레이션 부담 없음.

alter table public.places rename column court_fee_per_head to court_fee_per_hour;
comment on column public.places.court_fee_per_hour is
  '코트 1개 시간당 대관 요금(원). NULL=대관비 없는 장소. 수지 계산용(요금×코트수×시간). 회원 청구는 dues_settings.court_fee_default 고정 인당액.';

-- generate_dues_charges: 대관비 amount = dues_settings.court_fee_default(인당 고정), gate = 장소 요금 설정 여부.
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
	on conflict (member_id, period_ym) where period_ym is not null do nothing;
	get diagnostics v_monthly = row_count;

	-- ── 대관비(court_fee) ─────────────────────────────────────────
	-- 금액 = 고정 인당액(court_fee_default). 장소에 시간당 요금이 설정된(=대관하는) 세션에만.
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
	on conflict (member_id, session_id) where session_id is not null do nothing;
	get diagnostics v_courtn = row_count;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (public.current_member_id(), 'generate_charges',
	        jsonb_build_object('ym', p_ym, 'monthly', v_monthly, 'court', v_courtn));

	return jsonb_build_object('ym', p_ym, 'monthly_charges', v_monthly, 'court_charges', v_courtn);
end $$;
