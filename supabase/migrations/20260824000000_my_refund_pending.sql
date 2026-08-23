-- ============================================================
-- 회원 본인의 "돌려받을 돈" — 낼 돈보다 많이 들어와 남은 금액
--
-- 왜: 5,000원 낼 것에 6,000원을 보내면 정산 후 1,000원이 통장에 남는다. 지금까지 그 사실은
--   운영진의 정산함에만 보였고, 정작 돈을 돌려받아야 하는 회원은 알 수 없었다(계좌번호를 받아야
--   보낼 수 있는데 물어볼 계기도 없었다). 그래서 본인 화면에 띄울 근거를 서버에서 만든다.
--
-- 남은 돈의 정의: 그 입금에서 `배분 + 환불`을 뺀 나머지.
--   · 배분(dues_allocations) = 부과에 쓴 돈
--   · 환불(refund_of_tx_id 로 이 입금을 가리키는 출금) = 이미 돌려준 돈
--   → 둘을 빼고도 남으면 아직 처리되지 않은 잔돈이다.
--
-- 제외: 묶음(batch_id)·분류(category_id)·세션(session_id) 이 붙은 입금.
--   그 잔액은 **의도된 클럽 수입**이다(예: 54,000 중 30,000은 회식 부과, 24,000은 콕 공동구매 모금 →
--   묶음에 귀속). 이걸 환불로 안내하면 정반대의 사실을 말하게 된다.
--
-- 누구 돈인가: 입금자(`paid_by`) 가 있으면 그 사람, 없으면 그 입금의 배분을 받은 회원
--   (`dues_allocations.member_id` — 게스트 대납이면 대납자가 들어간다. dues_my_payments 와 같은 기준).
--
-- 보안: SECURITY DEFINER + current_member_id() 로 **본인 것만**. bank_transactions 는 운영진 전용
--   테이블이라 회원이 직접 못 읽는다(그래서 RPC 로 낸다).
-- ============================================================
create or replace function public.dues_my_refund_pending()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
	with me as (select public.current_member_id() as mid),
	-- 내가 낸 것으로 볼 입금
	mine as (
		select distinct bt.id
		  from public.bank_transactions bt, me
		 where bt.direction = 'in'
		   and (
		     bt.paid_by = me.mid
		     or (bt.paid_by is null and exists (
		           select 1 from public.dues_allocations a
		            where a.bank_tx_id = bt.id and a.member_id = me.mid))
		   )
	),
	calc as (
		select bt.id, bt.occurred_at, bt.amount,
		       coalesce((select sum(a.amount) from public.dues_allocations a
		                  where a.bank_tx_id = bt.id), 0) as used,
		       coalesce((select sum(r.amount) from public.bank_transactions r
		                  where r.refund_of_tx_id = bt.id), 0) as refunded
		  from public.bank_transactions bt
		  join mine on mine.id = bt.id
		 where bt.batch_id is null
		   and bt.category_id is null
		   and bt.session_id is null
	)
	select coalesce(jsonb_agg(jsonb_build_object(
	         'tx_id', id,
	         'date', to_char(occurred_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
	         'paid', amount,
	         'used', used,
	         'left', amount - used - refunded
	       ) order by occurred_at desc, id desc), '[]'::jsonb)
	  from calc
	 -- 배분이 하나도 없는 입금은 '아직 정산 전'이다 — 잔돈이 아니라 처리 대기라 안내하지 않는다.
	 where used > 0 and amount - used - refunded > 0
$function$;

revoke execute on function public.dues_my_refund_pending() from public, anon;
grant  execute on function public.dues_my_refund_pending() to authenticated;

comment on function public.dues_my_refund_pending() is
	'본인이 낸 입금 중 배분·환불을 빼고 남은 돈(돌려받을 돈). 묶음·분류·세션이 붙은 입금은 의도된 '
	'클럽 수입이라 제외. 회원 화면(내 회비·진입 알림)이 "환불받을 계좌번호를 알려주세요"를 띄우는 근거. 2026-08-24.';
