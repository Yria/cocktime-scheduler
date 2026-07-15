-- 비부과 납부(콕공구 등)를 회원 이력에 넣기 위한 '납부자' 귀속.
-- 회원↔입금 연결은 지금까지 부과 배분(dues_allocations)으로만 가능 → 카테고리 분류 입금엔 납부자 정보가 없었음.
-- bank_transactions.paid_by 로 "이 입금을 낸 회원"을 선택 저장(카테고리 수입에만 의미, 선택).
alter table public.bank_transactions
  add column if not exists paid_by uuid references public.members(id) on delete set null;

comment on column public.bank_transactions.paid_by is '비부과 수입(카테고리)을 낸 회원 — 내 회비 납부 이력 표시용. 부과 배분 입금은 dues_allocations로 귀속되므로 불필요.';

-- 분류 RPC에 납부자 파라미터 추가. 카테고리 해제(null) 시 납부자도 해제.
create or replace function public.dues_set_txn_category(p_tx_id bigint, p_category_id bigint, p_paid_by uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.bank_transactions
     set category_id = p_category_id,
         paid_by = case when p_category_id is null then null else p_paid_by end
   where id = p_tx_id;
  if not found then raise exception 'bank_tx % not found', p_tx_id; end if;
  insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
  values (public.current_member_id(), 'set_txn_category', p_tx_id,
          jsonb_build_object('category_id', p_category_id, 'paid_by', p_paid_by));
  return jsonb_build_object('tx_id', p_tx_id, 'category_id', p_category_id, 'paid_by', p_paid_by);
end $function$;
