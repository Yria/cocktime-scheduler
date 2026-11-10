-- 경기 결과 입력 때 '실제 편'을 고칠 수 있게 한다 (설계/계약: docs/MATCH_RESULT_ELO_SPEC.md §0 · §2).
--
-- 왜: 보드는 4명 '그룹'을 뽑을 뿐, 코트에서 누가 누구와 한 편이 될지는 선수들이 정한다. 보드의 A/B 나눔
-- (matches.team_a_*/team_b_*)이 실제 편과 다를 수 있으므로 결과를 넣는 사람이 실제 편을 함께 보낸다.
-- ELO·내 기록은 실제 편을 쓴다. matches 의 로스터(보드 나눔)는 건드리지 않는다 — 보드 기록은 그대로다.
--
-- 이 파일이 하는 일 (20261109000000 은 운영 배포 완료 — 그 파일은 고치지 않는다)
--   1. match_results.teams jsonb — 실제 편의 session_players.id 4개 [a1,a2,b1,b2]. NULL = 보드 나눔(이 파일 이전 행).
--      a1..b2(members.id) 는 계속 '실제 편' 을 뜻한다 — _rating_apply·ratings_recompute_all·RLS 는 그 열만 읽으므로 그대로 맞다.
--   2. p_team_a uuid[](A편을 이룬 session_players.id 2개, NULL = 보드 나눔) 를
--      _match_result_record · member_complete_match · match_result_submit · match_result_admin_set 에 추가.
--      2명·서로 다름·둘 다 그 경기 4명 로스터 안이 아니면 22023 'invalid teams'. winner 'A'/'B' 는 이 실제 A편 기준.
--   3. match_my_history 의 teamA/teamB/mySide 를 실제 편으로(결과가 있으면 teams, 없으면 로스터). 항목마다 spId 추가.
--      로스터의 NULL 칸(선수 행 삭제 → FK SET NULL)은 player_snapshot 의 같은 자리 id 로 메운다(_match_roster).
--      운영진 정정은 a1..b2 를 다시 찾지 않고 기록 때 박제한 멤버를 자리만 옮긴다.
--   4. 옛 시그니처는 지운다(프론트 미배포라 호환 불필요). 새 시그니처마다 revoke/grant 를 다시 적는다.
--
-- 규칙(일정 sync 사고 교훈): 모든 함수 security definer + set search_path = '' + public.* 한정.

-- ── 1. 컬럼 ────────────────────────────────────────────────────────
alter table public.match_results add column if not exists teams jsonb;

-- ── 2. 실제 편 해석 ────────────────────────────────────────────────

-- teams jsonb → uuid[4](순서 유지). JSON null 원소는 NULL.
create or replace function public._match_teams_array(p_teams jsonb)
returns uuid[]
language sql
immutable
security definer
set search_path = ''
as $function$
	select case when jsonb_typeof(p_teams) = 'array' then
		(select array_agg(nullif(e, '')::uuid order by o) from jsonb_array_elements_text(p_teams) with ordinality t(e, o))
	end;
$function$;

-- 경기 로스터 [a1,a2,b1,b2](session_players.id). 선수 행이 지워지면 matches.team_* 는 FK ON DELETE SET NULL
-- (20260616000000)로 NULL 이 되므로, 그 칸은 완료 때 찍은 player_snapshot 의 같은 자리 id 로 메운다
-- (스냅샷은 로스터 순서로 찍히고, 완료 뒤 로스터는 바뀌지 않는다). 안 메우면 기록 화면 이름·정정 때 멤버 연결을 잃는다.
create or replace function public._match_roster(p_ids uuid[], p_snapshot jsonb)
returns uuid[]
language sql
immutable
security definer
set search_path = ''
as $function$
	select array_agg(coalesce(p_ids[i],
		case when jsonb_typeof(p_snapshot) = 'array' then nullif(p_snapshot->(i - 1)->>'id', '')::uuid end) order by i)
	from generate_series(1, 4) i;
$function$;

