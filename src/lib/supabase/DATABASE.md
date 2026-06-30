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
| match_state_version | BIGINT | **코트 배정 동기화 v1**(2026-06-22, `20260622130000`). NOT NULL DEFAULT 0. 모든 매치 변경 RPC(`assign_match`/`complete_match`/`set_match_roster`)가 같은 트랜잭션에서 ++. board_drafts 와 동일하게 sessions row(이미 realtime publication 등록)에 두어, postgres_changes UPDATE 가 코트 배정의 신뢰성 있는 change-detection 신호가 된다 → 수신측은 version 갭이면 matches 권위 재조회(`refetchMatches`). broadcast 유실/역전과 무관하게 수렴(원인: matches 단일 broadcast 경로 의존). |
| board_drafts | JSONB? | 보드 "팀 구성중" 멤버십 공유 드래프트 |
| cock_check_enabled | BOOLEAN | **콕 체크 모드**(2026-06-19, `20260619000000`). 디폴트 true. on이면 선수가 콕 제출 확인을 받아야 매칭 대기 상태가 됨 |
| board_drafts_version | BIGINT | **보드 동기화 v2**(2026-06-22, `20260622000000`). NOT NULL DEFAULT 0. board_drafts 낙관적 동시성(쓰기 CAS, `board_save_drafts`) + 수신측 단조성 가드 기준. 쓰기 경로는 `board_save_drafts` RPC(version CAS)로 배선됨(원인3 해소). |
| editor_client_id | TEXT? | **서버 권위 편집 락**(2026-06-22, `20260622000000`). "보유자" = `editor_client_id != null AND editor_lease_until > now()`. presence 파생 락을 대체(배선 완료) — 편집 락 섹션 참고. |
| editor_name | TEXT? | 편집 보유자 표시명(편집 락) |
| editor_lease_until | TIMESTAMPTZ? | 편집 락 lease 만료 시각. heartbeat(`board_claim_editor` 본인 재호출)로 연장, crash 시 자연 만료로 자동 회수 |

### session_players
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | UUID PK | 세션 내 선수 ID |
| session_id | BIGINT FK | 세션 |
| player_id | TEXT | 원본 선수 ID |
| member_id | UUID FK? | 회원 링크(members, 마이그레이션 `20260621060000`, `ON DELETE SET NULL`). 게스트·구 Sheets 선수는 NULL. 월별 콕 지원 판정에 사용(`SessionPlayer.memberId`) |
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
| cock_checked | BOOLEAN | **콕 제출 확인 여부**(2026-06-19, `20260619000000`). 디폴트 false. 매칭 대기 = `(NOT cock_check_enabled) OR cock_checked`. 운영자 확인(`dbSetCockChecked`)으로 true 전환, 미확인 자석은 보드에서 비활성·페어/추천/자동편성 제외 |

> **UNIQUE(session_id, player_id) (2026-06-18, `20260618000000`)**: 같은 세션에 같은 원본 player_id는 단 1 row. 과거 동시 설정 변경이 `insert()`(ON CONFLICT 없음)로 중복 row("독립 인스턴스" → 한 사람이 편성/대기/휴식 동시 공존)를 만들던 버그를 차단. 마이그레이션이 기존 중복을 canonical(playing>game_count>id) 한 row로 병합(matches 참조 재연결, status playing>resting>waiting)·삭제 후 제약 추가. `updateSession` 의 신규 추가는 `upsert(onConflict:'session_id,player_id', ignoreDuplicates:true)`(DO NOTHING)로 변경 — **이 코드는 제약 적용(마이그레이션 A) 후 배포해야 함**.
> **Realtime 구독(2026-06-18)**: `session_players` 를 `supabase_realtime` 퍼블리케이션에 추가 → 아래 postgres_changes 로 row 단위(추가/삭제/상태) 즉시 동기화.

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
| player_snapshot | JSONB? | **경기 시점 선수 스냅샷**(2026-06-18, `20260618000100`). `[team_a_p1, team_a_p2, team_b_p1, team_b_p2]` 순서 `{id,name,gender,skills}` 배열. 완료 시 `complete_match` 가 기록. 로그/디버그가 이걸로 이름을 표시하므로 선수가 삭제돼도 "?" 대신 당시 이름 유지(인스턴스 미참조). 구 매치는 null → 현재 선수 맵 폴백 → "?" |
| assigned_by | TEXT? | **경기 시작(편성)한 편집자 실명**(2026-06-30, `20260630020000`). `assign_match` 가 `p_name`(=auth.myName, 경기 시작 누른 사람)을 INSERT 시 기록. 로그(MatchCard)에 "편성 OO" 작게 표시. set_match_roster(팀 편집)는 미변경 → "최초 편성자" 고정. 구 매치/미전달은 null → UI 미표시 |

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

