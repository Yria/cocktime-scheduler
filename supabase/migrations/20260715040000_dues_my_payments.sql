-- 내 납부 이력: 회원이 '실제로 낸 돈'을 입금 단위로. 미납은 제외(그건 부과 상태).
-- 두 소스: ① 부과(회비/대관)에 배분된 내 입금 ② paid_by=나 인 카테고리 입금(콕공구 등).
-- current_member_id() 로 본인분만 — 파라미터 없음(타인 조회 불가). SECURITY DEFINER + authenticated.
create or replace function public.dues_my_payments()
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  with me as (select public.current_member_id() as mid),
  -- ① 부과 배분: 입금(bank_tx)별로 내 배분 합 + 용도 라벨
  charge_pay as (
    select bt.id as tx_id, bt.occurred_at,
           sum(a.amount) as amt,
           string_agg(
             case when c.kind = 'monthly_fee'
                  then ltrim(substring(c.period_ym from 6 for 2), '0') || '월 회비'
                  else to_char(s.scheduled_at at time zone 'Asia/Seoul', 'MM-DD') || ' 대관비' end,
             ' · ' order by c.kind desc) as purpose
      from public.dues_allocations a
      join me on a.member_id = me.mid
      join public.bank_transactions bt on bt.id = a.bank_tx_id
      join public.dues_charges c on c.id = a.charge_id
      left join public.sessions s on s.id = c.session_id
     where a.charge_id is not null
     group by bt.id, bt.occurred_at
  ),
  -- ② 비부과 납부(paid_by=나 인 카테고리 입금)
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
