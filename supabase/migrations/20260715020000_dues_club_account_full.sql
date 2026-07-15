-- 내 회비 재설계: 로그인 회원에게 입금 계좌 전체번호 노출(마스킹 제거).
-- 이미 로그인(current_member_id) 게이팅돼 있고, "어디로 내는지" 실제로 쓰려면 전체번호+복사가 필요.
create or replace function public.dues_club_account()
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select case when public.current_member_id() is null then null
    else jsonb_build_object(
      'bank_name',      s.bank_name,
      'account',        s.bank_account,   -- 전체 계좌번호(로그인 회원 전용)
      'account_holder', s.account_holder,
      'monthly_fee',    s.monthly_fee
    ) end
  from public.dues_settings s where s.id = 1
$function$;
