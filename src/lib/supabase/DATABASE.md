# 데이터베이스 사용 현황

## 테이블 구조

### sessions
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | BIGSERIAL PK | 세션 ID |
| is_active | BOOLEAN | 활성 세션 여부 |
| court_count | INT | 코트 수 |
| script_url | TEXT? | Google Sheets 연동 URL |
| started_at | TIMESTAMPTZ | 시작 시각 |
| ended_at | TIMESTAMPTZ? | 종료 시각 |

### session_players
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | UUID PK | 세션 내 선수 ID |
| session_id | BIGINT FK | 세션 |
| player_id | TEXT | 원본 선수 ID (Google Sheets) |
| name | TEXT | 이름 |
| gender | TEXT | M/F |
| skills | JSONB | 7개 스킬 |
| allow_mixed_single | BOOLEAN | 혼합 단식 가능 여부 |
| status | TEXT | waiting/playing/resting/reserved |
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

### reserved_groups
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | "reserved-{timestamp}" |
| session_id | BIGINT FK | 세션 |
| member_ids | UUID[] | 전체 멤버 |
| ready_ids | UUID[] | 대기 중인 멤버 |

### team_candidates
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | UUID PK | 후보 ID |
| session_id | BIGINT FK | 세션 |
| queue_position | INT | 순서 (0, 1, 2, ...) |
| game_type | TEXT | 혼복/남복/여복/혼합 |
| team_a_p1/p2 | UUID FK | A팀 선수 |
| team_b_p1/p2 | UUID FK | B팀 선수 |

---

## API 함수 목록 & 사용 여부

### api.ts

| 함수 | 호출 위치 | 상태 |
|---|---|---|
| `fetchActiveSession()` | appStore | ✅ 사용 중 |
| `fetchSessionSnapshot(sessionId)` | appStore, sessionStore | ✅ 사용 중 |
| `startSession(...)` | appStore | ✅ 사용 중 |
| `updateSession(...)` | appStore | ✅ 사용 중 |
| `fetchAllSessions()` | LogPage | ✅ 사용 중 |
| `fetchMatchLogs(sessionId)` | LogPage | ✅ 사용 중 |
| `fetchSessionPlayers(sessionId)` | LogPage | ✅ 사용 중 |
| `dbClearSessionLogs(sessionId)` | LogPage | ✅ 사용 중 |
| `fetchSessionSettingsForConflictCheck(...)` | SessionSetup | ✅ 사용 중 |
| `fetchSessionPlayerForConflictCheck(...)` | SessionSetup | ✅ 사용 중 |
| `dbSaveTeamCandidates(sessionId, candidates)` | appStore | ✅ 사용 중 |
| `dbFetchTeamCandidates(sessionId)` | — | ❌ **미사용** |
| `dbDeleteTeamCandidate(candidateId)` | actions.ts | ✅ 사용 중 |
| `teamCandidateRowToGeneratedTeam(row, map)` | — | ❌ **미사용** |

### actions.ts

| 함수 | 호출 위치 | 상태 |
|---|---|---|
| `dbAssignMatch(...)` | sessionStore | ✅ 사용 중 |
| `dbCompleteMatch(...)` | sessionStore | ✅ 사용 중 |
| `dbToggleResting(player)` | sessionStore | ✅ 사용 중 |
| `dbToggleForceMixed(player)` | sessionStore | ✅ 사용 중 |
| `dbToggleForceHardGame(player)` | sessionStore | ✅ 사용 중 |
| `dbUpdateSessionPlayer(...)` | appStore | ✅ 사용 중 |
| `dbCreateReservation(...)` | sessionStore | ✅ 사용 중 |
| `dbDisbandGroup(group)` | sessionStore | ✅ 사용 중 |
| `dbEndSession(sessionId)` | sessionStore | ✅ 사용 중 |

---

## 데이터 흐름

### 세션 시작

```
appStore.startOrUpdateSessionAction()
  ├─ api.startSession() → DB: INSERT sessions, session_players
  ├─ teamGenerator.generateBulkTeamCandidates() → 메모리에서 팀 후보 생성
  ├─ api.dbSaveTeamCandidates() → DB: INSERT team_candidates
  └─ sessionStore.initialize(clientState) → 클라이언트 상태 초기화
```

### 세션 로드 (새로고침 / 재접속)

