-- 회계 Migration 14: 외부인(비회원·비게스트) 대관비 입금을 회원 없이 세션에 귀속.
-- 게스트로도 등록 안 된 완전 외부인이 대관비(6,000)를 입금한 경우, dues_charges 대상 회원이 없어 매칭 불가.
-- → bank_transactions.session_id 로 세션만 태깅하고 matched 처리(배분 없음). 수지에선 '대관비 수납'(matched IN)으로 집계.
--   "완전 외부인 금액도 세션목록 띄워서 정리"(2026-07-13 확정).

alter table public.bank_transactions
	add column if not exists session_id bigint references public.sessions(id) on delete set null;
create index if not exists idx_bank_tx_session on public.bank_transactions(session_id);

-- 외부인 대관비: 회원/부과/배분 없이 세션 귀속 + matched.
create or replace function public.dues_confirm_court_external(p_tx_id bigint, p_session_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin uuid := public.current_member_id();
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_session_id is null then raise exception 'session required'; end if;
	if not exists (select 1 from public.bank_transactions where id = p_tx_id) then
		raise exception 'bank_tx % not found', p_tx_id;
	end if;
	if not exists (select 1 from public.sessions where id = p_session_id) then
		raise exception 'session % not found', p_session_id;
	end if;
	if exists (select 1 from public.dues_allocations where bank_tx_id = p_tx_id) then
		raise exception 'tx % already allocated', p_tx_id;  -- 회원 매칭된 건 외부인 처리 금지
	end if;

	update public.bank_transactions
		set session_id = p_session_id, status = 'matched'
		where id = p_tx_id;

	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'confirm_court_external', p_tx_id, jsonb_build_object('session', p_session_id));
	return jsonb_build_object('tx_id', p_tx_id, 'session', p_session_id);
end $$;

revoke execute on function public.dues_confirm_court_external(bigint, bigint) from public;
grant execute on function public.dues_confirm_court_external(bigint, bigint) to authenticated;

-- 대사 취소: 기존 배분 삭제 + 외부인 세션 태깅 해제 + 배분 없으면 상태 복원.
create or replace function public.dues_cancel_match(p_tx_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin uuid := public.current_member_id();
	v_del   int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	delete from public.dues_allocations where bank_tx_id = p_tx_id;  -- 트리거가 charge/tx 캐시 복원
	get diagnostics v_del = row_count;
	delete from public.member_name_aliases where created_by_txn = p_tx_id and source = 'learned';
	-- 외부인 세션 태깅 해제 + 배분이 하나도 없으면(외부인/미배분) unmatched 로 복원(무시 상태는 유지).
	update public.bank_transactions set session_id = null where id = p_tx_id;
	update public.bank_transactions set status = 'unmatched'
		where id = p_tx_id and status <> 'ignored'
		  and not exists (select 1 from public.dues_allocations where bank_tx_id = p_tx_id);
	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'cancel_match', p_tx_id, jsonb_build_object('deleted', v_del));
	return jsonb_build_object('deleted', v_del);
end $$;
