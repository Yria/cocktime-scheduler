-- 회계 Migration 11: 거래 카테고리(입/출금 공통 분류) — 콕공구 등 활동별 수입−지출=순액 추적.
-- 설계서 §10. 기존 expense_categories(출금 전용)를 일반 거래 카테고리로 승격(입금에도 사용).
--   예: '콕공구' = 회비로 콕 대량구매(출금) + 회원 판매(입금) → 순액 0 이면 정산 완료.
--   회비/대관비 납부는 charge 대사(입금확인)로 분류되므로 카테고리 불필요. 그 외 입/출금을 카테고리로.

alter table public.expense_categories rename to txn_categories;
alter table public.bank_transactions rename column expense_category_id to category_id;
comment on table public.txn_categories is '거래 분류(입/출금 공통). 콕공구·코트대관 등 활동. 수지에서 카테고리별 순액 집계.';

-- 기본 카테고리 시드(관리자가 추가/삭제 가능).
insert into public.txn_categories (name) values ('코트대관'), ('콕공구'), ('셔틀콕')
on conflict (name) do nothing;

create or replace function public.dues_add_category(p_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; v_n text := btrim(p_name);
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if v_n = '' then raise exception 'name required'; end if;
	insert into public.txn_categories (name) values (v_n) on conflict (name) do nothing;
	select id into v_id from public.txn_categories where name = v_n;
	return jsonb_build_object('id', v_id, 'name', v_n);
end $$;

create or replace function public.dues_delete_category(p_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	delete from public.txn_categories where id = p_id;  -- FK on delete set null → 거래의 category_id 해제
	return jsonb_build_object('deleted', p_id);
end $$;

-- 거래에 카테고리 지정(NULL = 해제). 입금확인에서 비회비 입금을 분류하면 미처리 큐에서 빠짐(§ 미처리 필터 category_id is null).
create or replace function public.dues_set_txn_category(p_tx_id bigint, p_category_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	update public.bank_transactions set category_id = p_category_id where id = p_tx_id;
	if not found then raise exception 'bank_tx % not found', p_tx_id; end if;
	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (public.current_member_id(), 'set_txn_category', p_tx_id, jsonb_build_object('category_id', p_category_id));
	return jsonb_build_object('tx_id', p_tx_id, 'category_id', p_category_id);
end $$;

revoke execute on function public.dues_add_category(text)              from public;
revoke execute on function public.dues_delete_category(bigint)         from public;
revoke execute on function public.dues_set_txn_category(bigint, bigint) from public;
grant execute on function public.dues_add_category(text)              to authenticated;
grant execute on function public.dues_delete_category(bigint)         to authenticated;
grant execute on function public.dues_set_txn_category(bigint, bigint) to authenticated;
