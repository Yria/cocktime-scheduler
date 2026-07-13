# 콕타임 DB 설계

> 기획 문서(`product-spec.md`) 기반. **2026-06 리팩토링** 으로 자동 팀 편성 슬라이스를 제거한 현재 상태를 반영.

## 설계 원칙

1. **정규화된 테이블**: 실시간 상태도 (보드 드래프트 외) JSONB 덩어리 대신 각 도메인 테이블로 관리
2. **이벤트 기반 저장**: 배정·완료·휴식 등 이벤트 발생 시 해당 테이블 즉시 업데이트
3. **재연결 복구 가능**: DB 조회만으로 세션 전체 상태 복원 (타이머·스냅샷 불필요)
4. **Broadcast 동기화**: 실시간 전파는 Supabase Broadcast, DB는 영속성 담당

---

## 테이블 목록

| 테이블 | 역할 |
|--------|------|
| `sessions` | 세션 기본 정보 |
| `session_players` | 세션 참여자 + 실시간 상태 |
| `matches` | 코트별 경기 기록 |
| `pair_history` | 세션 내 동반 이력 |

### 제거된 객체 (deprecated — 2026-06 리팩토링)

마이그레이션 `20260612120000_remove_legacy_team_formation.sql` 에서 forward-only DROP으로 제거.
(기존 마이그레이션은 append-only 히스토리이므로 수정하지 않고 새 마이그레이션으로 제거.)

| 종류 | 이름 | 비고 |
|------|------|------|
| 테이블 | ~~`team_candidates`~~ | 자동 팀 후보/매치 대기열 저장소 (구 `add_team_candidates.sql`). `DROP TABLE ... CASCADE` |
| 테이블 | ~~`manual_match_logs`~~ | 수동매칭 로그 (구 `add_manual_match_logs.sql` + RLS). `DROP TABLE ... CASCADE` |
| RPC | ~~`save_team_candidates(BIGINT, JSONB)`~~ | 팀 후보 저장. `team_candidates` 의존 |
| RPC | ~~`save_match_queue(BIGINT, JSONB)`~~ | 매치 대기열 저장. `team_candidates` 의존 |
| RPC | ~~`activate_pending_player(BIGINT, UUID)`~~ | pending → waiting 활성화. pending 제거로 불필요 |
| status 값 | ~~`pending`~~ | `session_players.status` CHECK 에서 제거 → `('waiting','playing','resting')` 만 허용, DEFAULT `'waiting'` |
| 예약 그룹 | ~~`reserved_groups`~~ | 그 이전에 이미 제거됨 |

> **유지(절대 제거 안 함)**: `assign_match`, `complete_match` RPC, `sessions.match_assign_count`,
> `session_players.joined_at_match`, `sessions.board_drafts`.

---

## 테이블 상세

### sessions

```sql
CREATE TABLE sessions (
  id                 BIGSERIAL    PRIMARY KEY,
  is_active          BOOLEAN      NOT NULL DEFAULT true,
  court_count        INT          NOT NULL,
  script_url         TEXT,                          -- 구글 시트 연결 URL (재연결 복구용)
  started_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at           TIMESTAMPTZ,
  match_assign_count INT          NOT NULL DEFAULT 0,  -- 누적 코트 배정 횟수 (deficit 기산점)
  board_drafts       JSONB                            -- 보드 "팀 구성중"/예약 멤버십 (공유 드래프트)
);
```

> **`match_assign_count`**: 코트에 매치를 배정할 때마다 +1. deficit 계산에서 "참여 가능했던 라운드 수"의 기준이 된다.
> **`board_drafts`**: react-konva 보드의 팀 구성 영역 멤버십을 클라이언트 간 공유하기 위한 JSONB. 위치(좌표)는 클라이언트 로컬에서 결정.

---

### session_players

세션 참여자. 세션 당시 선수 정보 스냅샷 + 실시간 상태 + 알고리즘용 카운터.

