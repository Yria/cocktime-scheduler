-- 코트대관을 '미리 정의된 정산 항목'으로 통일 — DB 카테고리에서 완전 제거하고 session_id 로만 식별.
-- (환불=refund_of_tx_id, 코트대관=session_id, 나머지=category_id 로 개념 분리. 특수분기 제거.)
-- 코트대관 카테고리를 쓰던 거래는 category_id 를 비운다(세션 연결분은 세션으로, 미연결분은 미정산으로).

update public.bank_transactions
	set category_id = null
	where category_id = (select id from public.txn_categories where name = '코트대관');

delete from public.txn_categories where name = '코트대관';

-- 회원 공개 회계: 코트대관 카테고리 특수처리 제거. 코트대관은 세션별 순액(v_sessions)으로만 표시.
create or replace function public.dues_public_ledger(p_ym text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_start timestamptz; v_end timestamptz;
	v_income int; v_expense int; v_fee int;
	v_sessions jsonb; v_categories jsonb;
begin
	if p_ym is null or p_ym !~ '^\d{4}-\d{2}$' then raise exception 'invalid ym: %', p_ym; end if;
	v_start := (p_ym || '-01 00:00:00+09')::timestamptz;
	v_end := v_start + interval '1 month';

	select coalesce(sum(amount) filter (where direction = 'in'), 0),
	       coalesce(sum(amount) filter (where direction = 'out'), 0)
	  into v_income, v_expense
	  from public.bank_transactions where occurred_at >= v_start and occurred_at < v_end;

	select coalesce(sum(amount_paid), 0) into v_fee
	  from public.dues_charges where kind = 'monthly_fee' and period_ym = p_ym;

	-- 세션별 대관비 순액(세션 기준, 지출은 발생월 무관): 코트대관은 이걸로만 표시.
	select coalesce(jsonb_agg(jsonb_build_object(
	         'date', to_char(s.scheduled_at at time zone 'Asia/Seoul', 'MM-DD'),
	         'place', p.name, 'income', inc, 'expense', exp, 'net', inc - exp) order by s.scheduled_at), '[]'::jsonb)
	  into v_sessions
	  from public.sessions s
	  join public.places p on p.id = s.place_id
	  cross join lateral (
	    select coalesce((select sum(dc.amount_paid) from public.dues_charges dc where dc.session_id = s.id and dc.kind = 'court_fee'), 0)
	         + coalesce((select sum(bt.amount) from public.bank_transactions bt where bt.session_id = s.id and bt.direction = 'in'), 0) as inc,
	           coalesce((select sum(bt.amount) from public.bank_transactions bt where bt.session_id = s.id and bt.direction = 'out'), 0) as exp
	  ) agg
	  where p.court_fee_per_hour is not null and s.scheduled_at >= v_start and s.scheduled_at < v_end
	    and (s.status in ('active','closed') or s.dues_include) and (agg.inc <> 0 or agg.exp <> 0);

	-- 카테고리별(콕공구·이자 등) 순액. 코트대관 카테고리는 더 이상 없음(세션 미연결 거래는 여기 안 잡힘=미분류).
	select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'in', cin, 'out', cout, 'net', cin - cout) order by c.name), '[]'::jsonb)
	  into v_categories
	  from public.txn_categories c
	  cross join lateral (
	    select coalesce(sum(bt.amount) filter (where bt.direction='in'),0) cin,
	           coalesce(sum(bt.amount) filter (where bt.direction='out'),0) cout
	    from public.bank_transactions bt
	    where bt.category_id = c.id and bt.occurred_at >= v_start and bt.occurred_at < v_end
	  ) agg
	  where (agg.cin <> 0 or agg.cout <> 0);

	return jsonb_build_object(
	  'ym', p_ym, 'income', v_income, 'expense', v_expense, 'net', v_income - v_expense,
	  'fee_collected', v_fee, 'court_unassigned', 0, 'sessions', v_sessions, 'categories', v_categories);
end $$;
