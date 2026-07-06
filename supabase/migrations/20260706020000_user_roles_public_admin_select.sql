-- 참여자 목록의 "운영진" 뱃지: 운영진 여부는 공개 정보여야 한다(전 회원이 누가 운영진인지 알 수 있어야 함).
-- 기존 user_roles_select 는 본인 role 또는 운영진만 조회 가능 → 일반 회원이 타인의 admin 여부를 못 봄.
-- role='admin' 행을 로그인 사용자 전원에게 공개(permissive → 기존 정책과 OR). 'member' 등 나머지 role 행은 여전히 비공개.
create policy user_roles_select_admin_public on public.user_roles
	for select to authenticated
	using (role = 'admin');
