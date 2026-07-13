-- 회계 재정비 4: 사문화 RPC 제거 (ACCOUNTING_SPEC §8.1).
-- dues_confirm_reconcile(통합 확정)이 confirm_match/compose/new_monthly/new_court를 흡수했고,
-- 전체 미납 알림(dues_notify_unpaid)은 카테고리 단위 발송(dues_notify_selected)으로 대체(§6).
-- 현금 납부·수동 상태변경·배분 되돌리기·세션 요금 직접입력은 통장 전용 흐름에서 미사용.
-- 클라이언트 wrapper·호출처 없음(엣지/트리거/타 RPC 미참조) 확인 후 드롭.

drop function if exists public.dues_notify_unpaid(text);
drop function if exists public.dues_confirm_match(bigint, uuid, jsonb);
drop function if exists public.dues_confirm_new_monthly(bigint, uuid, text);
drop function if exists public.dues_confirm_new_court(bigint, uuid, bigint);
drop function if exists public.dues_confirm_compose(bigint, uuid, text, bigint[]);
drop function if exists public.dues_confirm_compose(bigint, uuid, text, jsonb);
drop function if exists public.dues_manual_payment(uuid, jsonb);
drop function if exists public.dues_set_charge_status(bigint, text);
drop function if exists public.dues_reverse_allocation(bigint);
drop function if exists public.dues_set_session_fee(bigint, integer);