```sql
CREATE TABLE session_players (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          BIGINT       NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- 선수 기본 정보 (세션 시점 스냅샷)
  player_id           TEXT         NOT NULL,   -- 구글시트 ID or 'guest-{timestamp}'
  name                TEXT         NOT NULL,
  gender              TEXT         NOT NULL,   -- 'M' | 'F'
  skills              JSONB        NOT NULL,   -- { 클리어: 'O'|'V'|'X', 스매시: ..., ... }

  -- 세션 설정값
  allow_mixed_single  BOOLEAN      NOT NULL DEFAULT false,
                                               -- 남3여1 혼복 단독 배치 허용 여부

  -- 실시간 상태
  status              TEXT         NOT NULL DEFAULT 'waiting'
                                   CHECK (status IN ('waiting', 'playing', 'resting')),
                                               -- 'pending' 제거됨 (2026-06)
  -- force_mixed / force_hard_game 컬럼 제거됨 (20260612120000 마이그레이션 DROP COLUMN)

  -- 알고리즘용 카운터
  game_count          INT          NOT NULL DEFAULT 0,  -- 누적 경기 횟수
  mixed_count         INT          NOT NULL DEFAULT 0,  -- 혼복 출전 횟수 (남자 균등 분배)
  joined_at_match     INT          NOT NULL DEFAULT 0,  -- 합류 시점의 match_assign_count (deficit 기산점)

  -- 대기 순서
  wait_since          TIMESTAMPTZ,                      -- 대기 시작 시각 (deficit 동점 시 순서 기준)

  joined_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sp_session        ON session_players(session_id);
CREATE INDEX idx_sp_session_status ON session_players(session_id, status);
```

> **대기 순서 정렬**: `game_count ASC, wait_since ASC` (재연결 복구 쿼리 기준).
> **`joined_at_match`**: 늦참자가 합류한 시점의 `match_assign_count`. deficit 의 `eligibleRounds = match_assign_count − joined_at_match` 계산에 사용.
> **제거됨(deprecated)**: `force_mixed`(혼복 우선배치), `force_hard_game`(빡겜 우선배치) 컬럼.
> 마이그레이션 `20260612120000_remove_legacy_team_formation.sql` 에서 `ALTER TABLE session_players DROP COLUMN IF EXISTS` 로 DROP 됐다.
> 코드 필드·transformer(`rowToSessionPlayer`)·타입(`SessionPlayerRow`)·`DebugMatchModal` 표시까지 전부 제거되어 더 이상 읽지 않는다.

---

### matches

코트별 경기. `status = 'playing'` 레코드가 현재 코트 상태.

```sql
CREATE TABLE matches (
  id          UUID         PRIMARY KEY,   -- 클라이언트에서 crypto.randomUUID() 생성
  session_id  BIGINT       NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  court_id    INT          NOT NULL,
  game_type   TEXT         NOT NULL,      -- '혼복' | '남복' | '여복' | '혼합'

  -- 팀 구성 (session_players FK)
  team_a_p1   UUID         NOT NULL REFERENCES session_players(id),
  team_a_p2   UUID         NOT NULL REFERENCES session_players(id),
  team_b_p1   UUID         NOT NULL REFERENCES session_players(id),
  team_b_p2   UUID         NOT NULL REFERENCES session_players(id),

  status      TEXT         NOT NULL DEFAULT 'playing',  -- 'playing' | 'completed'
  started_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ
);

CREATE INDEX idx_matches_session        ON matches(session_id);
CREATE INDEX idx_matches_session_status ON matches(session_id, status);
```

---

### pair_history

세션 내 동반 이력. 후보 점수의 `pairOverlap`(동반 회피)에 사용.
경기 완료 시 같은 경기 4명(팀A p1-p2, 팀B p1-p2) 페어를 upsert. (RPC `complete_match` 가 팀별 페어 2쌍을 누적)

```sql
CREATE TABLE pair_history (
  session_id  BIGINT  NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_a    UUID    NOT NULL REFERENCES session_players(id),
  player_b    UUID    NOT NULL REFERENCES session_players(id),
  count       INT     NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, player_a, player_b)
);
```

> 항상 `player_a < player_b` (UUID 문자열 기준) 순서로 저장하여 역방향 중복 방지.
> 클라이언트 측 `recordHistory` 는 같은 경기 4명 그룹의 6쌍 전체를 누적하지만, DB `complete_match` 는 실제 팀 페어 2쌍을 누적한다.

