-- 회계 재정비 3-fix: 공개 회계 이중계상 제거.
-- 코트대관 지출은 sessions(세션별)로 보여주므로, categories 목록에선 코트대관 카테고리를 제외하고
-- 세션 미배정 코트대관 지출만 court_unassigned로 따로 반환.

create or replace function public.dues_public_ledger(p_ym text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_start timestamptz; v_end timestamptz;
	v_income int; v_expense int; v_fee int; v_court_unassigned int;
	v_court_cat bigint;
	v_sessions jsonb; v_categories jsonb;
begin
	if p_ym is null or p_ym !~ '^\d{4}-\d{2}$' then raise exception 'invalid ym: %', p_ym; end if;
	v_start := (p_ym || '-01 00:00:00+09')::timestamptz;
	v_end := v_start + interval '1 month';
	select id into v_court_cat from public.txn_categories where name = '코트대관' limit 1;

	select coalesce(sum(amount) filter (where direction = 'in'), 0),
	       coalesce(sum(amount) filter (where direction = 'out'), 0)
	  into v_income, v_expense
	  from public.bank_transactions where occurred_at >= v_start and occurred_at < v_end;

	select coalesce(sum(amount_paid), 0) into v_fee
	  from public.dues_charges where kind = 'monthly_fee' and period_ym = p_ym;

	-- 세션별 대관비 순액(세션 기준, 월무관 지출 포함)
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

	-- 세션 미배정 코트대관 지출(그 달)
	select coalesce(sum(amount), 0) into v_court_unassigned
	  from public.bank_transactions
	  where category_id = v_court_cat and direction = 'out' and session_id is null
	    and occurred_at >= v_start and occurred_at < v_end;

	-- 카테고리별(코트대관 제외 — 세션으로 표시)
	select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'in', cin, 'out', cout, 'net', cin - cout) order by c.name), '[]'::jsonb)
	  into v_categories
	  from public.txn_categories c
	  cross join lateral (
	    select coalesce(sum(bt.amount) filter (where bt.direction='in'),0) cin,
	           coalesce(sum(bt.amount) filter (where bt.direction='out'),0) cout
	    from public.bank_transactions bt
	    where bt.category_id = c.id and bt.occurred_at >= v_start and bt.occurred_at < v_end
	  ) agg
	  where c.id is distinct from v_court_cat and (agg.cin <> 0 or agg.cout <> 0);

	return jsonb_build_object(
	  'ym', p_ym, 'income', v_income, 'expense', v_expense, 'net', v_income - v_expense,
	  'fee_collected', v_fee, 'court_unassigned', v_court_unassigned,
	  'sessions', v_sessions, 'categories', v_categories);
end $$;
