-- 회원 하드삭제 차단 — delete_member RPC 무력화.
--
-- 배경: 회원을 delete_member 로 하드삭제하면 FK CASCADE 로 그 회원의
--   dues_charges(부과)·dues_allocations(입금 배분)·attendances(참석)가 함께 삭제되고,
--   납부돼 있던 입금(bank_transactions)이 unmatched 로 되돌아가 정산이 꼬인다.
--   (실제 사고: 김영주92 재가입 시 구 계정을 하드삭제 → 7월 대관비/회비 부과·배분 유실.)
--
-- 정책: 탈퇴는 members.is_active=false(비활성) 로만. 재가입은 재활성화(is_active=true) —
--   옛 created_at 이 보존돼 dues_generate_monthly 가 당월 회비를 정상 부과한다(가입월 리셋 없음).
--   UI 삭제 버튼은 프론트에서 제거했고, 여기서 서버 RPC 도 차단해 직접 호출·구 클라이언트까지 막는다.
--
-- 시그니처·grant 는 유지(호출 시 404 대신 명확한 에러). 되돌리려면 이전 정의로 복구.

create or replace function public.delete_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
	raise exception 'member hard-delete is disabled; deactivate (is_active=false) instead'
		using errcode = 'P0001';
end; $$;

comment on function public.delete_member(uuid) is
	'폐지: 회원 하드삭제는 정산 CASCADE 유실로 차단(항상 예외). 탈퇴=is_active=false, 재가입=재활성화. 2026-07-21.';
