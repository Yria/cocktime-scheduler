-- 나이(age) → 출생년도(birth_year)로 전환. 매년 변하지 않는 값으로 저장.
-- name 은 기존 NOT NULL 컬럼(가입 시 카카오 이름으로 채움) — 프로필 입력에서 수정 가능.
alter table public.members
	add column if not exists birth_year int;
alter table public.members
	drop column if exists age;
