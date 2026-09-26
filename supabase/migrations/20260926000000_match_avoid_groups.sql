-- 같이 매칭하지 않기: 묶음 안의 두 사람은 자동 선발(자동편성)에서 같은 경기에 넣지 않는다.
-- 목록을 보고 바꾸는 사람은 match_avoid_owner에 지정한 계정뿐이다(지정은 저장소 밖에서 한다).
-- 자동 선발은 보드 편집 기기에서 돌므로, 활성 운영진 기기는 board_selection_rules로 이번 회차에 있는
-- 사람끼리의 묶음(회원 id)만 받는다 — 이름·만든 사람·전체 목록은 받지 않고 화면에도 드러내지 않는다.
-- 회원 파티(member_party_*, 2026-09-13부터 UI 비활성)는 이 묶음을 모르므로 되살릴 때 서버에서 검사해야 한다.
create or replace function public.match_avoid_distinct_count(p_ids uuid[])
returns int language sql immutable set search_path = '' as $$
  select count(distinct x)::int from unnest(p_ids) x
$$;

-- 같은 사람 구성의 묶음을 한 번만 저장한다(순서 무관).
create or replace function public.match_avoid_key(p_ids uuid[])
returns uuid[] language sql immutable set search_path = '' as $$
  select array_agg(x order by x) from unnest(p_ids) x
$$;
revoke execute on function public.match_avoid_distinct_count(uuid[]) from public, anon;
revoke execute on function public.match_avoid_key(uuid[]) from public, anon;
grant execute on function public.match_avoid_distinct_count(uuid[]) to authenticated;
grant execute on function public.match_avoid_key(uuid[]) to authenticated;

-- 목록 주인. 정책이 없어 어떤 클라이언트 롤도 직접 읽지 못한다(아래 security definer 함수만 본다).
create table if not exists public.match_avoid_owner (
  member_id uuid primary key references public.members(id) on delete cascade
);
alter table public.match_avoid_owner enable row level security;
revoke all on public.match_avoid_owner from public, anon, authenticated;

create or replace function public.is_match_avoid_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.match_avoid_owner o join public.members m on m.id = o.member_id
    where m.auth_user_id = auth.uid() and m.is_active
  )
$$;
-- RLS 정책 표현식이 호출자 권한으로 부르므로 authenticated EXECUTE가 필요하다.
revoke execute on function public.is_match_avoid_owner() from public, anon;
grant execute on function public.is_match_avoid_owner() to authenticated;

create table if not exists public.match_avoid_groups (
  id uuid primary key default gen_random_uuid(),
  member_ids uuid[] not null check (
    cardinality(member_ids) between 2 and 4
    and array_ndims(member_ids) = 1
    and array_position(member_ids, null) is null
    and public.match_avoid_distinct_count(member_ids) = cardinality(member_ids)
  ),
  created_at timestamptz not null default now()
);
create unique index if not exists match_avoid_groups_members_key
  on public.match_avoid_groups (public.match_avoid_key(member_ids));

alter table public.match_avoid_groups enable row level security;
revoke all on public.match_avoid_groups from public, anon, authenticated;
grant select, insert, delete on public.match_avoid_groups to authenticated;
drop policy if exists match_avoid_groups_admin on public.match_avoid_groups;
drop policy if exists match_avoid_groups_owner on public.match_avoid_groups;
create policy match_avoid_groups_owner on public.match_avoid_groups
  for all to authenticated
  using ((select public.is_match_avoid_owner()))
  with check ((select public.is_match_avoid_owner()));

-- 보드 편집 기기용 선발 규칙. 활성 운영진만 받는다(회원·비활성 계정은 빈 규칙).
-- groups: 이 회차 session_players에 있는 회원이 2명 이상인 묶음의 그 회원 id들. owner: 호출자가 목록 주인인지.
create or replace function public.board_selection_rules(p_session_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_admin() and exists (
    select 1 from public.members m where m.auth_user_id = auth.uid() and m.is_active
  )) then
    return jsonb_build_object('owner', false, 'groups', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'owner', public.is_match_avoid_owner(),
    'groups', coalesce((
      select jsonb_agg(present.ids)
      from public.match_avoid_groups g
      cross join lateral (
        select array_agg(distinct sp.member_id) as ids
        from public.session_players sp
        where sp.session_id = p_session_id and sp.member_id = any(g.member_ids)
      ) present
      where cardinality(present.ids) >= 2
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.board_selection_rules(bigint) from public, anon;
grant execute on function public.board_selection_rules(bigint) to authenticated;
