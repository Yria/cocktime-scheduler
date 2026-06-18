-- ============================================================
-- session_players 중복 제거 + (session_id, player_id) UNIQUE + realtime 구독
--
-- 버그: 동시 설정 변경 시 같은 player_id로 INSERT가 중복되어(ON CONFLICT 없음)
--       한 사람이 여러 UUID row("독립 인스턴스")로 존재 → 편성/대기/휴식 동시 공존.
-- 조치: 기존 중복을 canonical 한 row로 병합(참조 재연결) 후 삭제하고,
--       (session_id, player_id) UNIQUE 제약으로 재발 방지 + realtime row 구독 활성화.
-- ============================================================

-- 1) (session_id, player_id)별 canonical id 선정: playing 우선 → game_count 큰 순 → id 작은 순
CREATE TEMP TABLE _sp_canon ON COMMIT DROP AS
SELECT DISTINCT ON (session_id, player_id)
  session_id, player_id, id AS canonical_id
FROM session_players
ORDER BY session_id, player_id, (status = 'playing') DESC, game_count DESC, id ASC;

-- 2) 중복 row → canonical 매핑
CREATE TEMP TABLE _sp_map ON COMMIT DROP AS
SELECT sp.id AS dup_id, c.canonical_id
FROM session_players sp
JOIN _sp_canon c ON c.session_id = sp.session_id AND c.player_id = sp.player_id
WHERE sp.id <> c.canonical_id;

-- 3) matches 참조를 canonical로 재연결(경기 기록 보존)
UPDATE matches m SET team_a_p1 = mp.canonical_id FROM _sp_map mp WHERE m.team_a_p1 = mp.dup_id;
UPDATE matches m SET team_a_p2 = mp.canonical_id FROM _sp_map mp WHERE m.team_a_p2 = mp.dup_id;
UPDATE matches m SET team_b_p1 = mp.canonical_id FROM _sp_map mp WHERE m.team_b_p1 = mp.dup_id;
UPDATE matches m SET team_b_p2 = mp.canonical_id FROM _sp_map mp WHERE m.team_b_p2 = mp.dup_id;

-- 4) canonical status를 그룹 우선순위(playing > resting > waiting)로 정정
UPDATE session_players c SET status = grp.best
FROM (
  SELECT session_id, player_id,
    CASE WHEN bool_or(status = 'playing') THEN 'playing'
         WHEN bool_or(status = 'resting') THEN 'resting'
         ELSE 'waiting' END AS best
  FROM session_players
  GROUP BY session_id, player_id
) grp
WHERE c.session_id = grp.session_id AND c.player_id = grp.player_id
  AND c.id IN (SELECT canonical_id FROM _sp_canon)
  AND c.status <> grp.best;

-- 4.5) pair_history를 dup→canonical로 재키잉 + 병합(삭제 전). 안 하면 dup 행 삭제 시
--      FK ON DELETE CASCADE로 동반횟수(추천 공정성 데이터)가 합산 없이 손실된다.
--      dup이 포함된 페어를 canonical로 치환 → LEAST/GREATEST 정규화 → 자기페어 제외 → 동일 페어 count 합산.
WITH remapped AS (
  SELECT
    ph.session_id,
    LEAST(COALESCE(ma.canonical_id, ph.player_a), COALESCE(mb.canonical_id, ph.player_b)) AS pa,
    GREATEST(COALESCE(ma.canonical_id, ph.player_a), COALESCE(mb.canonical_id, ph.player_b)) AS pb,
    ph.count AS count
  FROM pair_history ph
  LEFT JOIN _sp_map ma ON ma.dup_id = ph.player_a
  LEFT JOIN _sp_map mb ON mb.dup_id = ph.player_b
  WHERE ma.dup_id IS NOT NULL OR mb.dup_id IS NOT NULL -- dup이 포함된 행만
),
agg AS (
  SELECT session_id, pa, pb, SUM(count) AS cnt
  FROM remapped
  WHERE pa <> pb -- 두 멤버가 같은 canonical로 합쳐진 자기-페어 제외
  GROUP BY session_id, pa, pb
)
INSERT INTO pair_history (session_id, player_a, player_b, count)
SELECT session_id, pa, pb, cnt FROM agg
ON CONFLICT (session_id, player_a, player_b)
DO UPDATE SET count = pair_history.count + EXCLUDED.count;

-- 5) 중복 row 삭제 (남은 dup 참조 pair_history는 FK CASCADE로 정리 — 위 4.5에서 canonical로 합산 완료,
--    matches는 step 3에서 canonical로 재연결됨)
DELETE FROM session_players sp USING _sp_map mp WHERE sp.id = mp.dup_id;

-- 6) UNIQUE 제약 — 같은 세션에 같은 player_id는 단 하나(재발 방지)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_session_player_unique') THEN
    ALTER TABLE session_players ADD CONSTRAINT uq_session_player_unique UNIQUE (session_id, player_id);
  END IF;
END $$;

-- 7) session_players realtime 구독(postgres_changes) — 추가/삭제/상태가 row 단위로 즉시 전파
-- REPLICA IDENTITY FULL: DELETE 이벤트의 old 레코드에 전체 컬럼(특히 session_id)을 포함시켜
--   filter(session_id=eq.X)가 DELETE에도 적용되게 한다. 기본(PK만)이면 DELETE는 필터에 걸려 전파 안 됨.
ALTER TABLE session_players REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'session_players'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE session_players;
  END IF;
END $$;
