# Branch: sam/expansion

## #1

**Prompt**: 현재 서비수에 추ㅜ가로 로그인이 가능하고 일정 추가 및 삭제 참여, 키풀신청등을 가능하게 하는 기능을 추가하려고해 대규모 기느추가라 빡센 설계가 필요해 운영진이 일정을 추가하고 일반 회원은 참석을 할 수 있으며 정원이 다 찼다면 대기를 걸고누군가 불참하면 대기한 회원이 자동으로 참여되며 푸쉬가 나가게 할거야 아울러 운영진은 모임장소가 먼 곳을 가기위해 카풀 가능, 카풀 필요 인원을 확인허고 이 장소로 몇시까지 나오라고 적어줄 수 있어. 장소앤 프리셋이 있어서 그거 지정할 수도 있고. 물론 지금 서비스도 게속 쓸거야 다맘 운영진만 편성이 가능하고 일반회원은 읽기만 되겠지 대충봐도 큰 변화잖아? 유지보수까지 고려해서 어떻게 만들지 잘 고민해봐 로그인과 가입은 카카오/네이버로 간단 가입도 되고 푸쉬느뉴supabase만 쓰고싶어

**Answer**: 로그인·일정·참석/대기열·카풀·푸시 대규모 확장을 설계함. 코드 탐색(6영역) → 기술 검증(4영역, 공식문서) → 4트랙 상세설계 → 통합 적대적 검증 워크플로를 거쳐 결정을 도출.

- **확정 결정**: 회원 프로필=선수(members 단일 소스, Sheets 점진 폐지) / 카카오 우선·네이버 2차 / 무료 티어+앱내 Realtime 알림 1차·설치형 PWA 웹푸시 보조 / 일정=세션 통합(별도 events 없이 sessions 상태기계화) / 로그인해야 열람 / places=좌표 테이블(코트 위치+카풀 집결지 공용) / 카풀=표시만+운영진 수동 매칭(전용 테이블 없음) / 정원 상향 시 자동 승급 / 콕 체크 운영진만 / 마이그레이션 자유(개발 중).
- **검증된 기술 전제**: 카카오 네이티브·네이버는 userinfo 중첩으로 Edge Function 우회 / 웹푸시는 VAPID+@negrel/webpush로 외부서비스 없이 가능(iOS는 설치 PWA만) / 자동승급은 cron 아닌 취소 RPC 단일 트랜잭션(session_counters FOR UPDATE + SKIP LOCKED) / RLS는 user_roles+is_admin() SECURITY DEFINER, 읽기 개방 유지하며 쓰기만 좁히고 마지막에 anon_all DROP.
- **핵심 원칙**: 스냅샷 격리막(session_players가 방화벽 → 편성 알고리즘·보드 0변경), 단일 트랜잭션 승급, 위험을 Phase 9 하나에 격리.
- **적대적 검증 수확**: 식별자 타입 계약 미동결(Phase 0 선행 필수), 참석확정→보드 편입 브릿지가 전 트랙 누락(Phase 6 명시).
- **산출물**: 시각 설계 문서(Artifact) + Phase 0 계약서 `docs/EXPANSION_SPEC.md`(식별자 타입·헬퍼 시그니처·7개 신규 테이블+기존 2개 변경·상태값/알림 레지스트리·RPC/RLS 계약·10단계 무중단 로드맵 동결). `sam/expansion` 브랜치 생성 후 착수.

---

## #2

**Prompt**: 카카오 앱등록까짐 했는데 다음 어케하지

**Answer**: Phase 1(카카오 로그인) 코드를 구현하고, 사용자 측 콘솔 설정을 안내함. RLS 무변경이라 기존 흐름은 그대로 유지하고 로그인은 옵션으로 추가.

- **코드**: `client.ts`에 PKCE/persistSession/autoRefreshToken/detectSessionInUrl 옵션 추가. 신규 `authStore`(getSession 복원 + onAuthStateChange 구독, signInWithKakao(redirectTo=origin+BASE_URL), signOut, authDisplayName 헬퍼). `App.tsx`에서 마운트 시 `authActions.init()`. `Home.tsx`에 카카오 로그인 버튼(미로그인) / "○○님 로그인됨 + 로그아웃"(로그인) UI.
- **설정 안내**(콘솔 작업이라 사용자 몫): 카카오 Redirect URI = `https://sfxbrheavypjsjgbzjom.supabase.co/auth/v1/callback`, 동의항목(닉네임, 이메일은 비즈앱 필요), Client Secret 생성·활성화, REST API키 → Supabase. Supabase 대시보드 Kakao 프로바이더 활성화 + Site URL/Redirect URLs(`https://Yria.github.io/cocktime-scheduler/**`, `http://localhost:5173/**`).
- 검증: tsc·biome·프로덕션 빌드 통과. biome가 기존 일부 포맷도 표준으로 정리.

---

## #3

**Prompt**: 로그인 처리됐어 다음스텝하자

**Answer**: Phase 1 로그인 동작을 검증하고 Phase 2(members + 운영진 권한)를 구현함.

