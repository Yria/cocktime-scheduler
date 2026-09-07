-- 늦참 시점의 참가자 평균으로 추천용 판수를 보정한다.
-- 평균: 대기/경기 중인 기존 참가자, 콕 체크 ON이면 확인한 사람만.
-- game_count는 완료 판수 + 이전 보정값이며 진행 중인 판은 더하지 않는다.
create or replace function public._session_avg_game_count(p_session_id bigint, p_exclude_id uuid)
returns integer
language sql
stable
set search_path = ''
as $function$
  select coalesce(round(avg(sp.game_count)), 0)::integer
  from public.session_players sp
  join public.sessions s on s.id = sp.session_id
  where sp.session_id = p_session_id
    and sp.status in ('waiting', 'playing')
    and sp.id is distinct from p_exclude_id
    and (not s.cock_check_enabled or sp.cock_checked);
$function$;

-- 콕 체크 OFF: 운영진 추가/일정 참가/승급 등 모든 INSERT 경로에서 합류 보정.
-- ON인 세션도 확인된 상태로 추가한다면 여기서 보정한다.
create or replace function public.session_players_apply_join_baseline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- INSERT ... ON CONFLICT DO UPDATE도 BEFORE INSERT를 호출한다.
  -- 기존 선수의 이름/설정 수정이 새 합류로 처리되지 않도록 제외한다.
  if exists (
    select 1 from public.session_players sp
    where sp.id = new.id
       or (sp.session_id = new.session_id and sp.player_id = new.player_id)
  ) then
    return new;
  end if;

  if new.status in ('waiting', 'playing') and exists (
    select 1 from public.sessions s
    where s.id = new.session_id and (not s.cock_check_enabled or new.cock_checked)
  ) then
    new.game_count := greatest(new.game_count, public._session_avg_game_count(new.session_id, new.id));
    new.wait_since := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sp_apply_join_baseline on public.session_players;
create trigger trg_sp_apply_join_baseline
before insert on public.session_players
for each row execute function public.session_players_apply_join_baseline();

create or replace function public.set_cock_checked(p_session_player_id uuid)
returns setof public.session_players
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session_id bigint;
  v_was_checked boolean;
  v_check_enabled boolean;
  v_avg integer;
begin
  select session_id, cock_checked into v_session_id, v_was_checked
  from public.session_players where id = p_session_player_id
  for update;
  if not found then return; end if;

  if v_was_checked then
    return query select * from public.session_players where id = p_session_player_id;
    return;
  end if;

  select cock_check_enabled into v_check_enabled
  from public.sessions where id = v_session_id;

  if v_check_enabled then
    v_avg := public._session_avg_game_count(v_session_id, p_session_player_id);
    update public.session_players
    set cock_checked = true,
        game_count = greatest(game_count, v_avg),
        wait_since = case when status = 'resting' then wait_since else now() end
    where id = p_session_player_id;
  else
    -- OFF 참가자는 추가/설정 전환 때 보정됨. 확인만으로 다시 보정하지 않는다.
    update public.session_players set cock_checked = true where id = p_session_player_id;
  end if;

  return query select * from public.session_players where id = p_session_player_id;
end;
$function$;

-- 체크를 OFF로 바꾸면 미확인 대기자도 참가 가능해진다.
-- 동시에 추가한 미확인자가 평균을 낮추지 않도록 전환 전 확인된 집단에서 한 번 계산한다.
create or replace function public.sessions_apply_join_baseline_on_cock_disable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_avg integer;
begin
  if old.cock_check_enabled and not new.cock_check_enabled then
    select coalesce(round(avg(game_count)), 0)::integer into v_avg
    from public.session_players
    where session_id = new.id and status in ('waiting', 'playing') and cock_checked;

    update public.session_players
    set game_count = greatest(game_count, v_avg), wait_since = now()
    where session_id = new.id and status = 'waiting' and not cock_checked;
  end if;
  return new;
end;
$function$;

-- AFTER에서 실행: 자식 테이블의 기존 sync_version 트리거가 부모를 갱신할 수 있게 한다.
drop trigger if exists trg_sessions_join_baseline_on_cock_disable on public.sessions;
create trigger trg_sessions_join_baseline_on_cock_disable
after update of cock_check_enabled on public.sessions
for each row execute function public.sessions_apply_join_baseline_on_cock_disable();

revoke execute on function public._session_avg_game_count(bigint, uuid) from public, anon, authenticated;
revoke execute on function public.session_players_apply_join_baseline() from public, anon, authenticated;
revoke execute on function public.sessions_apply_join_baseline_on_cock_disable() from public, anon, authenticated;
revoke execute on function public.set_cock_checked(uuid) from public, anon;
grant execute on function public.set_cock_checked(uuid) to authenticated;
