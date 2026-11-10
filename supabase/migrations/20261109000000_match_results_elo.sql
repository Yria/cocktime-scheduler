-- 경기 결과 입력 · ELO 등급 — DB 측 (설계/계약: docs/MATCH_RESULT_ELO_SPEC.md §1, §2)
--
-- 이 파일이 하는 일
--   1. 테이블 4개: match_results · member_ratings · rating_events · match_completion_grants
--   2. ELO 상수 함수 elo_seed / elo_k (클라 src/lib/rating/elo.ts 가 같은 값을 미러한다)
--   3. complete_match 의 갱신부를 _complete_match_apply 로 빼고, 회원 완료 member_complete_match 가 같은 갱신을 쓴다
--   4. 결과 기록 _match_result_record · 점수 반영 _rating_apply · 전체 재생 ratings_recompute_all
--   5. 회원/운영진 RPC: match_result_submit · match_result_admin_set · rating_my_summary · match_my_history ·
--      member_commit_completion_drafts(후보 배열 중 '같이 매칭하지 않기'를 안 어기는 첫 후보 저장 —
--      내부 _completion_team_sets · _completion_avoid_violation)
--
-- 규칙(일정 sync 사고 교훈): 모든 함수는 set search_path = '' 이고 객체는 전부 public.* 로 한정한다.
-- 잠금 순서: sessions → matches → (advisory 'elo') → member_ratings(member_id 순). 어느 경로도 거꾸로 잡지 않는다.
--
-- ELO 는 v1 에서 표시용(뱃지 테두리)이다. 팀 편성 알고리즘은 이 점수를 읽지 않는다.

-- ── 1. 테이블 ──────────────────────────────────────────────────────

-- 경기 1건당 결과 1행. a1..b2 는 session_players 가 아니라 members.id 로 박제한다 — session_players 는
-- 회차마다 새로 생기는 행이라 점수의 주인(영속 신원)이 될 수 없다. 게스트·브리지 없는 선수는 NULL.
create table if not exists public.match_results (
	match_id     uuid primary key references public.matches(id) on delete cascade,
	session_id   bigint,
	game_type    text,
	a1           uuid references public.members(id) on delete set null,
	a2           uuid references public.members(id) on delete set null,
	b1           uuid references public.members(id) on delete set null,
	b2           uuid references public.members(id) on delete set null,
	winner       text not null check (winner in ('A', 'B')),
	rated        boolean not null,
	recorded_by  uuid references public.members(id) on delete set null,
	recorded_at  timestamptz not null default now(),
	corrected_by uuid references public.members(id) on delete set null,
	corrected_at timestamptz
);
-- 본인 경기 조회(RLS)·내 기록이 4슬롯 중 하나로 찾는다.
create index if not exists idx_match_results_a1 on public.match_results(a1);
create index if not exists idx_match_results_a2 on public.match_results(a2);
create index if not exists idx_match_results_b1 on public.match_results(b1);
create index if not exists idx_match_results_b2 on public.match_results(b2);

-- 회원별 현재 점수. 첫 반영 때 lazily 생긴다(행이 없으면 seed 로 본다).
create table if not exists public.member_ratings (
	member_id  uuid primary key references public.members(id) on delete cascade,
	rating     integer not null,
	games      integer not null default 0,
	wins       integer not null default 0,
	losses     integer not null default 0,
	updated_at timestamptz
);

-- 반영 1건 = 경기 × 회원 1행. 내 기록의 Δ·반영 후 점수가 여기서 나온다.
create table if not exists public.rating_events (
	id         bigserial primary key,
	match_id   uuid references public.matches(id) on delete cascade,
	member_id  uuid references public.members(id) on delete cascade,
	before     integer,
	after      integer,
	delta      integer,
	expected   numeric,
	won        boolean,
	created_at timestamptz not null default now(),
	unique (match_id, member_id)
);
create index if not exists idx_rating_events_member on public.rating_events(member_id);

-- 회원이 경기를 완료하면 그 코트 그룹의 보드 편성을 '한 번' 저장할 권한을 준다.
-- 편집락(editor_*)을 열어 주는 대신 경기 단위 1회 토큰으로 범위를 좁힌다(전역 편집권 아님).
create table if not exists public.match_completion_grants (
	match_id   uuid primary key references public.matches(id) on delete cascade,
	session_id bigint,
	court_id   int,
	member_id  uuid references public.members(id) on delete cascade,
	created_at timestamptz not null default now(),
	used_at    timestamptz
);

-- RLS: 직접 쓰기 정책은 없다(RPC 전용). select 만 본인·운영진.
alter table public.match_results enable row level security;
alter table public.member_ratings enable row level security;
alter table public.rating_events enable row level security;
alter table public.match_completion_grants enable row level security;

