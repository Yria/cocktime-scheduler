-- 공개 회계(dues_public_ledger) 월 창 끝 계산 버그 수정 — 그 달 말일이 통째로 빠지던 문제.
--
-- 원인: v_start := 'YYYY-MM-01 00:00+09' 는 UTC 로 보면 '전월 말일 15:00' 이다.
--       여기에 v_end := v_start + interval '1 month' 를 하면 세션 타임존(프로덕션=UTC)에서 월 덧셈이
--       '같은 일(日)'로 이동한다 → 2026-06-30 15:00 + 1개월 = 2026-07-30 15:00 = KST 7/31 00:00.
--       즉 7월 창이 [7/1 00:00, 7/31 00:00) 이 되어 7월 31일 하루가 집계에서 빠졌다.
-- 규칙: 전월 말일이 30일인 달(5·7·10·12월)은 말일 1일 누락, 3월은 마지막 3일(윤년 2일) 누락.
--       나머지 달은 우연히 맞았다(5/31+1M=6/30 ✓, 7/31+1M=8/31 ✓).
-- 실측 사고: 2026-07 공개 회계가 7/31 14:03 입금 5,000원(id 10172)을 누락 →
--       총수입 1,837,055(RPC) vs 통장 원장 1,842,055. 운영진 [회계]는 클라이언트에서 원장을 직접
--       합산(ymRangeKst)하므로 정상이었고, 회원용 [클럽 회계]만 5,000원 적게 보였다.
-- 수정: 월 덧셈을 date 로 수행한 뒤 KST 오프셋을 붙인다(달 길이·연말 넘김 모두 안전, 세션 TZ 무관).
--       occurred_at 을 월 창으로 자르는 DB 함수는 이 함수뿐(dues_my_payments 는 at time zone 그룹핑).

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
  -- 월 덧셈은 반드시 date 로. timestamptz + interval '1 month' 는 세션 타임존(UTC) 기준 '같은 일(日)'로
  -- 이동하는데, v_start 는 UTC 로 보면 전월 말일 15:00 이라 결과가 그 달 말일 하루를 잘라먹는다.
  v_end := (((p_ym || '-01')::date + interval '1 month')::date::text || ' 00:00:00+09')::timestamptz;

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
