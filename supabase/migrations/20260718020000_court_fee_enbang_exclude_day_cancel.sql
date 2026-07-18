-- ============================================================
-- 엔빵 대관비: 당일취소자 제외(정액일 때만 부과).
--
-- 정책(회계 §1.1·§4):
--  · 정액(고정비, v_split=false): 참석(confirmed/late_pool) + **당일 확정취소**, 운영진 제외.
--    당일취소도 자리를 잡고 약속했던 비용이라 인당 정액을 부과(현행 유지).
--  · 엔빵(총액 분할, v_split=true): **실제 참석(confirmed/late_pool)만**, 운영진 포함.
--    총액을 '코트를 실제로 쓴 사람'끼리 나누는 모델이라 당일취소자는 분모/부과에서 제외.
--
-- 부과 대상 판정을 v_split 에 따라 갈리게: 당일취소 분기에 `not v_split` 가드 추가.
-- 분모(v_head)·INSERT·정리 delete 세 곳 모두 동일 술어 사용(일관).
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

  insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint)
  select 'court_fee', a.member_id, p_session_id,
         case when v_split then v_per else v_court end,
         case when mm.is_guest then a.invited_by else null end
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
  do update set amount_due = excluded.amount_due, updated_at = now()
  where public.dues_charges.amount_paid = 0;
  get diagnostics v_n = row_count;

  -- 부과 대상 아닌 회원의 미납 정리(선납 amount_paid>0 보존).
  --  무자격/사전취소 유령 + 엔빵→정액 전환 운영진 고아 + (엔빵) 당일취소 제외분까지 일괄.
  delete from public.dues_charges dc
  where dc.kind = 'court_fee' and dc.session_id = p_session_id and dc.amount_paid = 0
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
