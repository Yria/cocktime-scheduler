# 데이터베이스 사용 현황

> **2026-06 리팩토링 반영**: 자동 팀 편성 / 매치 대기열 / pending / 수동매칭 로그 / 팀 후보 슬라이스 제거.
> 메인 기능은 보드(SessionBoard, react-konva 자석 칠판). `/session` = 보드, 구 `/session/board` 는 `/session` 으로 리다이렉트.

## 테이블 구조

### sessions
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | BIGSERIAL PK | 세션 ID |
| is_active | BOOLEAN | 활성 세션 여부 |
| court_count | INT | 코트 수 |
| started_at | TIMESTAMPTZ | 시작 시각 |
| ended_at | TIMESTAMPTZ? | 종료 시각 |
| match_assign_count | INT | 누적 코트 배정 횟수 (deficit 기산점) |
| board_drafts | JSONB? | 보드 "팀 구성중" 멤버십 공유 드래프트 |

### session_players
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | UUID PK | 세션 내 선수 ID |
| session_id | BIGINT FK | 세션 |
| player_id | TEXT | 원본 선수 ID |
| name | TEXT | 이름 |
| gender | TEXT | M/F |
| skills | JSONB | 7개 스킬 |
| allow_mixed_single | BOOLEAN | 혼합 단독 배치 허용 여부 |
| status | TEXT | waiting/playing/resting (**pending 제거됨**) |
| game_count | INT | 게임 수 |
| mixed_count | INT | 혼복 게임 수 |
| joined_at_match | INT | 합류 시점 match_assign_count (deficit 기산점) |
| wait_since | TIMESTAMPTZ? | 대기 시작 시각 (휴식 진입 시 NULL, 복귀 시 now()) |
| rest_since_match | INT? | **서버 전용** — 휴식 진입 시 match_assign_count 기록. 복귀 시 `set_player_resting` 이 joined_at_match 를 휴식 구간만큼 전진시켜 deficit 폭증 방지. 클라이언트 타입/transformer 는 읽지 않음 (마이그레이션 `20260615130000`) |

> **제거됨(deprecated)**: `force_mixed`(혼복 우선배치) / `force_hard_game`(빡겜 우선배치) 컬럼.
> 마이그레이션 `20260612120000_remove_legacy_team_formation.sql` 에서 `ALTER TABLE session_players DROP COLUMN IF EXISTS` 로 DROP. 코드 필드·transformer(`rowToSessionPlayer`)·타입(`SessionPlayerRow`)·`DebugMatchModal` 표시까지 전부 제거됨.

### matches
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | UUID PK | 매치 ID |
| session_id | BIGINT FK | 세션 |
| court_id | INT | 코트 번호 |
| game_type | TEXT | 혼복/남복/여복/혼합 |
| team_a_p1/p2 | UUID FK? | A팀 선수 (`ON DELETE SET NULL`) |
| team_b_p1/p2 | UUID FK? | B팀 선수 (`ON DELETE SET NULL`) |
| status | TEXT | playing/completed |
| started_at | TIMESTAMPTZ | 시작 시각 |
| ended_at | TIMESTAMPTZ? | 종료 시각 |

> **코트 이중배정 방지(2026-06-15)**: 부분 유니크 인덱스 `uq_matches_active_court (session_id, court_id) WHERE status='playing'` — 코트당 진행중 매치 최대 1개. 마이그레이션 `20260615120000_prevent_court_double_booking.sql`. 완료(completed) 매치는 대상 아님(코트 재사용 정상).
> **FK 정책(2026-06-16, `20260616000000_db_cleanup.sql`)**: team_*_p* 는 `ON DELETE SET NULL`(NULL 허용) — 선수 삭제 시 매치 기록은 보존되고 참조만 NULL. 진행중(playing) 매치 선수는 `updateSession` 이 `status != 'playing'` 필터로 삭제 제외하므로 활성 매치엔 NULL 이 생기지 않음. `pair_history` FK 는 `ON DELETE CASCADE`. 이로써 선수 삭제가 FK 로 막히지 않음.

