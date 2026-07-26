-- ============================================================
-- 핫픽스: complete_session_playing_matches() 의 search_path 붕괴로
--         sync_schedule_occurrences() 전체가 롤백되던 문제.
--
-- 증상: 2026-07-26(일) 18:00 KST reveal cron 실패 →
--   "ERROR: relation \"matches\" does not exist"
--   (그 결과 A~E 전 단계 롤백 → draft→open 노출 안 됨 → 회차가 계속 '예정'.
--    cron 뿐 아니라 앱 로드 sync 도 동일 함수를 타므로 자동화 전체가 다운됐음.)
--
-- 원인: complete_session_playing_matches()(20260720010000)는
--   ① 자체 `set search_path` 가 없고
--   ② 테이블을 스키마 없이(matches / session_players / pair_history) 참조한다.
--   이 함수가 sync_schedule_occurrences()(= `set search_path = ''`)의 A단계
--   close UPDATE → 트리거(trg_complete_playing_on_close) 경로로 호출되면,
--   빈 search_path 를 상속받아 `matches` 를 해석하지 못하고 에러 → 상위 sync
--   트랜잭션 통째로 롤백. (앱에서 수동 종료 시엔 호출자 search_path 에 public 이
--   있어 우연히 성공했을 뿐 — sync 경로에서만 재현.)
--
-- 수정: 프로젝트 관례(다른 SECURITY DEFINER 함수들과 동일)대로
--   `set search_path = ''` 를 명시하고 모든 테이블을 `public.` 로 스키마 한정한다.
--   로직/시그니처는 20260720010000 과 동일 — 백필은 이미 그때 실행됐으므로 재실행 안 함.
--   트리거(trg_session_complete_matches_on_close)는 그대로 이 함수를 계속 가리킨다.
-- ============================================================

create or replace function public.complete_session_playing_matches(p_session_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
    from public.matches
    where session_id = p_session_id and status = 'playing'
  loop
    v_is_mixed := (m.game_type = '혼복');

    -- ① 매치 완료 + 시점 스냅샷([a1,a2,b1,b2] 순, 삭제된 선수 슬롯은 null — complete_match 와 동일)
    update public.matches
    set status = 'completed',
        ended_at = v_now,
        player_snapshot = jsonb_build_array(
          (select jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) from public.session_players sp where sp.id = m.team_a_p1),
          (select jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) from public.session_players sp where sp.id = m.team_a_p2),
          (select jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) from public.session_players sp where sp.id = m.team_b_p1),
          (select jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) from public.session_players sp where sp.id = m.team_b_p2)
        )
    where id = m.id and status = 'playing';

    -- ② pair_history: 실재하는 선수만 모아 6쌍(C(n,2)) upsert. 삭제 선수는 제외(FK 위반 방지).
    select array_agg(sp.id) into v_ids
    from public.session_players sp
    where sp.id in (m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2);

    if v_ids is not null then
      for i in 1..array_length(v_ids, 1) loop
        for j in (i + 1)..array_length(v_ids, 1) loop
          insert into public.pair_history (session_id, player_a, player_b, count)
          values (p_session_id, least(v_ids[i], v_ids[j]), greatest(v_ids[i], v_ids[j]), 1)
          on conflict (session_id, player_a, player_b)
          do update set count = pair_history.count + 1;
        end loop;
      end loop;
    end if;

    -- ③ 선수 상태: waiting 복귀 + game_count/mixed_count/wait_since (complete_match 와 동일)
    update public.session_players
    set status = 'waiting',
        wait_since = v_now,
        game_count = game_count + 1,
        mixed_count = case when v_is_mixed and gender = 'M' then mixed_count + 1 else mixed_count end
    where id in (m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2);

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- 트리거 래퍼도 방어적으로 search_path 고정(내부 함수를 public. 로 호출하므로 무해).
create or replace function public.trg_complete_playing_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.complete_session_playing_matches(new.id);
  return null; -- after 트리거: 반환값 무시
end;
$$;