-- Supabase 기본 권한은 새 테이블에 anon/authenticated 의 ALL(TRUNCATE 포함)을 준다. TRUNCATE 는 RLS 를
-- 타지 않으므로 쓰기 권한은 아예 회수하고 select 만 남긴다. grants 는 클라가 읽을 일도 없다.
revoke all on table public.match_results, public.member_ratings, public.rating_events, public.match_completion_grants from public, anon, authenticated;
grant select on table public.match_results, public.member_ratings, public.rating_events to authenticated;
revoke all on sequence public.rating_events_id_seq from public, anon, authenticated;

-- (select …) 로 감싸 행마다 재평가되지 않게 한다(20260817030000 의 auth_rls_initplan 정리와 같은 이유).
drop policy if exists match_results_select on public.match_results;
create policy match_results_select on public.match_results
	for select to authenticated
	using (
		(select public.current_member_id()) in (a1, a2, b1, b2)
		or (select public.is_admin())
	);

drop policy if exists member_ratings_select on public.member_ratings;
create policy member_ratings_select on public.member_ratings
	for select to authenticated
	using (member_id = (select public.current_member_id()) or (select public.is_admin()));

drop policy if exists rating_events_select on public.rating_events;
create policy rating_events_select on public.rating_events
	for select to authenticated
	using (member_id = (select public.current_member_id()) or (select public.is_admin()));

-- ── 2. ELO 상수 ────────────────────────────────────────────────────
--   시작 점수: 1000 + 100 × grade(1~10). grade 없음/0/범위 밖 → 1500(중간값).
--   개인 K: 반영 경기 < 10 → 40(배치, 빨리 제자리 찾기), 아니면 20.
--   팀 전력 0.6/0.4·척도 400 은 _rating_apply 본문에 있다. 클라 elo.ts 가 이 파일 숫자를 grep 해 일치를 검사한다.
create or replace function public.elo_seed(p_grade integer)
returns integer
language sql
immutable
security definer
set search_path = ''
as $function$
	select case when p_grade between 1 and 10 then 1000 + 100 * p_grade else 1500 end;
$function$;

create or replace function public.elo_k(p_games integer)
returns integer
language sql
immutable
security definer
set search_path = ''
as $function$
	select case when coalesce(p_games, 0) < 10 then 40 else 20 end;
$function$;

-- members.skills->>'grade' 를 안전하게 정수로. 숫자가 아니면 NULL(→ seed 1500). 캐스트 실패로 결과 기록 전체가
-- 롤백되는 일을 막는다.
create or replace function public._member_seed(p_member_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
	select public.elo_seed(
		(select case when m.skills->>'grade' ~ '^[0-9]{1,2}$' then (m.skills->>'grade')::integer end
		 from public.members m where m.id = p_member_id)
	);
$function$;

-- ── 3. 완료 갱신 공통부 ───────────────────────────────────────────
--   20261012000000 complete_match 의 1·3·4·5 단계를 그대로 옮겼다. 잠금·편집 가드는 호출자 몫이다.
--   p_game_type 은 mixed_count 판정용(운영진 경로는 기존처럼 클라가 넘긴 값, 회원 경로는 matches.game_type).
create or replace function public._complete_match_apply(p_match_id uuid, p_session_id bigint, p_game_type text)
returns setof public.session_players
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_is_mixed BOOLEAN := (p_game_type = '혼복');
  v_a1 UUID;
  v_a2 UUID;
  v_b1 UUID;
  v_b2 UUID;
BEGIN
  -- 1. 매치 완료 처리 + 선수 스냅샷 기록(동시성 제어: playing인 경우만). SET 의 m.* 는 갱신 전 값이다.
  UPDATE public.matches m
  SET status = 'completed',
      ended_at = v_now,
      player_snapshot = jsonb_build_array(
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM public.session_players sp WHERE sp.id = m.team_a_p1),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM public.session_players sp WHERE sp.id = m.team_a_p2),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM public.session_players sp WHERE sp.id = m.team_b_p1),
        (SELECT jsonb_build_object('id', sp.id, 'name', sp.name, 'gender', sp.gender, 'skills', sp.skills) FROM public.session_players sp WHERE sp.id = m.team_b_p2)
      )
  WHERE m.id = p_match_id AND m.session_id = p_session_id AND m.status = 'playing'
  RETURNING m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2 INTO v_a1, v_a2, v_b1, v_b2;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match already completed or not found';
  END IF;

  -- 3. 선수 상태 업데이트: waiting 복귀 + game_count 증가 + (혼복 남자) mixed_count 증가
  UPDATE public.session_players
  SET status = 'waiting',
      wait_since = v_now,
      game_count = game_count + 1,
      mixed_count = CASE
        WHEN v_is_mixed AND gender = 'M' THEN mixed_count + 1
        ELSE mixed_count
      END
  WHERE id IN (v_a1, v_a2, v_b1, v_b2) AND session_id = p_session_id;

  -- 4. 동기화 신호: 코트가 비워졌음을 catch-up 으로 알린다.
  UPDATE public.sessions SET match_state_version = match_state_version + 1 WHERE id = p_session_id;

  -- 5. 업데이트된 선수 데이터 반환
  RETURN QUERY
  SELECT * FROM public.session_players
  WHERE id IN (v_a1, v_a2, v_b1, v_b2) AND session_id = p_session_id;
