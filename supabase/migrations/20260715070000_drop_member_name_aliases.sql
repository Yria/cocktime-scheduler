-- 죽은 테이블 정리: member_name_aliases (옛 자동학습 별칭, 휴면 33행·현재 아무도 안 읽음).
-- 유일한 참조는 dues_cancel_match의 학습분 삭제 구문(현재 no-op) → 함수에서 제거 후 테이블 drop.
-- (자동 이름-매칭 학습이 다시 필요하면 그때 재구현)
create or replace function public.dues_cancel_match(p_tx_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_admin uuid := public.current_member_id();
  v_del   int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.dues_allocations where bank_tx_id = p_tx_id;  -- 트리거가 charge/tx 캐시 복원
  get diagnostics v_del = row_count;
  -- 외부인 세션 태깅 해제 + 배분이 하나도 없으면(외부인/미배분) unmatched 로 복원(무시 상태는 유지).
  update public.bank_transactions set session_id = null where id = p_tx_id;
  update public.bank_transactions set status = 'unmatched'
    where id = p_tx_id and status <> 'ignored'
      and not exists (select 1 from public.dues_allocations where bank_tx_id = p_tx_id);
  insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
  values (v_admin, 'cancel_match', p_tx_id, jsonb_build_object('deleted', v_del));
  return jsonb_build_object('deleted', v_del);
end $function$;

drop table if exists public.member_name_aliases;
