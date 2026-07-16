-- 대관비 정리 조건 안전화(20260716030000 수정).
-- 직전 버전은 '참석 자격 없는 모든 회원의 미납 대관비'를 지웠는데, 이는 attendances 없이 진행된 세션
-- (보드 직접/레거시 세션의 수동 정산 부과)이나 워크인 수동 부과의 '정상 미납'까지 삭제할 수 있었다.
-- 수정: 삭제는 '그 세션에 사전 취소(당일취소 아님) attendance 기록이 있는 회원'의 미납분으로 한정.
--   → 선납/부과 후 참가를 취소한 사람의 유령 미납만 정리. 취소 기록이 없으면(수동부과·워크인) 손대지 않는다.
--   선납(완납, amount_paid>0)은 여전히 보존(환불 절차로).
create or replace function public.dues_generate_session_court(p_session_id bigint)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare v_court int; v_n int := 0; v_eligible boolean;
begin
  select court_fee_default into v_court from public.dues_settings where id = 1;
  select (p.court_fee_per_hour is not null
          and s.status in ('active','closed')
          and s.scheduled_at is not null
          and exists (select 1 from public.matches mt where mt.session_id = s.id))
    into v_eligible
  from public.sessions s left join public.places p on p.id = s.place_id
  where s.id = p_session_id;

  if v_eligible is not true then
    -- 무자격(무산·비대관장소 등) → 미납 대관비 항목만 정리(납부분 보존)
    delete from public.dues_charges
    where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0;
    return 0;
  end if;

  insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint)
  select 'court_fee', a.member_id, p_session_id, v_court,
         case when mm.is_guest then a.invited_by else null end
  from public.attendances a
  join public.members mm on mm.id = a.member_id
  join public.sessions s on s.id = a.session_id
  where a.session_id = p_session_id
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
  get diagnostics v_n = row_count;

  -- '사전 취소(당일취소 아님)' attendance 가 있는 회원의 미납 대관비만 정리 — 선납/부과 후 참가취소한 사람의 유령 미납.
  --  · 취소 기록이 있어야만 삭제 → attendances 없는 수동부과 세션·워크인 수동부과의 정상 미납은 보존.
  --  · 선납(완납, amount_paid>0)은 보존(환불 절차로).
  delete from public.dues_charges dc
  where dc.kind = 'court_fee' and dc.session_id = p_session_id and dc.amount_paid = 0
    and exists (
      select 1
      from public.attendances a
      join public.sessions s on s.id = a.session_id
      where a.session_id = p_session_id
        and a.member_id = dc.member_id
        and a.status = 'cancelled'
        and not ( a.confirmed_at is not null
                  and (a.cancelled_at at time zone 'Asia/Seoul')::date
                    = (s.scheduled_at at time zone 'Asia/Seoul')::date )
    );

  return v_n;
end $function$;