END;
$function$;

-- complete_match: 가드(세션 잠금 → 편집 락)와 반환은 20261012000000 그대로, 갱신만 공통부 호출로 바꿨다.
create or replace function public.complete_match(p_match_id uuid, p_session_id bigint, p_game_type text, p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid, p_client_id text default null::text, p_name text default null::text, p_lease_seconds integer default 20)
returns setof public.session_players
language plpgsql
security definer
set search_path = ''
as $function$
BEGIN
  -- -1. 세션 잠금 — 배정·로스터 수정과 같은 순서(sessions → matches)로 잠가 교착을 피한다.
  PERFORM 1 FROM public.sessions WHERE id = p_session_id FOR UPDATE;

  -- 0. 편집 락 가드
  PERFORM public.board_assert_editor(p_session_id, p_client_id, p_name, p_lease_seconds);

  -- 1~5. 완료 갱신(p_team_* 는 시그니처 호환용 — 갱신은 matches 의 실제 로스터로 한다)
  RETURN QUERY SELECT * FROM public._complete_match_apply(p_match_id, p_session_id, p_game_type);
END;
$function$;

-- ── 4. 점수 반영 ───────────────────────────────────────────────────
--   match_results 1행을 member_ratings/rating_events 에 반영한다. 증분 기록과 전체 재생이 같은 함수를 쓴다.
--   팀 전력 = 0.6 × 약한 쪽 + 0.4 × 강한 쪽(복식은 약한 쪽이 집중 공략당한다).
--   기대 승률 E_A = 1 / (1 + 10^((R_B − R_A)/400)). Δ = round(K × (S − E)), 같은 팀은 같은 E·각자 K.
--   round 는 numeric round(.5 는 0에서 먼 쪽). 클라 미러도 같은 반올림을 써야 한다.
create or replace function public._rating_apply(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_r public.match_results%rowtype;
  v_ids uuid[];
  v_rating jsonb := '{}'::jsonb;  -- member_id → 반영 전 rating
  v_games jsonb := '{}'::jsonb;   -- member_id → 반영 전 games
  v_row record;
  v_ra numeric;
  v_rb numeric;
  v_ea numeric;
  v_id uuid;
  v_won boolean;
  v_e numeric;
  v_before integer;
  v_delta integer;
BEGIN
  SELECT * INTO v_r FROM public.match_results WHERE match_id = p_match_id;
  IF NOT FOUND OR NOT v_r.rated THEN
    RETURN;
  END IF;
  v_ids := ARRAY[v_r.a1, v_r.a2, v_r.b1, v_r.b2];
  -- 회원 하드삭제로 슬롯이 비었거나(set null) 이미 반영된 경기는 건너뛴다(재생이 끝까지 가도록).
  IF array_position(v_ids, NULL) IS NOT NULL
    OR (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> 4
    OR EXISTS (SELECT 1 FROM public.rating_events e WHERE e.match_id = p_match_id) THEN
    RETURN;
  END IF;

  -- 없으면 seed 로 만든다(첫 반영 때 lazily).
  INSERT INTO public.member_ratings (member_id, rating, updated_at)
  SELECT x, public._member_seed(x), now() FROM unnest(v_ids) x
  ON CONFLICT (member_id) DO NOTHING;

  -- member_id 순으로 잠가 동시 반영 간 교착을 피한다.
  FOR v_row IN
    SELECT mr.member_id, mr.rating, mr.games FROM public.member_ratings mr
    WHERE mr.member_id = ANY(v_ids) ORDER BY mr.member_id FOR UPDATE
  LOOP
    v_rating := v_rating || jsonb_build_object(v_row.member_id::text, v_row.rating);
    v_games := v_games || jsonb_build_object(v_row.member_id::text, v_row.games);
  END LOOP;

  v_ra := 0.6 * least((v_rating->>v_r.a1::text)::numeric, (v_rating->>v_r.a2::text)::numeric)
        + 0.4 * greatest((v_rating->>v_r.a1::text)::numeric, (v_rating->>v_r.a2::text)::numeric);
  v_rb := 0.6 * least((v_rating->>v_r.b1::text)::numeric, (v_rating->>v_r.b2::text)::numeric)
        + 0.4 * greatest((v_rating->>v_r.b1::text)::numeric, (v_rating->>v_r.b2::text)::numeric);
  v_ea := 1 / (1 + power(10::numeric, (v_rb - v_ra) / 400));

  FOREACH v_id IN ARRAY v_ids LOOP
    IF v_id = v_r.a1 OR v_id = v_r.a2 THEN
      v_won := (v_r.winner = 'A');
      v_e := v_ea;
    ELSE
      v_won := (v_r.winner = 'B');
      v_e := 1 - v_ea;
    END IF;
    v_before := (v_rating->>v_id::text)::integer;
    v_delta := round(public.elo_k((v_games->>v_id::text)::integer) * ((CASE WHEN v_won THEN 1 ELSE 0 END) - v_e))::integer;

    UPDATE public.member_ratings
    SET rating = v_before + v_delta,
        games = games + 1,
        wins = wins + (CASE WHEN v_won THEN 1 ELSE 0 END),
        losses = losses + (CASE WHEN v_won THEN 0 ELSE 1 END),
        updated_at = now()
    WHERE member_id = v_id;

    INSERT INTO public.rating_events (match_id, member_id, before, after, delta, expected, won)
    VALUES (p_match_id, v_id, v_before, v_before + v_delta, v_delta, round(v_e, 4), v_won);
  END LOOP;
END;
$function$;

-- 결과 1건 기록. 로스터의 session_players.member_id 4명을 해석해 박제하고, 반영 가능하면 바로 반영한다.
--   미반영(rated=false): 혼합 경기 / member_id NULL 인 선수 / 4명이 다 안 채워짐.
--   첫 입력이 확정: 이미 있으면 아무것도 바꾸지 않고 false. 새로 넣었으면 true.
create or replace function public._match_result_record(p_match_id uuid, p_winner text, p_actor_member uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_m public.matches%rowtype;
  v_a1 uuid;
  v_a2 uuid;
  v_b1 uuid;
  v_b2 uuid;
  v_rated boolean;
BEGIN
  IF p_winner IS NULL OR p_winner NOT IN ('A', 'B') THEN
    RAISE EXCEPTION 'invalid winner' USING ERRCODE = '22023';
  END IF;
  -- 점수 쓰기는 전부 직렬화한다(증분 반영과 전체 재생이 섞이지 않게). 결과 입력은 드물어 경합 비용이 없다.
  PERFORM pg_advisory_xact_lock(hashtext('public.member_ratings'));

  SELECT * INTO v_m FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT sp.member_id INTO v_a1 FROM public.session_players sp WHERE sp.id = v_m.team_a_p1;
  SELECT sp.member_id INTO v_a2 FROM public.session_players sp WHERE sp.id = v_m.team_a_p2;
  SELECT sp.member_id INTO v_b1 FROM public.session_players sp WHERE sp.id = v_m.team_b_p1;
  SELECT sp.member_id INTO v_b2 FROM public.session_players sp WHERE sp.id = v_m.team_b_p2;

  v_rated := v_m.game_type IS DISTINCT FROM '혼합'
    AND v_a1 IS NOT NULL AND v_a2 IS NOT NULL AND v_b1 IS NOT NULL AND v_b2 IS NOT NULL
    AND (SELECT count(DISTINCT x) FROM unnest(ARRAY[v_a1, v_a2, v_b1, v_b2]) x) = 4;

  INSERT INTO public.match_results (match_id, session_id, game_type, a1, a2, b1, b2, winner, rated, recorded_by)
  VALUES (p_match_id, v_m.session_id, v_m.game_type, v_a1, v_a2, v_b1, v_b2, p_winner, v_rated, p_actor_member)
  ON CONFLICT (match_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM public._rating_apply(p_match_id);
  RETURN true;
END;
$function$;

-- 결과 응답 공통 모양. 호출자 기준 Δ·반영 후 점수·반영 경기 수를 함께 준다(결과 단계 showOutcome 용).
--   {matchId, winner, rated, recordedBy, recordedAt, delta, ratingAfter, games}  — 결과 없으면 NULL.
create or replace function public._match_result_json(p_match_id uuid, p_member_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
	select jsonb_build_object(
		'matchId', r.match_id,
		'winner', r.winner,
		'rated', r.rated,
		'recordedBy', r.recorded_by,
		'recordedAt', r.recorded_at,
		'delta', e.delta,
		'ratingAfter', e.after,
		'games', (select mr.games from public.member_ratings mr where mr.member_id = p_member_id)
	)
	from public.match_results r
	left join public.rating_events e on e.match_id = r.match_id and e.member_id = p_member_id
	where r.match_id = p_match_id;
$function$;

-- 전체 재생: 운영진 정정 뒤 matches.ended_at 순으로 다시 쌓는다. 증분 반영과 같은 _rating_apply 를 쓰므로
-- 정정이 없으면 재생 결과는 증분 결과와 같다(seed 는 현재 grade 기준이라 그 사이 grade 를 바꿨다면 달라진다).
create or replace function public.ratings_recompute_all()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_match uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.member_ratings'));
  -- where true: PostgREST 경유 시 safeupdate 가 조건 없는 DELETE 를 막는다.
  DELETE FROM public.rating_events WHERE true;
  DELETE FROM public.member_ratings WHERE true;
  FOR v_match IN
    SELECT r.match_id FROM public.match_results r
    JOIN public.matches m ON m.id = r.match_id
    WHERE r.rated
    ORDER BY m.ended_at NULLS LAST, r.recorded_at, r.match_id
  LOOP
    PERFORM public._rating_apply(v_match);
  END LOOP;
END;
$function$;

-- ── 5. 회원 RPC ────────────────────────────────────────────────────

-- 회원 경기 완료: 자기가 뛰는 코트만. 갱신은 complete_match 와 같고, 그 코트 그룹 편성을 1회 저장할 권한을 준다.
create or replace function public.member_complete_match(p_match_id uuid, p_session_id bigint, p_winner text default null)
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

  -- 로스터 판정은 상태와 무관하게 한다 — 이미 완료된 경기의 로스터 회원에게는 '이미 완료' 를,
  -- 남에게는 'not in match' 를 돌려줘야 클라가 안내를 가를 수 있다.
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
    PERFORM public._match_result_record(p_match_id, p_winner, v_me);
    v_result := public._match_result_json(p_match_id, v_me);
  END IF;

  RETURN jsonb_build_object('players', v_players, 'result', v_result, 'courtId', v_m.court_id);
END;
$function$;

-- 결과 보충/입력: 그 경기 4명 또는 운영진, 완료 후 7일 이내. 첫 입력이 확정이라 있으면 그대로 돌려준다.
--   반환: _match_result_json || {"status": "recorded" | "exists"}
create or replace function public.match_result_submit(p_match_id uuid, p_winner text)
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

  IF EXISTS (SELECT 1 FROM public.match_results WHERE match_id = p_match_id) THEN
    RETURN public._match_result_json(p_match_id, v_me) || jsonb_build_object('status', 'exists');
  END IF;
  IF v_m.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'match not completed' USING ERRCODE = '55000';
  END IF;
  IF v_m.ended_at IS NULL OR v_m.ended_at <= now() - interval '7 days' THEN
    RAISE EXCEPTION 'result window closed' USING ERRCODE = '55000';
  END IF;

  v_inserted := public._match_result_record(p_match_id, p_winner, v_me);
  RETURN public._match_result_json(p_match_id, v_me)
    || jsonb_build_object('status', CASE WHEN v_inserted THEN 'recorded' ELSE 'exists' END);
END;
$function$;

-- 운영진 정정: winner 를 바꾸거나(NULL=삭제) 없던 결과를 넣는다. 기간 제한 없음. 증분 이력이 어긋나므로 전부 재생.
--   반환: _match_result_json(삭제면 {"matchId"}) || {"status": "recorded" | "corrected" | "deleted" | "unchanged"}
create or replace function public.match_result_admin_set(p_match_id uuid, p_winner text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_me uuid := public.current_member_id();
  v_status text;
  v_old text;
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

  PERFORM pg_advisory_xact_lock(hashtext('public.member_ratings'));
  SELECT winner INTO v_old FROM public.match_results WHERE match_id = p_match_id FOR UPDATE;

  IF p_winner IS NULL THEN
    DELETE FROM public.match_results WHERE match_id = p_match_id;
    v_status := CASE WHEN v_old IS NULL THEN 'unchanged' ELSE 'deleted' END;
  ELSIF v_old IS NULL THEN
    PERFORM public._match_result_record(p_match_id, p_winner, v_me);
    v_status := 'recorded';
  ELSIF v_old = p_winner THEN
    v_status := 'unchanged';
  ELSE
    UPDATE public.match_results
    SET winner = p_winner, corrected_by = v_me, corrected_at = now()
    WHERE match_id = p_match_id;
    v_status := 'corrected';
  END IF;

  -- 새로 넣은 결과는 _match_result_record 가 이미 증분 반영했지만, 그 경기가 과거라 순서가 어긋나므로 재생한다.
  IF v_status <> 'unchanged' THEN
    PERFORM public.ratings_recompute_all();
  END IF;

  RETURN coalesce(public._match_result_json(p_match_id, v_me), jsonb_build_object('matchId', p_match_id))
    || jsonb_build_object('status', v_status);
END;
$function$;

-- 내 점수 요약. 행이 없으면 seed 로 계산해 games=0, seeded=true(아직 반영된 경기가 없어 시작 점수라는 뜻).
create or replace function public.rating_my_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
DECLARE
  v_me uuid := public.current_member_id();
  v_r public.member_ratings%rowtype;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'member required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_r FROM public.member_ratings WHERE member_id = v_me;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('rating', public._member_seed(v_me), 'games', 0, 'wins', 0, 'losses', 0, 'seeded', true);
  END IF;
  RETURN jsonb_build_object('rating', v_r.rating, 'games', v_r.games, 'wins', v_r.wins, 'losses', v_r.losses, 'seeded', false);
END;
$function$;

-- 내가 뛴 완료 경기(로스터 session_players.member_id 기준) 최신순. 이름·성별은 그 회차 session_players,
-- 행이 지워졌으면 경기 시점 player_snapshot 으로 폴백한다. p_limit 은 1~100 으로 자른다.
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
          'mySide', CASE WHEN v_me IN (pa1.member_id, pa2.member_id) THEN 'A' ELSE 'B' END,
          'teamA', jsonb_build_array(
            jsonb_build_object('memberId', pa1.member_id, 'name', coalesce(pa1.name, m.player_snapshot->0->>'name'), 'gender', coalesce(pa1.gender, m.player_snapshot->0->>'gender')),
            jsonb_build_object('memberId', pa2.member_id, 'name', coalesce(pa2.name, m.player_snapshot->1->>'name'), 'gender', coalesce(pa2.gender, m.player_snapshot->1->>'gender'))),
          'teamB', jsonb_build_array(
            jsonb_build_object('memberId', pb1.member_id, 'name', coalesce(pb1.name, m.player_snapshot->2->>'name'), 'gender', coalesce(pb1.gender, m.player_snapshot->2->>'gender')),
            jsonb_build_object('memberId', pb2.member_id, 'name', coalesce(pb2.name, m.player_snapshot->3->>'name'), 'gender', coalesce(pb2.gender, m.player_snapshot->3->>'gender'))),
          'winner', r.winner,
          'rated', coalesce(r.rated, false),
          'delta', e.delta,
          'ratingAfter', e.after,
          'canSubmit', (r.match_id IS NULL AND m.ended_at > now() - interval '7 days')
        ) AS item
      FROM public.matches m
      LEFT JOIN public.session_players pa1 ON pa1.id = m.team_a_p1
      LEFT JOIN public.session_players pa2 ON pa2.id = m.team_a_p2
      LEFT JOIN public.session_players pb1 ON pb1.id = m.team_b_p1
      LEFT JOIN public.session_players pb2 ON pb2.id = m.team_b_p2
      LEFT JOIN public.match_results r ON r.match_id = m.id
      LEFT JOIN public.rating_events e ON e.match_id = m.id AND e.member_id = v_me
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

-- 회원 편성 후보 검사용(내부): drafts 의 팀별 유효 멤버 = anchor(memberIds) ∪ 그 팀을 향한 예약(ghost) playerId.
-- 값은 session_players.id 문자열이다.
create or replace function public._completion_team_sets(p_drafts jsonb)
returns table(team_id text, ids text[])
language sql
stable
security definer
set search_path = ''
as $function$
  SELECT t->>'id',
    array(
      SELECT DISTINCT u.x FROM (
        SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(t->'memberIds') = 'array' THEN t->'memberIds' ELSE '[]'::jsonb END) AS x
        UNION ALL
        SELECT r->>'playerId'
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_drafts->'reservations') = 'array'
          THEN p_drafts->'reservations' ELSE '[]'::jsonb END) r
        WHERE r->>'teamId' = t->>'id'
      ) u
      WHERE u.x IS NOT NULL
    )
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_drafts->'teams') = 'array' THEN p_drafts->'teams' ELSE '[]'::jsonb END) t;
$function$;

