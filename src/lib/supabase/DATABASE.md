# 데이터베이스 사용 현황

## 테이블 구조

### sessions
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | BIGSERIAL PK | 세션 ID |
| is_active | BOOLEAN | 활성 세션 여부 |
| court_count | INT | 코트 수 |
| started_at | TIMESTAMPTZ | 시작 시각 |
| ended_at | TIMESTAMPTZ? | 종료 시각 |

### session_players
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | UUID PK | 세션 내 선수 ID |
| session_id | BIGINT FK | 세션 |
| player_id | TEXT | 원본 선수 ID |
| name | TEXT | 이름 |
| gender | TEXT | M/F |
| skills | JSONB | 7개 스킬 |
| allow_mixed_single | BOOLEAN | 혼합 단식 가능 여부 |
| status | TEXT | waiting/playing/resting |
| force_mixed | BOOLEAN | 혼복 우선배치 |
| force_hard_game | BOOLEAN | 빡겜 우선배치 |
| game_count | INT | 게임 수 |
| mixed_count | INT | 혼복 게임 수 |
| wait_since | TIMESTAMPTZ? | 대기 시작 시각 |

### matches
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | UUID PK | 매치 ID |
| session_id | BIGINT FK | 세션 |
| court_id | INT | 코트 번호 |
| game_type | TEXT | 혼복/남복/여복/혼합 |
| team_a_p1/p2 | UUID FK | A팀 선수 |
| team_b_p1/p2 | UUID FK | B팀 선수 |
| status | TEXT | playing/completed |
| started_at | TIMESTAMPTZ | 시작 시각 |
| ended_at | TIMESTAMPTZ? | 종료 시각 |

### pair_history
| 컬럼 | 타입 | 설명 |
|---|---|---|
| session_id | BIGINT FK | 세션 |
| player_a | UUID FK | 선수 A (player_a < player_b 강제) |
| player_b | UUID FK | 선수 B |
| count | INT | 파트너 횟수 |

### team_candidates
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | UUID PK | 후보 ID |
| session_id | BIGINT FK | 세션 |
| queue_position | INT | 순서 (0, 1, 2, ...) |
| game_type | TEXT | 혼복/남복/여복/혼합 |
| team_a_p1/p2 | UUID FK | A팀 선수 |
| team_b_p1/p2 | UUID FK | B팀 선수 |
| reason | TEXT NULL | 선발 사유 (예: "혼복 우선", "게임수 균등") |
| strategy | TEXT NULL | 전략 ID (예: "gameCountBalanced") |
| is_new | BOOLEAN DEFAULT false | 보충 모드에서 새로 생성된 팀 여부 |

---

## API 함수 목록

### api.ts

| 함수 | 호출 위치 |
|---|---|
| `fetchActiveSession()` | appStore |
| `fetchSessionSnapshot(sessionId)` | appStore, sessionStore |
| `startSession(...)` | appStore |
| `updateSession(...)` | appStore |
| `fetchAllSessions()` | LogPage |
| `fetchMatchLogs(sessionId)` | LogPage |
| `fetchSessionPlayers(sessionId)` | LogPage |
| `dbClearSessionLogs(sessionId)` | LogPage |
| `fetchSessionSettingsForConflictCheck(...)` | SessionSetup |
| `fetchSessionPlayerForConflictCheck(...)` | SessionSetup |
| `dbSaveTeamCandidates(sessionId, candidates)` | SessionMain |

### actions.ts

| 함수 | 호출 위치 |
|---|---|
| `dbAssignMatch(...)` | sessionStore |
| `dbCompleteMatch(...)` | sessionStore |
| `dbToggleResting(player)` | sessionStore |
| `dbToggleForceMixed(player)` | sessionStore |
| `dbToggleForceHardGame(player)` | sessionStore |
| `dbUpdateSessionPlayer(...)` | appStore |
| `dbEndSession(sessionId)` | sessionStore |

---

## 데이터 흐름

### 세션 시작

```
appStore.startOrUpdateSessionAction()
  ├─ api.startSession() → DB: INSERT sessions, session_players
  └─ sessionStore.initialize(clientState) → 클라이언트 상태 초기화
      → SessionMain useEffect → generateBulkTeamCandidates() + dbSaveTeamCandidates()
```

### 세션 로드 (새로고침 / 재접속)

```
appStore.loadSessionAction() / checkActiveSessionAction()
  ├─ api.fetchSessionSnapshot() → DB: SELECT sessions, session_players, matches, pair_history, team_candidates
  ├─ transformers.snapshotToClientState() → ClientSessionState 변환 (후보 포함)
  └─ sessionStore.initialize(clientState) → 클라이언트 상태 초기화
```

### 매치 배정

```
sessionStore.handleAssign(courtId)
  ├─ actions.dbAssignMatch() → DB: INSERT match, UPDATE players→playing
  ├─ applyBroadcast("match_started") → 로컬 상태 업데이트
  └─ sendBroadcast() → 다른 클라이언트에 전파
```

### 매치 완료

```
sessionStore.handleComplete(courtId)
  ├─ actions.dbCompleteMatch() → DB: UPDATE match→completed, UPSERT pair_history, UPDATE players→waiting
  ├─ applyBroadcast("match_completed") → 로컬 상태 업데이트
  ├─ sendBroadcast() → 다른 클라이언트에 전파
  └─ SessionMain useEffect → 자동 보충 (유효 후보 < 5개 시)
```

### 설정 업데이트 (세션 진행 중)

```
appStore.startOrUpdateSessionAction() (세션 존재 시)
  ├─ api.updateSession() → DB: INSERT/UPDATE/DELETE session_players, UPDATE sessions
  ├─ api.fetchSessionSnapshot() → DB 상태 재로드
  ├─ sessionStore.initialize(clientState) → 클라이언트 상태 재초기화
  └─ sessionStore.notifySessionRefresh() → 다른 클라이언트에게 DB 재로드 요청
```

---

## 브로드캐스트 이벤트

| 이벤트 | 발생 시점 | 수신 처리 |
|---|---|---|
| `match_started` | 매치 코트 배정 | 코트에 매치 추가, 대기열에서 선수 제거, 후보 팀 정리 |
| `match_completed` | 게임 완료 | 코트 비움, 선수→대기열, pair_history 업데이트 |
| `player_status_changed` | 대기↔휴식 전환 | waiting/resting 목록 이동 |
| `player_force_mixed_changed` | 혼복 우선배치 토글 | 대기열 선수 플래그 업데이트 |
| `player_force_hard_game_changed` | 빡겜 우선배치 토글 | 대기열 선수 플래그 업데이트 |
| `player_updated` | 선수 정보 수정 (성별/스킬) | 전체 목록에서 선수 정보 교체 |
| `candidates_updated` | 팀 후보 생성/보충 | 후보 목록 교체 |
| `session_ended` | 세션 종료 | onEnd() 콜백 |
| `session_updated` | 코트/선수 설정 변경 | 코트 수 조정, 선수 추가/제거 |
| `session_refresh_required` | 설정 대변경 후 | DB 전체 재로드 |
