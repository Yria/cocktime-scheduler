-- ============================================================
-- 당일취소 대관비: 확정 직후 철회(1시간 이내)는 부과 대상에서 제외.
--
-- 배경(실제 사고): 2026-08-09 세션(106)에서 김영주가 참석을 누른 뒤 **2.7초** 만에 취소했는데
--   (confirmed_at 06:02:38 → cancelled_at 06:02:41 KST) 취소 시각이 세션 당일이라
--   `is_day_cancel` 정액 6,000원이 부과됐다. 같은 회원이 8/2 세션(107)에서도 5초 만에 취소하고 부과됐고,
--   7/25 세션(200)의 1초·31분 건은 운영진이 [부과삭제](void)로 수동 처리하고 있었다.
--   → 오조작/즉시 철회를 규칙이 걸러내지 못해 매번 운영진이 손으로 빼는 구조였다.
--
-- 정책 근거: 당일취소를 부과하는 이유는 "자리를 잡아둔 채 비워서 남이 못 들어온 비용"이다.
--   확정 후 1시간 이내에 스스로 물린 건은 자리를 실질적으로 점유한 적이 없으므로 그 근거가 성립하지 않는다.
--   → 정액 당일취소 술어에 **grace 1시간** 조건을 추가한다(엔빵은 원래 당일취소 미부과라 무관).
--
-- 구조: 술어가 INSERT·정리 DELETE 두 곳에 복제돼 있어 한쪽만 고치면 무한 재부과/재삭제로 갈린다.
--   → 단일 술어 함수 `dues_is_day_cancel_chargeable`로 뽑아 두 곳이 같은 정의를 쓰도록 강제한다.
--
-- 기준 시각(의도): grace는 `attendances.confirmed_at` = **마지막으로 자리를 잡은 시각**부터 잰다.
--   join_session 이 재참석 때 confirmed_at 을 now() 로 덮어쓰므로 "취소 → 재참석 → 취소"는
--   재참석 시각부터 다시 1시간이다. 이건 버그가 아니라 정책이다 — 재참석은 자리를 새로 잡은 것이므로
--   점유 타이머도 새로 시작하는 게 맞다(confirmed_at 의 불변식: 대기는 null, 승격은 승격 시각).
--   "오래 잡고 있다가 세션 직전에 취소→재참석→취소"로 앞선 점유가 회계에서 사라지는 경로가 남지만,
--   대기자가 있으면 첫 취소에서 promote_waitlist_fill 이 자리를 채워 재참석이 waitlisted 로 떨어지고,
--   대기자가 없으면 애초에 '남이 못 들어온 비용'이라는 부과 근거가 성립하지 않는다.
--   → 최초 확정 시각 보존 컬럼은 추가하지 않는다.
-- ============================================================

-- ── 단일 술어: 이 attendance 행이 '부과 대상 당일취소'인가 ───────────────
-- 정액(비엔빵) 모드에서만 호출된다. 호출부의 `not v_split` 가드는 그대로 유지.
create or replace function public.dues_is_day_cancel_chargeable(
  p_status       text,
  p_confirmed_at timestamptz,
  p_cancelled_at timestamptz,
  p_scheduled_at timestamptz
)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select p_status = 'cancelled'
     and p_confirmed_at is not null
     and p_cancelled_at is not null
     -- 세션 당일(KST)에 취소했는가
     and (p_cancelled_at at time zone 'Asia/Seoul')::date
       = (p_scheduled_at at time zone 'Asia/Seoul')::date
     -- grace: 확정 후 1시간 이내 철회는 오조작으로 보고 부과하지 않는다
     and (p_cancelled_at - p_confirmed_at) >= interval '1 hour';
$function$;
comment on function public.dues_is_day_cancel_chargeable(text, timestamptz, timestamptz, timestamptz)
  is '정액 대관비의 당일취소 부과 대상 판정(단일 술어). 세션 당일 취소 + 확정 후 1시간 경과.';

-- ── 부과 생성/정리: 위 술어로 두 경로 통일 ────────────────────────────
-- 20260727130000 대비 변경점은 당일취소 술어를 함수 호출로 교체한 것뿐(void 가드 등 나머지 동일).
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
         (a.status = 'cancelled')   -- 이 술어를 통과한 cancelled = 정액 당일 확정취소자(grace 초과)
  from public.attendances a
  join public.members mm on mm.id = a.member_id
  join public.sessions s on s.id = a.session_id
  where a.session_id = p_session_id
    and ( v_split or not public.is_operator(a.member_id) )   -- 엔빵=전원, 정액=운영진 제외
    and (
          a.status in ('confirmed', 'late_pool')
       or ( not v_split                                       -- 당일취소는 정액에서만 부과
            and public.dues_is_day_cancel_chargeable(a.status, a.confirmed_at, a.cancelled_at, s.scheduled_at) )
        )
  on conflict (member_id, session_id) where session_id is not null
  do update set amount_due = excluded.amount_due,
                is_day_cancel = excluded.is_day_cancel,
                updated_at = now()
  where public.dues_charges.amount_paid = 0;
  get diagnostics v_n = row_count;

  -- 부과 대상 아닌 회원의 미납 정리(선납 amount_paid>0 보존).
  --  무자격/사전취소 유령 + 엔빵→정액 전환 운영진 고아 + (엔빵) 당일취소 제외분
  --  + **grace 이내 철회분**까지 일괄.
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
                and public.dues_is_day_cancel_chargeable(a.status, a.confirmed_at, a.cancelled_at, s.scheduled_at) )
            )
    );

  return v_n;
end $function$;
revoke execute on function public.dues_generate_session_court(bigint) from public, anon, authenticated;

-- ── 백필: 이미 생성된 grace 이내 부과 정리 ─────────────────────────────
-- 대상은 '미납(amount_paid=0) + void 아님'만. 납부 완료분은 은행 대사가 끝난 현금이라
-- 자동으로 손대면 원장이 깨지므로 건드리지 않는다(해당 건은 운영 판단으로 별도 처리).
-- void 건은 감사 흔적 보존 원칙(20260727130000)대로 그대로 둔다.
delete from public.dues_charges dc
using public.attendances a, public.sessions s
where dc.kind = 'court_fee'
  and dc.is_day_cancel
  and dc.amount_paid = 0
  and dc.status <> 'void'
  and a.session_id = dc.session_id
  and a.member_id  = dc.member_id
  and s.id         = dc.session_id
  and not public.dues_is_day_cancel_chargeable(a.status, a.confirmed_at, a.cancelled_at, s.scheduled_at);
