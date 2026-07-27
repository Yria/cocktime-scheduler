-- ============================================================
-- 당일취소 부과삭제(void) 내구성 강화 — 재검증에서 발견된 MEDIUM 갭 수정.
--
-- 20260727120000 은 self-heal '개별정리 DELETE'에만 status<>'void' 가드를 넣었으나,
-- ①세션 무자격 시 전체삭제 DELETE ②엔빵 head=0 시 DELETE 두 bulk 경로는 무가드였다.
-- → 운영진이 void(부과삭제)한 당일취소 건이, 세션이 자격을 잃는 전이
--   (places.charges_court_fee 토글·matches 삭제·generate_dues_charges 배치 재순회)에서
--   amount_paid=0 이라 통째로 삭제됨. 결과: (a) voided_by/at 소실 + dues_audit_log.charge_id NULL화
--   (감사 단절), (b) 세션이 자격을 회복하면 status='unpaid'로 재부과되어 운영진 면제가 사라짐.
-- 이 기능의 핵심 불변식(row DELETE가 아니라 소프트 void로 감사·면제 보존)을 위배하므로,
-- 세 DELETE 경로 모두 `status <> 'void'` 가드로 통일한다.
--
-- 부수: dues_set_charge_status 의 waived 분기도 voided_by/at 를 해제하도록 보완
--       (불변식: voided_by 비어있지 않음 ⟺ status='void'). void→waived 직전이 전이 시 잔존 방지.
-- ============================================================

create or replace function public.dues_generate_session_court(p_session_id bigint)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_court int;      -- 정액 기본(6천)
  v_total int;      -- 엔빵 총액 = coalesce(세션, 규칙)
  v_n int := 0;
  v_eligible boolean;
  v_head int;       -- 엔빵 분모(실제 참석, 운영진 포함, 게스트 포함)
  v_per int;        -- 엔빵 1인당(10원 버림)
  v_split boolean;  -- 엔빵 모드
begin
  select court_fee_default into v_court from public.dues_settings where id = 1;

  select (p.charges_court_fee
          and s.status in ('active','closed')
          and s.scheduled_at is not null
          and exists (select 1 from public.matches mt where mt.session_id = s.id)),
         coalesce(s.court_fee, r.court_fee)
    into v_eligible, v_total
  from public.sessions s
  left join public.places p on p.id = s.place_id
  left join public.recurring_schedules r on r.id = s.recurring_schedule_id
  where s.id = p_session_id;

  if v_eligible is not true then
    -- 무자격 세션의 미납 전삭제. 단 void(부과삭제)는 감사·면제 보존 위해 제외.
    delete from public.dues_charges
    where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0
      and status <> 'void';
    return 0;
  end if;

  v_split := (v_total is not null and v_total > 0);
  if v_split then
    -- 엔빵 분모 = 실제 참석(confirmed/late_pool)만, 운영진·게스트 포함. 당일취소는 제외.
    select count(*) into v_head
    from public.attendances a
    where a.session_id = p_session_id
      and a.status in ('confirmed', 'late_pool');
    if v_head = 0 then
      delete from public.dues_charges where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0
        and status <> 'void';
      return 0;
    end if;
    v_per := ((v_total / v_head) / 10) * 10;  -- 10원 버림(엔빵)
  end if;

  insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint, is_day_cancel)
  select 'court_fee', a.member_id, p_session_id,
         case when v_split then v_per else v_court end,
         case when mm.is_guest then a.invited_by else null end,
         (a.status = 'cancelled')   -- 이 술어를 통과한 cancelled = 정액 당일 확정취소자
  from public.attendances a
  join public.members mm on mm.id = a.member_id
  join public.sessions s on s.id = a.session_id
  where a.session_id = p_session_id
    and ( v_split or not public.is_operator(a.member_id) )   -- 엔빵=전원, 정액=운영진 제외
    and (
          a.status in ('confirmed', 'late_pool')
       or ( not v_split                                       -- 당일취소는 정액에서만 부과
            and a.status = 'cancelled'
            and a.confirmed_at is not null
            and (a.cancelled_at at time zone 'Asia/Seoul')::date
              = (s.scheduled_at at time zone 'Asia/Seoul')::date )
        )
  on conflict (member_id, session_id) where session_id is not null
  do update set amount_due = excluded.amount_due,
                is_day_cancel = excluded.is_day_cancel,
                updated_at = now()
  where public.dues_charges.amount_paid = 0;
  get diagnostics v_n = row_count;

  -- 부과 대상 아닌 회원의 미납 정리(선납 amount_paid>0 보존).
  --  무자격/사전취소 유령 + 엔빵→정액 전환 운영진 고아 + (엔빵) 당일취소 제외분까지 일괄.
  --  단, 운영진이 무효(void)한 건은 감사·면제 보존을 위해 자동정리에서 제외한다.
  delete from public.dues_charges dc
  where dc.kind = 'court_fee' and dc.session_id = p_session_id and dc.amount_paid = 0
    and dc.status <> 'void'
    and not exists (
      select 1
      from public.attendances a
      join public.sessions s on s.id = a.session_id
      where a.session_id = p_session_id
        and a.member_id = dc.member_id
        and ( v_split or not public.is_operator(a.member_id) )
        and (
              a.status in ('confirmed', 'late_pool')
           or ( not v_split
                and a.status = 'cancelled'
                and a.confirmed_at is not null
                and (a.cancelled_at at time zone 'Asia/Seoul')::date
                  = (s.scheduled_at at time zone 'Asia/Seoul')::date )
            )
    );

  return v_n;
end $function$;
revoke execute on function public.dues_generate_session_court(bigint) from public, anon, authenticated;

-- ── 불변식 보완: waived 전이 시에도 voided_by/at 해제 ──
create or replace function public.dues_set_charge_status(p_charge_id bigint, p_status text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin uuid := public.current_member_id();
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_status = 'reset' then
		update public.dues_charges set status = case
				when amount_paid = 0            then 'unpaid'
				when amount_paid < amount_due   then 'partial'
				when amount_paid = amount_due   then 'paid'
				else                                 'overpaid'
			end, voided_by = null, voided_at = null, updated_at = now()
		where id = p_charge_id;
	elsif p_status = 'void' then
		update public.dues_charges
		set status = 'void', voided_by = v_admin, voided_at = now(), updated_at = now()
		where id = p_charge_id;
	elsif p_status = 'waived' then
		-- 면제는 부과삭제(void)와 다른 상태 → void 귀속(voided_by/at) 잔존 제거(불변식 유지).
		update public.dues_charges set status = 'waived', voided_by = null, voided_at = null, updated_at = now()
		where id = p_charge_id;
	else
		raise exception 'invalid status (waived|void|reset): %', p_status;
	end if;
	if not found then raise exception 'charge % not found', p_charge_id; end if;
	insert into public.dues_audit_log (actor_member_id, action, charge_id, detail)
	values (v_admin, 'set_charge_status', p_charge_id, jsonb_build_object('status', p_status));
	return jsonb_build_object('charge_id', p_charge_id, 'status', p_status);
end $$;