### pair_history
| 컬럼 | 타입 | 설명 |
|---|---|---|
| session_id | BIGINT FK | 세션 |
| player_a | UUID FK | 선수 A (player_a < player_b 강제) |
| player_b | UUID FK | 선수 B |
| count | INT | 동반 횟수 |

> **제거된 테이블(deprecated)**: ~~`team_candidates`~~, ~~`manual_match_logs`~~ (마이그레이션 `20260612120000_remove_legacy_team_formation.sql` 에서 DROP).

---

## RPC 함수 (Postgres)

| RPC | 시그니처 | 용도 |
|---|---|---|
| `assign_match` | (코트 배정 파라미터) | matches INSERT + players→playing + match_assign_count++. 코트 점유 시 `unique_violation`→`RAISE EXCEPTION 'court already assigned'`(dbAssignMatch=false 처리) |
| `complete_match` | `(p_match_id UUID, p_session_id BIGINT, p_game_type TEXT, p_team_a_p1/p2 UUID, p_team_b_p1/p2 UUID)` | match→completed + pair_history UPSERT(같은 경기 4명 6쌍) + players→waiting(game_count++/혼복 남자 mixed_count++) |
| `set_player_resting` | `(p_session_player_id UUID, p_session_id BIGINT, p_resting BOOLEAN)` | status 휴식/복귀 전환. 복귀 시 joined_at_match 를 휴식 구간만큼 전진(deficit 보정) + wait_since 리셋. 갱신 선수 반환 (`20260615130000`) |

> **제거된 RPC(deprecated)**: ~~`save_team_candidates(BIGINT, JSONB)`~~, ~~`save_match_queue(BIGINT, JSONB)`~~, ~~`activate_pending_player(BIGINT, UUID)`~~.
> ~~`swap_match_player(UUID, BIGINT, TEXT, UUID, UUID)`~~ — `20260615140000` 에서 추가됐으나 미사용으로 `20260616000000_db_cleanup.sql` 에서 DROP. **경기 수정(선수 교체)은 RPC 없이 클라이언트가 matches/session_players 를 직접 UPDATE**(`dbSetMatchRoster`)한다.

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
| `dbSaveBoardDrafts(...)` | sessionStore (보드 드래프트 저장) |

> **제거됨(deprecated)**: ~~`dbSaveTeamCandidates`~~, ~~`dbSaveMatchQueue`~~ (SessionMain 삭제로 호출처 소멸).

### actions.ts
| 함수 | 호출 위치 |
|---|---|
| `dbAssignMatch(...)` | sessionStore |
| `dbCompleteMatch(...)` | sessionStore |
| `dbUpdateSessionPlayer(id, gender, skills)` | appStore (선수 정보 변경 — gender/skills 직접 UPDATE) |
| `dbSetPlayerResting(id, sessionId, resting)` | sessionStore (`setResting` → `set_player_resting` RPC) |
| `dbSetMatchRoster(matchId, teamA, teamB, removed, added)` | sessionStore (`handleSetMatchRoster`: 경기 수정 — matches/session_players **직접 UPDATE**, 브로드캐스트 없이 결과만 반영) |
| `dbEndSession(sessionId)` | sessionStore (`handleEndSession`: `sessions.is_active=false`) |

> **제거됨(deprecated)**: ~~`dbToggleResting`~~, ~~`dbToggleForceMixed`~~, ~~`dbToggleForceHardGame`~~, ~~`dbLogManualMatch`~~, ~~`dbActivatePendingPlayer`~~, ~~`dbSwapMatchPlayer`~~. 휴식 전환은 `dbSetPlayerResting`(RPC), 경기 수정은 `dbSetMatchRoster`(직접 UPDATE)로 분리.
> **재추가됨**: `dbEndSession` (세션 종료) — 보드 헤더 [세션 종료] 버튼 → `handleEndSession` → `is_active=false`. 다른 클라이언트는 `is_active` postgres watch 로 종료 감지(`session_ended` 브로드캐스트는 미사용).

---

## 데이터 흐름

