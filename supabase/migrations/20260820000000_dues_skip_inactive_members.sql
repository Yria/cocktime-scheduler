-- 회비 부과 생성에서 비활성 회원을 다시 제외한다 — 20260819000000 의 §2 정정.
--
-- 어제 판단이 틀린 지점: 운영진 민원("비활성된 사용자가 부과에 자꾸 제외되는데")을 **부과 생성 룰**의
--   문제로 읽어 `dues_generate_monthly` 에서 `is_active` 조건을 뺐다. 실제 문제는 생성이 아니라
--   **이미 정산처리된 기록이 나중에 취소되는 것**이었다. 감사 로그가 그대로 보여준다:
--
--   · 이한비 님 2026-07 회비(charge 119) — 2026-07-13 10:20 `confirm_new_monthly` → 13:16 `confirm_match`
--     로 입금 5,000(bank_tx 2)에 **정산 완료**. 2026-07-26 대관비 6,000(bank_tx 8958)도 `confirm_reconcile`
--     완료(charge 1022). 그런데 members 행이 하드삭제되자 두 부과와 배분이 CASCADE 로 사라지고
--     `bank_transactions.paid_by` 는 SET NULL 돼 **두 입금이 미분류로 되돌아갔다** = 7월 정산이 풀렸다.
--   · 홍예린 님 2026-07 회비 — 실제 참석자인데 정지 시 자동 면제 트리거가 `waived` 로 돌려
--     이미 마감한 7월의 진행률·미납 명단을 사후에 바꿨다.
--
--   둘 다 "이미 처리된 게 취소된" 사고이고, **부과 생성 자격과는 무관하다**. 어제 배포에서 그 두 원인
--   (하드삭제 경로 봉인 20260819010000 · 자동 면제 폐지 20260819000000 §1)은 이미 제거했다.
--   생성 룰 변경만 과잉이었으므로 되돌린다.
--
-- 확정 정책
--   1) **명단 기반 자동 생성은 활성 회원만**: 나간 사람에게 매달 새 회비가 붙으면 영구 미납이 쌓인다.
--   2) **이미 생긴 부과는 자동으로 지우지 않는다**(트리거 폐지 유지). 걷지 않기로 하는 판단은 사람이
--      회비 현황 [면제] 로 한다.
--   3) **돈이 들어오면 붙일 자리는 만든다**: 입금 확인 경로(`dues_confirm_reconcile`)는 명단 자격을
--      보지 않고 납부자 앞으로 부과를 생성한다 — 그대로 둔다. 비활성 회원이 뒤늦게 회비를 내는 경우
--      (이한비 님 케이스)에 정산할 길이 여기뿐이다. 자동 생성은 안 하지만 수납은 막지 않는다.
--
-- 이 마이그레이션은 부과를 만들거나 지우지 않는다(함수 정의만 교체). 어제 원복한 미납 11건은
--   그대로 남는다 — 되살린 기록을 다시 조용히 지우지 않는다는 게 위 2)의 요지다.

create or replace function public.dues_generate_monthly(p_ym text)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare v_fee int; v_offset int; v_n int := 0;
begin
  select monthly_fee, offset_days into v_fee, v_offset from public.dues_settings where id = 1;
  if v_fee is null then raise exception 'dues_settings not initialized'; end if;
  insert into public.dues_charges (kind, member_id, period_ym, amount_due)
  select 'monthly_fee', m.id, p_ym, v_fee
  from public.members m
  where m.is_active and not m.is_guest and not m.is_honorary and not public.is_operator(m.id)
    and p_ym >= to_char(
      date_trunc('month',
        (coalesce(m.membership_started_at, (m.created_at at time zone 'Asia/Seoul')::date) + v_offset)::timestamp)
      + interval '1 month', 'YYYY-MM')
  on conflict (member_id, period_ym) where period_ym is not null
  do update set amount_due = excluded.amount_due, updated_at = now()
  where public.dues_charges.amount_paid = 0;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke execute on function public.dues_generate_monthly(text) from public, anon, authenticated;

comment on function public.dues_generate_monthly(text) is
  '월 회비 부과 생성. 자격 = 활성·비게스트·비명예·비운영진, 가입월+offset 다음 달부터. 이미 납부분(amount_paid>0)은 금액을 덮지 않는다. 생성에서 빠지는 것과 이미 생긴 부과를 지우는 것은 다른 문제다 — 후자는 하지 않는다(20260820000000).';
