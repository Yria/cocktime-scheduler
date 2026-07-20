-- ============================================================
-- 세션 종료 시 진행중(playing) 매치 자동 완료 처리
--
-- 배경: 세션이 closed 로 전환될 때 코트에서 아직 진행중이던 매치(status='playing')는
--   그대로 방치됐다. 그 결과:
--   - 경기 로그(fetchMatchLogs, status='completed'만)에서 그 경기가 안 보임
--   - game_count / pair_history 미반영으로 정모 통계·출전수가 실제보다 적게 집계
--   실제로 과거 closed 세션 전반에 playing 매치가 다수 잔존(도입 시점 백필로 정리).
--
-- 종료 경로가 여러 곳이라(수동 종료 dbEndSession=sessionStore, 종료시각 지난 세션 일괄
--   자동종료=scheduleStore, 반복일정 정리 등 전부 sessions.status='closed' UPDATE) 단일
--   초크포인트인 **트리거**로 잡는다.
--
-- 완료 처리 로직은 complete_match RPC(20260624020000)와 동일 효과를 낸다:
--   ① matches: status='completed', ended_at, player_snapshot(시점 스냅샷)
--   ② pair_history: 같은 경기 4명의 6쌍 +1
--   ③ session_players: waiting 복귀 + game_count +1 + (혼복 남자) mixed_count +1 + wait_since
--   단, 시스템 동작이므로 board_assert_editor(편집락) 가드는 두지 않는다.
--   백필 견고성: 스냅샷 선수가 삭제됐어도(pair_history FK 위반 방지) 실재 선수만 대상으로 한다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 세션의 playing 매치 전부를 완료 처리하는 재사용 함수. 완료 건수 반환.
-- ------------------------------------------------------------
create or replace function public.complete_session_playing_matches(p_session_id bigint)
returns integer as $$
declare
  m         record;
  v_now     timestamptz := now();
  v_is_mixed boolean;
  v_ids     uuid[];
  i int;
  j int;
  v_n int := 0;
begin
  for m in
    select id, game_type, team_a_p1, team_a_p2, team_b_p1, team_b_p2
    from matches
    where session_id = p_session_id and status = 'playing'
  loop
    v_is_mixed := (m.game_type = '혼복');

    -- ① 매치 완료 + 시점 스냅샷([a1,a2,b1,b2] 순, 삭제된 선수 슬롯은 null — complete_match 와 동일)
    update matches
    set status = 'completed',
        ended_at = v_now,
        player_snapshot = jsonb_build_array(
          (select jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) from session_players sp where sp.id = m.team_a_p1),
          (select jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) from session_players sp where sp.id = m.team_a_p2),
          (select jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) from session_players sp where sp.id = m.team_b_p1),
          (select jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) from session_players sp where sp.id = m.team_b_p2)
        )
    where id = m.id and status = 'playing';

    -- ② pair_history: 실재하는 선수만 모아 6쌍(C(n,2)) upsert. 삭제 선수는 제외(FK 위반 방지).
    select array_agg(sp.id) into v_ids
    from session_players sp
    where sp.id in (m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2);

    if v_ids is not null then
      for i in 1..array_length(v_ids, 1) loop
        for j in (i + 1)..array_length(v_ids, 1) loop
          insert into pair_history (session_id, player_a, player_b, count)
          values (p_session_id, least(v_ids[i], v_ids[j]), greatest(v_ids[i], v_ids[j]), 1)
          on conflict (session_id, player_a, player_b)
          do update set count = pair_history.count + 1;
        end loop;
      end loop;
    end if;

    -- ③ 선수 상태: waiting 복귀 + game_count/mixed_count/wait_since (complete_match 와 동일)
    update session_players
    set status = 'waiting',
        wait_since = v_now,
        game_count = game_count + 1,
        mixed_count = case when v_is_mixed and gender = 'M' then mixed_count + 1 else mixed_count end
    where id in (m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2);

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$ language plpgsql security definer;

-- ------------------------------------------------------------
-- 2. 세션 종료(closed) 트리거 — 모든 종료 경로 공통.
--    trg_session_court_on_close(대관비, 20260715080000)와 동일 타이밍(after update of status).
--    두 트리거는 이름 알파벳순으로 complete→court 순 발화하며, 대관비는 attendances 기준이라 상호 독립.
-- ------------------------------------------------------------
create or replace function public.trg_complete_playing_on_close()
returns trigger as $$
begin
  perform public.complete_session_playing_matches(new.id);
  return null; -- after 트리거: 반환값 무시
end;
$$ language plpgsql security definer;

drop trigger if exists trg_session_complete_matches_on_close on public.sessions;
create trigger trg_session_complete_matches_on_close
  after update of status on public.sessions
  for each row
  when (new.status = 'closed' and old.status is distinct from 'closed')
  execute function public.trg_complete_playing_on_close();

-- ------------------------------------------------------------
-- 3. 일회성 백필 — 트리거 도입 전 이미 closed 인데 playing 매치가 남은 과거 세션 정리.
--    함수가 status='playing' 만 대상으로 하므로 멱등(재실행/replay 안전).
--    주의: 백필 player_snapshot 은 경기 '시점'이 아닌 '적용 시점(now())'의 session_players 값을
--    기록한다(complete_match 와 동일하게 live 행을 읽음). name/gender 는 세션 시작 스냅샷 이후
--    갱신 경로가 없어 사실상 불변, skills 는 사후 변경 가능하나 로그 표시 전용이라 회계·정합성 무영향.
-- ------------------------------------------------------------
do $$
declare
  r record;
  v_total int := 0;
  v_n int;
begin
  for r in select id from sessions where status = 'closed' loop
    v_n := public.complete_session_playing_matches(r.id);
    v_total := v_total + v_n;
  end loop;
  raise notice 'backfill: completed % playing matches in closed sessions', v_total;
end $$;