-- 보드 로스터 + p_team_a → 실제 편 [a1,a2,b1,b2](session_players.id). p_team_a NULL = 보드 나눔 그대로.
-- 각 편 안의 순서는 로스터 순서로 맞춘다(같은 편을 어떤 순서로 보내도 같은 값). 검증 실패는 22023 'invalid teams'.
create or replace function public._match_split(p_match_id uuid, p_team_a uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $function$
DECLARE
  v_roster uuid[];
  v_a uuid[];
  v_b uuid[];
BEGIN
  SELECT public._match_roster(ARRAY[m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2], m.player_snapshot) INTO v_roster
  FROM public.matches m WHERE m.id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_team_a IS NULL THEN
    RETURN v_roster;
  END IF;
  IF array_ndims(p_team_a) IS DISTINCT FROM 1 OR cardinality(p_team_a) <> 2
    OR p_team_a[1] IS NULL OR p_team_a[2] IS NULL OR p_team_a[1] = p_team_a[2]
    OR (p_team_a[1] = ANY (v_roster)) IS NOT TRUE OR (p_team_a[2] = ANY (v_roster)) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid teams' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(x ORDER BY o) INTO v_a FROM unnest(v_roster) WITH ORDINALITY u(x, o) WHERE x = ANY (p_team_a);
  SELECT array_agg(x ORDER BY o) INTO v_b FROM unnest(v_roster) WITH ORDINALITY u(x, o) WHERE x IS NULL OR NOT (x = ANY (p_team_a));
  -- 로스터에 같은 사람이 두 번 들어 있는 등 4칸으로 안 나뉘면 받지 않는다.
  IF coalesce(cardinality(v_a), 0) <> 2 OR coalesce(cardinality(v_b), 0) <> 2 THEN
    RAISE EXCEPTION 'invalid teams' USING ERRCODE = '22023';
  END IF;
  RETURN v_a || v_b;
END;
$function$;

-- 편 비교 키: 두 사람을 정렬해 이은 문자열(순서 무관). NULL 칸은 '-'.
create or replace function public._pair_key(p_ids uuid[])
returns text
language sql
immutable
security definer
set search_path = ''
as $function$
	select string_agg(coalesce(x::text, '-'), ',' order by coalesce(x::text, '-')) from unnest(p_ids) x;
$function$;

-- 기록 화면 한 칸: 그 회차 session_players 행, 지워졌으면 경기 시점 player_snapshot(같은 id 원소)으로 폴백.
create or replace function public._match_slot_json(p_snapshot jsonb, p_sp_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
	select jsonb_build_object(
		'spId', p_sp_id,
		'memberId', sp.member_id,
		'name', coalesce(sp.name, s.e->>'name'),
		'gender', coalesce(sp.gender, s.e->>'gender'))
	from (select 1) one
	left join public.session_players sp on sp.id = p_sp_id
	left join lateral (
		select e from jsonb_array_elements(case when jsonb_typeof(p_snapshot) = 'array' then p_snapshot else '[]'::jsonb end) e
		where e->>'id' = p_sp_id::text
		limit 1
	) s on true;
$function$;

-- ── 3. 결과 기록 ───────────────────────────────────────────────────
-- 옛 3인자판은 지운다(새 판은 p_team_a 를 받는다).
drop function if exists public._match_result_record(uuid, text, uuid);
create or replace function public._match_result_record(p_match_id uuid, p_winner text, p_actor_member uuid, p_team_a uuid[] default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_m public.matches%rowtype;
  v_split uuid[];
  v_a1 uuid;
  v_a2 uuid;
  v_b1 uuid;
  v_b2 uuid;
  v_rated boolean;
BEGIN
  IF p_winner IS NULL OR p_winner NOT IN ('A', 'B') THEN
    RAISE EXCEPTION 'invalid winner' USING ERRCODE = '22023';
  END IF;
  -- 점수 쓰기는 전부 직렬화한다(증분 반영과 전체 재생이 섞이지 않게).
  PERFORM pg_advisory_xact_lock(hashtext('public.member_ratings'));

  SELECT * INTO v_m FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;

  -- 실제 편(p_team_a NULL = 보드 나눔). a1..b2 는 이 실제 편의 members.id 다.
  v_split := public._match_split(p_match_id, p_team_a);
  SELECT sp.member_id INTO v_a1 FROM public.session_players sp WHERE sp.id = v_split[1];
  SELECT sp.member_id INTO v_a2 FROM public.session_players sp WHERE sp.id = v_split[2];
  SELECT sp.member_id INTO v_b1 FROM public.session_players sp WHERE sp.id = v_split[3];
  SELECT sp.member_id INTO v_b2 FROM public.session_players sp WHERE sp.id = v_split[4];

  v_rated := v_m.game_type IS DISTINCT FROM '혼합'
    AND v_a1 IS NOT NULL AND v_a2 IS NOT NULL AND v_b1 IS NOT NULL AND v_b2 IS NOT NULL
    AND (SELECT count(DISTINCT x) FROM unnest(ARRAY[v_a1, v_a2, v_b1, v_b2]) x) = 4;

  INSERT INTO public.match_results (match_id, session_id, game_type, a1, a2, b1, b2, teams, winner, rated, recorded_by)
  VALUES (p_match_id, v_m.session_id, v_m.game_type, v_a1, v_a2, v_b1, v_b2, to_jsonb(v_split), p_winner, v_rated, p_actor_member)
  ON CONFLICT (match_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM public._rating_apply(p_match_id);
  RETURN true;
END;
$function$;

-- ── 4. 회원 완료 ───────────────────────────────────────────────────
-- 20261109000000 판과 같고, p_team_a 를 결과 기록까지 넘긴다(p_winner 가 NULL 이면 p_team_a 는 쓰지 않는다).
-- 편 검증 실패는 결과 기록 단계에서 나고, 한 트랜잭션이라 완료까지 함께 되돌려진다.
drop function if exists public.member_complete_match(uuid, bigint, text);
create or replace function public.member_complete_match(p_match_id uuid, p_session_id bigint, p_winner text default null, p_team_a uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_me uuid := public.current_member_id();
  v_session public.sessions%rowtype;
  v_m public.matches%rowtype;
  v_players jsonb;
  v_result jsonb := NULL;
BEGIN
  IF p_winner IS NOT NULL AND p_winner NOT IN ('A', 'B') THEN
    RAISE EXCEPTION 'invalid winner' USING ERRCODE = '22023';
  END IF;

  -- 잠금 순서 sessions → matches(배정·로스터 수정·운영진 완료와 같다).
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR NOT v_session.is_active OR v_session.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'session not active' USING ERRCODE = '55000';
  END IF;

  -- 로스터 판정은 상태와 무관하게 한다(이미 완료된 경기의 로스터 회원에게는 '이미 완료' 를 돌려줘야 한다).
  SELECT * INTO v_m FROM public.matches WHERE id = p_match_id AND session_id = p_session_id;
  IF FOUND AND (v_me IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.session_players sp
    WHERE sp.id IN (v_m.team_a_p1, v_m.team_a_p2, v_m.team_b_p1, v_m.team_b_p2)
      AND sp.member_id = v_me
  )) THEN
    RAISE EXCEPTION 'not in match' USING ERRCODE = '42501';
  END IF;

  -- 완료 갱신(이미 완료·없음이면 'Match already completed or not found').
  SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_players
  FROM public._complete_match_apply(p_match_id, p_session_id, v_m.game_type) p;

  INSERT INTO public.match_completion_grants (match_id, session_id, court_id, member_id)
  VALUES (p_match_id, p_session_id, v_m.court_id, v_me);

  IF p_winner IS NOT NULL THEN
    PERFORM public._match_result_record(p_match_id, p_winner, v_me, p_team_a);
    v_result := public._match_result_json(p_match_id, v_me);
  END IF;

  RETURN jsonb_build_object('players', v_players, 'result', v_result, 'courtId', v_m.court_id);
END;
$function$;

-- ── 5. 결과 보충/입력 ──────────────────────────────────────────────
-- 20261109000000 판과 같고 p_team_a 만 더했다. 결과가 이미 있으면(첫 입력 확정) 편도 바꾸지 않는다.
-- 편 검증은 'exists' 판정보다 먼저 — 잘못된 요청이 기존 결과 응답으로 묻히지 않게.
drop function if exists public.match_result_submit(uuid, text);
create or replace function public.match_result_submit(p_match_id uuid, p_winner text, p_team_a uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_me uuid := public.current_member_id();
  v_m public.matches%rowtype;
  v_inserted boolean;
BEGIN
  IF p_winner IS NULL OR p_winner NOT IN ('A', 'B') THEN
    RAISE EXCEPTION 'invalid winner' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_m FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_admin() AND (v_me IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.session_players sp
    WHERE sp.id IN (v_m.team_a_p1, v_m.team_a_p2, v_m.team_b_p1, v_m.team_b_p2)
      AND sp.member_id = v_me
  )) THEN
    RAISE EXCEPTION 'not in match' USING ERRCODE = '42501';
  END IF;
  PERFORM public._match_split(p_match_id, p_team_a);

  IF EXISTS (SELECT 1 FROM public.match_results WHERE match_id = p_match_id) THEN
    RETURN public._match_result_json(p_match_id, v_me) || jsonb_build_object('status', 'exists');
  END IF;
  IF v_m.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'match not completed' USING ERRCODE = '55000';
  END IF;
  IF v_m.ended_at IS NULL OR v_m.ended_at <= now() - interval '7 days' THEN
    RAISE EXCEPTION 'result window closed' USING ERRCODE = '55000';
  END IF;

  v_inserted := public._match_result_record(p_match_id, p_winner, v_me, p_team_a);
  RETURN public._match_result_json(p_match_id, v_me)
    || jsonb_build_object('status', CASE WHEN v_inserted THEN 'recorded' ELSE 'exists' END);
END;
$function$;

-- ── 6. 운영진 정정 ─────────────────────────────────────────────────
-- winner·실제 편을 바꾸거나(NULL winner = 삭제) 없던 결과를 넣는다. 기간 제한 없음. 바뀌면 전부 재생.
--   p_team_a: 결과가 이미 있으면 NULL = '기록된 편 그대로'(승자만 고치는 정정이 편을 보드 나눔으로 되돌리지 않게),
--             결과가 없으면 NULL = 보드 나눔.
--   '이긴 두 사람·진 두 사람' 이 같으면 A/B 표기만 달라도 unchanged(점수가 같다).
--   반환: _match_result_json(삭제면 {"matchId"}) || {"status": "recorded" | "corrected" | "deleted" | "unchanged"}
drop function if exists public.match_result_admin_set(uuid, text);
create or replace function public.match_result_admin_set(p_match_id uuid, p_winner text, p_team_a uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_me uuid := public.current_member_id();
  v_status text;
  v_old public.match_results%rowtype;
  v_old_split uuid[];
  v_new_split uuid[];
  v_old_win text;
  v_old_lose text;
  v_new_win text;
  v_new_lose text;
  v_old_mem uuid[];
  v_new_mem uuid[] := ARRAY[NULL, NULL, NULL, NULL]::uuid[];
  v_pos integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF p_winner IS NOT NULL AND p_winner NOT IN ('A', 'B') THEN
    RAISE EXCEPTION 'invalid winner' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.matches WHERE id = p_match_id AND status = 'completed') THEN
    RAISE EXCEPTION 'match not completed' USING ERRCODE = '55000';
  END IF;
  IF p_team_a IS NOT NULL THEN
    v_new_split := public._match_split(p_match_id, p_team_a);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('public.member_ratings'));
  SELECT * INTO v_old FROM public.match_results WHERE match_id = p_match_id FOR UPDATE;

  IF p_winner IS NULL THEN
    DELETE FROM public.match_results WHERE match_id = p_match_id;
    v_status := CASE WHEN v_old.match_id IS NULL THEN 'unchanged' ELSE 'deleted' END;
  ELSIF v_old.match_id IS NULL THEN
    PERFORM public._match_result_record(p_match_id, p_winner, v_me, p_team_a);
    v_status := 'recorded';
  ELSE
    v_old_split := coalesce(public._match_teams_array(v_old.teams), public._match_split(p_match_id, NULL));
    v_new_split := coalesce(v_new_split, v_old_split);
    v_old_win := public._pair_key(CASE WHEN v_old.winner = 'A' THEN v_old_split[1:2] ELSE v_old_split[3:4] END);
    v_old_lose := public._pair_key(CASE WHEN v_old.winner = 'A' THEN v_old_split[3:4] ELSE v_old_split[1:2] END);
    v_new_win := public._pair_key(CASE WHEN p_winner = 'A' THEN v_new_split[1:2] ELSE v_new_split[3:4] END);
    v_new_lose := public._pair_key(CASE WHEN p_winner = 'A' THEN v_new_split[3:4] ELSE v_new_split[1:2] END);
    IF v_old_win = v_new_win AND v_old_lose = v_new_lose THEN
      v_status := 'unchanged';
    ELSE
      -- 멤버는 기록 때 박제한 a1..b2 를 자리만 옮긴다(실제 편은 같은 4명의 재분할이다). 지금 session_players 로
      -- 다시 찾으면 그 사이 지워진 선수 칸이 NULL 이 되어 재생이 경기째 건너뛴다. 옛 칸에 없는 id 만 새로 찾는다.
      v_old_mem := ARRAY[v_old.a1, v_old.a2, v_old.b1, v_old.b2];
      FOR i IN 1..4 LOOP
        v_pos := array_position(v_old_split, v_new_split[i]);
        IF v_pos IS NOT NULL THEN
          v_new_mem[i] := v_old_mem[v_pos];
        ELSE
          v_new_mem[i] := (SELECT sp.member_id FROM public.session_players sp WHERE sp.id = v_new_split[i]);
        END IF;
      END LOOP;
      UPDATE public.match_results r
      SET winner = p_winner,
          teams = to_jsonb(v_new_split),
          a1 = v_new_mem[1],
          a2 = v_new_mem[2],
          b1 = v_new_mem[3],
          b2 = v_new_mem[4],
          corrected_by = v_me,
          corrected_at = now()
      WHERE r.match_id = p_match_id;
      v_status := 'corrected';
    END IF;
  END IF;

  -- 새로 넣은 결과도 과거 경기라 증분 순서가 어긋나므로 재생한다.
  IF v_status <> 'unchanged' THEN
    PERFORM public.ratings_recompute_all();
  END IF;

  RETURN coalesce(public._match_result_json(p_match_id, v_me), jsonb_build_object('matchId', p_match_id))
    || jsonb_build_object('status', v_status);
END;
$function$;

-- ── 7. 내 기록 ─────────────────────────────────────────────────────
-- 20261109000000 판과 같은 시그니처·모양. teamA/teamB/mySide 는 실제 편(결과의 teams, 없으면 로스터)이고
-- 칸마다 spId(session_players.id)를 더했다 — 보충 화면이 실제 편을 다시 보낼 때 쓴다.
-- '내가 뛴 경기' 판정은 로스터 4명 기준 그대로(편이 바뀌어도 4명은 같다).
create or replace function public.match_my_history(p_limit integer default 30, p_before timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
DECLARE
  v_me uuid := public.current_member_id();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'member required' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(item ORDER BY ended_at DESC, match_id)
    FROM (
      SELECT m.id AS match_id, m.ended_at,
        jsonb_build_object(
          'matchId', m.id,
          'sessionId', m.session_id,
          'endedAt', m.ended_at,
          'gameType', m.game_type,
          'courtId', m.court_id,
          'mySide', CASE WHEN v_me IN ((p.a1->>'memberId')::uuid, (p.a2->>'memberId')::uuid) THEN 'A' ELSE 'B' END,
          'teamA', jsonb_build_array(p.a1, p.a2),
          'teamB', jsonb_build_array(p.b1, p.b2),
          'winner', r.winner,
          'rated', coalesce(r.rated, false),
          'delta', e.delta,
          'ratingAfter', e.after,
          'canSubmit', (r.match_id IS NULL AND m.ended_at > now() - interval '7 days')
        ) AS item
      FROM public.matches m
      LEFT JOIN public.match_results r ON r.match_id = m.id
      LEFT JOIN public.rating_events e ON e.match_id = m.id AND e.member_id = v_me
      CROSS JOIN LATERAL (
        SELECT coalesce(public._match_teams_array(r.teams),
                        public._match_roster(ARRAY[m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2], m.player_snapshot)) AS ids
      ) s
      CROSS JOIN LATERAL (
        SELECT public._match_slot_json(m.player_snapshot, s.ids[1]) AS a1,
               public._match_slot_json(m.player_snapshot, s.ids[2]) AS a2,
               public._match_slot_json(m.player_snapshot, s.ids[3]) AS b1,
               public._match_slot_json(m.player_snapshot, s.ids[4]) AS b2
      ) p
      WHERE m.status = 'completed'
        AND m.id IN (
          SELECT mm.id FROM public.session_players sp
          JOIN public.matches mm ON mm.session_id = sp.session_id
            AND sp.id IN (mm.team_a_p1, mm.team_a_p2, mm.team_b_p1, mm.team_b_p2)
          WHERE sp.member_id = v_me
        )
        AND (p_before IS NULL OR m.ended_at < p_before)
      ORDER BY m.ended_at DESC, m.id
      LIMIT greatest(1, least(coalesce(p_limit, 30), 100))
    ) t
  ), '[]'::jsonb);
END;
$function$;

-- ── 8. 실행 권한 ───────────────────────────────────────────────────
-- 내부 함수: 전부 회수.
revoke execute on function public._match_teams_array(jsonb) from public, anon, authenticated;
revoke execute on function public._match_roster(uuid[], jsonb) from public, anon, authenticated;
revoke execute on function public._match_split(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public._pair_key(uuid[]) from public, anon, authenticated;
revoke execute on function public._match_slot_json(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public._match_result_record(uuid, text, uuid, uuid[]) from public, anon, authenticated;

-- 회원 RPC: authenticated 만.
revoke execute on function public.member_complete_match(uuid, bigint, text, uuid[]) from public, anon;
revoke execute on function public.match_result_submit(uuid, text, uuid[]) from public, anon;
revoke execute on function public.match_result_admin_set(uuid, text, uuid[]) from public, anon;
revoke execute on function public.match_my_history(integer, timestamptz) from public, anon;
grant execute on function public.member_complete_match(uuid, bigint, text, uuid[]) to authenticated;
grant execute on function public.match_result_submit(uuid, text, uuid[]) to authenticated;
grant execute on function public.match_result_admin_set(uuid, text, uuid[]) to authenticated;
grant execute on function public.match_my_history(integer, timestamptz) to authenticated;
