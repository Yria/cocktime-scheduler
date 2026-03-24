create table if not exists manual_match_logs (
  id uuid primary key default gen_random_uuid(),
  session_id bigint not null references sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  snapshot jsonb not null
);

create index idx_manual_match_logs_session on manual_match_logs(session_id);