### group_settings (2026-06-30, `20260630030000`)
클럽 전역 설정 싱글톤(`id=1`). 회원관리>"콕 설정"(`GroupSettingsModal`)에서 편집.
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INT PK | 항상 1 (`check (id=1)`) |
| cock_quota_male | INT | 세션 콕체크 1회당 남자가 내는 콕 수(기본 2) |
| cock_quota_female | INT | 세션 콕체크 1회당 여자가 내는 콕 수(기본 1) |
| cock_support_per_month | INT | 회원당 매달 콕 지원 수(기본 1) |
| updated_at | TIMESTAMPTZ | |

RLS: select=authenticated 전체, write=`is_admin()`.

### cock_support_grants (2026-06-30, `20260630030000`)
회원이 어느 달(ym)에 콕 지원을 소진했는지 1행. 그 달 첫 콕체크 확인이 upsert로 소진(멱등).
| 컬럼 | 타입 | 설명 |
|---|---|---|
| member_id | UUID FK | members (`ON DELETE CASCADE`) |
| ym | TEXT | 'YYYY-MM' (KST) |
| session_id | BIGINT FK? | 소진된 세션(참고, `ON DELETE SET NULL`) |
| granted_at | TIMESTAMPTZ | |
| | PK | (member_id, ym) = 멱등 |

RLS: select=authenticated 전체, insert=authenticated(보드 편집자가 콕체크로 소진). 클라: `clubSettings.ts`(fetchGroupSettings/updateGroupSettings/fetchCockSupportUsed/grantCockSupport). 콕체크 모달(`CockCheckModal`)이 회원 단건 조회로 "이번 달 지원 미사용 → 남:1개만/여:안 내도 됨" 노출, `confirmCock` 가 소진.

---

## RPC 함수 (Postgres)

