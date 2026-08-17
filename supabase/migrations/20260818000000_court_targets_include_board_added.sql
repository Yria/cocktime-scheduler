-- ============================================================
-- 대관비 부과 대상 = 참석 명단 ∪ 보드 수동 추가분 (2026-08-18 운영 결정)
--
-- 실제 사고: 세션 237(8/17)에서 손형일이 정원 18 만석에 14:25 신청 → 정상 대기(waitlisted).
--   그런데 현장에서 운영진이 보드에 직접 넣어 **9경기를 뛰었다**(19명 운영). 부과 대상 판정이
--   attendances(confirmed/late_pool) 만 보므로 실제로 코트를 쓴 사람이 한 푼도 안 냈다.
--
-- 규칙: **참석 명단이 기준(base)이고, 보드 추가분만 더한다(union).**
--   · 보드에 "추가"된 회원(session_players 에 있으나 명단 기준 대상이 아닌 사람) → 부과 대상에 넣는다.
--   · 보드에서 "뺀" 회원(명단은 확정인데 보드에 없는 사람) → **여전히 부과한다.** 자리를 잡았던 건
--     사실이고, 현장에서 보드에서 빼는 일(휴식·조기귀가 정리 등)은 부과와 무관하다.
--     그래서 교집합이 아니라 합집합이다.
--
-- 구조: 부과 대상 술어가 분모(v_head)·INSERT·정리 DELETE 세 곳에 복제돼 있어 한쪽만 고치면
--   무한 재부과/재삭제로 갈렸다(20260810000000 주석의 그 문제). 이번엔 술어를 단일 함수
--   `dues_court_targets` 로 뽑아 세 경로가 같은 정의를 강제로 쓰게 한다.
-- ============================================================

-- ── 단일 소스: 이 세션의 대관비 부과 대상 ────────────────────────────
-- p_split = 엔빵 모드인가. 엔빵은 운영진 포함, 정액은 운영진 제외(종전 규칙 유지).
create or replace function public.dues_court_targets(p_session_id bigint, p_split boolean)
returns table (member_id uuid, is_day_cancel boolean, payer_hint uuid)
language sql
stable
security definer
set search_path = ''
as $function$
  with roster as (
    -- ① 참석 명단 기준: 확정 참석 + 부과 대상 당일취소(grace 초과)
    select a.member_id,
           -- 당일취소로 잡혔더라도 보드에 올라가 실제로 뛰었다면 참여자다 → 당일취소 딱지를 붙이지 않는다.
           (a.status = 'cancelled'
            and not exists (select 1 from public.session_players sp
                            where sp.session_id = p_session_id and sp.member_id = a.member_id)) as is_day_cancel,
           case when mm.is_guest then a.invited_by else null end as payer_hint
    from public.attendances a
    join public.members mm on mm.id = a.member_id
    join public.sessions s on s.id = a.session_id
    where a.session_id = p_session_id
      and ( a.status in ('confirmed', 'late_pool')
         or public.dues_is_day_cancel_chargeable(a.status, a.confirmed_at, a.cancelled_at, s.scheduled_at) )
  ),
  board_added as (
    -- ② 보드 수동 추가분. member_id 가 null 인 세션 셋업 게스트는 부과 주체가 없어 제외한다.
    select distinct sp.member_id,
           false as is_day_cancel,
           case when mm.is_guest
                then (select a2.invited_by from public.attendances a2
                      where a2.session_id = p_session_id and a2.member_id = sp.member_id)
                else null end as payer_hint
    from public.session_players sp
    join public.members mm on mm.id = sp.member_id
    where sp.session_id = p_session_id
      and sp.member_id is not null
      and not exists (select 1 from roster r where r.member_id = sp.member_id)
  )
  select t.member_id, t.is_day_cancel, t.payer_hint
  from (select * from roster union all select * from board_added) t
  where p_split or not public.is_operator(t.member_id);
$function$;

comment on function public.dues_court_targets(bigint, boolean) is
  '대관비 부과 대상 단일 소스 = 참석 명단(확정+부과대상 당일취소) ∪ 보드 수동 추가분. 엔빵 분모·INSERT·정리 DELETE 가 모두 이걸 쓴다.';

revoke execute on function public.dues_court_targets(bigint, boolean) from public, anon, authenticated;

-- ── 부과 생성/정리: 대상 판정을 위 함수에 위임 ──────────────────────
-- 20260817040000 대비 변경점은 세 경로가 dues_court_targets 를 쓰도록 바꾼 것뿐
-- (10원 절상·정액 근처 스냅·무자격 정리·void 가드는 그대로).
create or replace function public.dues_generate_session_court(p_session_id bigint)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_court int;          -- 정액 기본(6천). 스냅 기준점 겸용
  v_total int;          -- 엔빵 총액 = coalesce(세션, 규칙)
  v_n int := 0;
  v_eligible boolean;
  v_head int;           -- 엔빵 분모 = 부과 대상 수
  v_per int;            -- 엔빵 1인당(10원 절상 + 정액 근처 스냅)
  v_split boolean;      -- 엔빵 모드
  v_target_ids uuid[];  -- 정리 DELETE 가 쓸 대상 명단(함수 재호출 O(n²) 회피)
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
    -- 분모 = 부과 대상 수. 대상 집합과 **같은 함수**에서 나오므로 인당×인원이 총액과 어긋나지 않는다.
    select count(*) into v_head from public.dues_court_targets(p_session_id, true);
    if v_head = 0 then
      delete from public.dues_charges where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0
        and status <> 'void';
      return 0;
    end if;
    v_per := ceil(v_total::numeric / v_head / 10)::int * 10;      -- 10원 절상
    if v_per >= v_court and v_per < v_court + 200 then            -- 정액 근처면 정액으로(한방향)
      v_per := v_court;
    end if;
  end if;

  insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint, is_day_cancel)
  select 'court_fee', t.member_id, p_session_id,
         case when v_split then v_per else v_court end,
         t.payer_hint,
         t.is_day_cancel
  from public.dues_court_targets(p_session_id, v_split) t
  on conflict (member_id, session_id) where session_id is not null
  do update set amount_due = excluded.amount_due,
                is_day_cancel = excluded.is_day_cancel,
                updated_at = now()
  where public.dues_charges.amount_paid = 0;
  get diagnostics v_n = row_count;

  -- 부과 대상 아닌 회원의 미납 정리(선납 amount_paid>0 보존).
  --  무자격/사전취소 유령 + 엔빵→정액 전환 운영진 고아 + grace 이내 철회분.
  --  단, 운영진이 무효(void)한 건은 감사·면제 보존을 위해 자동정리에서 제외한다.
  select coalesce(array_agg(t.member_id), '{}'::uuid[]) into v_target_ids
  from public.dues_court_targets(p_session_id, v_split) t;

  delete from public.dues_charges dc
  where dc.kind = 'court_fee' and dc.session_id = p_session_id and dc.amount_paid = 0
    and dc.status <> 'void'
    and not (dc.member_id = any(v_target_ids));

  return v_n;
end $function$;

revoke execute on function public.dues_generate_session_court(bigint) from public, anon, authenticated;
