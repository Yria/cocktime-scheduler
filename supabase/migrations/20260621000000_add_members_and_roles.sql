-- Phase 2: members(계정+선수 프로필) + user_roles(권한) + 권한 헬퍼
-- 계약서: docs/EXPANSION_SPEC.md §2, §4.1, §7
-- RLS는 신규 테이블이므로 처음부터 좁게. 기존 4테이블(sessions 등)은 아직 anon_all 유지(Phase 9에서 전환).

-- ============================================================
-- ① members : 계정 + 선수 프로필 (단일 소스). 게스트도 여기(auth_user_id NULL).
-- ============================================================
create table if not exists public.members (
	id              uuid primary key default gen_random_uuid(),
	auth_user_id    uuid unique references auth.users(id) on delete set null,
	name            text not null,
	gender          text check (gender in ('M','F')),   -- NULL 허용(가입 직후), 세션 편입 전 필수
	skills          jsonb,
	avatar_url      text,
	phone           text,
	is_guest        boolean not null default false,
	is_active       boolean not null default true,
	sheet_player_id text unique,                          -- Sheets player-N 매핑 키(폐지 후 deprecated)
	created_at      timestamptz not null default now(),
	updated_at      timestamptz not null default now()
);

-- ============================================================
-- ② user_roles : 권한 소스 오브 트루스
-- ============================================================
create table if not exists public.user_roles (
	member_id  uuid not null references public.members(id) on delete cascade,
	role       text not null check (role in ('admin','member')),
	granted_at timestamptz not null default now(),
	primary key (member_id, role)
);

-- ============================================================
-- ③ 권한 헬퍼 (SECURITY DEFINER + search_path='' → user_roles RLS 재귀 회피)
-- ============================================================
create or replace function public.current_member_id()
returns uuid language sql stable security definer set search_path = ''
as $$
	select id from public.members where auth_user_id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
	select exists (
		select 1
		from public.user_roles ur
		join public.members m on m.id = ur.member_id
		where m.auth_user_id = auth.uid() and ur.role = 'admin'
	)
$$;

revoke execute on function public.current_member_id() from anon;
revoke execute on function public.is_admin() from anon;
grant execute on function public.current_member_id() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ============================================================
-- ④ RLS : members
-- ============================================================
alter table public.members enable row level security;

-- 로그인 사용자는 전원 조회 가능(선수 명단 공유)
create policy members_select on public.members
	for select to authenticated using (true);

-- 본인 행 생성(첫 로그인 upsert)
create policy members_self_insert on public.members
	for insert to authenticated with check (auth_user_id = auth.uid());

-- 본인 프로필 수정
create policy members_self_update on public.members
	for update to authenticated
	using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

-- 운영진은 전체 쓰기(게스트 추가/회원 관리)
create policy members_admin_write on public.members
	for all to authenticated
	using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- ⑤ RLS : user_roles
-- ============================================================
alter table public.user_roles enable row level security;

-- 본인 역할 또는 운영진은 조회
create policy user_roles_select on public.user_roles
	for select to authenticated
	using (public.is_admin() or member_id = public.current_member_id());

-- 역할 부여/회수는 운영진만
create policy user_roles_admin_write on public.user_roles
	for all to authenticated
	using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- ⑥ 부트스트랩 : 현재 가입된 첫 사용자를 운영진으로 시드
--    (이미 카카오 로그인한 본인 → 적용 즉시 운영진 권한 확보)
-- ============================================================
do $$
declare
	v_uid uuid;
	v_mid uuid;
	v_name text;
begin
	select id, coalesce(
		raw_user_meta_data->>'name',
		raw_user_meta_data->>'full_name',
		raw_user_meta_data->>'nickname',
		'운영진'
	)
	into v_uid, v_name
	from auth.users
	order by created_at
	limit 1;

	if v_uid is not null then
		insert into public.members (auth_user_id, name)
		values (v_uid, v_name)
		on conflict (auth_user_id) do nothing;

		select id into v_mid from public.members where auth_user_id = v_uid;

		insert into public.user_roles (member_id, role)
		values (v_mid, 'admin')
		on conflict do nothing;
	end if;
end $$;
