-- ============================================================
-- 엔빵 대관비 산식 3가지 변경 (2026-08-17 운영 결정)
--
--  ① 당일취소(부과 대상)를 엔빵에도 포함한다.
--     종전: 당일취소 부과는 정액 모드 전용이고, 엔빵은 분모·부과에서 통째로 제외했다.
--     변경 근거: 당일취소를 부과하는 이유는 "자리를 잡아둔 채 비워서 남이 못 들어온 비용"이고,
--       그 근거는 총액을 나누는 엔빵에서도 똑같이 성립한다. 오히려 엔빵에서 빼면 실제로 코트를
--       비운 사람이 한 푼도 안 내고 나온 사람들이 그만큼 더 나눠 갖는 역진이 된다.
--     → 부과 대상 술어를 두 모드에서 동일하게 만든다(`not v_split` 게이트 제거).
--       분모(v_head)에도 같은 술어를 적용해 "부과 대상 = 분모"를 강제한다.
--       grace 1시간(20260810000000) 규칙은 그대로 — 확정 직후 철회는 여전히 부과하지 않는다.
--
--  ② 1인당 금액을 10원 **절상**한다(종전 버림).
--     버림은 총액보다 적게 걷혀 늘 통장이 모자랐다. 절상은 최대 (인원-1)×10원 더 걷힌다.
--
--  ③ 1인당이 정액 기본값 이상 ~ +200원 미만이면 정액 기본값으로 내린다.
--     예) 117,000 ÷ 19 = 6,157.9 → 절상 6,160 → 6,000원.
--     근거: 정액과 사실상 같은 금액인데 6,160원 같은 잔돈을 걷는 건 실무 비용이 더 크다.
--     **한방향이다** — 정액보다 싸게 나오면 계산값 그대로 받는다(회원이 더 내는 방향으로는 올리지 않는다).
--     ⚠ 스냅 기준점은 `dues_settings.court_fee_default`(현재 6,000)다. 이 값을 바꾸면 엔빵 금액의
--       스냅 구간도 함께 움직인다는 뜻이니, 정액을 조정할 때 이 규칙을 같이 확인할 것.
--
-- 적용 범위: 이 함수는 세션 종료 트리거(trg_session_court_on_close)와 수동 재실행에서만 돈다.
--   이미 종료된 과거 세션은 재실행하지 않으면 종전 금액을 유지한다(공개 원장 소급 변동 방지).
-- ============================================================

create or replace function public.dues_generate_session_court(p_session_id bigint)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_court int;      -- 정액 기본(6천). ③ 스냅 기준점 겸용
  v_total int;      -- 엔빵 총액 = coalesce(세션, 규칙)
  v_n int := 0;
  v_eligible boolean;
  v_head int;       -- 엔빵 분모(실제 참석 + 부과 대상 당일취소, 운영진·게스트 포함)
  v_per int;        -- 엔빵 1인당(10원 절상 + 정액 근처 스냅)
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
    -- ① 엔빵 분모 = 실제 참석(confirmed/late_pool) + 부과 대상 당일취소. 운영진·게스트 포함.
    --    아래 INSERT 대상 술어와 **글자 그대로 같아야 한다**(분모 ≠ 부과대상이면 합이 총액과 어긋난다).
    select count(*) into v_head
    from public.attendances a
    join public.sessions s on s.id = a.session_id
    where a.session_id = p_session_id
      and ( a.status in ('confirmed', 'late_pool')
         or public.dues_is_day_cancel_chargeable(a.status, a.confirmed_at, a.cancelled_at, s.scheduled_at) );
    if v_head = 0 then
      delete from public.dues_charges where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0
        and status <> 'void';
      return 0;
    end if;
    -- ② 10원 절상
    v_per := ceil(v_total::numeric / v_head / 10)::int * 10;
    -- ③ 정액 기본값 이상 ~ +200원 미만이면 정액으로 스냅(한방향 — 더 싸게 나오면 그대로 둔다)
    if v_per >= v_court and v_per < v_court + 200 then
      v_per := v_court;
    end if;
  end if;

  insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint, is_day_cancel)
  select 'court_fee', a.member_id, p_session_id,
         case when v_split then v_per else v_court end,
         case when mm.is_guest then a.invited_by else null end,
         (a.status = 'cancelled')   -- 이 술어를 통과한 cancelled = 당일 확정취소자(grace 초과)
  from public.attendances a
  join public.members mm on mm.id = a.member_id
  join public.sessions s on s.id = a.session_id
  where a.session_id = p_session_id
    and ( v_split or not public.is_operator(a.member_id) )   -- 엔빵=전원, 정액=운영진 제외
    and (
          a.status in ('confirmed', 'late_pool')
       -- ① 당일취소는 두 모드 모두 부과(종전 `not v_split` 게이트 제거)
       or public.dues_is_day_cancel_chargeable(a.status, a.confirmed_at, a.cancelled_at, s.scheduled_at)
        )
  on conflict (member_id, session_id) where session_id is not null
  do update set amount_due = excluded.amount_due,
                is_day_cancel = excluded.is_day_cancel,
                updated_at = now()
  where public.dues_charges.amount_paid = 0;
  get diagnostics v_n = row_count;

  -- 부과 대상 아닌 회원의 미납 정리(선납 amount_paid>0 보존).
  --  무자격/사전취소 유령 + 엔빵→정액 전환 운영진 고아 + grace 이내 철회분.
  --  (엔빵 당일취소 제외분은 ①로 사라졌다 — 이제 두 모드 다 부과 대상이다.)
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
           or public.dues_is_day_cancel_chargeable(a.status, a.confirmed_at, a.cancelled_at, s.scheduled_at)
            )
    );

  return v_n;
end $function$;

revoke execute on function public.dues_generate_session_court(bigint) from public, anon, authenticated;