| RPC | 시그니처 | 용도 |
|---|---|---|
| `assign_match` | (코트 배정 파라미터) | matches INSERT(**assigned_by=p_name**, 2026-06-30 `20260630020000`: 경기 시작 누른 편집자 실명 기록) + players→playing + match_assign_count++ **+ match_state_version++**(2026-06-22, `20260622130000`: 코트 동기화 신호). 코트 점유 시 `unique_violation`→`RAISE EXCEPTION 'court already assigned'`(dbAssignMatch=false 처리) |
| `complete_match` | `(p_match_id UUID, p_session_id BIGINT, p_game_type TEXT, p_team_a_p1/p2 UUID, p_team_b_p1/p2 UUID)` | match→completed + **player_snapshot 기록**(2026-06-18) + pair_history UPSERT(같은 경기 4명 6쌍) + players→waiting(game_count++/혼복 남자 mixed_count++) **+ match_state_version++**(`20260622130000`). 시그니처 불변(스냅샷은 RPC 내부에서 session_players로부터 생성) |
| `set_match_roster` | `(p_match_id UUID, p_session_id BIGINT, p_team_a_p1/p2 UUID, p_team_b_p1/p2 UUID, p_removed_ids UUID[], p_added_ids UUID[])` | **경기 로스터 수정 원자 RPC**(2026-06-22, `20260622130000`, 기존 직접 UPDATE 대체). playing 매치의 4슬롯 교체 + removed→waiting + added→playing + match_state_version++ 를 단일 트랜잭션. 변경 선수(removed+added) 반환(클라 broadcast 용). game_count 는 완료 시점에만 집계하므로 미변경. |
| `load_session_state` | `(p_session_id BIGINT)` | **세션 상태 단일 스냅샷**(2026-06-22, `20260622140000`). board_drafts+version+match_state_version+court_count+editor_*+진행중 matches 를 단일 SELECT(같은 MVCC 시점)로 JSONB 반환. 재구독 catch-up·CAS 충돌 복구에서 팀 편성/코트 배정 두 권위를 "같은 시점"으로 수렴. 클라 `dbLoadSessionState`(sessionStore `resyncFromServer`). |
| `set_player_resting` | `(p_session_player_id UUID, p_session_id BIGINT, p_resting BOOLEAN)` | status 휴식/복귀 전환. 복귀 시 joined_at_match 를 휴식 구간만큼 전진(deficit 보정) + wait_since 리셋. 갱신 선수 반환 (`20260615130000`) |
| `board_claim_editor` | `(p_session_id BIGINT, p_client_id TEXT, p_name TEXT, p_lease_seconds INT=20)` | **보드 동기화 v2**(2026-06-22, `20260622000000`). 편집권 획득/연장(heartbeat) CAS. 조건부 UPDATE `WHERE editor IS NULL OR lease<now() OR editor=client` → row-lock 직렬화로 동시 호출 중 정확히 1명만 비-0행 수신(이중 편집권 차단). 결과 row(o_client_id/o_name/o_lease_until) 반환, 0행=획득 실패. 클라 `dbBoardClaimEditor`+heartbeat(7s). |
| `board_handoff_editor` | `(p_session_id BIGINT, p_from_client_id TEXT, p_to_client_id TEXT, p_to_name TEXT, p_lease_seconds INT=20)` | 편집권 명시 양도. 보유자 본인(`WHERE editor=from`)만 대상에게 이전. 클라 `dbBoardHandoffEditor`(BoardToolbar "넘기기"). |
| `board_takeover_editor` | `(p_session_id BIGINT, p_client_id TEXT, p_name TEXT, p_lease_seconds INT=20)` | **편집권 강제 탈취**(2026-06-23, `20260623050000`). 명시 "편집 권한 가져오기" 전용. lease 조건 **없이**(`WHERE id=session`만) 호출자를 편집자로 덮어쓴다 — `board_claim_editor`(CAS)가 활성 보유자의 유효 lease를 못 뺏어 가져오기가 되돌아가는 문제 해결. 직전 보유자는 다음 heartbeat(CAS) 거부 + 실시간 row 수신으로 읽기 모드로 수렴. 클라 `dbBoardTakeoverEditor`(sessionStore `claimEditor`). |
| `board_release_editor` | `(p_session_id BIGINT, p_client_id TEXT)` | 편집권 해제(정상 이탈: unsubscribe/pagehide). 보유자 본인만. crash 시는 lease 만료가 백업. |
| `board_save_drafts` | `(p_session_id BIGINT, p_client_id TEXT, p_name TEXT, p_payload JSONB, p_base_version BIGINT, p_lease_seconds INT=20)` | board_drafts 낙관적 버전 CAS 쓰기 **+ self-claim**. `WHERE version=base AND (editor IS NULL OR lease<now() OR editor=client)` 통과 시 board_drafts 교체+version+1+editor_*=호출자(쓰면서 락 획득/연장). 새 version 반환, 0행이면 NULL(충돌/타인 점유) → 통째 last-writer-wins 손실·조용한 실패 차단. self-claim이라 사전 claim 없이 첫 쓰기가 락을 잡음(데드존 없음). 클라 `dbBoardSaveDrafts`(boardStore `pushDraftsToRemote`, 직렬화+충돌 시 resync). |

