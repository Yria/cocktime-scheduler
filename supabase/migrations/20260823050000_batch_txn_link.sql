-- ============================================================
-- 묶음에 거래를 연결한다 — 분류(txn_categories) 폐지 (2026-08-23)
--
-- 왜: 공동구매는 **부과 모델이 아니다.** 실측(콕공구 입금 44건, 2026-06~08)이 그걸 보여준다:
--   · 수량 제각각 — 1타/2타로 금액이 2배 차이(27,000/54,000 · 26,000/52,000 · 24,000)
--   · 단가가 차수마다 다름 — 27,000 → 26,000 → 24,000
--   · 명단을 미리 알 수 없음 — 각자 카톡으로 신청하고 6/14~8/22 흩어져 입금
--   · **미납 개념이 없다** — 신청 안 한 사람은 그냥 안 산 사람. 부과를 만들면 안 산 회원에게 독촉이 간다
--   즉 부과(낼 돈을 정하고 걷는다)가 아니라 **모금**(들어온 걸 집계한다)이다.
--
-- 그래서 묶음의 수입 경로를 둘로 만든다:
--   묶음 수입 = 부과 배분액  +  직접 연결된 입금의 **잔액**(= 거래액 − 그 거래의 배분액)
--   묶음 지출 = 직접 연결된 출금
--   "잔액"만 먹으므로 같은 돈이 두 항목에 뜰 수 없다(이중계상 구조적 차단).
--
-- 새 개념이 아니다: `bank_transactions.session_id` 가 이미 비회원 대관비 입금·대관료 출금을 세션에
--   직접 붙인다. 묶음은 세션 역할의 일반화이므로 같은 것을 갖는 게 당연하다.
--
-- **이관 무손실 근거(실측 2026-08-23)**: 카테고리 태그된 거래 54건 중 부과에 배분된 것이 **0건**이다.
--   그래서 "거래액 − 배분액 = 전액" 이 되어 새 산식이 종전 카테고리 산식과 **정확히 같은 값**을 낸다.
--   · 콕공구 in 44건 1,531,000 / out 3건 1,925,000 (6~8월)
--   · 정모 out 3건 521,300 · 기타 in/out 1/1건 · 이자 in 2건 94원
--   차수 분할은 자동 불가(8월에 6·7월 단가로 낸 사람이 섞여 있다) → **카테고리 1개 = 묶음 1개**로
--   뭉쳐 이관한다. 공개회계는 거래 날짜로 월을 가르므로 종전 카테고리와 동일하게 6·7·8월에 나타난다.
--   앞으로 새 공구는 차수별 묶음(`manual:cock:2026-09`)으로 만든다.
--
-- expand 단계: `category_id` 는 **그대로 둔다**(되돌릴 수 있게). 산식에서만 빠진다.
-- ============================================================

-- ① 거래 → 묶음
alter table public.bank_transactions add column if not exists batch_id bigint references public.dues_batches(id) on delete set null;
create index if not exists idx_bank_tx_batch on public.bank_transactions(batch_id);

comment on column public.bank_transactions.batch_id is
	'이 거래가 속한 묶음(dues_batches). 부과 없이 묶음에 직접 귀속되는 돈(공동구매 모금·잡수입·묶음 지출). '
	'session_id 가 세션에 대해 하던 역할의 일반화. 2026-08-23 — txn_categories 를 대체한다.';

-- ② 레거시 카테고리 → 묶음 이관 (카테고리 1개 = 묶음 1개)
insert into public.dues_batches (kind, key, label, occurred_on)
select 'manual', 'manual:cat:' || c.id::text, c.name,
       min((bt.occurred_at at time zone 'Asia/Seoul')::date)
  from public.txn_categories c
  join public.bank_transactions bt on bt.category_id = c.id
 group by c.id, c.name
on conflict (key) do nothing;

update public.bank_transactions bt
   set batch_id = b.id
  from public.dues_batches b
 where bt.batch_id is null and bt.category_id is not null
   and b.key = 'manual:cat:' || bt.category_id::text;

