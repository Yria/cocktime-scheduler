# 세션 보드 실시간 동기화 재설계 (Realtime-aware)

> 상태: **Stage 1 + Stage 2a 구현 완료(작업 트리) · DB `supabase db push` 대기 · 적대적 리뷰 반영** · 2026-07-22 · Stage 2b(postgres_changes 제거 + publication drop) 미착수(게이팅)
> 관련 코드: `src/lib/supabase/{sessionChannels,broadcast,board,client}.ts`, `src/store/{sessionStore,sessionBroadcastHandlers,sessionEditorLock}.ts`, `src/store/board/draftsSync.ts`, `supabase/migrations/*_load_session_state*.sql`

## 1. 증상과 배경

두 클라이언트(편집자 1 + 관전자 여럿)의 보드 화면이 **자주·지속적으로 어긋난다**("서로 똑같은 화면이 안 나온다"). 규모는 세션당 선수 수십 명, 동시 접속 기기 2~10, 세션 지속 2~4시간, 모바일 PWA(iOS) 사용이 많다. 과거 Supabase Realtime 메시지 쿼터 초과 이력이 있어 이후 'Realtime 감축' 작업(커밋 `99c76fa`)으로 브로드캐스트 이중화를 제거한 바 있다.

## 2. 근본 원인 (다각도 조사 + 적대적 검증으로 확정)

**한 문장: 정합성(누가 맞는 화면인가)을 at-most-once realtime 메시지 배달에 결합해 놓았고, 그 복구 안전망(`resyncFromServer`)이 불완전하고 발동 조건이 너무 좁다.** 전송(postgres_changes) 자체가 근본 문제가 아니다.

### 2-1. 지배 원인 — `session_players`가 복구되지 않음 (CONFIRMED, 심각)
- `session_players`(대기열/휴식/콕체크/입퇴장)는 **delta 방식** postgres_changes라 각 이벤트가 자기 row 하나만 실어온다.
- 유일한 복구 경로 `resyncFromServer` → `load_session_state` RPC가 **`session_players`를 아예 반환하지 않는다**(board_drafts·matches·editor만). `sessionPlayers` Map은 최초 진입(initialize) 이후 오직 라이브 이벤트로만 갱신된다.
- 결과: 소켓이 잠깐 끊긴 사이(모바일 백그라운드·네트워크 blip·토큰 만료 등) 놓친 "선수 삭제/휴식 토글/콕체크"는 **탭 재포커스로도, 재구독으로도 절대 backfill되지 않는다.** 새로고침 전까지 두 화면이 계속 다르다.
- 부가로 `set_player_resting`/`set_cock_checked`는 sessions row 버전도 올리지 않아 스냅샷에도 안 실린다.

### 2-2. 2차 원인 — board_drafts/matches가 단일 postgres_changes에 의존 (CONFIRMED, 대부분 self-heal)
- 'Realtime 감축'에서 `board_drafts_updated` 브로드캐스트를 제거해, `sessions` row UPDATE **하나가 유일 권위 경로**가 됐다. 코트/매치 복구 신호(`match_state_version`)도 같은 UPDATE에 실려오므로, 그 한 건을 놓치면 편성과 코트가 동시에 멈춘다.
- 전량 스냅샷 + 단조 모델이라 **다음 UPDATE 한 건이면 자동 복구**되지만, "편성 확정 → 보드 유휴 → 마지막 UPDATE 유실 → 뷰어가 계속 foreground(재포커스 없음)"이면 지속 stale. 이게 배드민턴 앱의 표준 흐름(편성 후 관전)과 정확히 겹친다.
- 능동적 갭 감지·폴링이 전혀 없다. 복구 트리거가 `visibilitychange`와 재구독(SUBSCRIBED)뿐이다.

### 2-3. 반증된 가설 (여기 손대면 오진)
- **auth/RLS/`realtime.setAuth`**: supabase-js 2.108.2가 `TOKEN_REFRESHED` 시 `realtime.setAuth`를 **자동 호출**한다(`index.mjs:847`). 수동 추가는 no-op.
- **quota 초과**: 월 메시지는 과금 미터일 뿐 조용히 드롭되지 않는다. 초당 rate-limit은 `phx_close`(연결 끊김→재구독→resync). 약한 증폭 요인일 뿐 원인 아님.
- **`board_drafts_updated` 브로드캐스트 재도입**: 브로드캐스트도 at-most-once라 이중화가 안 된다. 감축 목표만 되돌린다.