- **Phase 1 검증**: Playwright로 OAuth 리다이렉트 체인 확인(앱→Supabase authorize(PKCE)→카카오). 카카오 `account_email` scope는 Supabase 카카오 기본값이라 클라이언트 코드/대시보드로 제거 불가(클라 scopes는 덧붙기만 됨 — 실험으로 확인). 개인 개발자는 카카오 콘솔 "개인 개발자 등록"으로 해결(GitHub #36878). 사용자가 등록 후 로그인 성공.
- **Phase 2 구현**: 마이그레이션 `20260621000000_add_members_and_roles.sql` — members(계정+선수 프로필, auth_user_id nullable=게스트), user_roles(admin/member), `current_member_id()`/`is_admin()` SECURITY DEFINER 헬퍼(search_path='' 재귀 회피), 신규 테이블 RLS(전원 read + 본인 insert/update + 운영진 write), **첫 가입자 운영진 자동 시드**(부트스트랩). `authStore`에 memberId/isAdmin 추가 + 로그인 시 members upsert·role 로드(onAuthStateChange 데드락 회피 위해 setTimeout 디퍼). Home에 운영진 배지.
- **적용 대기**: `supabase db push`로 원격 DB 적용 필요. tsc·biome·빌드 통과.

---

## #4

**Prompt**: 했어

**Answer**: Phase 4(일정 = 세션) 일정 기능을 풀스택 구현하고 E2E로 검증함. "홈을 일정 목록 중심으로" 결정 반영.

- **마이그레이션** `20260621010000_sessions_schedule_and_places.sql`: 기존 sessions를 예정→진행→종료 상태기계로 확장(title·scheduled_at·capacity·place_id·status·created_by·carpool_muster_*) + places(좌표 프리셋) 테이블 + 좁은 RLS. status 기본값 'active'로 기존 즉석 세션 무영향, is_active→status 보정.
- **배관**: types.ts SessionRow 확장 + SessionStatus + PlaceRow. schedule.ts(fetchSchedules/createSchedule/deleteSchedule/fetchPlaces/createPlace). scheduleStore(schedules·places 상태 + load/create/remove/addPlace).
- **화면**: Home 전면 개편 — 비로그인=로그인 뷰, 로그인=일정 목록 중심(헤더·운영진 "일정 추가"·일정 카드·즉석 세션 시작·매치 로그). ScheduleForm(운영진 일정 생성: 제목·일시·장소 select+신규추가·코트수·정원). App에 /schedule/new 라우트.
- **검증**: tsc·biome·빌드 통과. Playwright E2E — 로그인(오상진·운영진)→일정 추가→폼 작성→저장→목록에 "수요 정기 모임 / 6월 25일(목) 오후 7:00 / 정원 20명"(Asia/Seoul 포맷) 표시, 콘솔 에러 0.

---

## #5

**Prompt**: 진행해

**Answer**: Phase 5(참석/정원/대기/자동승급) 구현 + 동시성 적대 검증 + FOUND 버그 발견·수정 + db push 파이프라인 전환.

- **마이그레이션**: attendances·session_counters·notifications + join_session/cancel_attendance/promote_waitlist RPC. 직렬화 지점 session_counters FOR UPDATE(보드 편성과 락 분리), 대기 1순위 FOR UPDATE SKIP LOCKED 승급, 취소+승급+알림 단일 트랜잭션. 적대 검증 3트랙(동시성/정확성/보안)으로 FOR SHARE·종료세션 거부 보정, 과장 결함(explicit deny·무한루프·cascade 등) 기각.
- **클라**: AttendanceRow 타입, schedule.ts 참석 API(join/cancel/fetch), scheduleStore 확장, ScheduleCard(참석/대기 현황+참석/취소 버튼), Home 연결.
- **근본 버그**: counter만 +1되고 attendances가 비는 증상. 처음엔 대시보드 붙여넣기 잘림으로 의심했으나, 디버그 RPC(pg_get_functiondef)로 소스 확인 결과 **PL/pgSQL FOUND 버그**. 기존참석 select 직후의 FOUND가 그 뒤 `update session_counters`에 덮어써져 `if found then update else insert`가 INSERT 대신 UPDATE(0행) 경로를 탐 → v_has_existing 변수로 FOUND 캡처해 수정(050000).
- **인프라**: 원격 세션이라 supabase login(브라우저) 불가 → `supabase login --token`으로 전환, migration repair(--status reverted/applied) + db push 파이프라인 확립. 이제 마이그레이션은 db push로 적용.
- **검증**: Playwright E2E 참석→확정 1/20→취소→0 정상, 콘솔 에러 0. 대기/자동승급은 회원 2명 필요(동시성 워크플로 논리 검증 완료, 추후 실증).

---

## #6

**Prompt**: 참석확정 → 보드 편입 (Phase 3+6)

**Answer**: Phase 3(선수↔회원 연결) + 6(참석확정→보드 브릿지) 구현 + E2E 검증. 일정/참석과 기존 편성보드를 연결.

- **마이그레이션 060000**: session_players.member_id 추가(nullable) + `start_session_from_schedule` 브릿지 RPC(is_admin 가드, status='open' 검증, gender 미입력 confirmed 차단, confirmed 참석자→session_players 일괄 INSERT with members gender/skills 스냅샷, sessions status='active'+is_active=true).
- **핵심 통합 포인트**: 기존 appStore.subscribeSessionWatch(postgres_changes on sessions)가 is_active=true를 감지해 모든 클라가 자동 loadSession→보드 이동. 브릿지는 session_players 생성 + is_active만 켜면 기존 보드 흐름이 그대로 받음(보드 코드 0변경, 스냅샷 격리막).
- **클라**: schedule.ts startSessionFromSchedule, authStore myGender+updateGender(프로필 성별), ScheduleCard "세션 시작·보드 열기" 버튼(운영진+open), Home 성별 입력 배너(미입력 시 남/여)+handleStartSession(RPC→checkActiveSession→/session).
- **E2E**: 성별 설정→참석(확정 1/20)→세션 시작→/session 보드 이동, session_players에 오상진(gender 스냅샷 M·status=waiting) 편입 + session active 확인, 콘솔 에러 0. tsc·biome·빌드 통과.

---

## #7

**Prompt**: 커밋하고 계속

**Answer**: Phase 8 앱내 실시간 알림 구현 + E2E 검증.

- notifications Realtime 구독(`subscribeNotifications`, postgres_changes INSERT filter recipient_member_id) → 기존 toastStore 토스트로 표시. type별 메시지(`notificationMessage`: promoted/session_cancelled/session_closed/carpool_muster).
- App.tsx에서 memberId 있을 때 구독, 로그아웃/언마운트 시 removeChannel. NotificationRow 타입 추가.
- notifications는 Phase 5에서 이미 자동승급 시 INSERT + realtime publication 등록됨 → 구독만 추가하면 동작.
- **E2E**: service_role로 promoted 알림 INSERT → "대기자에서 참석이 확정되었어요!" 토스트가 실시간으로 표시됨 확인. tsc·biome·빌드 통과. (콘솔 player-photos 400은 기존 선수사진 storage 누락, 알림과 무관)
- 설치형 PWA 웹푸시(SW+VAPID+Edge Function)는 Phase 8 잔여로 추후.

---

## #8

**Prompt**: 커밋하고 계속

**Answer**: Phase 7 카풀(의향 표시 + 집계) 구현 + E2E 검증.

- 마이그레이션 070000: `set_carpool_role`(본인 의향, 참석자만) + `announce_carpool_muster`(운영진 집결지/시각 설정 + confirmed 참석자에게 carpool_muster 알림) RPC. attendances.carpool_role / sessions.carpool_muster_* 컬럼은 기존(Phase 4/5).
- 클라: schedule.ts setCarpoolRole, scheduleStore setCarpool(+reloadAttendances), ScheduleCard 카풀 토글(운전 가능/탑승 필요/안 함, 본인 상태 강조)+집계(🚗 운전 N·탑승 M), Home handleSetCarpool 연결.
- **E2E**: 참석→"운전 가능" 클릭→carpool_role 설정+버튼 active+"🚗 운전 가능 1·탑승 필요 0" 집계 표시, 콘솔 에러 0. tsc·biome·빌드 통과.
- 집결 공지 운영진 입력 UI(place/time→announce_carpool_muster)는 RPC만 준비, UI 추후. 잔여 즉석 세션(53) 종료 정리.

---

## #9

**Prompt**: c

**Answer**: 보드 팀 동기화 버그(관전자에게 팀 미표시·하드 새로고침해도 고착·이따금 이중 편집권)의 근본원인을 워크플로우 2회(가설 5개 적대적 반증 + 설계 3안 critique·통합)로 규명한 뒤, 사용자가 고른 통합 설계의 Phase 0(마이그레이션)·Phase 1(관전자 렌더 수정)을 구현.

- 확정 근본원인: ①board_drafts가 broadcast 단일경로로만 전파(postgres_changes 핸들러가 board_drafts 무시 → DB 차원 catch-up 부재) ②편집락이 서버 권위 없이 presence 파생이라 부분 동기화 시 이중 편집권 ③board_drafts 통째 last-writer-wins 덮어쓰기 ④관전자가 DB값을 받고도 렌더 실패(SessionBoard effect가 자석 로드 전 영구 bail + deps에 자석 신호 없음).
- Phase 0(무중단·dormant): 마이그레이션 20260622000000 — sessions에 editor_client_id/editor_name/editor_lease_until/board_drafts_version 컬럼, 서버 권위 lease 락 RPC 3종(claim/handoff/release) + 낙관적 버전 CAS 쓰기 RPC(board_save_drafts), sessions realtime publication 멱등 승격. 컬럼 nullable/DEFAULT라 기존 클라와 호환, RPC는 아직 미호출.
- Phase 1(저위험·서버 무관): SessionBoard의 applyRemoteDrafts effect에 magnetCount 셀렉터를 deps로 추가하고 영구 bail 제거 → 자석이 boardDrafts보다 늦게 로드돼도 재적용되어 관전자가 팀을 그린다. 원인4 핵심 수정.
- reconcileMembership 팀 drop은 분석상 Phase 1 수정만으로 수렴(부분 렌더 + session_players 동기화로 누락 멤버 자동 합류)하고, 자석 보장생성은 magnet 소스 이원화/scatter 상호작용 위험이 있어 Phase 1에서 의도적으로 제외.
- 검증: tsc -b 통과, vitest 131 tests / 11 files 전부 통과.

---

## #10

**Prompt**: 일단 해당 액션에서 해야할거 다 해

**Answer**: Phase 0+1을 완결 상태로 마감 — 빌드·문서·적대적 자체 리뷰까지 수행하고 리뷰가 잡은 blocker를 수정.

- 품질 게이트: tsc·**vite 프로덕션 빌드**·eslint(변경파일 0건)·vitest(131/131) 전부 통과.
- 문서화: `DATABASE.md`(신규 컬럼 4개 + RPC 4종 + "보드 동기화 v2 롤아웃 현황표" + 원인2 presence 락 한계 명시), `docs/migration.sql`(publication 정식 승격 주석).
- 적대적 자체 리뷰 워크플로우(SQL 실행정확성 / 락·CAS 의미론 / Phase1 React 회귀)로 미실행 마이그레이션 검증 → **blocker 1건 발견·수정**: SessionBoard의 applyRemoteDrafts effect에 편집자 가드가 없어, broadcast self:false 탓에 STALE한 sessionStore.boardDrafts가 선수 합류/이탈(magnetCount 변화) 시 편집자의 로컬 팀을 원복시키던 데이터 손실. → "boardDrafts가 실제로 바뀐 경우(로드/원격 수신)는 모두 적용, magnetCount만 변한 수렴 재적용은 관전자만"으로 수정(ref 비교 + isEditor 가드). 무한루프/위치출렁임/관전자수렴은 clean 확인.
- 마이그레이션 보강(최근 컨벤션 정렬): 4개 SECURITY DEFINER 함수에 `SET search_path = ''` + `public.sessions` 한정, lease NULL 가드(`coalesce(...,20)`), Phase 3/4 배포순서 데드존 경고 헤더 주석. grant/revoke는 보드가 아직 anon 접근(로그인 필수 열람=Phase 9 미착수)이라 기존 보드 RPC처럼 PUBLIC 유지하고 사유 주석화.
- 운영 DB 마이그레이션 적용은 supabase 원격 링크라 자동 실행하지 않음(`db push`=운영 직행 → 사용자 배포 결정에 위임).

---

## #11

**Prompt**: step0 확인할 수 있는 사오항이 아니라서 이거 확인을 일단 했다고 가정하고 진행해

**Answer**: step0(DB 실측)는 확인 불가 상황이라 근본원인 확정 가정하에 Phase 2(DB catch-up, 원인1) 구현·검증.

- 분석 결과 Phase 2는 버전/락과 분리해 독립 적용 가능(단일 편집자 모델에선 catch-up이 broadcast와 멱등). Phase 3은 board_save_drafts의 editor WHERE 때문에 Phase 4 없이는 모든 쓰기가 거부되는 데드존이 있어 Phase 4와 묶어야 함 → 이번 턴은 Phase 2만.
- Phase 2 변경: `api.dbLoadBoardDrafts`(단건 재조회) 추가 / `sessionChannels`의 sessions UPDATE 핸들러가 `board_drafts`도 읽어 `onBoardDraftsRow`로 전달 + meta 채널 SUBSCRIBED 시 `onResync` 훅 / `sessionStore`가 두 핸들러 배선(catch-up은 boardDrafts만 갱신, 보드 반영은 SessionBoard applyRemoteDrafts가 멱등 처리, 재구독 시 dbLoadBoardDrafts 1회 재조회).
- 효과: broadcast(self:false, fire-and-forget) 누락·늦은 접속·순간 끊김에도 관전자가 DB로 수렴(원인1 해소). Phase 1(렌더)+Phase 2(수신)로 "관전자 미표시·새로고침 고착" 주 증상 구조적 해결.
- 문서: DATABASE.md realtime 노트 + 롤아웃 표 Phase 2 ✅ 갱신.
- 검증: tsc 0 · eslint 0 · vitest 131/131.
- 남음: Phase 3+4(이중 편집권·쓰기 손실 — 락 모델 전면 교체, ~9파일, editLock 테스트 재작성, UX 변경)는 한 묶음으로 다음 단계.

---

## #12

**Prompt**: 일정만들때 필요한건 날짜, 최대인원, 장소뿐이야. 코트수는 가봐야 알 수 있어. 그리고 매주 반복하는 일정이기때문에 월~일 등록해놓으면 다음주에 자연스럽게 반복되어야 해. 물론 일정이 수정될 수 있기때문에 일정수정 기능도 필요해. 제목은 딱히 필요없어. 디비마이그레이션도 필요하면 해. (후속 명확화: 1·3주/2·4주 같은 몇째 주 규칙 + 주차별 장소 가변, 달력 편집, 명절 등 예외 위해 회차는 1주 전 노출하고 그 전엔 운영자만 수정)

**Answer**: 일정을 단발 `scheduled_at` 입력에서 "반복 규칙 → 회차 자동 생성" 2계층 모델로 재설계. 입력 방식은 사용자 확인 거쳐 "요일+시간", 이후 몇째 주 규칙·장소 가변·1주 전 노출 요구를 반영해 "반복 규칙 + 달력 하이브리드"로 확정. 코드 토대는 직접 작성, 운영진 UI 4개 컴포넌트는 워크플로로 병렬 작성 후 빌드/적대적 리뷰로 검증.
- DB(`20260622010000`): `recurring_schedules`(요일·`week_ordinals`·`include_last`·시간·인원·장소) + `sessions`에 `recurring_schedule_id`/`occurrence_date`/`is_overridden`. `recurring_valid_occurrences` 뷰(향후 56일) + `sync_schedule_occurrences()` RPC(회차 생성/규칙반영/정리 + **1주 전 draft→open 노출** + 과거 종료, 멱등).
- 상태기계: draft(운영진만)→open(노출·참석)→active(보드)→closed/cancelled. 명절 등은 해당 회차만 cancelled(행 유지로 재생성 차단) 또는 개별 override.
- UI: 운영진 `/schedule` 달력+규칙 패널(규칙 CRUD·회차별 수정/취소/일회성), 회원은 노출 회차만 목록. 제목·코트수(보드에서 결정) 입력 제거, 구 `ScheduleForm` 삭제.
- 검증: 적대적 리뷰로 결함 4건(당일 오전 회차 노출 누락→KST 날짜 하한, 일회성 노출 기준 클라/서버 불일치→sync에 단일 위임, 월 이동 시 선택일 미초기화, 과거 취소 회차 되돌리기 가드) 수정. tsc clean, 린트 신규 에러 0(기존 3건은 무관).
- 적용 필요: Supabase에 마이그레이션 1건 적용해야 동작.

---

## #13

**Prompt**: 계속해

**Answer**: 보드 동기화 v2 Phase 3+4(쓰기 CAS + 서버 권위 편집 락) 구현 — 원인2(이중 편집권)·원인3/5(쓰기 손실·조용한 실패) 해소. 적대적 리뷰로 결함 잡아 수정.

- Phase 4(서버 권위 락): presence 파생 락(`computePresence`/`nextClaimAt`) 폐기 → `sessions.editor_*` row가 단일 진실. editLock는 `computePresenceList`(접속자 목록)+`computeLockFromRow`(락 산정)로 축소(테스트 재작성). sessionStore에 락 생명주기(cachedEditor + 7s heartbeat + 4s reeval로 lease 만료/crash 회복 + visibilitychange/pagehide). claimEditor/claimEditingIfFree(첫 편집 시 낙관 점유)/handoffEditor(BoardToolbar "넘기기")/resyncFromServer. 동시 점유는 DB 조건부 UPDATE row-lock으로 1명만 성공 → 이중 편집권 구조적 불가.
- Phase 3(쓰기 CAS): `board_save_drafts`에 **self-claim** 추가(쓰면서 락 획득 → Phase3/4 배포 데드존 제거). boardStore `pushDraftsToRemote`가 base_version 동반 + `draftsSaveInFlight`/`pendingDraftsPayload` 직렬화(자기충돌 방지) + 충돌 시 resync+toast. 통째 LWW `dbSaveBoardDrafts` 제거.
- sessionChannels: sessions UPDATE를 단일 `onSessionRowUpdate(row)`로 통합(catch-up+락 동승). broadcast payload `{drafts, version}`.
- 적대적 리뷰 수정: ① HIGH 크로스세션 락 오염(`wasEditorBeforeHidden` 모듈변수 → subscribe 클로저 지역) ② handoff/heartbeat stale .then(`lockEpoch` 가드) ③ 충돌 시 미저장 편집 유실(resync 강제 적용 + toast) ④ 자기-echo 깜빡임(`applyDraftsIfNewer` `<=` 멱등) ⑤ bigint 역직렬화 강건성(Number 정규화) ⑥ pagehide heartbeat 정지.
- 검증: 내 변경 파일 tsc 0 · eslint 0 · vitest 132/132. (전체 빌드는 병렬 진행 중인 반복일정 작업의 미완성 코드 `PlaceLocationPicker` 누락 등 때문에 막혀 있으나 내 변경과 무관.)
- 적용 필요: 마이그레이션 `20260622000000`을 운영 DB에 적용해야 Phase 0~4 전체 동작(supabase 원격 링크 — 사용자 배포).

---

## #14

**Prompt**: 우리가 장소 입력할때 위치를 넣어야 하는데 lng, lat 를 따다 넣긴 그렇고, 네이버지도 링크를 넣으려고 하는데 이게 링크누르기전 미리보기 형태로 어디위치인지 보이게 만들 수 있을까 static map api 가 있는건 아는데 이거 따로 권한따야해서 다른 개발자들은 어떻게 처리하는지 궁금 (후속: 붙여넣는 링크가 네이버일수도 카카오일수도 있음, 거기서 lat/lng 추출 / 계속해)

**Answer**: 장소 위치를 네이버/카카오 공유 링크에서 추출 + 지도 미리보기로 구현. 웹 조사로 확인: Static Map API는 Client Secret이 필요해 서버 프록시 필수지만, 지도 JS SDK는 도메인 제한 클라이언트 키로 충분(대부분의 정석). 단축링크(naver.me/kko)는 CORS로 클라에서 좌표 추출 불가, 네이버 URL 좌표는 EPSG:3857(Web Mercator). 그래서 서버·시크릿 없이 되는 **카카오 지도 JS SDK 임베드 picker**로 결정(링크 좌표 추출 + 장소명 검색 + 핀 드래그, 좌표는 항상 WGS84 저장).
- DB: `places.map_url` 컬럼(`20260622020000`, 원격 적용 완료). lat/lng/address는 기존 컬럼 활용.
- 신규: `mapLink.ts`(링크 좌표 파서 — WGS84/Web Mercator 변환, 한국 범위 가드로 오탐 차단), `kakaoMap.ts`(도메인 제한 JS 키 SDK 동적 로더), `PlaceLocationPicker.tsx`(카카오 지도 임베드 + 검색 + 드래그 핀).
- `createPlace`를 `CreatePlaceInput` 객체로 통일(lat/lng/map_url 추가), 두 에디터의 인라인 장소추가 → picker 모달로 교체, 죽은 `scheduleStore.addPlace` 제거.
- 워크플로(컴포넌트 작성 + 적대적 리뷰)로 결함 수정: 린트 `no-explicit-any`(파일 레벨 eslint-disable), SDK 로딩 레이스(`mapReady` 게이팅 + `coordsRef`로 스테일 클로저 회피), 저장 성공 후 `busy` 복구, 검색 결과없음/실패 구분, `c=` 머케이터 KR 범위 가드.
- 검증: tsc 0, 린트 신규 에러 0(기존 3건 무관), 프로덕션 빌드 통과. 좌표 공식·계약 체인은 적대적 리뷰로 정확 확인.
- 사용자 설정 필요: 카카오 개발자콘솔 JavaScript 키 발급 → `.env.local`의 `VITE_KAKAO_MAP_KEY` + Web 플랫폼 도메인 등록(localhost·배포 URL). 키 없어도 이름/링크 좌표추출 저장은 동작(지도 미리보기·검색만 비활성).

---

## #15

**Prompt**: (pnpm 전환 / 장소등록할때 코트수는 필요없어 / 변경되는거 db 에서도 필요없으면 바로 마이그레이션해)

**Answer**: `pnpm install`이 esbuild 빌드 스크립트 승인 게이트(pnpm v11)에 막혀 `run dev` 실패한 것 — 사용자 선택으로 npm→pnpm 전환 + 장소에서 코트 수 제거(UI·코드·DB).
- **pnpm 전환**: pnpm v11은 package.json의 `pnpm` 필드를 무시하고 설정을 `pnpm-workspace.yaml`로 옮김. 또한 이 버전은 `allowBuilds`(패키지→불리언) 키를 씀(pnpm이 직접 스캐폴드). `pnpm-workspace.yaml`에 `allowBuilds: { esbuild: true }` 설정 → install 성공. `package.json`에 `packageManager: pnpm@11.8.0` 고정, `predeploy`(npm run build) 제거하고 `deploy`를 자기완결(`pnpm run build && gh-pages`)로(pnpm은 pre/post 스크립트 미실행 + `pnpm deploy` 빌트인 충돌 회피). `package-lock.json` 삭제(락파일 단일화), node_modules 클린 재설치. `.github/workflows/deploy.yml`을 `pnpm/action-setup` + `cache: pnpm` + `pnpm install --frozen-lockfile` + `pnpm run build`로 전환하고 빌드 env에 `VITE_KAKAO_MAP_KEY` 추가(배포본 지도용 — GH secret 등록 필요).
- **코트 수 제거**: `PlaceLocationPicker`에서 코트 수 필드/상태/페이로드 제거. `CreatePlaceInput.defaultCourtCount`·`PlaceRow.default_court_count`·`createPlace` insert에서 제거.
- **DB 마이그레이션**(`20260622030000`, 원격 적용): `recurring_valid_occurrences` 뷰의 `court_count`를 장소 기본값 `coalesce(p.default_court_count,4)` → 상수 `4`(보드에서 결정)로 교체 + places 조인 제거 → `places.default_court_count` 컬럼 DROP. (뷰 의존성 순서대로 REPLACE 후 DROP.)
- 린트 부수 수정: picker `setSdkError` effect 동기 호출 → `useState` 초기화로 이동(`set-state-in-effect` 해소).
- 검증: `pnpm run build`/`pnpm dev`(localhost:5174 HTTP 200) 정상, tsc 0, 린트 기존 3건만. 원격: default_court_count select→400(삭제 확인), 뷰·`sync_schedule_occurrences` RPC(204) 정상.

---

## #16

**Prompt**: 디비 마이그레이션 해

**Answer**: 보드 동기화 v2 마이그레이션을 운영 DB에 적용. `migration list` 확인 결과 `20260622000000`이 이미 원격 적용 기록(병렬 작업 db push에 순서상 함께 실려감)이었으나, 이후 같은 파일을 여러 번 수정(특히 board_save_drafts 4인자→6인자 self-claim)했고 db push는 적용된 버전을 재실행하지 않아 **원격에 구버전 함수가 잔존**했다.

- service role 키로 원격 RPC probe(session_id=0 → 0행, 무변경): `board_save_drafts`가 옛 4인자, claim/handoff/release는 존재. 그대로면 클라 6인자 호출 → PGRST202 → 모든 보드 저장 실패.
- forward-only 수렴 마이그레이션 `20260622040000_board_lock_v2_fix.sql`: 옛 4인자 board_save_drafts DROP + 4종 함수(claim/handoff/release/save_drafts)를 현재 최종 정의로 CREATE OR REPLACE(search_path·self-claim 포함). 컬럼/publication은 이미 적용돼 손대지 않음.
- `supabase db push`로 040000 적용(병렬 030000은 그 사이 병렬 세션이 이미 적용 → 내 것만 pending). 재-probe로 6인자 board_save_drafts 정상(null)·옛 4인자 제거(PGRST202)·migration list 동기 확인. Phase 0~4 전체가 원격에서 동작(클라 배포 시).

---

## #17

**Prompt**: 일정화면 일정관리에 시작시작-끝시간 넣을수 있게 해주고 지금 입력된 모든 일정엔 +3시간으로 끝시간으로 값넣어줘. 그리고 카풀 on/off 옵션 넣어서 카풀 on 하면 카풀가능/카풀필요 할 수 있게 해주고 홈화면에서 현재 열린 모든 일정이 보이고 시작/보드열기 버튼이 있는데 해당 버튼은 보이지 않게 하고, 일정시간이 시작되면 그 일정만 따로 똑 떼서 맨 위로 하이라이트해서 올려주고, 세션시작 버튼을 노출하게 해줘.

**Answer**: 일정에 끝시간·카풀토글을 추가하고 홈화면 진행 하이라이트를 구현. 카풀 기본값(주말 on/평일 off)과 하이라이트 유지구간(시작 이후 계속)은 되돌리기 어려운 마이그레이션·UX 분기라 사전 확인 후 진행.

- 마이그레이션 `20260622120000`: `sessions.ends_at/carpool_enabled`, `recurring_schedules.end_time/carpool_enabled` 추가. 백필=끝시간 시작+3h, 카풀 주말만 on. `recurring_valid_occurrences` 뷰에 occ_ends_at(자정 넘김 CASE)·carpool_enabled 추가, sync RPC B/C단계가 회차로 전파(미오버라이드 draft 한정). 운영 DB에 db push 적용 완료.
- 편집기(Rule/Occurrence): 시작/끝 시간 분리 + 카풀 ON/OFF 토글. 신규는 선택 요일 주말이면 카풀 기본 on(touched flag로 수정 전까지 추종).
- 홈/카드: 시간범위 표시, 카풀 섹션은 carpool_enabled일 때만, 세션시작 버튼은 시작시각 지난 open(=isLive)에만 노출. live 일정은 맨 위로 분리·하이라이트(30초 tick). 끝시간 무관하게 시작 이후 유지.
- 검증: tsc/eslint/vite build/vitest(132) 통과 + 3차원(SQL·로직·커버리지) 적대적 검증 워크플로 확정결함 0건.

---

## #18

**Prompt**: 일정보드에 "진행시간" 배지는 불필요해보여.

**Answer**: ScheduleCard의 "● 진행 시간" 배지를 제거. 초록 테두리 하이라이트와 맨 위 정렬만으로 진행 상태가 충분히 드러나므로 배지는 군더더기로 판단. flex-wrap도 원복(active 배지만 남음). isLive prop은 카드 하이라이트·세션시작 버튼 게이팅에 계속 사용되어 그대로 유지.

---

## #19

**Prompt**: 지금 내가 코트배정 동기화때문에 무척 골치가 아파. 누구는 팀으로 보이고 누군 안보이고 그래서 이 부분을 완벽하게 동기시키고 싶어. supabase 를 쓰니까 현실적 한계점을 감안해서 편집하는 사람만 편집하고 나머지는 lock 시켜 변화되는것만 감지하는 방식을 하고싶은데 이러한 목적에 서버로 옮겨도 되는 로직들이 부합한다면, 최초 목적을 상기해서 최적의 방법을 고민해봐

**Answer**: 근본 원인부터 규명: board_drafts(팀 편성)는 broadcast + sessions postgres_changes catch-up + 재구독 refetch + 단조 version CAS의 다중 안전장치로 수렴하지만, matches(코트 배정)는 broadcast(self:false, fire-and-forget) 단일 경로에만 의존해 메시지를 놓치면 영영 미동기화됨이 증상의 원인(검증된 결함 H1~H5). 단일 편집자 + 읽기 전용 follower + 변경 감지 모델을 위해 board_drafts 패턴을 matches로 확장하는 A→B 안을 구현.
- A-1: sessions.match_state_version 단조 컬럼 신설 + assign_match·complete_match·set_match_roster가 같은 트랜잭션에서 ++ (matches는 publication에 안 넣고 sessions row 신호로 catch-up → 부하 회피)
- A-2: 경기 로스터 수정을 직접 UPDATE에서 set_match_roster RPC로 원자화 + match_roster_updated broadcast 추가(H3: 이전엔 편집자만 보임)
- A-3: onSessionRowUpdate/onResync가 match_state_version 갭 감지 시 refetchMatches로 코트 권위 재조회 — broadcast 유실/역전·"선수는 playing인데 코트 빔"(H2)·재연결 공백 모두 수렴. broadcast는 즉시성 전용, 권위는 version 갭 refetch
- B: load_session_state RPC로 board_drafts+matches+버전을 단일 트랜잭션 스냅샷으로 묶어 두 권위 시점 일치, resyncFromServer 통합(dbLoadSessionRow→dbLoadSessionState)
- 추천/랭킹 등 무겁고 잦은 순수 계산은 클라 유지(연산량 분석 일관), 서버 이전은 가벼운 검증·원자적 다중행·권위 재조회에 한정. typecheck/build/test(132)/eslint 통과, DATABASE.md 갱신. 마이그레이션 2종은 배포(supabase db push) 시 적용 필요.

---

## #20

**Prompt**: 변경점이 또 있는데 배포해줘

**Answer**: 헤더 알림 벨/메뉴 관련 추가 변경(NotificationBell·HeaderMenu·notificationStore 신규 + App/Home/notifications 연동)을 동일 경로(커밋→main push→CI 배포)로 배포. 지난 배포 실패(pnpm Node 요구) 재발 방지를 위해 로컬 build(tsc -b && vite build) 선검증 후 커밋·푸시. main fast-forward push로 deploy.yml 트리거.

---

## #21

**Prompt**: 우상단 메뉴를 합쳐줘. 알림을 볼 수 있는 종모양과 ... 을 눌러 내정보/회원관리/로그아웃 할수 있게.

**Answer**: 요청한 헤더 통합(🔔 종모양 알림 + ⋯ 케밥 메뉴)은 이미 직전 작업(#20, 커밋 8c32b31 "헤더 알림 벨 + 메뉴 컴포넌트 추가")에 구현·배포돼 있음을 git 이력으로 확인. 동일 재구현분은 diff 0. 4차원(정합성·RLS/보안·UX/다크모드·React 패턴) adversarial 리뷰로 찾은 3가지 개선만 실제 변경으로 적용:
- **NotificationBell 미읽음 점 보존**: 패널 open 시 markAllRead의 낙관적 갱신이 동기 실행돼, 미읽음 파란 점이 첫 렌더부터 사라져 "무엇이 새 알림인지" 못 보던 결함. 열람 시점 미읽음 id를 로컬 스냅샷으로 캡처해 이번 열람 동안 점을 유지(서버/배지 읽음 처리는 그대로). 닫을 때 스냅샷 초기화.
- **터치 타깃 확대**: 종모양·케밥 버튼 히트영역 34→40px(아이콘 20 유지). 우상단 인접 소형 타깃 오탭 완화.
- **포그라운드 복귀 재동기화**: App의 가시성 복귀 effect에서 알림 load 추가 — 백그라운드 동안 realtime이 놓쳤을 INSERT를 복구해 stale 방지.
- 검증: tsc -b / eslint / vite build 모두 통과. 작업 중 발견된 App.tsx 선재 `react-hooks/refs` 에러(navRef 렌더 중 변경)도 effect로 옮겨 해결.

---

## #22

**Prompt**: 네비 헤더를 분리해서 앱처럼 개선하고, 해당 헤더를 활용하는 구조로 변경해. 지금보니까 아래로 드래그하면 상단도 같이 내려오고, 일정관리 페이지도 독립된 페이지인데, 상단 네비의 이전버튼이 없고 그러네. 그렇게 하고 아래로 땡기면 리로드하게 해주고, foreground 복귀시 자동 재동기화도 같이해줘.

**Answer**: 앱 스타일 공통 네비 헤더 + 고정 셸 + pull-to-refresh + foreground 재동기화를 구현. 기존엔 각 페이지가 자체 헤더를 스크롤 영역 안에 그려 함께 스크롤되고(아래로 당기면 상단도 내려옴), SchedulePage 등은 '닫기' 텍스트만 있고 표준 뒤로가기가 없었음.
- **공통 컴포넌트 신설**: AppHeader(sticky 고정 네비 — 뒤로가기 화살표/타이틀/로고/우측 액션, safe-area-inset-top 흡수), AppScreen(h-100dvh flex 셸: 고정 헤더 + flex-1 overflow-y-auto overscroll-contain main → 헤더는 안 움직이고 main 만 스크롤), usePullToRefresh 훅(스크롤 최상단에서 당기면 임계 70px 넘어 location.reload, 고무줄 감쇠+스피너 인디케이터).
- **페이지 적용**: Home(로고+알림벨/메뉴) / SchedulePage(뒤로가기+'일정 관리') / MemberAdminPage(뒤로가기+'회원 관리', 가상화 목록이라 AppHeader만)에 적용, '닫기' 텍스트 제거. LogPage는 이미 sticky 헤더+뒤로가기가 있고 콘텐츠가 자체 패딩이라 유지.
- **모달 분리**: ProfileSetup(fixed 오버레이)이 pull-to-refresh transform의 containing block 영향을 받지 않도록 셸 밖으로 이동(SchedulePage 모달도 동일).
- **foreground 재동기화**: App 가시성 복귀 effect에 sessionMeta 있으면 sessionStore.resyncFromServer(보드/코트 권위 재조회), 로그인 시 scheduleActions.load 추가(기존 checkActiveSession+알림 load에 더해).
- 검증: tsc -b / vite build / eslint 통과. usePullToRefresh의 ref 미러를 단일 effect 내로 정리해 react-hooks/immutability 에러 해소.

---

## #23

**Prompt**: 혹시 지금 대기였다가 참석으로 바뀔때 알림보내는거 구현됨? 내 아이폰에서 알림이 안오는데 뭘 봐야할까.

**Answer**: 진단 결과 대기→참석 승급 알림은 DB(cancel_attendance/promote_waitlist RPC가 promoted INSERT) + 인앱 수신(realtime 종모양/토스트)까지 구현돼 있으나, **아이폰 잠금화면 네이티브 푸시는 미구현**이 원인 — realtime WebSocket은 앱 포그라운드에서만 살아있어 앱을 닫으면 도착 안 함. 사용자 요청으로 EXPANSION_SPEC Phase 8(웹푸시)를 구현:
- **DB**: push_subscriptions 테이블(unique(member_id,endpoint), RLS 본인 CRUD) + pg_net 트리거(notifications AFTER INSERT → Vault 시크릿으로 send-push 호출, x-push-secret 헤더, 시크릿 미설정 시 조용히 통과).
- **Edge Function send-push**: @negrel/webpush(Deno 네이티브, npm:web-push의 Node crypto 의존 회피)로 VAPID 서명+암호화 전송, 404/410 만료 구독 정리, notifications.sent 마킹, notificationMessage 이식. verify_jwt=false + 헤더 시크릿 검증.
- **Service Worker(public/sw.js)**: push→showNotification(self.registration.scope 기준 base-aware), notificationclick→열린 창 focus+postMessage 또는 openWindow.
- **클라이언트(src/lib/push/ platform·vapid·subscription·db) + pushStore + PushSettingsSheet**(HeaderMenu "알림 설정" 항목). iOS standalone 게이팅, 권한요청은 클릭 핸들러 첫 await(제스처 유지).
- **App.tsx**: pushActions.init + push-navigate 라우팅(base prefix 제거). deploy.yml에 VITE_VAPID_PUBLIC_KEY.
- **iOS 제약**: 16.4+ & 홈화면 설치 PWA에서만 동작. 배포 시 사용자 콘솔 작업 필요(@negrel/webpush로 VAPID 키 생성 / supabase secrets / Vault edge_function_url·push_send_secret / GitHub secret / db push / functions deploy send-push).
- 검증: tsc -b / eslint / vite build / deno check 모두 통과. 작업 중 git 워킹트리 일시 변동이 있었으나 파일 손실 없이 복구 확인.

---
