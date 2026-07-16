-- 세션 종료(자격) 시 '참석 자격 없는 회원의 미납 대관비'도 정리.
-- 기존: 자격 세션에선 참석자 부과 INSERT만 하고, 참석 안 한 사람의 남은 미납 court_fee는 안 지웠다
--       (미납 정리는 '무산 세션' 분기에서만). → 선납 후 참가 취소·환불한 사람의 부과를 미납으로 되돌리면(취소·재처리),
--       세션이 열려도 그 미납 유령 부과가 계속 남아 미납 알림 대상이 됐다.
-- 신규: 자격 세션에서도, 참석 자격(confirmed/late_pool/당일취소·비운영진) 없는 회원의 court_fee 중 amount_paid=0 은 삭제.
--       선납(완납, amount_paid>0)은 삭제하지 않는다(환불 절차로 처리 — 돈이 들어왔으므로 보존).
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

  -- 참석 자격 없는(불참·사전취소·운영진) 회원의 '미납' 대관비 정리 — 선납(완납)은 보존(환불 절차로).
  --  · INSERT 의 자격 조건과 동일한 attendances 판정으로 '부과 대상이 아닌' 회원을 가려낸다.
  delete from public.dues_charges dc
  where dc.kind = 'court_fee' and dc.session_id = p_session_id and dc.amount_paid = 0
    and not exists (
      select 1
      from public.attendances a
      join public.sessions s on s.id = a.session_id
      where a.session_id = p_session_id
        and a.member_id = dc.member_id
        and not public.is_operator(a.member_id)
        and (
              a.status in ('confirmed', 'late_pool')
           or ( a.status = 'cancelled'
                and a.confirmed_at is not null
                and (a.cancelled_at at time zone 'Asia/Seoul')::date
                  = (s.scheduled_at at time zone 'Asia/Seoul')::date )
            )
    );

  return v_n;
end $function$;
