-- ============================================================
-- 대관비 개편 contract 단계 — court_fee_per_hour 컬럼 + 전환창 브리지 제거.
--
-- expand(20260718000000)에서 게이트를 charges_court_fee 로 옮기고, 전환 창 동안 구/신 클라의
-- 두 쓰기 경로를 브리지 트리거로 동기화했다. 이제 charges_court_fee 를 write 하는 신 클라가
-- 운영 배포되어(라이브 번들에 charges_court_fee 확인) 어떤 클라도 court_fee_per_hour 를
-- 더 이상 read/write 하지 않는다. 참조 객체도 브리지 함수 하나뿐(뷰·타 함수 없음, 확인 완료).
-- → 브리지와 컬럼을 제거한다(게이트는 charges_court_fee 로 완전 일원화).
-- ============================================================

drop trigger if exists trg_places_sync_charges_gate on public.places;
drop function if exists public.places_sync_charges_gate();
alter table public.places drop column if exists court_fee_per_hour;