-- 회원 편성 후보가 '같이 매칭하지 않기' 묶음을 어기는지(내부). 회원 기기에는 숨은 규칙이 내려가지 않으므로
-- (board_selection_rules 는 활성 운영진 전용) 서버가 대신 본다. 판정은 편집자 편성(src/lib/teamSelection/
-- recommendTeammates.ts — 운영진이 손으로 둔 멤버는 그대로 두고 '새로 고르는 사람'만 막는다)과 같다:
-- 후보의 한 팀(유효 멤버 = anchor ∪ 그 팀을 향한 예약)에 한 묶음의 서로 다른 회원(session_players.member_id) 둘이
-- 함께 있고, 그 두 사람이 지금 보드의 어느 팀에서도 같이 있지 않았으면(= 이 편성이 새로 만든 짝) 위반.
-- 이미 함께 있던 짝(운영진이 둔 것·예비팀 옮기기·예약 승격)은 그 팀에 다른 사람이 더해져도 보지 않는다.
create or replace function public._completion_avoid_violation(p_session_id bigint, p_current jsonb, p_payload jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  SELECT EXISTS (
    SELECT 1
    FROM public._completion_team_sets(p_payload) n
    JOIN public.session_players a ON a.session_id = p_session_id AND a.id::text = ANY (n.ids)
    JOIN public.session_players b ON b.session_id = p_session_id AND b.id::text = ANY (n.ids)
    WHERE a.member_id IS NOT NULL AND b.member_id IS NOT NULL AND a.member_id < b.member_id
      AND EXISTS (
        SELECT 1 FROM public.match_avoid_groups g
        WHERE a.member_id = ANY (g.member_ids) AND b.member_id = ANY (g.member_ids)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public._completion_team_sets(p_current) c
        WHERE a.id::text = ANY (c.ids) AND b.id::text = ANY (c.ids)
      )
  );
$function$;

-- 회원 완료 뒤 보드 편성 1회 저장(CAS). 편집락(editor_*)은 건드리지 않는다 — 운영진 편집 상태를 뺏지 않는다.
--   p_payloads: 후보 payload 배열(1~6개, 클라 우선순위 순). 앞에서부터 검사해 처음 통과한 후보를 저장한다.
--   클라는 '같이 매칭하지 않기' 규칙을 모른 채(숨은 설정) 새 그룹을 짜므로, 사람을 바꾼 대안 후보와
--   마지막에 '예비팀 옮기기만' 안전 후보를 함께 보낸다. 어떤 규칙에 걸렸는지는 응답·오류에 드러내지 않는다.
--   grant 는 후보를 평가한 호출(ok·rejected)에서 소모한다 — 검사는 grant 당 한 번뿐이다. rejected 에서 남겨 두면
--   devtools 로 지어낸 후보 집합을 3분 안에 몇 번이고 넣어 보며 숨은 묶음을 알아낼 수 있다(정직한 클라는
--   늘 통과하는 안전 후보를 마지막에 넣으므로 rejected 를 받지 않는다). stale 만 소모하지 않는다(검사 전, 재계산용).
--   chosen 인덱스는 숨길 이유가 없다 — 저장된 보드 자체가 모두에게 보이므로 어느 후보인지는 어차피 드러난다.
-- 기존 단일 p_payload 판(미배포 초안)이 로컬 DB 에 남아 있으면 인자 이름이 달라 replace 가 안 된다.
drop function if exists public.member_commit_completion_drafts(bigint, uuid, bigint, jsonb);
create or replace function public.member_commit_completion_drafts(p_session_id bigint, p_match_id uuid, p_base_version bigint, p_payloads jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
DECLARE
  v_me uuid := public.current_member_id();
  v_session public.sessions%rowtype;
  v_version bigint;
  v_payload jsonb;
  v_n integer;
  v_i integer;
BEGIN
  -- 잠금 순서 sessions → grants.
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR NOT v_session.is_active OR v_session.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'session not active' USING ERRCODE = '55000';
  END IF;

  PERFORM 1 FROM public.match_completion_grants g
  WHERE g.match_id = p_match_id AND g.session_id = p_session_id
    AND v_me IS NOT NULL AND g.member_id = v_me
    AND g.used_at IS NULL AND g.created_at > now() - interval '3 minutes'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no completion grant' USING ERRCODE = '42501';
  END IF;

  IF p_payloads IS NULL OR jsonb_typeof(p_payloads) <> 'array'
    OR jsonb_array_length(p_payloads) NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'invalid payload' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_payloads);
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_payload := p_payloads->v_i;
    IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object'
      OR jsonb_typeof(v_payload->'teams') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_payload->'reservations') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid payload' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_session.board_drafts_version IS DISTINCT FROM p_base_version THEN
    RETURN jsonb_build_object('status', 'stale', 'version', v_session.board_drafts_version);
  END IF;

  FOR v_i IN 0 .. v_n - 1 LOOP
    v_payload := p_payloads->v_i;

    -- grant 는 편집락·is_admin 없이 보드 전체를 쓰는 권한이라, 회원 편성이 하는 일(끝난 선수 예약 승격·준비된
    -- 예비팀을 코트 그룹으로 옮기기·빈 자리 채우기·흩기 좌표)만 통과시키는 '얹기 전용' 가드를 둔다: 지금 보드에
    -- 올라 있는 사람을 내리는 후보는 저장하지 않고 건너뛴다. 그래야 devtools 로 '{"teams":[],"reservations":[]}'
    -- 를 보내 모든 그룹·예약을 지우는 길이 막힌다. 호출 전체를 거부하지 않는 이유: 정직한 편성도 이 가드에
    -- 걸릴 수 있다(자동 편성의 유연 풀이 2인 합류 대기팀에서 한 명을 빼 오면 남은 한 명이 해체로 풀린다) —
    -- 그 한 후보 때문에 늘 통과하는 안전 후보까지 버리면 코트가 빈 채로 남는다.
    -- 판정은 사람 단위 — 팀 id·순서·좌표는 정당한 편성에서도 바뀐다.
    --   ① 현재 anchor(memberIds)였던 선수는 후보의 어느 팀이든 anchor 로 남아야 한다.
    --   ② 현재 예약(ghost)은 같은 id 로 남거나, 그 선수가 후보에서 anchor 가 됐어야 한다(끝난 선수 예약 승격).
    IF EXISTS (
      WITH cur_teams AS (
        SELECT t FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_session.board_drafts->'teams') = 'array'
          THEN v_session.board_drafts->'teams' ELSE '[]'::jsonb END) t
      ), cur_res AS (
        SELECT r FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_session.board_drafts->'reservations') = 'array'
          THEN v_session.board_drafts->'reservations' ELSE '[]'::jsonb END) r
      ), new_anchor AS (
        SELECT DISTINCT pid FROM jsonb_array_elements(v_payload->'teams') t,
          jsonb_array_elements_text(CASE WHEN jsonb_typeof(t->'memberIds') = 'array' THEN t->'memberIds' ELSE '[]'::jsonb END) pid
        WHERE pid IS NOT NULL
      ), new_res AS (
        SELECT DISTINCT r->>'id' AS id FROM jsonb_array_elements(v_payload->'reservations') r
      )
      SELECT 1 FROM cur_teams,
        jsonb_array_elements_text(CASE WHEN jsonb_typeof(t->'memberIds') = 'array' THEN t->'memberIds' ELSE '[]'::jsonb END) pid
      WHERE pid NOT IN (SELECT na.pid FROM new_anchor na)
      UNION ALL
      SELECT 1 FROM cur_res
      WHERE (r->>'id') IS NOT NULL
        AND (r->>'id') NOT IN (SELECT nr.id FROM new_res nr WHERE nr.id IS NOT NULL)
        AND coalesce(r->>'playerId', '') NOT IN (SELECT na.pid FROM new_anchor na)
    ) THEN
      CONTINUE;
    END IF;

    CONTINUE WHEN public._completion_avoid_violation(p_session_id, v_session.board_drafts, v_payload);

    UPDATE public.sessions s
    SET board_drafts = v_payload,
        board_drafts_version = s.board_drafts_version + 1
    WHERE s.id = p_session_id
    RETURNING s.board_drafts_version INTO v_version;

    UPDATE public.match_completion_grants SET used_at = now() WHERE match_id = p_match_id;

    RETURN jsonb_build_object('status', 'ok', 'version', v_version, 'chosen', v_i);
  END LOOP;

  -- 모든 후보가 걸렸다(사람을 내리거나 묶음을 어김) — 저장하지 않고 grant 는 소모한다(위 설명). 코트 그룹은 운영진이 채운다.
  UPDATE public.match_completion_grants SET used_at = now() WHERE match_id = p_match_id;
  RETURN jsonb_build_object('status', 'rejected');