## 3. 설계 원칙

> **정합성은 realtime 메시지가 도착했는지에 절대 의존하지 않는다.**
> Realtime은 "뭔가 바뀌었다"는 **힌트**일 뿐이고, 진실은 **버전을 비교해 스냅샷을 PULL**해서 얻는다. Realtime은 저지연 fast-path, 정합성은 pull+version이 보장한다.

이 원칙은 매치 동기화가 이미 부분적으로 쓰고 있다(`match_state_version` 갭 → `refetchMatches`). 재설계는 이 패턴을 **모든 공유 상태로 완성**하는 것이다.

## 4. 두 종류의 버전 (핵심 — 하나로 합치면 안 됨)

| 버전 | 역할 | 누가 올리나 | 용도 |
|---|---|---|---|
| **`sync_version`** (신설, 세션당 1개) | "뭔가 바뀜" | 모든 공유상태 write | realtime 신호 + 갭 감지 |
| **component version** (`board_drafts_version`·`match_state_version`, **유지**) | "이 조각을 적용해도 안전한가" | 해당 조각 write | **단조 apply-gating** |

`sync_version` 하나로 통합하면, 남이 선수를 토글해서 pull이 돌 때 **편집자가 방금 만든 팀 편성이 stale 스냅샷에 원복**된다(데이터 손실). component version의 단조 게이팅(`applyDraftsIfNewer`)이 편집자의 in-flight 편집을 보호하므로 반드시 살려둔다.

## 5. 목표 아키텍처 (Stage 2 — realtime 전제 DB 재설계)

1. **`sessions.sync_version bigint`** — 세션의 리비전 시계. 공유상태가 바뀔 때마다 +1.
2. **bump는 RPC 규율이 아니라 트리거로 강제한다.** 공유상태 write가 SECURITY DEFINER RPC뿐 아니라 **직접 PostgREST write 5개**(startSession·updateSession·dbUpdateSessionPlayer·dbEndSession)와 **세션 종료 트리거**까지 3원화돼 있어, "모든 RPC가 bump한다" 규율로는 못 잡는다.
   - `session_players`·`matches` **AFTER 트리거** → 부모 `sessions.sync_version` bump
   - `sessions` **BEFORE UPDATE 트리거** → 감시 컬럼(board_drafts/editor_*/court_count/status…) 변경 시 bump (sync_version 단독 변경은 skip해 재귀 차단)
   - → 모든 경로가 같은 초크포인트를 통과 = 불변식이 구조적으로 보장됨.
3. **`load_session_state`를 유일 권위 스냅샷으로.** `session_players` + `sync_version` 추가(component version 동봉 유지). board_drafts + matches + players + editor lock을 **한 MVCC 시점**으로 반환.
4. **전송: Broadcast from Database.** `sessions` `AFTER UPDATE OF sync_version` 트리거 →
   ```sql
   perform realtime.send('{"v": ' || NEW.sync_version || '}'::jsonb, 'sync', 'session:' || NEW.id, true);
   ```
   `broadcast_changes`(행 diff 포맷)가 아니라 **`realtime.send`**(커스텀 페이로드). private 채널이라 4번째 인자 `true`. write 트랜잭션 안에서 도므로 **비치명 처리**(실패해도 write를 물면 안 됨).
   - RLS: `realtime.messages`에 `FOR SELECT TO authenticated`(+`realtime.topic() like 'session:%'` 스코핑). postgres_changes의 per-row·per-subscriber RLS와 달리 **접속 시 1회**만 검사.
   - 배포 확인 후 `sessions`/`session_players`를 postgres_changes publication에서 DROP.
5. **클라: 힌트 수신 → debounce pull.** `session:{id}` private 채널 구독(구독 전 `realtime.setAuth()` 필수). 힌트가 로컬보다 크면 `load_session_state` pull. component version으로 apply-gating(board_drafts/matches 단조, players full-replace, lock from snapshot).

