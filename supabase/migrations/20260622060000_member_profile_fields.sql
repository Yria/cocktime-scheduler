-- 회원 프로필 추가 필드: 카카오 로그인(가입) 후 입력받는 나이·거주지(동 단위).
-- gender 는 기존 컬럼. 가입 직후 NULL 이며 프로필 입력 단계에서 채운다.
alter table public.members
	add column if not exists age       int,
	add column if not exists residence text; -- 거주지(동 단위, 예: "역삼동")