> **제거된 RPC(deprecated)**: ~~`save_team_candidates(BIGINT, JSONB)`~~, ~~`save_match_queue(BIGINT, JSONB)`~~, ~~`activate_pending_player(BIGINT, UUID)`~~.
> ~~`swap_match_player(UUID, BIGINT, TEXT, UUID, UUID)`~~ — `20260615140000` 에서 추가됐으나 미사용으로 `20260616000000_db_cleanup.sql` 에서 DROP. **경기 수정(로스터 변경)은 `20260622130000` 부터 `set_match_roster` RPC**로 원자 처리(이전엔 클라가 matches/session_players 를 직접 UPDATE, 동기화 없음 — H3).

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
| `dbBoardSaveDrafts(sessionId, clientId, name, payload, baseVersion)` | boardStore `pushDraftsToRemote` (board_drafts version CAS 저장, →새 version\|null) |
| `dbLoadSessionState(sessionId)` | sessionStore `resyncFromServer`/`onResync` — `load_session_state` RPC: board_drafts+version+matches+match_state_version+editor_* 단일 스냅샷 재조회(`dbLoadSessionRow` 대체) |
| `dbLoadMatches(sessionId)` | sessionStore `refetchMatches` — 진행중 matches 단일 SELECT(match_state_version 갭 catch-up 시 코트 재구성) |
| `dbBoardClaimEditor/HandoffEditor/ReleaseEditor(...)` | sessionStore 편집 락 (획득·heartbeat/양도/해제) |

> **제거됨(deprecated)**: ~~`dbSaveTeamCandidates`~~, ~~`dbSaveMatchQueue`~~ (SessionMain 삭제로 호출처 소멸).

### actions.ts
| 함수 | 호출 위치 |
|---|---|
| `dbAssignMatch(...)` | sessionStore |
| `dbCompleteMatch(...)` | sessionStore |
| `dbUpdateSessionPlayer(id, gender, skills)` | appStore (선수 정보 변경 — gender/skills 직접 UPDATE) |
| `dbSetPlayerResting(id, sessionId, resting)` | sessionStore (`setResting` → `set_player_resting` RPC) |
| `dbSetMatchRoster(sessionId, matchId, teamA, teamB, removed, added)` | sessionStore (`handleSetMatchRoster`: 경기 로스터 수정 → `set_match_roster` RPC 원자 처리 + match_state_version++. 변경 선수 반환 → `match_roster_updated` broadcast + version 갭 catch-up 으로 모든 기기 수렴) |
| `dbEndSession(sessionId)` | sessionStore (`handleEndSession`: `sessions.is_active=false`) |

> **제거됨(deprecated)**: ~~`dbToggleResting`~~, ~~`dbToggleForceMixed`~~, ~~`dbToggleForceHardGame`~~, ~~`dbLogManualMatch`~~, ~~`dbActivatePendingPlayer`~~, ~~`dbSwapMatchPlayer`~~, ~~`dbLoadSessionRow`~~(→`dbLoadSessionState`로 통합). 휴식 전환은 `dbSetPlayerResting`(RPC), 경기 로스터 수정은 `dbSetMatchRoster`→`set_match_roster`(RPC)로 분리.
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

`BroadcastPayload` 유니온(broadcast.ts) 6종. 채널은 `self: false`(자기 이벤트 미수신). **broadcast 는 즉시성(best-effort)만 담당 — 권위 수렴은 version(matches=match_state_version, board=board_drafts_version) 비교 → 갭이면 권위 재조회.**

| 이벤트 | 발생 시점 | 수신 처리 |
|---|---|---|
| `match_started` | 매치 코트 배정 | 코트에 매치 추가, 대기열에서 선수 제거 |
| `match_completed` | 게임 완료 | 코트 비움, 선수→대기열, pair_history 업데이트 (updatedPlayers) |
| `match_roster_updated` | 경기 로스터 수정(`set_match_roster`) | 코트의 teamA/B 교체 + 상태 바뀐 선수 upsert (2026-06-22, H3 해결 — 이전엔 broadcast 없었음) |
| `player_updated` | 선수 정보/상태 변경 (성별·스킬·휴식 토글) | 전체 목록에서 선수 정보 교체 |
| `board_drafts_updated` | 보드 "팀 구성중" 멤버십 변경 | 드래프트 멤버십 교체 |
| `session_refresh_required` | 설정 대변경 후 | DB 전체 재로드 |

