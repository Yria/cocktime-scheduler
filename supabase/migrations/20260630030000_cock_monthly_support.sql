-- 월별 콕 지원 + 성별 콕 쿼터(그룹 전역 설정)
--
-- 콕체크(set_cock_checked) 시, 회원이 그 달 콕 지원(기본 1개)을 아직 안 받았으면 콕체크 모달에
-- "이번 달 콕 지원 — 남:1개만 / 여:안 내도 됨"을 크게 노출하고, 확인 시 그 달 지원을 소진한다.
--   - group_settings: 성별 1회 콕 쿼터(남2/여1) + 월 지원량(1). 클럽 전역 영구 설정(싱글톤 id=1).
--     회원관리(관리자) 화면에서 편집. "콕 내는 양"은 세션 콕체크 1회당 기준.
--   - cock_support_grants: 회원이 어느 달(ym='YYYY-MM', KST)에 지원을 소진했는지 1행. PK(member_id, ym)=멱등.
--     그 달 첫 콕체크 확인이 소진(insert). 같은 달 이후엔 이미 소진이라 정상 쿼터.
--   - 게스트/구 Sheets 선수(member_id NULL)는 회원이 아니라 지원 대상 외.

create table if not exists public.group_settings (
	id int primary key default 1 check (id = 1),
	cock_quota_male int not null default 2,
	cock_quota_female int not null default 1,
	cock_support_per_month int not null default 1,
	updated_at timestamptz not null default now()
);
insert into public.group_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.cock_support_grants (
	member_id uuid not null references public.members(id) on delete cascade,
	ym text not null,
	session_id bigint references public.sessions(id) on delete set null,
	granted_at timestamptz not null default now(),
	primary key (member_id, ym)
);
create index if not exists idx_cock_support_grants_ym on public.cock_support_grants(ym);

-- RLS: 읽기는 authenticated 전체. group_settings 쓰기는 운영진만(is_admin).
-- cock_support_grants insert 는 authenticated(보드 편집자가 콕체크로 소진) — 현 broad-RLS 기조와 일치.
alter table public.group_settings enable row level security;
drop policy if exists group_settings_select on public.group_settings;
create policy group_settings_select on public.group_settings
	for select to authenticated using (true);
drop policy if exists group_settings_admin_write on public.group_settings;
create policy group_settings_admin_write on public.group_settings
	for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.cock_support_grants enable row level security;
drop policy if exists cock_support_grants_select on public.cock_support_grants;
create policy cock_support_grants_select on public.cock_support_grants
	for select to authenticated using (true);
drop policy if exists cock_support_grants_insert on public.cock_support_grants;
create policy cock_support_grants_insert on public.cock_support_grants
	for insert to authenticated with check (true);