```
appStore.loadSessionAction() / checkActiveSessionAction()
  ├─ api.fetchSessionSnapshot() → DB: SELECT sessions, session_players, matches, pair_history, reserved_groups
  ├─ transformers.snapshotToClientState() → ClientSessionState 변환
  └─ sessionStore.initialize(clientState) → 클라이언트 상태 초기화
```

### 매치 배정

```
sessionStore.handleAssign(courtId)
  ├─ actions.dbAssignMatch() → DB: INSERT match, UPDATE players→playing, DELETE reserved_group?, DELETE team_candidate?
  ├─ applyBroadcast("match_started") → 로컬 상태 업데이트
  └─ sendBroadcast() → 다른 클라이언트에 전파
```

### 매치 완료

```
sessionStore.handleComplete(courtId)
  ├─ actions.dbCompleteMatch() → DB: UPDATE match→completed, UPSERT pair_history, UPDATE players→waiting/reserved
  ├─ applyBroadcast("match_completed") → 로컬 상태 업데이트
  ├─ sendBroadcast() → 다른 클라이언트에 전파
  └─ (100ms 후) generateTeamCandidates() → 새 후보 자동 생성 (메모리만)
```

### 설정 업데이트 (세션 진행 중)

```
appStore.startOrUpdateSessionAction() (세션 존재 시)
  ├─ api.updateSession() → DB: INSERT/UPDATE/DELETE session_players, UPDATE sessions
  ├─ api.fetchSessionSnapshot() → DB 상태 재로드
  ├─ generateBulkTeamCandidates() → 팀 후보 재생성
  ├─ api.dbSaveTeamCandidates() → DB: DELETE old + INSERT new team_candidates
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
| `group_reserved` | 예약 그룹 생성 | 예약 목록 추가, 대기열에서 제거 |
| `group_disbanded` | 예약 그룹 해체 | 예약 목록 제거, 대기열에 복귀 |
| `session_ended` | 세션 종료 | onEnd() 콜백 |
| `session_updated` | 코트/선수 설정 변경 | 코트 수 조정, 선수 추가/제거 |
| `session_refresh_required` | 설정 대변경 후 | DB 전체 재로드 |

---

## 🔴 문제점

### 1. team_candidates: DB에 저장만 하고 로드하지 않음

**저장**: `appStore` → 세션 시작/업데이트 시 `dbSaveTeamCandidates()`로 DB에 저장
**로드**: `fetchSessionSnapshot()`에서 team_candidates를 **조회하지 않음**
**결과**: 새로고침하면 DB에 저장된 팀 후보가 사라짐

```
저장 경로: appStore → dbSaveTeamCandidates() → DB ✅
로드 경로: fetchSessionSnapshot() → ❌ team_candidates 미조회
          snapshotToClientState() → ❌ candidateTeams 미포함
          sessionStore.initialize() → ❌ candidateTeams 초기화 안 됨
```

미사용 함수:
- `dbFetchTeamCandidates()` — 정의만 되어 있고 호출 없음
- `teamCandidateRowToGeneratedTeam()` — 정의만 되어 있고 호출 없음

### 2. handleComplete 자동 생성 팀이 DB에 저장되지 않음

매치 완료 후 `generateTeamCandidates()`로 새 후보를 생성하지만 **메모리에만** 저장.
`dbSaveTeamCandidates()`를 호출하지 않아 다른 클라이언트에서 볼 수 없고 새로고침 시 사라짐.

### 3. candidateTeams 상태가 브로드캐스트로 동기화되지 않음

팀 후보 변경 시 다른 클라이언트에 전파하는 브로드캐스트 이벤트가 없음.
클라이언트 A에서 팀을 배정하면 `match_started` 브로드캐스트에서 해당 선수 포함 후보를 필터링하지만,
새로 자동 생성된 후보 목록은 다른 클라이언트에 전달되지 않음.

### 4. SessionSnapshot/ClientSessionState에 candidateTeams 누락

```typescript
// types.ts - team_candidates 관련 필드 없음
interface SessionSnapshot {
  session, players, matches, pairHistory, reservedGroups
  // ❌ teamCandidates 없음
}
interface ClientSessionState {
  courts, waiting, resting, reservedGroups, pairHistory
  // ❌ candidateTeams 없음
}
```

### 5. dbAssignMatch의 usedCandidateId 미연결

`dbAssignMatch()`는 `usedCandidateId` 파라미터를 받아 사용한 후보를 DB에서 삭제하지만,
`sessionStore.handleAssign()`에서 이 파라미터를 전달하지 않음 (현재 undefined로 호출).