> **제거된 이벤트(deprecated)**: ~~`player_status_changed`~~(→ `player_updated` 로 통합), ~~`session_updated`~~,
> ~~`player_force_mixed_changed`~~, ~~`player_force_hard_game_changed`~~, ~~`candidates_updated`~~, ~~`session_ended`~~, ~~`pending_team`~~.

> **매치 broadcast 는 즉시성 전용, 권위는 catch-up**(2026-06-22): `match_started`/`match_completed`/`match_roster_updated` 를 놓치거나 순서가 역전돼도, 모든 매치 RPC 가 올린 `sessions.match_state_version` 갭을 postgres_changes 가 감지해 `refetchMatches`(matches 권위 재조회)로 수렴한다. 따라서 broadcast 페이로드에는 version 단조 가드를 두지 않는다(refetch 가 항상 최신 DB 로 교정).

## Realtime postgres_changes (2026-06-18)

`session-meta:{id}` 채널이 두 테이블을 row 단위로 감시한다.
- `sessions` UPDATE → **단일 `onSessionRowUpdate(row)`**(2026-06-22): `is_active`(세션 종료) + `match_assign_count` + **`board_drafts`/`board_drafts_version`(catch-up, 원인1)** + **`match_state_version`(코트 배정 catch-up, `20260622130000`)** + **`editor_*`(서버 권위 편집 락, 원인2)**를 한 row에서 처리. board_drafts는 broadcast(self:false) 누락 시 이 DB UPDATE로 수렴하고(`applyDraftsIfNewer` 단조 가드); **match_state_version 갭이면 `refetchMatches`(matches 권위 SELECT)로 코트 배정을 수렴**(broadcast 유실/역전·H1/H2 해결). 편집 락 변화도 같은 이벤트에 동승(`setCachedEditorFromRow`→`recomputeLock`). 이중 도착·자기 echo는 version 단조(`<=` 스킵)로 멱등. meta 채널 SUBSCRIBED(재연결) 시 `onResync`→`resyncFromServer`(`dbLoadSessionState`)로 **board_drafts+matches+버전+락을 단일 트랜잭션 스냅샷으로 1회 재조회**(두 권위 시점 일치, 옵션 B)해 재구독 공백을 메운다.
- **`session_players` `*`(INSERT/UPDATE/DELETE, filter `session_id`)**: 선수 추가/삭제/상태를 **즉시** 모든 기기에 전파(`sessionStore.onSessionPlayersChange`). DELETE→Map 제거+보드 자동 재정합(`initializeFromPool`), INSERT/UPDATE→`rowToSessionPlayer` upsert. broadcast(`player_updated` 등)와 이중 적용돼도 id 기반 upsert라 idempotent — broadcast 누락/지연·낙관적 반영 실패 시에도 DB 로 수렴(중복/미동기화/다중상태 방지). 코트(경기중)는 여전히 broadcast 가 담당(이 핸들러는 session_players Map 만 갱신).

> **`sessions` publication 정식 승격(2026-06-22, `20260622000000`)**: 기존엔 `docs/migration.sql` 수동 스크립트로만 `supabase_realtime` 에 추가돼 환경 드리프트가 있었다. Phase 0 마이그레이션이 `pg_publication_tables` 멱등 가드로 정식화. (sessions 는 UPDATE 만 구독·DELETE 필터 미사용이라 REPLICA IDENTITY 는 DEFAULT 로 충분 — payload.new 는 전체 컬럼 포함.)

## 편집 락 (서버 권위 — sessions.editor_* 컬럼, 2026-06-22 board 동기화 v2)

