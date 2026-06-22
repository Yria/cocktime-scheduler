-- ============================================================
-- push_subscriptions : 웹푸시(Web Push) 구독 저장 (보조 알림 경로)
--   한 회원이 여러 기기 가능. (member_id, endpoint) 자연 유일키.
--   만료(410/404) 구독은 send-push Edge Function이 정리.
--   RLS: 본인 구독만 CRUD. INSERT/UPDATE도 본인 행만(복합 유일키라 RPC 불필요).
-- ============================================================
create table if not exists public.push_subscriptions (
	id           uuid primary key default gen_random_uuid(),
	member_id    uuid not null references public.members(id) on delete cascade,
	endpoint     text not null,
	p256dh       text not null,
	auth         text not null,
	user_agent   text,
	created_at   timestamptz not null default now(),
	last_seen_at timestamptz not null default now(),
	unique (member_id, endpoint)
);

create index if not exists idx_push_sub_member
	on public.push_subscriptions(member_id);

alter table public.push_subscriptions enable row level security;

-- 본인 구독만 조회/등록/갱신/삭제
create policy push_sub_self_select on public.push_subscriptions
	for select to authenticated
	using (member_id = public.current_member_id());

create policy push_sub_self_insert on public.push_subscriptions
	for insert to authenticated
	with check (member_id = public.current_member_id());

create policy push_sub_self_update on public.push_subscriptions
	for update to authenticated
	using (member_id = public.current_member_id())
	with check (member_id = public.current_member_id());

create policy push_sub_self_delete on public.push_subscriptions
	for delete to authenticated
	using (member_id = public.current_member_id());