-- ③ 즉석 묶음 생성(정산함에서 "새 묶음") — 모금·잡수입용. 부과 없이 시작하는 묶음이다.
create or replace function public.dues_create_batch(p_label text, p_occurred_on date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_admin uuid := public.current_member_id();
	v_id bigint;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if coalesce(btrim(p_label), '') = '' then raise exception 'label required'; end if;

	insert into public.dues_batches (kind, key, label, occurred_on)
	values ('manual', 'manual:tmp:' || gen_random_uuid()::text, btrim(p_label),
	        coalesce(p_occurred_on, (now() at time zone 'Asia/Seoul')::date))
	returning id into v_id;
	-- 키를 사람이 읽을 수 있게 정리(id 를 알아야 만들 수 있어 두 단계).
	update public.dues_batches set key = 'manual:b' || v_id::text where id = v_id;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'create_batch', jsonb_build_object('batch_id', v_id, 'label', btrim(p_label), 'on', p_occurred_on));

	return jsonb_build_object('batch_id', v_id, 'key', 'manual:b' || v_id::text, 'label', btrim(p_label));
end $function$;

revoke execute on function public.dues_create_batch(text, date) from public, anon;
grant  execute on function public.dues_create_batch(text, date) to authenticated;

-- ④ 거래를 묶음에 붙이기/떼기. p_batch_id = null 이면 연결 해제(미분류로 되돌림).
create or replace function public.dues_set_txn_batch(p_tx_id bigint, p_batch_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_admin uuid := public.current_member_id();
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_batch_id is not null and not exists (select 1 from public.dues_batches where id = p_batch_id) then
		raise exception 'batch % not found', p_batch_id;
	end if;

	update public.bank_transactions
	   set batch_id = p_batch_id,
	       -- 묶음에 붙으면 정산함에서 '처리됨'으로 빠진다(카테고리가 하던 역할).
	       status = case when p_batch_id is not null and status = 'unmatched' then 'matched' else status end
	 where id = p_tx_id;
	if not found then raise exception 'tx % not found', p_tx_id; end if;

	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'set_txn_batch', p_tx_id, jsonb_build_object('batch_id', p_batch_id));

	return jsonb_build_object('tx_id', p_tx_id, 'batch_id', p_batch_id);
end $function$;

revoke execute on function public.dues_set_txn_batch(bigint, bigint) from public, anon;
grant  execute on function public.dues_set_txn_batch(bigint, bigint) to authenticated;

