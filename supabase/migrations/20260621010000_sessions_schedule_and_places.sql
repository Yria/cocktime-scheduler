-- Phase 4: 일정 = 세션. 기존 sessions를 예정→진행→종료 상태기계로 확장 + places(좌표 프리셋)
-- 계약서: docs/EXPANSION_SPEC.md §3, §4
-- 기존 보드 무영향: status 기본값 'active' → 기존 즉석 세션(startSession) 경로 그대로 동작.

-- ============================================================
-- ① places : 좌표 프리셋 (모임 코트 위치 + 카풀 집결지 공용)
-- ============================================================
create table if not exists public.places (
	id                  bigserial primary key,
	name                text not null,
	address             text,
	lat                 double precision,
	lng                 double precision,
	default_court_count int,
	is_active           boolean not null default true,
	created_by          uuid references public.members(id) on delete set null,
	created_at          timestamptz not null default now()
);

alter table public.places enable row level security;
create policy places_select on public.places
	for select to authenticated using (true);
create policy places_admin_write on public.places
	for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- ② sessions 확장 : 일정 메타 + 상태기계 + 카풀 집결 공지
-- ============================================================
alter table public.sessions
	add column if not exists title                    text,
	add column if not exists scheduled_at             timestamptz,
	add column if not exists capacity                 int,
	add column if not exists place_id                 bigint,
	add column if not exists status                   text not null default 'active',
	add column if not exists created_by               uuid,
	add column if not exists carpool_muster_place_id  bigint,
	add column if not exists carpool_muster_at        timestamptz;

-- 상태값 제약 (draft 작성중 → open 모집 → active 진행 → closed 종료 / cancelled)
alter table public.sessions
	add constraint sessions_status_check
	check (status in ('draft','open','active','closed','cancelled'));

-- FK
alter table public.sessions
	add constraint sessions_place_id_fkey
		foreign key (place_id) references public.places(id) on delete set null,
	add constraint sessions_created_by_fkey
		foreign key (created_by) references public.members(id) on delete set null,
	add constraint sessions_carpool_muster_place_id_fkey
		foreign key (carpool_muster_place_id) references public.places(id) on delete set null;

-- 기존 데이터 보정: is_active → status (개발 중, 파괴적 정리 허용)
update public.sessions set status = case when is_active then 'active' else 'closed' end;

-- 일정 목록 조회용 인덱스 (예정 일정 정렬)
create index if not exists idx_sessions_status_scheduled
	on public.sessions(status, scheduled_at);
