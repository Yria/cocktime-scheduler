-- 세션 237(2026-08-17 에이트민턴): 부과 대상인데 부과 행이 없는 회원을 6,000원으로 채운다.
--
-- 대상은 손형일 1명 — 정원 18 만석에 대기(waitlisted)였는데 현장에서 보드에 넣어 9경기를 뛰었다.
-- 20260818000000 로 부과 대상이 '참석 명단 ∪ 보드 추가분'이 되어 이제 대상으로 잡히지만,
-- 부과 행 생성은 세션 종료 트리거에서만 돌기 때문에 이미 닫힌 이 세션은 손으로 채워야 한다.
--
-- **금액은 6,000원으로 고정한다(재계산하지 않는다).** 대상이 19→20명이 되어 엔빵 산식은
-- 117,000 ÷ 20 = 5,850원을 내놓지만, 이미 20명 중 14명이 6,000원을 납부 완료했다.
-- 전원 5,850으로 내리면 14명이 150원씩 초과납으로 도장돼 환불 대상이 생기고 금액 변경 안내가
-- 필요해진다. 실무 비용이 차액보다 크다는 판단으로 **공지된 6,000원을 유지**한다(운영 결정 2026-08-18).
--   부과합 20 × 6,000 = 120,000 vs 실지출 117,000 → 잉여 3,000원은 통장이 흡수.
--
-- ⚠ 이 세션에 `dues_generate_session_court(237)` 를 다시 돌리면 미납분이 5,850으로 재계산된다.
--   되돌릴 이유가 없으면 다시 돌리지 말 것(세션이 이미 closed 라 트리거는 저절로 발화하지 않는다).
--
-- 대상 판정은 손으로 쓰지 않고 `dues_court_targets` 에 맡긴다 — 명단 기준과 갈릴 여지를 없애고
-- 이미 부과가 있는 사람은 건드리지 않아 몇 번 실행해도 결과가 같다.
insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint, is_day_cancel)
select 'court_fee', t.member_id, 237, 6000, t.payer_hint, t.is_day_cancel
from public.dues_court_targets(237, true) t
where not exists (
  select 1 from public.dues_charges dc
  where dc.kind = 'court_fee' and dc.session_id = 237 and dc.member_id = t.member_id
)
on conflict (member_id, session_id) where session_id is not null do nothing;