편집 보유자를 **단일 DB row(`sessions.editor_client_id`/`editor_name`/`editor_lease_until`)**가 결정한다. presence 다수결이 아니라 서버 권위라 presence 부분 동기화로 인한 **이중 편집권(원인2)이 구조적으로 불가능**하다. (이전 presence 파생 락 `computePresence`/`nextClaimAt`은 폐기.)

- **식별자**: `editor_client_id`에는 **로그인 사용자 id(`user.id`, 사람 단위)** 를 저장한다(2026-06-23). 같은 사람의 리로드·다른 탭·다른 기기는 같은 id라 `editor=client` 분기로 자기 lease를 즉시 재획득(자기 잠금 없음). 미로그인 등 부재 시에만 탭 단위 영속 `clientId`(sessionStorage) 폴백. (이전: 연결마다 randomUUID라 리로드 시 직전 lease에 묶여 20s 자기 잠금이 발생.)
- **보유자** = `editor_client_id != null AND editor_lease_until > now()`. `computeLockFromRow`로 `isEditor`/`holderClientId`/`holderName`/`lockFree` 산정.
- **획득**: (a) **자동 점유는 "혼자일 때만"(presenceCount<=1)** (2026-06-30 변경) — 자유 상태에서 접속자가 나뿐이면 즉시 낙관 점유(SessionBoard effect→`claimEditingIfFree`, maybeClaimIfAlone). **2명 이상이면 진입·창 액티브로 자동 점유하지 않는다** — 인원수와 무관히 자유 락을 낚아채 "뺏기는 것처럼" 보이던 버그(특히 창 복귀 시 무조건 재점유) 제거. 서버 락은 `board_save_drafts` self-claim 또는 heartbeat `board_claim_editor`(CAS: 자유/만료/본인)가 확정. (b) **명시 점유** — 직접 드래그 편집(`boardStore`→`claimEditingIfFree`, 자유 락만)과 **강제 탈취** "편집 권한 가져오기"(`claimEditor`→`board_takeover_editor`, 활성 보유자도 무조건). 직전 보유자는 다음 heartbeat 거부+실시간 수신으로 읽기 모드로 수렴(+뺏긴 쪽엔 `EditorTakenNotice` 다이얼로그).
- **유지**: 보유자만 7s heartbeat(`board_claim_editor`)로 20s lease 연장. 백그라운드(visibilitychange) 시 heartbeat 정지, 복귀 시엔 **서버 재동기만** 하고 자동 점유는 "혼자일 때만" 규칙을 따른다(여럿이면 재점유 안 함).
- **해제/회복**: 정상 이탈(unsubscribe/pagehide)→`board_release_editor`. crash/강제종료→20s lease 만료 후 자유(클라 4s `reeval` 타이머가 만료를 로컬 감지). presence leave 의존 없음.
- **양도**: 보유자가 접속자 모달에서 "넘기기"(`board_handoff_editor`)로 명시 이전.
- **stale 콜백 방어**: `lockEpoch`(권위 변경마다 증가)로 in-flight heartbeat의 늦은 `.then`이 handoff/세션전환 후 상태를 덮어쓰지 못하게 가드.
- presence(`session-bc:{id}`)는 이제 **접속자 목록 표시 전용**(`computePresenceList`) — 편집권 election에 쓰지 않는다. 비편집자는 멤버십 변경 차단(보기 전용)이되 broadcast/catch-up은 정상 수신.


## 보드 동기화 v2 롤아웃 현황 (2026-06-22)