-- ============================================================
-- ⑤ 공개 회계 — 항목 축을 묶음으로. `categories` 응답 모양({name,in,out,net})은 그대로 유지해
--    회원·운영진 화면을 고치지 않는다(내용만 카테고리 → 묶음).
--
--    · 회비   = monthly 부과 배분(그 달 입금) — 기존과 동일
--    · 세션   = court 부과 배분 + session_id 연결 거래 — 기존과 동일
--    · 묶음   = manual 부과 배분 + batch_id 연결 거래의 **잔액**  ← 신설(카테고리 대체)
--    · 미분류 = 어느 축에도 안 붙은 거래의 잔액
--
--    KST 월 창 함정(20260803000000): 월 덧셈은 반드시 date 로. 그 규칙을 그대로 유지한다.
-- ============================================================
create or replace function public.dues_public_ledger(p_ym text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_start timestamptz; v_end timestamptz;
  v_income int; v_expense int; v_fee int; v_refund int; v_refund_net int;
  v_untagged_in int; v_untagged_alloc int; v_uncat_in int; v_uncat_out int;
  v_sessions jsonb; v_batches jsonb;
begin
  if p_ym is null or p_ym !~ '^\d{4}-\d{2}$' then raise exception 'invalid ym: %', p_ym; end if;
  v_start := (p_ym || '-01 00:00:00+09')::timestamptz;
  -- 월 덧셈은 date 로(timestamptz + interval '1 month' 는 세션 TZ 기준 '같은 일'로 이동해 말일이 잘린다).
  v_end := (((p_ym || '-01')::date + interval '1 month')::date::text || ' 00:00:00+09')::timestamptz;

  select coalesce(sum(amount) filter (where direction='in'),0),
         coalesce(sum(amount) filter (where direction='out'),0)
    into v_income, v_expense
    from public.bank_transactions where occurred_at >= v_start and occurred_at < v_end;

  -- 회비: 그 달 입금이 회비 부과에 배분한 금액
  select coalesce(sum(a.amount),0) into v_fee
    from public.dues_allocations a
    join public.dues_charges c on c.id = a.charge_id and c.kind='monthly_fee'
    join public.bank_transactions bt on bt.id = a.bank_tx_id
   where bt.direction='in' and bt.occurred_at >= v_start and bt.occurred_at < v_end;

  -- 환불 출금(그 달) 전체 − '이 달 미분류 입금'을 환불한 것(그 입금과 상쇄)
  select coalesce(sum(amount),0) into v_refund
    from public.bank_transactions
   where direction='out' and refund_of_tx_id is not null and occurred_at >= v_start and occurred_at < v_end;
  select coalesce(sum(o.amount),0) into v_refund_net
    from public.bank_transactions o
    join public.bank_transactions i on i.id = o.refund_of_tx_id
   where o.direction='out' and o.refund_of_tx_id is not null
     and o.occurred_at >= v_start and o.occurred_at < v_end
     and i.direction='in' and i.session_id is null and i.batch_id is null
     and i.occurred_at >= v_start and i.occurred_at < v_end;
  v_refund := v_refund - v_refund_net;

  -- 세션별 순액(현금·그 달): 코트 부과 배분 + 세션 링크 입금 − 세션 링크 출금
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
    select i.sid, coalesce(sa.amt,0) + coalesce(sb.inc,0) as inc, coalesce(sb.exp,0) as exp
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

  -- 묶음별(manual)·그 달: 부과 배분 + 연결 거래의 잔액(거래액 − 그 거래 배분액 전체)
  with b_alloc as (
    select c.batch_id as bid, sum(a.amount) as amt
      from public.dues_allocations a
      join public.dues_charges c on c.id = a.charge_id
      join public.bank_transactions bt on bt.id = a.bank_tx_id
     where bt.direction='in' and bt.occurred_at >= v_start and bt.occurred_at < v_end
     group by c.batch_id
  ),
  b_bank as (
    select bt.batch_id as bid,
           coalesce(sum(
             case when bt.direction='in'
               then bt.amount - coalesce((select sum(a2.amount) from public.dues_allocations a2 where a2.bank_tx_id = bt.id), 0)
               else 0 end), 0) as inc,
           coalesce(sum(case when bt.direction='out' then bt.amount else 0 end), 0) as exp
      from public.bank_transactions bt
     where bt.batch_id is not null and bt.occurred_at >= v_start and bt.occurred_at < v_end
     group by bt.batch_id
  ),
  bids as (select bid from b_alloc where bid is not null union select bid from b_bank),
  bmerged as (
    select x.bid, coalesce(ba.amt,0) + coalesce(bb.inc,0) as inc, coalesce(bb.exp,0) as exp
      from bids x
      left join b_alloc ba on ba.bid = x.bid
      left join b_bank bb on bb.bid = x.bid
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', b.label, 'in', m.inc, 'out', m.exp, 'net', m.inc - m.exp) order by b.label), '[]'::jsonb)
    into v_batches
    from bmerged m
    join public.dues_batches b on b.id = m.bid
   where b.kind = 'manual' and (m.inc <> 0 or m.exp <> 0);

  -- 미분류 입금 = 어느 축에도 안 붙은 입금 − 상쇄 환불 − 그 거래들의 배분액
  select coalesce(sum(amount),0) into v_untagged_in
    from public.bank_transactions
   where direction='in' and session_id is null and batch_id is null
     and occurred_at >= v_start and occurred_at < v_end;
  select coalesce(sum(a.amount),0) into v_untagged_alloc
    from public.dues_allocations a
    join public.bank_transactions bt on bt.id = a.bank_tx_id
   where bt.direction='in' and bt.session_id is null and bt.batch_id is null
     and bt.occurred_at >= v_start and bt.occurred_at < v_end;
  v_uncat_in := (v_untagged_in - v_refund_net) - v_untagged_alloc;

  select coalesce(sum(amount),0) into v_uncat_out
    from public.bank_transactions
   where direction='out' and session_id is null and batch_id is null and refund_of_tx_id is null
     and occurred_at >= v_start and occurred_at < v_end;

  return jsonb_build_object(
    'ym', p_ym, 'income', v_income, 'expense', v_expense, 'net', v_income - v_expense,
    'fee_collected', v_fee, 'refund', v_refund, 'uncat_in', v_uncat_in, 'uncat_out', v_uncat_out,
    'sessions', v_sessions, 'categories', v_batches);
end $function$;

comment on function public.dues_public_ledger(text) is
	'월 공개 회계(현금주의). 항목 축 = 묶음(dues_batches) — 회비·세션·묶음·미분류. '
	'묶음 수입 = 부과 배분 + 연결 거래의 잔액(거래액 − 그 거래 배분액)이라 이중계상이 구조적으로 없다. '
	'응답의 categories 키는 하위호환으로 유지(내용은 묶음). 2026-08-23 — txn_categories 를 산식에서 제외.';
