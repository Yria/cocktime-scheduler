-- 내 회비 재설계 적대 검증 수정:
-- (1) 익명(anon) 접근 차단 — 로그인 열람 불변식. Supabase 기본권한이 anon에 직접 execute를 부여하므로
--     revoke ... from public 만으로는 anon이 남음 → anon 명시 revoke(프로젝트 관례).
-- (2) 납부이력 대관비 라벨 중복 제거(같은 세션 본인+게스트 대납 배분 시 '07-12 대관비 · 07-12 대관비')
--     + 날짜 포맷을 앱 전역(fmtMD)과 통일: 0패딩/하이픈 제거 → '7.12 대관비'.

revoke execute on function public.dues_public_ledger(text) from anon;
revoke execute on function public.dues_my_payments() from anon;

create or replace function public.dues_my_payments()
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  with me as (select public.current_member_id() as mid),
  charge_pay as (
    select bt.id as tx_id, bt.occurred_at,
           sum(a.amount) as amt,
           -- distinct: 같은 세션의 본인+게스트 대납 배분이 하나로. 포맷 '7.12 대관비' / '7월 회비'
           string_agg(distinct
             case when c.kind = 'monthly_fee'
                  then ltrim(substring(c.period_ym from 6 for 2), '0') || '월 회비'
                  else to_char(s.scheduled_at at time zone 'Asia/Seoul', 'FMMM"."FMDD') || ' 대관비' end,
             ' · ') as purpose
      from public.dues_allocations a
      join me on a.member_id = me.mid
      join public.bank_transactions bt on bt.id = a.bank_tx_id
      join public.dues_charges c on c.id = a.charge_id
      left join public.sessions s on s.id = c.session_id
     where a.charge_id is not null
     group by bt.id, bt.occurred_at
  ),
  cat_pay as (
    select bt.id as tx_id, bt.occurred_at, bt.amount as amt, tc.name as purpose
      from public.bank_transactions bt
      join me on bt.paid_by = me.mid
      join public.txn_categories tc on tc.id = bt.category_id
     where bt.category_id is not null
  ),
  u as (
    select tx_id, occurred_at, amt, purpose from charge_pay
    union all
    select tx_id, occurred_at, amt, purpose from cat_pay
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tx_id', tx_id,
           'date', to_char(occurred_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
           'ym', to_char(occurred_at at time zone 'Asia/Seoul', 'YYYY-MM'),
           'amount', amt,
           'purpose', purpose) order by occurred_at desc, tx_id desc), '[]'::jsonb)
  from u
$function$;

revoke execute on function public.dues_my_payments() from public;
grant execute on function public.dues_my_payments() to authenticated;
