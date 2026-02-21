# 콕타임 DB 설계

> 기획 문서(`product-spec.md`) 기반으로 코드 참조 없이 설계.

## 설계 원칙

1. **정규화된 테이블**: 실시간 상태도 JSONB 덩어리 대신 각 도메인 테이블로 관리
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
| `pair_history` | 세션 내 파트너 이력 |
| `reserved_groups` | 예약 그룹 |

---

## 테이블 상세

### sessions

```sql
CREATE TABLE sessions (
  id           BIGSERIAL    PRIMARY KEY,
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  court_count  INT          NOT NULL,
  script_url   TEXT,                          -- 구글 시트 연결 URL (재연결 복구용)
  started_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at     TIMESTAMPTZ
);
```

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
  status              TEXT         NOT NULL DEFAULT 'waiting',
                                               -- 'waiting' | 'playing' | 'resting' | 'reserved'
  force_mixed         BOOLEAN      NOT NULL DEFAULT false,
                                               -- 다음 매칭에서 혼복 강제 배치 (배정 시 자동 해제)

  -- 알고리즘용 카운터
  game_count          INT          NOT NULL DEFAULT 0,  -- 누적 경기 횟수 (선발 우선순위)
  mixed_count         INT          NOT NULL DEFAULT 0,  -- 혼복 출전 횟수 (남자 균등 분배)

  -- 대기 순서
  wait_since          TIMESTAMPTZ,                      -- 대기 시작 시각 (game_count 동점 시 순서 기준)

  joined_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sp_session        ON session_players(session_id);
CREATE INDEX idx_sp_session_status ON session_players(session_id, status);
```

> **대기 순서 정렬**: `game_count ASC, wait_since ASC`
> **`allow_mixed_single`**: 세션 설정 시 선택, 세션 중 토글 가능
> **`force_mixed`**: 대기 중 선수에게만 설정 가능, 코트 배정 완료 시 자동 `false`

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

세션 내 파트너 이력. 팀 구성 점수 계산(`historyPenalty`)에 사용.
경기 완료 시 팀A(p1-p2), 팀B(p1-p2) 두 쌍을 upsert.

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

---

### reserved_groups

예약 그룹. 2~4명을 미리 묶어두는 기능.

```sql
CREATE TABLE reserved_groups (
  id          TEXT         PRIMARY KEY,   -- 클라이언트 생성 ('reserved-{timestamp}')
  session_id  BIGINT       NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  member_ids  UUID[]       NOT NULL,      -- session_players.id 목록 (구성원 전체)
  ready_ids   UUID[]       NOT NULL DEFAULT '{}',
                                          -- 현재 대기 완료된 session_players.id
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rg_session ON reserved_groups(session_id);
```

> `ready_ids = member_ids`이면 그룹 전원 준비 완료 → 코트 배정 가능.

---

## 이벤트별 DB 처리

### 세션 시작
```
sessions INSERT
session_players INSERT × N  (status='waiting', wait_since=NOW())
```

### 팀 생성 (pending — 미리보기)
```
DB 저장 없음
Broadcast: { event: 'pending_team', payload: { team } }
```

### 코트 배정
```
matches INSERT  (status='playing')
session_players UPDATE  status='playing'                    WHERE id IN [4명]
session_players UPDATE  force_mixed=false                   WHERE id IN [4명]
reserved_groups DELETE                                      해당 그룹이 있으면

Broadcast: { event: 'match_started', payload: { match } }
```

### 경기 완료
```
matches UPDATE  status='completed', ended_at=NOW()

session_players UPDATE  game_count++                        WHERE id IN [4명]
session_players UPDATE  mixed_count++                       WHERE 혼복 남자만
session_players UPDATE  status='waiting', wait_since=NOW()  WHERE 예약 미소속
reserved_groups UPDATE  ready_ids = ready_ids || [복귀 선수] WHERE 예약 소속

pair_history UPSERT  (teamA: p1-p2, teamB: p1-p2)
  ON CONFLICT DO UPDATE SET count = count + 1

Broadcast: { event: 'match_completed', payload: { matchId, courtId } }
```

### 휴식 전환
```
session_players UPDATE  status='resting'                    (waiting → resting)
session_players UPDATE  status='waiting', wait_since=NOW()  (resting → waiting)

Broadcast: { event: 'player_status_changed', payload: { playerId, status } }
```

### 혼복 우선배치 토글
```
session_players UPDATE  force_mixed = NOT force_mixed       WHERE status='waiting'

Broadcast: { event: 'player_force_mixed_changed', payload: { playerId, forceMixed } }
```

### 예약 생성
```
reserved_groups INSERT
session_players UPDATE  status='reserved'                   WHERE 대기 중인 구성원

Broadcast: { event: 'group_reserved', payload: { group } }
```

### 예약 해제
```
session_players UPDATE  status='waiting', wait_since=NOW()  WHERE ready_ids 소속
reserved_groups DELETE

Broadcast: { event: 'group_disbanded', payload: { groupId } }
```

### 세션 종료
```
sessions UPDATE  is_active=false, ended_at=NOW()

Broadcast: { event: 'session_ended' }
```

---

## 재연결 시 상태 복구

```sql
-- 1. 세션 정보
SELECT * FROM sessions WHERE is_active = true LIMIT 1;

-- 2. 참여자 상태 전체 (대기 순서 포함)
SELECT * FROM session_players
WHERE session_id = $1
ORDER BY game_count ASC, wait_since ASC;

-- 3. 진행 중인 경기 (코트 상태 복구)
SELECT * FROM matches WHERE session_id = $1 AND status = 'playing';

-- 4. 파트너 이력 (팀 구성 알고리즘용)
SELECT * FROM pair_history WHERE session_id = $1;

-- 5. 예약 그룹
SELECT * FROM reserved_groups WHERE session_id = $1;
```

5개 쿼리로 전체 세션 상태 복원 가능.

---

## RLS 정책

```sql
ALTER TABLE sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_players   ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pair_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reserved_groups   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON sessions        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON session_players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON matches         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON pair_history    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON reserved_groups FOR ALL USING (true) WITH CHECK (true);
```
