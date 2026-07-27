-- ============================================================
-- 당일취소 대관비: 현황 노출 + 운영진 소프트 무효(부과삭제·취소선) + 감사(누가 삭제했는지)
--
-- 배경(회계 §1.1·§4): 정액 모드에서 '당일 확정취소자'도 자리·약속 비용으로 정액을 부과한다.
--   그러나 카풀 불발 등 사정이 있는 건은 운영진이 개별로 부과를 빼줄 수 있어야 한다.
--   row DELETE 가 아니라 status='void' 소프트 무효로 두어 취소선 + 감사기록(누가·언제)을 남긴다.
--
-- 이 마이그레이션:
--  1) dues_charges 컬럼 추가:
--     - is_day_cancel        : court_fee 부과가 '당일 확정취소' 분기로 생성됐는지(현황 노출/버튼 게이트)
--     - voided_by / voided_at: 누가·언제 무효(부과삭제)했는지(감사·표시)
--  2) dues_generate_session_court: INSERT 시 is_day_cancel 세팅 + 재실행 시 보존/갱신,
--     self-heal 개별정리 DELETE 에 `status<>'void'` 가드(운영진 무효 결정을 자동정리가 지우지 않게).
--  3) dues_set_charge_status: void 시 voided_by/at 기록, reset 시 해제.
--  4) 기존 당일취소 부과분 is_day_cancel 백필.
-- ============================================================

alter table public.dues_charges
  add column if not exists is_day_cancel boolean not null default false,
  add column if not exists voided_by uuid references public.members(id) on delete set null,
  add column if not exists voided_at timestamptz;

-- ── 기존 당일취소 부과분 백필(정액 모드에서 확정 후 당일취소로 부과된 court_fee) ──
update public.dues_charges dc
set is_day_cancel = true
from public.attendances a
join public.sessions s on s.id = a.session_id
where dc.kind = 'court_fee'
  and a.session_id = dc.session_id
  and a.member_id = dc.member_id
  and a.status = 'cancelled'
  and a.confirmed_at is not null
  and (a.cancelled_at at time zone 'Asia/Seoul')::date
    = (s.scheduled_at at time zone 'Asia/Seoul')::date
  and dc.is_day_cancel is distinct from true;

-- ── 부과 생성/self-heal: is_day_cancel 세팅 + void 보존 가드 ──
--    (기존 20260718020000 정의에서 INSERT 컬럼·ON CONFLICT·개별정리 DELETE 3곳만 변경)
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
  v_head int;       -- 엔빵 분모(실제 참석, 운영진 포함)
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
    delete from public.dues_charges
    where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0;
    return 0;
  end if;

  v_split := (v_total is not null and v_total > 0);
  if v_split then
    -- 엔빵 분모 = 실제 참석(confirmed/late_pool)만, 운영진 포함. 당일취소는 제외.
    select count(*) into v_head
    from public.attendances a
    where a.session_id = p_session_id
      and a.status in ('confirmed', 'late_pool');
    if v_head = 0 then
      delete from public.dues_charges where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0;
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
  --  단, 운영진이 무효(void)한 건은 감사·표시 보존을 위해 자동정리에서 제외한다.
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

-- ── 부과 무효/재산정: void 시 누가·언제 했는지 기록, reset 시 해제 ──
--    (기존 20260713060000 정의에 voided_by/at 처리만 추가. 시그니처 동일 → 기존 grant 유지)
create or replace function public.dues_set_charge_status(p_charge_id bigint, p_status text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin uuid := public.current_member_id();
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_status = 'reset' then
		-- 배분 캐시 기준으로 상태 재산정(무효/면제 해제). 무효 흔적(voided_by/at) 제거.
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
		update public.dues_charges set status = 'waived', updated_at = now() where id = p_charge_id;
	else
		raise exception 'invalid status (waived|void|reset): %', p_status;
	end if;
	if not found then raise exception 'charge % not found', p_charge_id; end if;
	insert into public.dues_audit_log (actor_member_id, action, charge_id, detail)
	values (v_admin, 'set_charge_status', p_charge_id, jsonb_build_object('status', p_status));
	return jsonb_build_object('charge_id', p_charge_id, 'status', p_status);
end $$;
