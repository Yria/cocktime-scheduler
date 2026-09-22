-- 코트 수를 줄일 때 경기 중인 코트는 유지하고 빈 코트만 제거한다.
-- sessions 행 잠금은 경기 배정의 board_assert_editor와 직렬화된다.
-- AFTER를 사용해야 matches의 동기화 트리거가 같은 sessions 행을 갱신할 수 있다.
create or replace function public.sessions_resize_empty_courts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_removed integer[];
  v_map jsonb := '{}'::jsonb;
  v_drafts jsonb;
  v_teams jsonb := '[]'::jsonb;
  v_team jsonb;
  v_courts jsonb := '{}'::jsonb;
  v_layout_teams jsonb;
  v_old integer;
  v_next integer := 0;
  v_team_court integer;
begin
  if new.court_count is null or new.court_count < 1 then
    raise exception 'court count must be positive';
  end if;

  if new.court_count < old.court_count then
    select s.board_drafts into v_drafts from public.sessions s where s.id = new.id;

    -- 편성도 없는 빈 코트부터, 동률이면 뒤 번호부터 없앤다.
    select array_agg(court_id) into v_removed from (
      select c as court_id
      from generate_series(1, old.court_count) c
      where not exists (
        select 1 from public.matches m
        where m.session_id = new.id and m.status = 'playing' and m.court_id = c
      )
      order by exists (
        select 1 from jsonb_array_elements(coalesce(v_drafts->'teams', '[]'::jsonb)) t
        where (t->>'courtId')::integer = c and (
          jsonb_array_length(coalesce(t->'memberIds', '[]'::jsonb)) > 0 or exists (
            select 1 from jsonb_array_elements(coalesce(v_drafts->'reservations', '[]'::jsonb)) r
            where r->>'teamId' = t->>'id'
          )
        )
      ), c desc
      limit old.court_count - new.court_count
    ) empty_courts;
    if coalesce(cardinality(v_removed), 0) <> old.court_count - new.court_count then
      raise exception 'not enough empty courts';
    end if;

    -- 작은 번호부터 당겨야 진행 중 코트의 유일성 제약과 충돌하지 않는다.
    for v_old in 1..old.court_count loop
      if v_old = any(v_removed) then continue; end if;
      v_next := v_next + 1;
      v_map := v_map || jsonb_build_object(v_old::text, v_next);
      if v_old <> v_next then
        update public.matches set court_id = v_next
        where session_id = new.id and status = 'playing' and court_id = v_old;
      end if;
    end loop;

    if v_drafts is not null then
      v_layout_teams := coalesce(v_drafts->'layout'->'teams', '{}'::jsonb);
      for v_team in select value from jsonb_array_elements(coalesce(v_drafts->'teams', '[]'::jsonb)) loop
        v_team_court := (v_team->>'courtId')::integer;
        if v_team_court = any(v_removed) then
          if jsonb_array_length(coalesce(v_team->'memberIds', '[]'::jsonb)) > 0 or exists (
            select 1 from jsonb_array_elements(coalesce(v_drafts->'reservations', '[]'::jsonb)) r
            where r->>'teamId' = v_team->>'id'
          ) then
            -- 편성해 둔 명단/예약은 예비 그룹으로 보존한다. ID는 그대로라 예약도 유효하다.
            v_team := (v_team - 'courtId') || jsonb_build_object('createdMs', floor(extract(epoch from clock_timestamp()) * 1000));
          else
            v_layout_teams := v_layout_teams - (v_team->>'id');
            continue;
          end if;
        elsif v_map ? v_team_court::text then
          v_team := jsonb_set(v_team, '{courtId}', v_map->v_team_court::text);
        end if;
        v_teams := v_teams || jsonb_build_array(v_team);
      end loop;
      v_drafts := jsonb_set(v_drafts, '{teams}', v_teams);

      if jsonb_typeof(v_drafts->'layout') = 'object' then
        select coalesce(jsonb_object_agg(v_map->>c.key, c.value), '{}'::jsonb) into v_courts
        from jsonb_each(coalesce(v_drafts->'layout'->'courts', '{}'::jsonb)) c
        where v_map ? c.key;
        v_drafts := jsonb_set(v_drafts, '{layout,courts}', v_courts);
        v_drafts := jsonb_set(v_drafts, '{layout,teams}', v_layout_teams);
      end if;

      update public.sessions set board_drafts = v_drafts,
        board_drafts_version = board_drafts_version + 1
      where id = new.id;
    end if;
  end if;

  -- 증설·축소 모두 코트 목록이 바뀐다. 빈 코트만 바뀌어도 조회 기기가 다시 반영한다.
  update public.sessions set match_state_version = match_state_version + 1 where id = new.id;
  return null;
end;
$function$;

drop trigger if exists trg_sessions_resize_empty_courts on public.sessions;
create trigger trg_sessions_resize_empty_courts
after update of court_count on public.sessions
for each row when (old.court_count is distinct from new.court_count)
execute function public.sessions_resize_empty_courts();

revoke all on function public.sessions_resize_empty_courts() from public, anon, authenticated;

-- 축소 전 화면에서 늦게 도착한 배정도 삭제된 코트에 경기를 만들 수 없다.
create or replace function public.guard_playing_court_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_count integer;
begin
  if new.status = 'playing' then
    select court_count into v_count from public.sessions where id = new.session_id for update;
    if v_count is null or new.court_id is null or new.court_id < 1 or new.court_id > v_count then
      raise exception 'court no longer exists';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_playing_court_number on public.matches;
create trigger trg_guard_playing_court_number
before insert or update of court_id, session_id, status on public.matches
for each row execute function public.guard_playing_court_number();

revoke all on function public.guard_playing_court_number() from public, anon, authenticated;