### 5-1. 쿼터에 대한 사실 (오해 정정)
- 브로드캐스트도 fan-out 미터는 **N+1**(발신 1 + 수신자당 1). "broadcast라 싸다"는 틀림.
- 절감의 본질은 **이벤트 통합**: 지금 `assign_match` 한 번이 `session_players` 4행 + `sessions` 1 = **5 이벤트 × N**인데, 재설계는 `sync_version` bump **1 신호 × N**. 다중행 op에서 ~5배 감소.
- 편집 락은 하트비트가 폐기됐으므로(`20260717000000_lock_sticky_no_heartbeat`) `sync_version`에 태워도 bump 폭풍이 없다.

## 6. 2단계 실행 계획

전송계층 재작성(broadcast-from-DB + publication drop)은 **desync 치료에 필요하지 않다.** desync 원인은 "resync가 선수를 안 읽음 + 갭 감지 부재"이지 "전송 방식"이 아니다. 그래서 분리한다.

### 🟢 Stage 1 — desync 실제 종결 (먼저, 저위험, 롤백 쉬움, 전송 불변)
1. **`load_session_state`에 `session_players` 추가** + `resyncFromServer`가 선수 Map 전량 교체(full-replace라 삭제 이벤트 유실도 자동 수렴) + `rebuildDerivedIds`. → 이미 있는 재연결/foreground/충돌복구 경로가 즉시 선수까지 수렴.
2. **reconcile-edge 안전화**: `resyncFromServer`의 board_drafts/matches 적용을 **단조 게이팅**으로 바꾼다(스냅샷이 로컬보다 새로울 때만 덮어씀). 충돌 복구 롤백 경로만 `force`로 우회. 워치독이 이 경로를 자주 돌리므로, 늦게 도착한 stale pull이 방금 저장한 편집을 덮는 레이스를 제거.
3. **foreground 워치독 + 채널 상태 모니터**: foreground + 세션 활성 동안 저빈도(~25s)로 데이터 reconcile(락 미변경). REST라 Realtime 쿼터와 무관. `visibilitychange`·재구독만으로 못 잡는 always-foreground 뷰어·SUBSCRIBED 레이스·장수명 소켓 조용한 죽음을 메운다.

→ 정합성이 pull+version에 놓인다. 마이그레이션 1개(load_session_state 확장) + 중간 규모 클라 변경.

### 🔵 Stage 2a — realtime 전제 DB 재설계 (구현 완료, additive)
`sync_version` 신설 + 트리거 강제 bump + `realtime.send` broadcast-from-DB. postgres_changes는 유지(overlap). 클라는 기존 `session-bc` 채널에 `sync` 힌트 리스너를 얹어 힌트>로컬이면 디바운스 pull.

**구현 노트 / 적대적 리뷰 반영(2026-07-22):**
- **버전 이원화**: `state.syncVersion`(applied — pull 로만 전진, 힌트 skip 가드) vs `lastSeenSyncVersion`(observed — 힌트+postgres_changes row 의 max, stale 스냅샷 거부용). `onSessionRowUpdate` 는 applied 를 전진시키지 않는다 — sessions row 의 sync_version 도달이 별 스트림인 session_players delta 적용을 함의하지 않기 때문(안 그러면 선수 delta 유실 시 힌트 pull 스킵되어 fast-heal 무력화).
- **stale 스냅샷 거부**: `resyncFromServer` 는 `snap.syncVersion < lastSeenSyncVersion` 이면 적용 skip(force=CAS 롤백 제외). pull 비행 중 도착한 delta 로 갱신된 로컬(예: 방금 경기중이 된 선수)을 stale 스냅샷 full-replace 가 되돌리는 clobber 방지.
- **선수 full-replace 시 코트 재정합**: 스냅샷에 없는 선수를 참조하는 코트 match 를 비운다(DELETE delta 핸들러와 동일 규율 — 권위 복구 경로는 delta 경로의 정합을 상위집합으로 포함).
- **편집 락은 실제 변경 시에만**: 잦은 sync-bump sessions UPDATE 마다 락 재계산하면 lockEpoch churn·in-flight claim 무효화·가짜 '뺏김'. `editorRowChanged` 게이트.
- **트리거 튜닝**: `editor_lease_until` 감시 제외(sticky 락, 매 op 갱신발 bump 증폭 제거). 자식 bump/broadcast 예외는 `RAISE WARNING` 으로 관측 가능(silent no-op 방지).
- **보안**: `load_session_state` EXECUTE 를 authenticated 로 잠금(REVOKE anon/PUBLIC) — SECURITY DEFINER 라 anon 이 선수 PII/member_id 를 읽던 구멍 차단(Phase 9 예고 조치).
- **빈 스냅샷 가드**: `snap.players.length>0 || snap.syncVersion>0` — 구 RPC(미적용) 과도기의 선수 전량삭제 방지하되, Stage 2 RPC 응답(syncVersion>0)이면 정당한 0명 수렴 허용.