---

## 이벤트별 DB 처리

### 세션 시작
```
sessions INSERT  (match_assign_count = 0)
session_players INSERT × N  (status='waiting', joined_at_match=0)
```

### 코트 배정 (RPC: assign_match)
```
matches INSERT  (status='playing')
session_players UPDATE  status='playing'                    WHERE id IN [4명]
sessions UPDATE  match_assign_count = match_assign_count + 1

Broadcast: { event: 'match_started', payload: { match } }
```

### 경기 완료 (RPC: complete_match)
```
matches UPDATE  status='completed', ended_at=NOW()

session_players UPDATE  game_count++                        WHERE id IN [4명]
session_players UPDATE  mixed_count++                       WHERE 혼복(game_type='혼복') 남자만
session_players UPDATE  status='waiting', wait_since=NOW()

pair_history UPSERT  (teamA: p1-p2, teamB: p1-p2)
  ON CONFLICT DO UPDATE SET count = count + 1

Broadcast: { event: 'match_completed', payload: { matchId, courtId } }
```

### 휴식 전환
```
session_players UPDATE  status='resting'                    (waiting → resting)
session_players UPDATE  status='waiting', wait_since=NOW()  (resting → waiting)

Broadcast: { event: 'player_updated', payload: { player } }
```
> 휴식 토글은 별도 RPC 없이 `dbUpdateSessionPlayer` 의 status 필드 업데이트로 처리하며, `player_updated` 로 전파한다.

### 보드 드래프트 변경
```
sessions UPDATE  board_drafts = $payload

Broadcast: { event: 'board_drafts_updated', payload: <BoardDraftsPayload> }
```

> **세션 종료(유지)**: `dbEndSession` → `sessions UPDATE is_active=false`. 다른 클라이언트는 `is_active` postgres watch 로 감지한다.
> 단 `session_ended` **브로드캐스트 이벤트는 미사용**(BroadcastPayload 에 없음) — 종료 전파는 watch 로만 이뤄진다.
>
> **제거됨(deprecated)**: 선수 활성화(pending→waiting), 팀 생성 미리보기(`pending_team`),
> 혼복/빡겜 우선배치 토글, 팀 후보 저장/대기열 저장, `session_ended` 브로드캐스트 이벤트.

---

## 재연결 시 상태 복구

```sql
-- 1. 세션 정보 (match_assign_count, board_drafts 포함)
SELECT * FROM sessions WHERE is_active = true LIMIT 1;

-- 2. 참여자 상태 전체 (대기 순서 포함)
SELECT * FROM session_players
WHERE session_id = $1
ORDER BY game_count ASC, wait_since ASC;

-- 3. 진행 중인 경기 (코트 상태 복구)
SELECT * FROM matches WHERE session_id = $1 AND status = 'playing';

-- 4. 동반 이력 (후보 점수 pairOverlap용)
SELECT * FROM pair_history WHERE session_id = $1;
```

4개 쿼리로 전체 세션 상태 복원 가능. (팀 후보/대기열 로드는 제거됨)

---

## RLS 정책

```sql
ALTER TABLE sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_players   ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pair_history      ENABLE ROW LEVEL SECURITY;

-- sessions / session_players : 조회=로그인 전원, 쓰기=운영진(is_admin)만
--   (마이그레이션 20260713140000. 회원 대면 write 는 전부 SECURITY DEFINER RPC 경유.)
CREATE POLICY sessions_select             ON sessions        FOR SELECT TO authenticated USING (true);
CREATE POLICY sessions_admin_write        ON sessions        FOR ALL    TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY session_players_select      ON session_players FOR SELECT TO authenticated USING (true);
CREATE POLICY session_players_admin_write ON session_players FOR ALL    TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- matches / pair_history : 아직 anon_all (후속 전환 대상 — board write 는 DEFINER RPC 경유).
CREATE POLICY "anon_all" ON matches         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON pair_history    FOR ALL USING (true) WITH CHECK (true);
```
