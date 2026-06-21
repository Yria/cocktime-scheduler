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