### 세션 시작
```
appStore.startOrUpdateSessionAction()
  ├─ api.startSession() → DB: INSERT sessions(match_assign_count=0), session_players(status='waiting')
  └─ sessionStore.initialize(clientState) → 클라이언트 상태 초기화 (보드)
```

### 세션 로드 (새로고침 / 재접속)
```
appStore.loadSessionAction() / checkActiveSessionAction()
  ├─ api.fetchSessionSnapshot() → DB: SELECT sessions, session_players, matches, pair_history
  ├─ transformers.snapshotToClientState() → ClientSessionState 변환 (boardDrafts·lastGameType 포함)
  └─ sessionStore.initialize(clientState) → 클라이언트 상태 초기화
```

### 매치 배정
```
sessionStore.handleAssign(courtId)
  ├─ actions.dbAssignMatch() → RPC assign_match: INSERT match, UPDATE players→playing, match_assign_count++
  ├─ applyBroadcast("match_started") → 로컬 상태 업데이트
  └─ sendBroadcast() → 다른 클라이언트에 전파
```

### 매치 완료
```
sessionStore.handleComplete(courtId)
  ├─ actions.dbCompleteMatch() → RPC complete_match: match→completed, UPSERT pair_history, players→waiting
  ├─ applyBroadcast("match_completed") → 로컬 상태 업데이트 (updatedPlayers 반영)
  └─ sendBroadcast() → 다른 클라이언트에 전파
```

### 휴식 전환
```
sessionStore (휴식 토글)
  ├─ actions.dbUpdateSessionPlayer() → DB: UPDATE session_players SET status='resting'|'waiting'
  └─ sendBroadcast("player_updated") → 갱신된 선수 전파
```

### 보드 추천 (DB 미사용)
```
보드 "팀 구성중" 빈 슬롯(+) 클릭
  └─ recommendTeammates(confirmed, pool, ctx) → 후보 순위(클라이언트 계산, DB 저장 없음)
```

---

## 브로드캐스트 이벤트

`BroadcastPayload` 유니온(broadcast.ts) 5종. 채널은 `self: false`(자기 이벤트 미수신).

| 이벤트 | 발생 시점 | 수신 처리 |
|---|---|---|
| `match_started` | 매치 코트 배정 | 코트에 매치 추가, 대기열에서 선수 제거 |
| `match_completed` | 게임 완료 | 코트 비움, 선수→대기열, pair_history 업데이트 (updatedPlayers) |
| `player_updated` | 선수 정보/상태 변경 (성별·스킬·휴식 토글) | 전체 목록에서 선수 정보 교체 |
| `board_drafts_updated` | 보드 "팀 구성중" 멤버십 변경 | 드래프트 멤버십 교체 |
| `session_refresh_required` | 설정 대변경 후 | DB 전체 재로드 |

> **제거된 이벤트(deprecated)**: ~~`player_status_changed`~~(→ `player_updated` 로 통합), ~~`session_updated`~~,
> ~~`player_force_mixed_changed`~~, ~~`player_force_hard_game_changed`~~, ~~`candidates_updated`~~, ~~`session_ended`~~, ~~`pending_team`~~.

> **경기 수정(`dbSetMatchRoster`)은 브로드캐스트 안 함** — 결과만 DB 에 반영하고 편집자 로컬만 갱신. 다른 기기는 다음 스냅샷 로드 시 반영.

## 편집 락 (Realtime Presence, DB 미사용)

같은 `session-bc:{id}` 채널의 **Presence** 로 동시편집을 제어한다(DB 테이블 없음). 각 기기가 `{clientId, name, claimAt}` 를 track → 현재 접속자 중 `claimAt` 최댓값이 **편집자(보유자)**, 아무도 claim 안 했으면 자유(누구나 편집, 첫 편집이 자동 점유). 비편집자는 모든 변경 액션 차단(보기 전용)이되 위 브로드캐스트는 정상 수신. 헤더 칩 → 접속자 모달에서 "편집 권한 가져오기"로 즉시 인계. 보유자 이탈 시 presence 에서 사라져 자동 자유/인계(영구 잠금 없음).
