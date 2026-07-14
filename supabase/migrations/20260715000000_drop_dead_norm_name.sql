-- 죽은 함수 정리: dues_norm_name(text)
-- 초기 이름-정규화 매칭(dues_confirm_match/dues_manual_payment)에서만 쓰였는데
-- 그 함수들이 재정비 과정에서 모두 드롭됨 → 현재 어떤 함수/뷰/트리거도 참조하지 않음(참조 0 확인).
drop function if exists public.dues_norm_name(text);