### 🔵 Stage 2b — postgres_changes 제거 + publication drop (미착수, 게이팅)
`publication DROP TABLE`이 **유일한 비가역 단계**라, PWA는 강제 업데이트가 안 되니 **클라 버전 텔레메트리로 잔존 구클라 0 확인 + DB발 sync 브로드캐스트가 클라에 실제 수신됨을 E2E 양성 확인**(realtime.send 4-arg 시그니처가 이 인스턴스에서 동작하는지 — 첫 사용이라 배포 후 검증 필수)한 뒤 실행한다. 얻는 것은 쿼터 절감과 신호 경로 단일화.

## 7. 외부 검증 (공식 + 커뮤니티, 2026-07-22)

- **공식**: postgres_changes는 변경 1건당 구독자 수만큼 인가 검사 + 순서보존 단일 스레드라 확장 한계(~3,000 동접 넘으면 Broadcast로). Supabase에 **`Migrate from Postgres Changes` 전용 가이드** 존재. Broadcast from Database가 "대부분의 use case에 권장". 트러블슈팅에 "Handling Silent Disconnections in Background Applications" 항목 존재(= iOS PWA 백그라운드 조용한 끊김 공식 인정).
- **확인된 결함**: `supabase/realtime-py` #213 — 재연결 후 채널엔 붙지만 postgres_changes를 빈 배열로 재구독 → **조용히 이벤트 미수신**(PR 시도, 레포 아카이브). 디스커션 #35147 — 변경 미수신. **SUBSCRIBED 레이스**: 클라가 logical replication listener 준비 전에 `SUBSCRIBED` 방출 → 직후 **1~3초 창의 write가 조용히 유실**. 장수명 연결 **~30분 hang/drop** 보고.
- **커뮤니티 실전 해법(eastondev)** = 이 설계: 글로벌 연결상태 모니터(`SUBSCRIBED`/`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`) + `heartbeatCallback`(fake-connection 감지 45s→12s) + graduated backoff + **재연결 즉시 "마지막 버전 이후" pull**(수동 새로고침 대기 X).
- **함의**: 업계 표준 "snapshot 로드 → subscribe" 조차 SUBSCRIBED 레이스·조용한 죽음을 못 막는다. **워치독(주기 pull)은 선택이 아니라 그 구멍을 메우는 필수 요소.**

## 8. 하지 말 것

- component version을 `sync_version`으로 **제거**하기 (편집자 낙관 편집 원복 유발 — §4).
- 전송 재작성을 desync 픽스와 한 릴리스로 묶기 (blast radius 확대, 급한 픽스 지연).
- `realtime.send` 트리거 실패를 write 트랜잭션에 치명적으로 전파시키기.
- `realtime.setAuth` 수동 호출 추가 (SDK가 이미 자동 — no-op·오진 위험). 단, Stage 2에서 **private 채널** 도입 시엔 `subscribe()` 전 `setAuth()`가 별도로 필요.

## 9. 출처

- Supabase Docs — [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) · [Subscribing to Database Changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) · [Broadcast](https://supabase.com/docs/guides/realtime/broadcast) · [Authorization](https://supabase.com/docs/guides/realtime/authorization) · [Realtime messages 과금](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages) · [Troubleshooting](https://supabase.com/docs/guides/realtime/troubleshooting)
- Supabase Blog — [Realtime: Broadcast from Database](https://supabase.com/blog/realtime-broadcast-from-database)
- [supabase/realtime-py #213](https://github.com/supabase/realtime-py/issues/213) · [supabase Discussion #35147](https://github.com/orgs/supabase/discussions/35147)
- [Supabase Realtime in Practice — 재연결 전략 (eastondev)](https://eastondev.com/blog/en/posts/dev/supabase-realtime-practice/)
