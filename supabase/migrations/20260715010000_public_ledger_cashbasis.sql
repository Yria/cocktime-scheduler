-- 회원 공개 회계(dues_public_ledger)를 관리자 회계와 동일한 '월 통장 기준(현금주의)'으로 통일.
-- 기존: 회비=부과 amount_paid(발생주의), 세션=세션기준(다른 달 지출 포함) → 항목별 합 ≠ 남은 돈(회원도 안 맞는 숫자를 봄).
-- 신규: 그 달 통장 거래만 버킷에 담아 합이 반드시 net(=income-expense)과 일치.
--   회비 = 그 달 입금의 회비 배분액 / 세션 = 그 달 세션거래(+코트배분) / 환불 = 그 달 환불출금 / 미분류 = 잔여.
create or replace function public.dues_public_ledger(p_ym text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_start timestamptz; v_end timestamptz;
  v_income int; v_expense int; v_fee int; v_refund int;
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

  -- 환불 출금(그 달)
  select coalesce(sum(amount),0) into v_refund
    from public.bank_transactions
   where direction='out' and refund_of_tx_id is not null and occurred_at >= v_start and occurred_at < v_end;

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

  -- 미분류 입금 = 세션·카테고리 미지정 입금 − (회비배분 + 코트배분) [미매칭 + 부분배분 잔액]
  select coalesce(sum(amount),0) into v_untagged_in
    from public.bank_transactions
   where direction='in' and session_id is null and category_id is null
     and occurred_at >= v_start and occurred_at < v_end;
  select coalesce(sum(a.amount),0) into v_court_alloc
    from public.dues_allocations a
    join public.dues_charges c on c.id=a.charge_id and c.kind='court_fee'
    join public.bank_transactions bt on bt.id=a.bank_tx_id
   where bt.direction='in' and bt.occurred_at >= v_start and bt.occurred_at < v_end;
  v_uncat_in := v_untagged_in - v_fee - v_court_alloc;
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
