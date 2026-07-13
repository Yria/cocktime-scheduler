-- 회계 Migration 4: 은행거래 수동 분류(무시/사유) — 완전성 보장(모든 거래를 종결 상태로).
-- 설계서: docs/ACCOUNTING_DESIGN.md §8. 자동매칭 실패분(이름·금액·비회비수입)을 관리자가 무시(사유)로 종결.
-- 회원 수동 지목 매칭은 기존 dues_confirm_match(tx, payer, lines) 재사용.

-- 분류 메모(무시 사유·비회비수입 분류 등). 콕판매 같은 별도 수입은 여기 사유 남기고 §10 수지에서 집계.
alter table public.bank_transactions
  add column if not exists classify_note text;

-- 거래 무시(회비/대관비 아님·이자·오입금 등): status='ignored' + 사유. 배분이 있으면 금지(먼저 대사취소).
create or replace function public.dues_ignore_transaction(p_tx_id bigint, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin uuid := public.current_member_id();
  v_alloc int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select count(*) into v_alloc from public.dues_allocations where bank_tx_id = p_tx_id;
  if v_alloc > 0 then
    raise exception 'transaction has allocations — cancel match first';
  end if;
  update public.bank_transactions
    set status = 'ignored', classify_note = p_note
    where id = p_tx_id;
  if not found then raise exception 'bank_tx % not found', p_tx_id; end if;
  insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
  values (v_admin, 'ignore_transaction', p_tx_id, jsonb_build_object('note', p_note));
  return jsonb_build_object('tx_id', p_tx_id, 'status', 'ignored');
end $$;

-- 무시 해제 → 미처리로 복귀(배분 없으므로 unmatched).
create or replace function public.dues_unignore_transaction(p_tx_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin uuid := public.current_member_id();
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.bank_transactions
    set status = 'unmatched', classify_note = null
    where id = p_tx_id and status = 'ignored';
  if not found then raise exception 'bank_tx % not found or not ignored', p_tx_id; end if;
  insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
  values (v_admin, 'unignore_transaction', p_tx_id, null);
  return jsonb_build_object('tx_id', p_tx_id, 'status', 'unmatched');
end $$;

revoke execute on function public.dues_ignore_transaction(bigint, text) from public;
revoke execute on function public.dues_unignore_transaction(bigint)     from public;
grant execute on function public.dues_ignore_transaction(bigint, text) to authenticated;
grant execute on function public.dues_unignore_transaction(bigint)     to authenticated;
