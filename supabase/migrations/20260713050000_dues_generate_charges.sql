-- 회계 Migration 2: 부과 생성 RPC generate_dues_charges(ym)
-- 설계서: docs/ACCOUNTING_DESIGN.md §7(부과 생성층). 복잡한 룰을 여기서 한 번 계산해 구체 행으로 떨군다.
--
-- 멱등: dues_charges의 부분 유니크 인덱스(uq_charge_month/uq_charge_session) + on conflict do nothing.
--   부분 인덱스이므로 conflict target에 동일 predicate(where ... is not null)를 명시해야 arbiter가 매칭됨.
-- 룰(확정):
--   회비 — is_active AND NOT is_guest AND NOT is_operator. 첫 부과월 = month_of(가입일+offset)의 다음 달.
--          가입일 = coalesce(membership_started_at, created_at KST).
--   대관비 — places.court_fee_per_head not null AND sessions.status in ('active','closed') 인 세션의,
--          참석 status in ('confirmed','late_pool')  또는  당일취소자(confirmed_at 존재 & 취소일=세션일).
--          운영진 제외. 게스트는 payer_hint=invited_by(대납 후보). 금액은 장소별 인당액 스냅샷.

create or replace function public.generate_dues_charges(p_ym text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_fee     int;
	v_offset  int;
	v_monthly int := 0;
	v_court   int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_ym is null or p_ym !~ '^\d{4}-\d{2}$' then
		raise exception 'invalid ym (expected YYYY-MM): %', p_ym;
	end if;

	select monthly_fee, offset_days into v_fee, v_offset
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
	insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint)
	select 'court_fee', a.member_id, s.id, p.court_fee_per_head,
	       case when mm.is_guest then a.invited_by else null end
	from public.sessions s
	join public.places p       on p.id = s.place_id
	join public.attendances a  on a.session_id = s.id
	join public.members mm     on mm.id = a.member_id
	where p.court_fee_per_head is not null
	  and s.status in ('active', 'closed')
	  and s.scheduled_at is not null
	  and to_char((s.scheduled_at at time zone 'Asia/Seoul'), 'YYYY-MM') = p_ym
	  and not public.is_operator(a.member_id)
	  and (
	        a.status in ('confirmed', 'late_pool')            -- 확정(no-show 포함) + 정원외 늦참(악용 방지)
	     or ( a.status = 'cancelled'                          -- 당일 취소자
	          and a.confirmed_at is not null                  --   확정된 적 있음(대기만 하다 취소 제외)
	          and (a.cancelled_at at time zone 'Asia/Seoul')::date
	            = (s.scheduled_at at time zone 'Asia/Seoul')::date )
	      )
	on conflict (member_id, session_id) where session_id is not null do nothing;
	get diagnostics v_court = row_count;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (public.current_member_id(), 'generate_charges',
	        jsonb_build_object('ym', p_ym, 'monthly', v_monthly, 'court', v_court));

	return jsonb_build_object('ym', p_ym, 'monthly_charges', v_monthly, 'court_charges', v_court);
end $$;

revoke execute on function public.generate_dues_charges(text) from public;  -- 암묵적 PUBLIC EXECUTE 제거(anon 차단), authenticated 만 재부여(내부 is_admin 가드가 실제 방어)
grant execute on function public.generate_dues_charges(text) to authenticated;
