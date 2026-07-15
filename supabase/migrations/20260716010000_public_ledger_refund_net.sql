-- 항목별 정산(dues_public_ledger)에서 환불을 소스 입금과 상쇄 처리.
-- 기존: 환불된 (미분류) 입금은 미분류에 +로, 환불 출금은 '환불' 라인에 −로 따로 떠서 상쇄가 안 보였다.
-- 신규: '이 달 미분류(untagged) 입금'을 환불한 건은 그 입금과 상쇄 → 정상 전액환불이면 미분류에서 사라짐(±0).
--       부분/미스매치면 잔액이 미분류에 남아 추적 가능. 소스가 다른 달/태그된 입금인 환불만 '환불' 잔여 라인으로.
-- 현금주의 불변식(버킷 합 = net = income−expense)은 유지: 상쇄분(v_refund_net)이 미분류·환불 양쪽에서 동일하게 빠져 상쇄됨.
create or replace function public.dues_public_ledger(p_ym text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_start timestamptz; v_end timestamptz;
  v_income int; v_expense int; v_fee int; v_refund int; v_refund_net int;
  v_untagged_in int; v_court_alloc int; v_uncat_in int; v_uncat_out int;
  v_sessions jsonb; v_categories jsonb;
begin
  if p_ym is null or p_ym !~ '^\d{4}-\d{2}$' then raise exception 'invalid ym: %', p_ym; end if;
  v_start := (p_ym || '-01 00:00:00+09')::timestamptz;
  v_end := v_start + interval '1 month';

  -- 그 달 통장 총수입/총지출(현금)
  select coalesce(sum(amount) filter (where direction='in'),0),
         coalesce(sum(amount) filter (where direction='out'),0)
    into v_income, v_expense
    from public.bank_transactions where occurred_at >= v_start and occurred_at < v_end;

  -- 회비: 그 달 입금이 회비 부과에 배분한 금액(현금 기준)
  select coalesce(sum(a.amount),0) into v_fee
    from public.dues_allocations a
    join public.dues_charges c on c.id = a.charge_id and c.kind='monthly_fee'
    join public.bank_transactions bt on bt.id = a.bank_tx_id
   where bt.direction='in' and bt.occurred_at >= v_start and bt.occurred_at < v_end;

  -- 환불 출금(그 달) 전체
  select coalesce(sum(amount),0) into v_refund
    from public.bank_transactions
   where direction='out' and refund_of_tx_id is not null and occurred_at >= v_start and occurred_at < v_end;
  -- 그 중 '이 달 미분류(untagged) 입금'을 환불한 것 = 그 입금과 상쇄(별도 표시 안 함).
  select coalesce(sum(o.amount),0) into v_refund_net
    from public.bank_transactions o
    join public.bank_transactions i on i.id = o.refund_of_tx_id
   where o.direction='out' and o.refund_of_tx_id is not null
     and o.occurred_at >= v_start and o.occurred_at < v_end
     and i.direction='in' and i.session_id is null and i.category_id is null
     and i.occurred_at >= v_start and i.occurred_at < v_end;
  v_refund := v_refund - v_refund_net;  -- 표시 환불 = 상쇄 안 된(크로스먼스/태그된 소스) 잔여만

  -- 세션별 순액(현금·그 달): 코트배분(그 달 입금) + 세션 링크 입금(그 달) − 세션 링크 출금(그 달)
  with sess_alloc as (
    select c.session_id as sid, sum(a.amount) as amt
      from public.dues_allocations a
      join public.dues_charges c on c.id=a.charge_id and c.kind='court_fee'
      join public.bank_transactions bt on bt.id=a.bank_tx_id
     where bt.direction='in' and bt.occurred_at >= v_start and bt.occurred_at < v_end
     group by c.session_id
  ),
  sess_bank as (
    select session_id as sid,
           coalesce(sum(amount) filter (where direction='in'),0) as inc,
           coalesce(sum(amount) filter (where direction='out'),0) as exp
      from public.bank_transactions
     where session_id is not null and occurred_at >= v_start and occurred_at < v_end
     group by session_id
  ),
  ids as (select sid from sess_alloc union select sid from sess_bank),
  merged as (
    select i.sid,
           coalesce(sa.amt,0) + coalesce(sb.inc,0) as inc,
           coalesce(sb.exp,0) as exp
      from ids i
      left join sess_alloc sa on sa.sid = i.sid
      left join sess_bank sb on sb.sid = i.sid
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', to_char(s.scheduled_at at time zone 'Asia/Seoul','MM-DD'),
           'place', p.name, 'income', m.inc, 'expense', m.exp, 'net', m.inc - m.exp)
           order by s.scheduled_at), '[]'::jsonb)
    into v_sessions
    from merged m
    join public.sessions s on s.id = m.sid
    left join public.places p on p.id = s.place_id
   where m.inc <> 0 or m.exp <> 0;

  -- 카테고리별(그 달·현금)
  select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'in', cin, 'out', cout, 'net', cin - cout) order by c.name), '[]'::jsonb)
    into v_categories
    from public.txn_categories c
    cross join lateral (
      select coalesce(sum(bt.amount) filter (where bt.direction='in'),0) cin,
             coalesce(sum(bt.amount) filter (where bt.direction='out'),0) cout
        from public.bank_transactions bt
       where bt.category_id = c.id and bt.occurred_at >= v_start and bt.occurred_at < v_end
    ) agg
    where agg.cin <> 0 or agg.cout <> 0;

  -- 미분류 입금 = 세션·카테고리 미지정 입금 − (회비배분 + 코트배분) − 상쇄 환불 [미매칭 + 부분배분 잔액 − 상쇄]
  select coalesce(sum(amount),0) into v_untagged_in
    from public.bank_transactions
   where direction='in' and session_id is null and category_id is null
     and occurred_at >= v_start and occurred_at < v_end;
  select coalesce(sum(a.amount),0) into v_court_alloc
    from public.dues_allocations a
    join public.dues_charges c on c.id=a.charge_id and c.kind='court_fee'
    join public.bank_transactions bt on bt.id=a.bank_tx_id
   where bt.direction='in' and bt.occurred_at >= v_start and bt.occurred_at < v_end;
  v_uncat_in := (v_untagged_in - v_refund_net) - v_fee - v_court_alloc;  -- 상쇄 환불만큼 미분류에서 차감(정상 환불=0)
  -- 미분류 지출 = 세션·카테고리·환불 미지정 출금
  select coalesce(sum(amount),0) into v_uncat_out
    from public.bank_transactions
   where direction='out' and session_id is null and category_id is null and refund_of_tx_id is null
     and occurred_at >= v_start and occurred_at < v_end;

  return jsonb_build_object(
    'ym', p_ym, 'income', v_income, 'expense', v_expense, 'net', v_income - v_expense,
    'fee_collected', v_fee, 'refund', v_refund, 'uncat_in', v_uncat_in, 'uncat_out', v_uncat_out,
    'sessions', v_sessions, 'categories', v_categories);
end $function$;
