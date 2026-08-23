-- ============================================================
-- 총액을 바꾸면 그 회차 대관비를 **전부 정리하고 재발행**한다 (2026-08-23 운영 결정)
--
-- 실제 사고: 세션 147(8/23 에이트민턴)에 총액 45,000원을 넣었는데 아무 일도 일어나지 않았다.
--   감사 로그: `{"head":9,"per_head":5000,"fixed":0,"locked":7}`
--   원인 — 종전 정의는 "미납 발행분만 금액 정정"이었고, 그 회차는 **7명이 전부 완납**이라
--   `amount_paid = 0` 게이트에 다 걸렸다. 게다가 정액으로 발행돼 운영진 2명이 빠져 있어
--   대상도 7 → 9로 늘어야 했는데 그 경로(추가 발행)는 대기로만 갔다.
--
-- 결정: **총액 변경 = 그 회차 정산을 처음부터 다시 한다.**
--   ① 그 회차 대관비 부과의 **배분을 먼저 삭제** → 트리거(dues_alloc_sync)가 그 입금을 `unmatched`
--      로 되돌려 **정산함에 다시 띄운다**(= 미정산 상태)
--   ② 부과를 **삭제**한다(void 가 아니다 — 재발행이 목적이고, void 는 "있는 것"으로 세어 재발행을 막는다)
--   ③ 새 금액으로 생성기를 다시 돌린다(정상이면 즉시 발행, 이상하면 발행 대기)
--
-- 순서가 중요하다: 부과를 먼저 지우면 `dues_allocations` 가 CASCADE 로 사라지면서 트리거가
--   부과를 못 찾아(`select ... from dues_charges where id = v_cid` 빈 결과) **통장 status 동기가 빠진다**
--   → 낸 입금이 'matched' 로 남아 정산함에 안 뜨는 유령이 된다. 배분을 명시적으로 먼저 지운다.
--
-- 이 조작은 "발행분은 규칙이 건드리지 않는다"(20260823020000)와 충돌하지 않는다. 그 원칙이 금지하는
--   것은 **규칙**이 발행분을 흔드는 것이고, 이건 사람이 부르는 **명시적 조작**이다. 대신 대가가 크므로
--   지우기 전 원본(누가 얼마 냈는지·어느 입금이었는지)을 감사 로그에 스냅샷으로 남긴다.
--
-- 주의: 이미 낸 사람의 입금이 정산함으로 돌아가므로 운영진이 다시 확인해야 한다. 세션 147 기준
--   7건이다. 금액이 줄면(6,000 → 5,000) 입금에 잔액이 생겨 그 처리(다음 선납·환불·묶음)가 따라온다.
-- ============================================================
create or replace function public.dues_set_session_fee(p_session_id bigint, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_admin uuid := public.current_member_id();
	v_before jsonb;
	v_freed int := 0;
	v_removed int := 0;
	v_issued int := 0;
	v_held int := 0;
	v_group text := 'court:' || p_session_id::text;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_amount is not null and p_amount < 0 then raise exception 'invalid amount'; end if;

	-- 지우기 전 원본 스냅샷 — 되돌릴 근거. 누가 얼마 냈고 어느 입금이었는지까지 남긴다.
	select jsonb_agg(jsonb_build_object(
	         'charge', c.id, 'member', c.member_id, 'due', c.amount_due,
	         'paid', c.amount_paid, 'status', c.status,
	         'txs', (select jsonb_agg(a.bank_tx_id) from public.dues_allocations a where a.charge_id = c.id)))
	  into v_before
	  from public.dues_charges c
	 where c.kind = 'court_fee' and c.session_id = p_session_id;

	update public.sessions set court_fee = p_amount where id = p_session_id;
	if not found then raise exception 'session % not found', p_session_id; end if;

	-- ① 배분 삭제(먼저!) → 트리거가 그 입금을 unmatched 로 되돌려 정산함에 다시 띄운다.
	delete from public.dues_allocations a
	 using public.dues_charges c
	 where a.charge_id = c.id and c.kind = 'court_fee' and c.session_id = p_session_id;
	get diagnostics v_freed = row_count;

	-- ② 부과 삭제. 재발행이 목적이라 void 가 아니라 삭제다.
	delete from public.dues_charges
	 where kind = 'court_fee' and session_id = p_session_id;
	get diagnostics v_removed = row_count;

	-- 남아 있던 발행 대기 초안도 정리(금액이 바뀌었으니 옛 초안은 무효).
	delete from public.dues_charge_drafts where draft_group = v_group;

	-- ③ 새 금액으로 재발행. 이상하면(인당 금액이 정액의 절반 미만/2.5배 초과) 발행 대기로 간다.
	v_issued := public.dues_generate_session_court(p_session_id);
	select count(*) into v_held from public.dues_charge_drafts where draft_group = v_group;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'reset_session_court', jsonb_build_object(
		'session_id', p_session_id, 'amount', p_amount,
		'freed_allocations', v_freed, 'removed_charges', v_removed,
		'issued', v_issued, 'held', v_held, 'before', v_before));

	return jsonb_build_object(
		'court_fee', p_amount, 'freed', v_freed, 'removed', v_removed,
		'issued', v_issued, 'held', v_held);
end $function$;

revoke execute on function public.dues_set_session_fee(bigint, integer) from public, anon;
grant  execute on function public.dues_set_session_fee(bigint, integer) to authenticated;

comment on function public.dues_set_session_fee(bigint, integer) is
	'세션 대관 총액 변경 = 그 회차 정산 재시작. 배분 삭제(→입금이 정산함으로) → 부과 삭제 → 새 금액으로 '
	'재발행(이상하면 발행 대기). 지우기 전 원본을 dues_audit_log 에 스냅샷. 2026-08-23 운영 결정 — '
	'종전 "미납분만 금액 정정"은 완납된 회차에서 아무 일도 못 했다(세션 147, fixed=0/locked=7).';
