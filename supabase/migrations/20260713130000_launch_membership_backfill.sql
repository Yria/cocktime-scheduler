-- 회계 Migration 10: 7월 서비스 시작 백필.
-- 설계서 §7.1. 서비스 2026-07 시작 → 현재 회원은 전부 "기존 가입자"(created_at=앱 등록일이 7월일 뿐).
--   created_at 기반 offset 당월면제가 7월 회비를 잘못 스킵하므로, 기존 회원 membership_started_at 을
--   6월로 백필 → 첫 부과월 = 7월. (앞으로 가입하는 진짜 신규는 membership_started_at NULL → created_at offset 정상)
-- 회비 면제 회원은 별도 플래그 없이, 필요 시 해당 회원 membership_started_at 을 미래로 두어 부과 제외(DB 직접 조작).

update public.members
set membership_started_at = date '2026-06-01'
where membership_started_at is null and not is_guest;