END;
$function$;

-- ── 6. 실행 권한 ───────────────────────────────────────────────────
-- Supabase 는 새 함수에 anon/authenticated 실행권을 직접 준다. public 만 회수하면 남으므로 셋 다 회수한다.
-- 내부 함수(전부 회수): 상수·공통부·반영·재생.
revoke execute on function public.elo_seed(integer) from public, anon, authenticated;
revoke execute on function public.elo_k(integer) from public, anon, authenticated;
revoke execute on function public._member_seed(uuid) from public, anon, authenticated;
revoke execute on function public._complete_match_apply(uuid, bigint, text) from public, anon, authenticated;
revoke execute on function public._rating_apply(uuid) from public, anon, authenticated;
revoke execute on function public._match_result_record(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public._match_result_json(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ratings_recompute_all() from public, anon, authenticated;
revoke execute on function public._completion_team_sets(jsonb) from public, anon, authenticated;
revoke execute on function public._completion_avoid_violation(bigint, jsonb, jsonb) from public, anon, authenticated;

-- 회원 RPC: authenticated 만.
revoke execute on function public.complete_match(uuid, bigint, text, uuid, uuid, uuid, uuid, text, text, integer) from public, anon;
revoke execute on function public.member_complete_match(uuid, bigint, text) from public, anon;
revoke execute on function public.match_result_submit(uuid, text) from public, anon;
revoke execute on function public.match_result_admin_set(uuid, text) from public, anon;
revoke execute on function public.rating_my_summary() from public, anon;
revoke execute on function public.match_my_history(integer, timestamptz) from public, anon;
revoke execute on function public.member_commit_completion_drafts(bigint, uuid, bigint, jsonb) from public, anon;
grant execute on function public.complete_match(uuid, bigint, text, uuid, uuid, uuid, uuid, text, text, integer) to authenticated;
grant execute on function public.member_complete_match(uuid, bigint, text) to authenticated;
grant execute on function public.match_result_submit(uuid, text) to authenticated;
grant execute on function public.match_result_admin_set(uuid, text) to authenticated;
grant execute on function public.rating_my_summary() to authenticated;
grant execute on function public.match_my_history(integer, timestamptz) to authenticated;
grant execute on function public.member_commit_completion_drafts(bigint, uuid, bigint, jsonb) to authenticated;