세션 보드 팀 동기화 버그(관전자 팀 미표시 · 하드 새로고침 고착 · 이따금 이중 편집권)의 근본 원인 4건을 단계적으로 수정 중. 단일 편집자 + 신뢰성 있는 실시간 관전 + DB 진실원천 모델(CRDT 미도입).

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 마이그레이션 `20260622000000`: `editor_*`/`board_drafts_version` 컬럼 + 락/CAS RPC 4종 + sessions publication 멱등 승격. 클라 미사용(dormant). | ✅ 완료(스키마) |
| 1 | **관전자 렌더 수정(원인4)**: `SessionBoard` 의 `applyRemoteDrafts` effect 가 자석(`magnets`) 로드 전 영구 bail 하던 것을 제거하고 `magnetCount` 를 deps 에 추가 → 자석이 `boardDrafts` 보다 늦게 로드돼도 재적용되어 관전자가 팀을 그린다. (자석은 `applyRemoteDrafts` 가 add/remove 안 하므로 재실행 루프 없음.) | ✅ 완료 |
| 2 | **DB catch-up(원인1)**: `sessions` UPDATE 핸들러(`onSessionRowUpdate`)가 `board_drafts`/version을 읽어 broadcast 누락 보정 + 재구독 시 `onResync`→`resyncFromServer`(`dbLoadSessionRow`) 1회 재조회. version 단조 가드(`applyDraftsIfNewer`)로 broadcast/catch-up 역전·자기 echo 멱등. | ✅ 완료 |
| 3 | **쓰기 CAS(원인3·5)**: `dbSaveBoardDrafts`(통째 LWW, 제거됨) → `board_save_drafts` RPC(version CAS + self-claim). `pushDraftsToRemote`가 base_version 동반 호출 + `draftsSaveInFlight`/`pendingDraftsPayload` 직렬화(자기충돌 방지) + 0행 충돌 시 `resyncFromServer`(서버 수렴 + toast). | ✅ 완료 |
| 4 | **서버 권위 락(원인2)**: presence 파생 락 폐기(`computePresence`/`nextClaimAt` 삭제). `editor_*` row + `board_claim_editor`(heartbeat 7s)/`handoff`/`release`로 단일 편집자 보장. lease 20s + reeval 4s(crash 회복). board_save_drafts self-claim이라 Phase 3과 배포 데드존 없음. UX: 접속 즉시 자동 편집자 → "첫 편집 시 점유". | ✅ 완료 |

## 코트 배정(matches) 동기화 v1 (2026-06-22, `20260622130000`/`20260622140000`)

board_drafts(팀 편성)는 위 v2로 수렴했으나 **matches(코트 배정)는 broadcast 단일 경로 의존**이라 같은 부류의 미동기화가 남아 있었다(근본 원인 검증 H1~H5). board_drafts 패턴을 matches 로 확장한다.

| Phase | 내용 | 상태 |
|---|---|---|
| A-1 | **단조 우산 신설**: `sessions.match_state_version` 컬럼 + 모든 매치 RPC(`assign_match`/`complete_match`/`set_match_roster`)가 같은 트랜잭션에서 ++. matches 를 publication 에 넣지 않고 sessions row 신호만으로 catch-up(부하 회피). | ✅ 완료 |
| A-2 | **로스터 RPC 원자화(H3)**: 직접 UPDATE `dbSetMatchRoster` → `set_match_roster` RPC(matches+session_players+version 단일 트랜잭션) + `match_roster_updated` broadcast. 이전엔 "동기화 안 함"이라 편집자만 보였음. | ✅ 완료 |
| A-3 | **version 갭 catch-up(H1/H2/H4/H5)**: `onSessionRowUpdate`/`onResync` 가 `match_state_version` 갭 감지 시 `refetchMatches`(matches 권위 SELECT)로 코트 재구성. broadcast 유실/역전·"선수는 playing인데 코트 빔"·재연결 공백 모두 수렴. broadcast 는 즉시성 전용. | ✅ 완료 |
| B | **단일 스냅샷 통합(`20260622140000`)**: `load_session_state` RPC 로 board_drafts+matches+버전+락을 단일 트랜잭션 스냅샷으로 반환 → `resyncFromServer` 가 두 권위를 "같은 시점"으로 수렴(시점차 제거). `dbLoadSessionRow`→`dbLoadSessionState` 통합. | ✅ 완료 |

> 클라 추천/랭킹/페어 계산은 서버로 옮기지 않는다(무겁고 잦은 순수 계산 → 분산 클라 유지). 서버 이전은 "가벼운 검증/원자적 다중행 변경/권위 재조회"에 한정.
