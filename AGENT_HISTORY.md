# Branch: main

## #1

**Prompt**: pwa 로 아이폰 볼때 하단 safe area 영역만큼 빈 공간으로 나오는데 이것도 채우게 해줄수있어?

**Answer**: iOS standalone PWA에서 하단 safe area(home indicator) 영역이 화면 배경과 다른 빈 띠로 보이는 문제를 해결했습니다. 근본 원인은 iOS PWA에서 safe area 영역이 `<body>`가 아니라 `<html>` 요소의 배경색으로 칠해지는데, `<html>`에 배경색이 지정돼 있지 않아 노출된 것이었습니다. 상단 노치는 AppHeader가 padding-top으로 직접 덮어 문제없지만, 하단은 덮는 요소가 없어 빈 띠가 생겼습니다.

- `<html>`에 화면 배경색과 동일한 색 지정 (라이트 `#fafbff` / 다크 `#0f172a`)
- `.dark` 클래스가 `<html>`(documentElement)에 부착되므로 `html.dark` 셀렉터로 다크 분기
- 모든 화면 배경(AppScreen·Home·SessionSetup·보드 BG_BOARD)이 동일 색이라 단일 수정으로 일괄 적용
- 보드 화면 하단은 RestBar가 이미 home indicator를 직접 덮고 있어 영향 없음
- safe area는 실기기 전용이라 실제 효과는 iOS 기기 PWA에서 확인 필요

---

## #2

**Prompt**: 대기→참석 승급 알림 native push 디버깅 및 배포 + 알림설정 모달에 iOS/Android PWA 설치 안내 추가

**Answer**: sam/expansion의 웹푸시(Phase 8)를 배포하고 실제 작동까지 디버깅했습니다.

- **배포**: GitHub Secret `VITE_VAPID_PUBLIC_KEY`, `db push`(push_subscriptions+트리거), `functions deploy send-push`, main 배포.
- **cancel_attendance 깨짐(URL bad format)**: 푸시 트리거의 `net.http_post` 동기 오류가 취소/승급 트랜잭션을 롤백시킴. 트리거를 URL 검증(`!~ '^https?://'`) + `BEGIN/EXCEPTION` 격리로 수정해 진짜 fire-and-forget 보장(20260622170000).
- **send-push 500 WORKER_ERROR**: `VAPID_KEYS` secret이 복붙 중 깨진 게 원인. 로컬 재현으로 코드는 정상 확인 후, 파일 기반으로 재설정 + 함수를 top-level await에서 **lazy 초기화 + try/catch 에러 노출**로 견고화(콜드스타트 크래시 방지).
- **edge_function_url 줄바꿈 깨짐**(`funct\n  ions`) → 재설정.
- **구독 0**: 아이폰에서 알림을 안 켠 것이 native push 미수신의 최종 원인으로 확인.
- **설치 가이드**: PushSettingsSheet에 플랫폼별(iOS/Android/데스크톱) 홈 화면 설치 단계 안내 추가, `platform.ts`에 `isAndroid` 추가.
- 검증: tsc -b / eslint / vite build / deno check 통과.

---

## #2

**Prompt**: 아니 색깔문제가 아니고 그 영역만큼 스크롤을 안그리는게 문제야. 이거 해결불가?

**Answer**: 색이 아니라 스크롤(콘텐츠 렌더링) 영역이 home indicator만큼 짧은 게 문제임을 확인했습니다. 근본 원인은 iOS PWA에서 `100dvh`가 콜드스타트 시 잘못된(작은) 값을 반환해, `height:100dvh` 컨테이너가 화면을 다 못 덮고 내부 스크롤 영역이 하단 safe area를 제외하는 것입니다(웹 검색으로 100dvh 콜드스타트 버그 확인).

- 타입1(고정높이+내부스크롤) 화면 3개를 `position:fixed; inset:0`으로 변경: AppScreen(일정·Home), MemberAdminPage, SessionBoard
- `fixed/inset:0`은 layout viewport(safe area 포함) 전체를 안정적으로 덮어 dvh 콜드스타트 버그를 회피
- 타입2(min-height+페이지스크롤: LogPage·SessionSetup·Home 로그인)는 페이지 스크롤이라 메커니즘상 무관해 미변경
- #1의 html 배경은 보조 안전망으로 유지, 타입 체크 통과, 실제 효과는 iOS 실기기 PWA에서 확인 필요

---

## #3

**Prompt**: 지금 수정본 배포됐음에도 하단이 가려져 / 세션시작·보드열기 텍스트를 "경기 시작"으로, 참석 확정·취소를 참석중/대기중이 명확하게

**Answer**: #2의 `position:fixed; inset:0` 수정으로도 실기기에서 하단이 계속 가려져, 추측을 멈추고 임시 디버그 오버레이(`SafeAreaDebug`)로 실기기 실측값을 수집해 근본 원인을 규명했습니다.

- **실측 결과**: `scr:956` vs `vh:956 lvh:956` / `dvh:894 svh:894 clientHeight:894`. 즉 `position:fixed; inset:0`과 `100dvh`는 모두 `clientHeight(894)`에 갇혀 화면(956)보다 **상단 inset(62px)만큼 짧음** → #2의 fixed 방식도 사실상 dvh와 동일하게 짧았던 것. **`vh`/`lvh`(956)만 풀스크린**.
- **처방**: `.app-shell-h` 클래스 신설 — 일반 브라우저는 `100dvh`(툴바 동적 반영), `@media (display-mode:standalone)`에서는 `100vh`→`100lvh`로 풀스크린 강제. AppScreen·SessionBoard(→position:relative)·MemberAdminPage의 `fixed/inset:0`을 `.app-shell-h`로 교체.
- **ScheduleCard UI**: "세션 시작·보드 열기" → "경기 시작". 참석 확정/대기 상태를 색 점+pill 배지(참석 중 / 대기 N번째)로 시각화해 내 상태를 한눈에 구분.
- 디버그 오버레이 제거, tsc·vite build 통과. MemberAdminPage 모달 오버레이(fixed/inset:0)는 미변경(추후 필요시 정리).

---

## #4

**Prompt**: 아직도 여전히 pwa 하단 safearea 가 스크롤에 가리는데, 보통 사람들은 safearea 영역만큼 겹쳐져서 문제가 발생하는데 난 애초에 안겹쳐서 생기는 문제란말야. 인터넷에서 관련문제 검색하고, playwright 에서 렌더된 html 을 참고해서 뭐가 문제가 될 것 같은지 전체적으로 확인해봐. 그리고 네가 본격적으로 파악할 방법도 찾아보고.

**Answer**: "콘텐츠가 safe area에 겹치는" 흔한 문제가 아니라 "렌더 영역 자체가 화면보다 작은" 반대 문제임을 사용자가 정확히 지적. 웹 리서치(5각도 병렬 워크플로우) + Playwright 배포본 DOM 검사로 근본 원인을 확정했습니다.

- **확정 원인 A**: `black-translucent + viewport-fit=cover + standalone` 조합에서 WebKit이 레이아웃/비주얼 뷰포트 자체를 상단 inset(62px)만큼 축소 → `innerHeight=clientHeight=100dvh=100svh=894`, `100vh=100lvh=956`(풀스크린)만 화면 전체. 사양 동작(버그 아님), 5개 리서치 + 실측 1:1 일치.
- **확정 원인 B(실제 트리거)**: Playwright로 DOM 체인에 높이/overflow 제약 없음 확인. 셸(`.app-shell-h`)은 이미 lvh로 정답이나, **셸을 안 쓰는 화면들이 `100dvh`(894)에 묶여** 하단 62px 미충전(`html{background}` 핵으로 색만 가리던 상태). 특히 사용자가 테스트한 로그인 화면(#4).
- **처방 적용**: `.app-shell-minh` 유틸 신설(standalone에서 min-height lvh). `App.tsx`(로딩)·`Home.tsx`(로그인·로딩)·`SessionSetup`·`LogPage`·`.lq-bg`(배경)를 통일. black-translucent·매니페스트·viewport meta·theme-color는 트레이드오프 손해라 미변경.
- **본격 진단법 제공**: macOS Safari 원격 웹 인스펙터로 설치형 PWA inspect + lvh/dvh/offsetHeight 측정 스크립트 + cold-start/회전/OS버전(26.1 회귀 가설) 배제 절차.
- tsc·vite build 통과.

---

## #5

**Prompt**: 일정 취소하면 그냥 삭제되게 해줘. 취소 스트라이크 없어도 돼.

**Answer**: 사용자가 말한 "스트라이크"는 취소 시 달력에 남던 취소선(line-through)이었음. 취소=삭제로 통합하고 취소선/되돌리기 상태를 제거. 핵심 제약은 반복 규칙 회차를 그냥 delete하면 sync_schedule_occurrences B단계가 56일 창 안에서 재생성한다는 점 — 그래서 회차 타입별로 분기 처리.
- **일회성 회차**: `deleteSchedule`로 완전 삭제(참석/카운터/알림은 FK on delete cascade로 정리)
- **반복 규칙 회차**: `status='cancelled'` tombstone만 남겨 재생성 방지하되, `fetchOccurrences`에서 cancelled를 제외(`neq`)해 달력에서 사라지게 함 → 화면상 "삭제됨"
- `OccurrenceEditor`: "이 회차 취소"/"삭제" 두 버튼을 단일 "삭제"로 통합, cancelled 분기·되돌리기·onSkip/onRestore/isPast 제거
- `ScheduleCalendar`: line-through·opacity 취소선 렌더 제거
- 스토어: skipOccurrence/deleteOcc/restoreOcc → 단일 `removeOccurrence(occ)` 통합, `restoreOccurrence` 체인 dead code 삭제
- DB 계약은 불변이라 EXPANSION_SPEC 수정 불필요. tsc·eslint·테스트 132개 전부 통과.

---

## #6

**Prompt**: 카풀 신청/필요자가 참석/대기 빼면 자동으로 카풀관련도 같이 취소되게 해줘.

**Answer**: 근본 원인은 `cancel_attendance` RPC가 `status='cancelled'`만 찍고 `carpool_role`은 그대로 둔다는 점. 표시상으론 `fetchAttendances`가 cancelled를 제외해 안 보이지만, `join_session`으로 재참석하면 "취소후재신청은 같은 행 갱신"이라 carpool_role이 부활하는 잠재 버그가 있었음.
- 새 마이그레이션 `20260623010000_cancel_attendance_clears_carpool.sql`: `cancel_attendance`를 재정의(create or replace)해 취소 UPDATE에 `carpool_role='none', carpool_seats=null` 추가. 카운터 감소·대기 승급 로직은 그대로.
- 기존에 취소됐지만 carpool_role이 남은 행 1회 backfill 정리.
- 클라이언트는 변경 불필요 — `scheduleStore.cancel`이 `reloadAttendances`로 서버 진실을 다시 받고, 카풀 선택 UI는 `attending`일 때만 노출되어 취소자는 재설정 불가.
- `docs/EXPANSION_SPEC.md`의 cancel_attendance 계약에 카풀 해제 명시. 마이그레이션은 직접 적용 필요(Supabase).

---

## #7

**Prompt**: 일정추가 모달 on/off 를 스위치형태의 디자인으로 바꾸고 selectbox 의 우측 화살표가 오른쪽에 너무 붙어있는데 적절한 패딩으로 띄워줘

**Answer**: 카풀 ON/OFF 텍스트 버튼을 iOS 스타일 토글 스위치로 교체하고, place select의 네이티브 화살표를 커스텀 화살표로 바꿔 우측 패딩을 줬음. 기존 `CockCheckToggle`의 스위치 디자인을 재사용 컴포넌트로 추출해 톤 일관성 유지.
- `src/components/common/Switch.tsx` 신설: role="switch" iOS 토글(on=카풀 그린 #2c7a57, disabled 지원).
- `styles.ts`에 `selectStyle` 추가: `appearance:none` + data-URI chevron + `backgroundPosition:right 14px center` + `paddingRight:38`로 화살표를 가장자리에서 띄움.
- `OccurrenceEditor`·`ScheduleRuleEditor` 두 모달 모두 카풀 토글 → `<Switch>`, place select → `selectStyle` 적용(동일 패턴이라 일관성 위해 둘 다).
- headless Chrome 스크린샷으로 라이트·다크 렌더 확인. tsc·eslint 통과.

---

## #8

**Prompt**: 카카오로 로그인 텍스트 왼쪽에 카카오 메신저 이미지 넣어줘. 보편적으로 넣는 이미지가 있는데 인터넷 검색하면 나올거야.

**Answer**: 로그인 버튼(`Home.tsx`, 이미 #FEE500 옐로우)을 flex 구조로 바꿔 텍스트 왼쪽에 카카오 말풍선 심볼(인라인 SVG)을 추가. 웹 검색 결과 공식 심볼은 말풍선 형태이고 SVG path는 공개되지 않아, 후보 2개(직접 그린 말풍선 vs simple-icons kakaotalk 사각 앱아이콘)를 노란 버튼 위에 렌더해 비교.
- 로그인 버튼 표준은 순수 말풍선이라 직접 그린 말풍선(fill #191600, 텍스트색과 동일)을 채택. simple-icons 사각 아이콘은 배지처럼 무거워 제외.
- 외부 에셋/네트워크 요청 없이 인라인 SVG로 처리(viewBox 0 0 24 24), `aria-hidden`.
- headless Chrome 스크린샷으로 실제 버튼 렌더 확인. tsc·eslint 통과.

---

## #9

**Prompt**: recurring_valid_occurrences 테이블에 Data is publicly accessible via API as this is a Security definer view. Learn more. 에러발생해. 이거 해결하는데, 그 전에 db 를 보고 쓰고 있는거 쓰고있지 않은거 확인해서 정리부터 하고 해줘.

**Answer**: 라이브 DB를 REST OpenAPI·행수로 introspection(테이블 13·뷰 1·RPC 24)한 뒤, 마이그레이션 생명주기·코드 참조·라이브 객체를 교차검증하고 미사용 후보는 적대적 재검증으로 오삭제를 차단했다.

- 핵심: 코드에 직접 안 보이던 `session_counters`·`recurring_valid_occurrences` 뷰·`current_member_id`는 모두 SECURITY DEFINER RPC를 통한 간접 사용 → 드롭 금지. 즉시 깨지는 참조·잔존 레거시 객체 0건(과거 정리 이미 완료).
- lint 원인: 뷰가 `security_invoker` 없이 생성돼 기본 SECURITY DEFINER로 RLS를 우회하고 anon/authenticated에 API 노출. 클라이언트는 뷰를 직접 조회하지 않고 RPC(`sync_schedule_occurrences`)만 소비.
- 수정: 뷰를 `security_invoker=on`으로 재정의(정의 본문 동일) + anon·authenticated SELECT 회수. 의존 RPC는 소유자 권한으로 읽어 무영향.
- 원격 적용 후 검증: anon 접근 401 차단, service_role 정상 57행 반환, 뷰 정의·sessions 무손상 확인.

---

## #10

**Prompt**: 필요없으면 드랍해

**Answer**: 미연결 관리자 RPC 2개(`promote_waitlist`·`announce_carpool_muster`)의 전용 DB 의존성을 먼저 점검한 뒤 제거했다. git 이력상 둘 다 Phase 5/7 때 만들어졌으나 클라이언트 호출이 한 번도 연결된 적 없는 미완성 기능.

- 의존성 점검: `promote_waitlist`는 건드리는 객체(session_counters·attendances·notifications·sessions)가 전부 활성 RPC와 공유 → 전용 DB 없음. `announce_carpool_muster`는 `sessions.carpool_muster_place_id`(+FK)·`carpool_muster_at` 전용 컬럼 보유, 단 write만 되고 읽는 곳이 없는 죽은 컬럼(집결 알림 표시는 notifications.payload로 처리).
- 결정에 따라 두 함수 + 죽은 컬럼 2개·FK 제거, `types.ts`의 대응 죽은 필드도 정리.
- 검증: RPC 24→22, `carpool_muster_at` 컬럼 부재(42703), sessions 정상 조회, tsc 종료코드 0.
- 보존: 자동승급 `'promoted'` 알림은 `cancel_attendance`가 계속 발송하므로 렌더링 유지, 활성 기능 `set_carpool_role`도 유지. `'carpool_muster'` 렌더링은 과거 알림 표시용으로 존치.

---

## #11

**Prompt**: 일정 노출시작을 일주일전이라고 했는데 이게 클라 하드코딩되어있는지 확인하고, 만약 그렇지않다면 서버에서 일주일전이 아닌데 참석을 누르려고 했을때 에러가 되게 해줘. 참고로 시간은 클라시간이 아닌, 서버시간을 기준으로 해야해.

**Answer**: 클라이언트에는 "일주일 전" 하드코딩이 없음을 먼저 확인했다. `ScheduleCard`는 `s.status === "open"`만 보고 참석 버튼을 노출하고, 노출(draft→open) 전환은 전적으로 서버 RPC `sync_schedule_occurrences` E단계가 `scheduled_at <= now() + interval '7 days'`로 처리한다(`now()`=Postgres 서버시간). 다만 참석 RPC `join_session`은 `status='open'` 간접 체크만 해서, status가 stale하거나 운영진이 open 회차를 1주보다 먼 미래로 옮기면 "1주 전이 아닌데" 참석이 통과되는 허점이 있었다.

- 새 마이그레이션으로 `join_session`을 재정의해 서버시간 `now()` 기준 상한 가드(`scheduled_at > now() + interval '7 days'`이면 `session not open yet` 예외)를 직접 추가. 본문은 직전 정의(FOUND 버그 수정본)를 그대로 보존하고 시각 가드만 삽입.
- 클라 `joinErrorMsg`에 `not open yet` → "아직 신청 기간이 아닙니다" 매핑을 `not open`보다 먼저 추가. 스펙(EXPANSION_SPEC.md)에도 가드 동작 보강.
- 다각도 검증 워크플로우로 타임스탬프 충돌(기존 `20260623030000_drop_unused_admin_rpcs.sql`과 중복)을 발견해 파일명을 `20260623040000`으로 변경. KST 하한(과거 일정) 가드는 의도적으로 제외 — 시작 시각 지난 open 회차의 늦참은 기존 `isLive` 흐름에서 허용되므로 추가 시 회귀. 스펙 문구를 "상한만 재검증"으로 정정.
- 검증: tsc 종료코드 0.

---

## #12

**Prompt**: 상단 nav 좌우패딩이 모바일에서 이상해. 그리고 상단 nav 스타일을 모든 페이지에 적용해. 현재까지 다른게 확인된건 매치로그 페이지야.

**Answer**: 모바일 패딩 이상의 근본 원인은 공용 `AppHeader`의 내부 컨테이너가 `max-w-sm`를 `md:` 없이 무조건 적용하고 거터가 `px-2.5`(10px)였던 것. 384px보다 넓은 폰(예: 430px)에서 nav가 전체 뷰포트 기준으로 384px 중앙 캡되어 본문(20px 거터)보다 안쪽으로 떠 보였다. 본문 콘텐츠와 동일한 중첩 구조(외부 1.25rem 패딩 + 내부 max-w-sm mx-auto)로 바꿔 모든 화면폭에서 nav가 본문 거터와 정확히 정렬되게 했다.

- `AppHeader`: 컨테이너 중첩 구조로 재작성, 뒤로가기 글리프(marginLeft −7)·로고/제목 마진을 거터선에 맞춤
- nav 스타일 불일치 페이지 통합: `LogPage`(매치 로그)·`SessionSetup`(세션 설정)의 흰색·60px 자체 헤더를 공용 `AppHeader`로 교체
- `MemberAdminPage` 우측 카운트의 marginRight:6 제거(헤더가 20px 거터 제공)
- 전체 consumer 스윕으로 누락 페이지 없음 확인(로그인 랜딩·ProfileSetup은 의도적 nav 없음)
- 적대적 검증 워크플로우는 서브에이전트가 세션 한도로 전부 실패 → 수동 검증으로 대체. tsc 종료코드 0, eslint 0 errors

---

## #13

**Prompt**: 회처편집에서 카풀 on/off 를 일반적인 스위치디자인으로 해줘. 그리고 시작시간/종료시간 input 도 모달 폭 고려해서 폭 조절해주고.

**Answer**: 카풀 on/off 스위치는 #7에서 이미 `common/Switch.tsx`(iOS 토글)로 두 모달에 적용됨을 확인했고, 이번 턴의 실작업은 시간 input 폭 조정이었다. 추측 대신 헤드리스 렌더+JS 실측으로 먼저 검증한 결과 현재 코드(`flex:1`)도 320~430px에서 오버플로우가 없었고, 초기 repro의 "넘침"은 `position:fixed` 오버레이를 모델링하지 않아 페이지가 가로로 확장된 아티팩트였다.

- 사용자가 요청한 적대적 검증 워크플로우(에이전트 6개)의 CSS 렌즈가 "가드가 잘못된 노드(래퍼 div)에 있다 — 넘침 위험원은 네이티브 `<input type=time>` 자신의 intrinsic 폭이므로 input 레벨 `min-width:0`이 정공법"이라는 타당한 major 지적을 제기.
- 이를 반영해 공유 `styles.ts`의 `inputStyle`에 `minWidth:0` 추가(→ `selectStyle`도 spread로 상속). 시간 input 래퍼의 `minWidth:0`는 flex item이 줄어들게 하는 표준 패턴이라 유지(belt-and-suspenders). 주석도 효과를 과대표현하지 않도록 정정.
- 부수효과: 같은 행의 장소 `<select>` 오버플로우(완전성 렌즈 minor 지적)도 `inputStyle` 한 곳 수정으로 동시 해결 — 긴 장소명이 깔끔히 클리핑됨을 fixed-오버레이 재현으로 확인(`placeRow overflow=false`).
- iOS Safari의 넓은 네이티브 time 위젯이 실제 위험 케이스이며, input+래퍼 양쪽 `minWidth:0`로 어떤 폭에서도 모달 밖 넘침을 차단.
- 검증: `tsc -b` 0, `vitest` 132 passed, 변경 파일 eslint 0. 전체 eslint의 기존 무관 문제 3건(`useSetupPlayers.ts`·`MemberAdminPage.tsx`)은 범위 밖이라 미수정.

---

## #14

**Prompt**: 세션화면에서 현재 사람 누르고 있으면 매칭이력 뜨는데, 더블탭으로 바꿔주고, 화면 축소해도 자석이동가능범위는 그대로인데 이것도 비율에 맞게 변경해줘. 그리고 여기로 끌어서 팀에서 빼기처럼 휴식하기 존도 드래그 시작할때만 나오게 해주고, 하단에 배치해줘. 또한 자석의 출발지점이 상단의 팀에서빼기존, 하단의 휴식하기존에서 출발한다면, 해당 지점으로 드래그하는 액션 실패하게 해줘.

**Answer**: 세션보드(react-konva) 자석 드래그 시스템에 4가지를 구현하고, 검증 워크플로우(에이전트 8개)의 적대적 리뷰로 major 2건을 잡아 수정한 뒤 집중 재리뷰(8/8 PASS)로 확정했다. 좌표계(absToStage가 줌/팬을 논리 좌표로 역변환)를 먼저 파악한 게 핵심.

- **req1 (더블탭)**: `PlayerMagnet`의 롱프레스(450ms)→`openDebug` 제거, 더블탭→매칭이력으로. 단일 탭(추천/콕확인)은 더블탭과 구분하려 280ms 지연 발동. 리뷰가 "60ms 중복 가드는 잘못된 위협모델(브라우저 호환 click은 ~300ms 지연이라 못 잡음, 사실상 dead code)"이라는 major를 제기 → 타임스탬프 대신 **이벤트 modality(터치 tap vs mouse click) 기반**으로 터치 탭 직후의 호환 click 1개를 흡수하도록 수정.
- **req2 (줌 비율 이동범위)**: store 클램프·존 판정·정렬 경계를 물리 `stageW/H`에서 **논리 `viewW/H`(=stage/scale)** 로 통일(`setStageSize(viewW,viewH)`, `useBoardDragHandlers(viewH)`, 존 렌더 viewW/viewH) → 축소 시 보이는 영역만큼 이동범위가 비율대로 확대. `Stage`는 물리 width/height+scale 유지.
- **req3 (휴식 밴드)**: 신규 `RestZone` Konva 밴드를 `DetachZone`(상단)처럼 **드래그 중에만 하단** 노출. `dragInfo.restable`(편집자의 free/anchor 대기 자석) 추가, `showRest=restable && !restZoneOpen`. 밴드 높이=드롭 판정(`REST_FIELD_H`)과 일치. 기존 RestBar(카운트)·RestZonePanel(휴식자 보기)은 유지.
- **req4 (출발존 가드)**: `dragInfo.from`(시작 논리좌표) 기록 → 출발이 빼기존/휴식존이면 같은 존 드롭 무효. 리뷰 핵심버그: 단순히 detach/rest만 건너뛰고 `handleDrop`으로 폴백하면 `resolveDropTarget`이 빈 공간 앵커 드롭을 'detach'로 재해석해 가드가 우회됨 → **두 존 분기 모두 무조건 `return`**(앵커=슬롯·자유=원위치 스냅백)으로 차단. ghost의 빈공간=예약취소 우회도 동일 차단. 교차 존(빼기↔휴식)은 정상 동작.
- 검증: `tsc -b` 0, `vitest` 132 passed, 변경 파일 eslint 0. 적대적 8시나리오 재검증 전부 PASS. eslint 기존 무관 3건은 범위 밖이라 미수정. (보드 캔버스는 Supabase 인증 필요로 실기기 시각 확인은 사용자 몫 — 줌 0.5배 우하단 드래그·휴식 밴드 외형.)

---

## #15

**Prompt**: 편집모드로 넘어갈때 너 이거 건드리면 다른사람이 편집못한다는 경고 알라트 띄우기
자동편성 모달에서도 더블탭으로 정보띄우기
정보모달에 디버그 테이블 진입안됨
혼자 보고있으면 보기전용없이 바로 편집모드. 그리고 가끔 앱 내렸다 올릴때 보기전용 버튼 안눌러도 편집모드로 넘어갈 때 있음
휴식존에서 드래그할때 프레임 너무 떨어짐
늦참한 사람은 늦참한 시간만큼 경기 뛰었다고 가정(전체 판수 평균내면 될듯)
게스트참가 양식이 필요. 사용자가 일정에 참여를 누를때 카풀선택을 하듯이, 게스트 신청을 할 수 있음. 사용자가 직접 게스트를 실력과 함께 입력하며, 이후 게스트만 일정을 취소또는 대기하는것도 가능해야함. 이거 개발할건데 어떻게 개발해야할지 고민해봐.

**Answer**: 7개 작업을 이해→설계→구현→적대적 리뷰 워크플로우로 진행. 7영역 병렬 심층조사 후 결과가 갈리는 4건(더블탭 진입·늦참 보정 방식·혼자 기준·게스트 정원)을 사용자에게 확인하고, #6은 사용자가 deficit 모델 제거를 직접 지시. 구현 후 적대적 리뷰(에이전트 8개)가 critical 회귀 1건을 잡아 수정. 검증: tsc 0, vitest 132 passed, 변경 파일 eslint 0.

- **#1 편집 진입 경고**: '편집 권한 가져오기'가 *남이 편집 중일 때만* 확인 모달(기존 ModalSheet 패턴) → 확정 시 탈취. 빈 자리(자유) 점유는 경고 없이 즉시(BoardToolbar). 자동 점유(lockFree)는 남을 안 쫓아내므로 경고 불필요로 판단.
- **#2·#3 더블탭 정보**: `useDoubleTap` 훅 신규 추출(항목 키 기반, 다른 항목 전환 시 직전 단일탭 flush). `PlayerPickerList`에 `onItemDoubleTap`(있을 때만 단일탭 280ms 지연, 없으면 즉시 보존). RecommendTeammateDialog에서 선수 더블탭→`openDebug`(전역 DebugMatchModal은 이미 마운트). 🐛(인라인 점수표)는 유지.
- **#4 혼자 자동편집 + 재개 버그**: (A) `presenceCount≤1 && lockFree && !isEditor`면 자동 점유(`maybeClaimIfAlone`, presence/resync/lease만료 틱에서 호출, lockFree 가드로 활성 편집자 안 뺏음). (B) 재개 핸들러의 무조건 낙관선점(claimNow) 제거 → `resyncFromServer` 먼저, '직전 편집자 && 자유'일 때만 재점유 → '두 명 편집' 윈도우 제거(근본 원인).
- **#5 휴식존 프레임드랍**: `useBoardDragHandlers`가 restHot이면 early-return(휴식존에선 버려지는 `resolveDropTarget`/`cockPendingIds` 매프레임 계산 제거). `PlayerMagnet.handleDragMove`를 rAF 코얼레싱(프레임당 1회 hover 해석) + dragend/언마운트 시 `cancelAnimationFrame` 정리.
- **#6 늦참 보정(알고리즘 변경)**: 사용자 지시로 deficit(라운드 비례 기대치) 모델을 제거하고 raw `gameCount` 기준으로 단순화. '콕확인=합류' 시점에 `game_count`를 그때의 활성 평균으로 보정(`set_cock_checked` RPC 신규, `GREATEST`로 실제 더 뛴 값은 안 깎음). 휴식 복귀도 같은 over-prioritize가 재발하므로 동일 보정으로 일반화(`set_player_resting` 교체). `ScoreBreakdown.deficit→game` 개명, `RankContext`에서 `totalMatchCount`/`allSessionPlayers` 제거. `docs/TEAM_GENERATION_RULES.md` 동기화(프로젝트 규칙). 마이그레이션 20260624000000.
- **#7 게스트 RSVP(설계→구현)**: 핵심 발견 — `members.is_guest`가 이미 존재해 '계정 없는 회원' 모델이 의도됨. 게스트 = `is_guest` member + `attendances.invited_by`(데려온 회원). 보드 편입 브릿지(`start_session_from_schedule`가 members JOIN)가 자동 연동되어 편성/보드 코드 변경 0. 정원은 회원과 동일. `add_guest_attendance`/`cancel_guest_attendance` RPC(SECURITY DEFINER로 RLS 우회, join/cancel 패턴 복제, 게스트 승급 알림은 초대 회원에게). `ScheduleCard`에 `GuestSection`(신청 모달=GuestModal 재사용 + 내 게스트 목록/상태/취소). 회원관리(`fetchMembersForAdmin`)에 `is_guest=false` 필터로 명단 오염 방지. 마이그레이션 20260624010000.
- **적대적 리뷰가 잡은 critical**: `invited_by` FK 추가로 attendances→members 관계가 둘이 되어 `fetchAttendances`의 member 임베드가 모호(PGRST201)→error 분기로 전체 빈배열 반환 = 모든 일정 카드 참석/대기/카풀이 통째로 깨지는 회귀. FK 컬럼 명시 임베드(`member:member_id(...)`)로 수정. (나머지 3개 리뷰 영역은 확정 이슈 0.)
- **배포 의존성**: 마이그레이션 2건(20260624000000 콕확인 평균보정, 20260624010000 게스트) DB 적용 필요 — 미적용 시 콕확인/게스트 신청이 실패. 보드 실기기 확인(편집락·재개·휴식존 프레임)과 게스트 RSVP→경기 시작 편입은 사용자 몫.

---

## #16

**Prompt**: 드래그할때, 하단으로 드래그하면 휴식, 상단으로 드래그하면 팀에서 해제인데, 상단 드래그 영역은 현재 보드(네비영역제외한)의 최상단인데, 네비영역인 부분이 빨간색 dot square 가 나오고 거기로 끌어가면 해제되게 해주고, 휴식패널 열고 드래그해서 사람 넣고 뺄때마다 휴식드랍존 내부에서 자동정렬시켜줘.

**Answer**: 보드 드래그 시스템 2건을 구현하고 적대적 리뷰(에이전트 3개)로 low 1건을 잡아 수정. 좌표계(Stage 컨테이너가 네비 TOOLBAR_H 아래, 자석/존은 논리 viewW×viewH 좌표)를 먼저 확인한 게 핵심. 결정이 갈리는 두 지점(네비 detach 구현 방식·휴식 자동정렬 의미)은 먼저 사용자에게 확인.

- **#1 팀 해제존 → 네비 영역**: Konva 캔버스가 네비(DOM) 바로 아래라 자석을 네비 안으로 직접 끌 수 없음 → "네비에 빨간 점선 DOM 오버레이" 방식 선택. 기존 stage 상단 Konva 밴드(`DetachZone`) 제거하고 신규 `DetachZoneOverlay`(DOM, 네비 위 z-index:30, pointerEvents:none, 팀 소속 자석 드래그 중 노출, `detachHot`이면 강조)로 교체. 드롭 감지는 그대로 `isInDetachZone`(보드 최상단 72px 논리좌표) — 즉 시각=네비 오버레이 / 감지=보드 최상단 strip 하이브리드(자석은 stage 상단까지만 가므로). 보드 콘텐츠 상단 공간 확보.
- **#2 휴식존 다중 줄 자동정렬**: 휴식 자석은 이미 `restSlotOffset` 인덱스 격자라 넣고 빼면 빈칸 없이 재패킹됨(자동정렬). 추가로 1줄 고정이던 패널을 인원수만큼 **여러 줄로 자동 확장**: `REST_ZONE_H`(고정 108) 제거 → `restZoneHeight(count, stageW, stageH)`(줄 수만큼, 1줄=108 동일). `isInRestField` 시그니처 `(point, stageH, expanded:boolean)`→`(point, stageH, fieldH:number)`, `restSlotOffset(index, count, stageW, stageH)` 다중 줄. SessionBoard가 `restFieldH`를 산정해 `useBoardDragHandlers`·`RestZonePanel`이 **같은 산식**을 써 드롭 감지 영역 == 패널 영역 일치.
- **적대적 리뷰**: detach 오버레이 0건. rest 1건(low) — `restZoneHeight`에 상한이 없어 극단 인원(약 41명+ 휴식)에서 패널이 viewH를 넘으면 `isInRestField` 임계값(`viewH−restFieldH`)이 음수가 되어 보드 전체가 휴식 드롭존이 됨 → `Math.min(h, stageH−DETACH_ZONE_H)`로 클램프(상단 detach strip 항상 보존, 감지·렌더 동일 적용으로 불변식 유지).
- 검증: `tsc -b` 0, `vitest` 142 passed, 변경 파일 eslint 0. 네비 오버레이·다중 줄 패널의 실기기 시각 확인은 사용자 몫.

---

## #17

**Prompt**: 가끔 팀편성하다보면 이미 팀에 소속되어 있는데 게임중이라고 뜨거나, A팀에도 들어있고 B팀에도 들어있는 경우가 있어. 아마 동시편집하면서 발생하는 문제같은데, 사용자의 처리를 유니크하게 처리해서 해당상황처럼 중복으로 들어가지 않게 처리하지 않았나? 다시한번 점검하고 편집->보기할때 뭔가 액션중인거 있으면 전부 취소시켜줘 예를 들어 팀편성 모달을 띄워놓았다던가 하는거. 그담에 세션종료하면 현재 게임중인 팀 있으면 자동으로 게임종료처리되고 세션종료해줘.

**Answer**: 동시편집 중복/게임중 오표시의 근본 원인을 5개 적대 검증 에이전트로 확정했다 — 팀편성(board_drafts)과 코트배정(matches)이 별도 권위로 비원자적으로 동기화되는데, board_drafts 쓰기만 editor lease로 보호되고 경기 RPC는 lease 미검증이라, lease 없는 낙관적 편집자/핸드오프 레이스가 경기를 성공시키면 짝이 되는 팀 해체(dissolve)는 거부·롤백되어 선수가 "팀에 남은 채 게임중"이 됐다. 사용자가 요구한 두 선행조건(편집은 한 명만 + 사람 유니크성)을 모두 보장하도록 설계했다.

- **수렴 불변식(유니크성)**: reconcile 단계에서 I1(한 선수=한 팀 anchor, createdMs→id 결정적 정렬로 먼저 만든 팀 유지)·I2(경기중 선수는 anchor 아님, 단 의도된 ghost 예약은 보존)를 항상 강제. 편집자는 정제 결과를 서버에 영속화(코트 변화 시 healPlayingAnchors + 원격 적용 후 차이나면 push)해 새로고침 시 "유령 팀" 부활까지 차단. 뷰어는 화면만 정제.
- **편집은 한 명만(서버 강제)**: assign/complete/set_match_roster RPC에 board_assert_editor(lease self-claim CAS) 가드를 추가한 마이그레이션 신설. board_save_drafts와 동일한 관대한 술어로 혼자/heartbeat 공백은 통과, 다른 기기가 유효 lease 보유 시 'not editor'로 거부. 거부된 기기는 resync로 보기 전용 수렴. 클라이언트는 client_id/name을 RPC에 전달.
- **편집→보기 취소**: isEditor true→false 전이 감지 시 추천/경기수정/콕확인 모달 닫기 + cancelEditActions로 드래그·hover·배정중 상태 초기화(접속자 모달·휴식 패널은 뷰어 공용이라 유지).
- **세션종료 자동완료**: handleEndSession이 진행 중 코트를 complete_match로 먼저 정상 완료(판수·동반이력 집계)한 뒤 종료. 확인 다이얼로그 문구도 조건부 안내.
- 검증: 신규 테스트(reconcile I1/I2/ghost·healPlayingAnchors·cancelEditActions) 포함 vitest 142 통과, tsc·eslint·prod build 통과, 문서(TEAM_GENERATION_RULES) 불변식 섹션 추가. 마이그레이션은 클라 배포보다 먼저 적용 필요(신규 client_id 인자) — db push는 사용자 몫.

---

## #18

**Prompt**: 아니다 하지말고 상단 네비에 드랍영역 나타낼때, 네비의 글자가 오파시티값때문에 노출되는데 안보이게 해줘.

**Answer**: 보드 chrome 전체를 Konva로 옮기는 큰 리팩터를 검토하다(줌이 Stage scale에 걸려 있어 absToStage 좌표계 재작성이 필요 — 줌을 콘텐츠 Layer로 내리면 absToStage 한 곳 수정으로 가능함을 사용자와 확인) 사용자가 중단을 선택하고, 작은 표시 버그만 수정으로 전환.

- 증상: 팀 소속 자석 드래그 시 네비 위에 뜨는 `DetachZoneOverlay`(반투명 빨강, hot 상태 alpha 0.22)의 투명도 사이로 네비 글자(설정/로그/종료·코트 점)가 비쳐 보임.
- 수정: `BoardToolbar`가 `dragInfo?.detachable`(= DetachZoneOverlay 노출 조건과 동일)을 구독해, 드래그 중 헤더 div를 `opacity:0`(+`pointerEvents:none`, 0.12s 트랜지션)로 숨김. 점선 드롭존 디자인은 유지하고 글자만 가림. 숨김 시 오버레이는 보드 배경(다크) 위에 표시됨.
- 검증: tsc -b 0, 변경 파일 eslint 0. 시각 확인은 실기기 몫(Supabase 인증 필요).

---

## #19

**Prompt**: 네비 상단으로 드래그해야 팀에서 빠지게 ui는 수정했는데 드래그 범위는 그대로인거같아. 칠판기준 상단이 아니고 네비영역으로 드래그해야 팀에서 빠지는거야. 그럼 기존 코드중 자석이 이미 상단에 있을때 드래그하면 취소, 이 로직이 필요없어지겠지? 확인해. 마찬가지로 휴식도 휴식드래그존이 바텀에 띠형태로 있고 그 위에 하나 더 있는 형태인데, 바텀의 띠형태만 드래그존으로 하는걸로 해줘

**Answer**: detach 드롭존의 UI(네비 영역 오버레이)와 실제 판정 영역(칠판 상단 strip y≤72)이 불일치하던 문제를 진단해 판정 경계를 칠판 밖 네비 영역과 일치시켰다. 자석은 Konva 캔버스(칠판) 안에서만 그려지므로 네비/바텀바로 끌면 시각적으로 잘리지만 좌표는 음수/초과로 잡히며, 오버레이·바텀바 hot 점등이 피드백을 준다(BoardToolbar의 네비 글자 숨김도 이 동작을 전제한 기존 설계).

- detach 판정을 `y ≤ 72` → `y ≤ 0`(칠판 상단 경계=네비 진입)으로 변경 — UI와 일치
- "자석이 이미 상단에 있을 때 취소"(startedInDetach) 가드 제거 확인 — 존이 칠판 밖으로 옮겨가 자석이 거기서 출발할 수 없어 불필요(anchor·ghost 양쪽)
- 휴식: 칠판 안에 그리던 밴드 컴포넌트(RestZone) 삭제, 접힘 상태 판정 높이를 0으로 → 자석을 칠판 하단 경계 너머 바텀 바까지 내려야(y ≥ viewH) 휴식
- 휴식 출발 가드(startedInRest)는 펼침 패널 오작동 방지를 위해 유지 — 접힘 상태에선 높이 0이라 자동 비활성
- 미사용 상수(REST_FIELD_H) 제거, DETACH_ZONE_H는 펼침 패널 상단 마진으로 의미 재정의, 관련 문서·테스트 갱신
- 검증: 타입체크·ESLint·테스트 142개·프로덕션 빌드 모두 통과

---

## #20

**Prompt**: 드래그 시작할때 드래그존이 상단, 하단 두개가 있는데 상단이 "여기로 끌어 팀에서 빼기" 가 보이듯이, 하단에도 마찬가지로 문구와 박스가 보이게 해줘.

**Answer**: #19에서 칠판 안 휴식 밴드를 삭제하면서 하단은 바텀바 점등만 남아, 상단 detach 오버레이와 비대칭이 됐다. 상단 `DetachZoneOverlay`의 하단 대칭으로 바텀바 영역에 DOM 오버레이를 새로 만들어 점선 박스 + 문구를 드래그 시작 시 띄우도록 했다.

- 새 컴포넌트 `RestDropOverlay` 추가 — 바텀바 영역에 점선 박스 + "↓ 여기로 끌어 휴식하기"(hot 시 "여기 놓으면 휴식합니다"), showRest(restable && 접힘) 조건, hot=restFieldHot
- `SessionBoard`에서 showRest 복원 후 DetachZoneOverlay 옆에 RestDropOverlay 노출
- `RestBar`는 드래그 중 라벨/chevron을 opacity:0로 숨김 — 오버레이 hot 반투명 사이로 바 내용 비침 방지(BoardToolbar의 detach 처리와 대칭)
- 검증: 타입체크·ESLint 통과

---

## #21

**Prompt**: 휴식존 드래그할때 dash square 가 밝아지는건 좋은데 top border 까지 밝아질필욘 없을거같아

**Answer**: 휴식 영역 hot(restFieldHot) 시 RestDropOverlay 점선 박스와 RestBar의 top border가 함께 스카이로 밝아지던 것을, 오버레이가 hot 피드백을 전담하도록 바 쪽 top border hot만 껐다.

- `RestBar`의 borderTop을 dragging(접힘 드래그) 중에는 transparent로 — 점선 박스만 밝아지고 바 top border는 그대로 유지
- 펼침 상태(restZoneOpen) hot border는 dragging=false라 그대로 보존
- 검증: 타입체크·ESLint 통과

---

## #22

**Prompt**: 일정시간이 넘어가면 참석이 불가하고 노출도 안되게 해줘.

**Answer**: "일정시간"의 기준이 기존 동작(시작 시각이 지난 open 일정을 일부러 유지)과 충돌해 사용자에게 확인했고, **종료 시각(ends_at) 기준**·**운영진 포함 전원**으로 확정했다. 종료된 일정은 참석/게스트신청/경기시작이 모두 불가하고 홈 목록에서 사라진다.

- 서버: 새 마이그레이션 `20260624030000_attendance_end_time_guard.sql`에서 `join_session`·`add_guest_attendance`·`start_session_from_schedule` 세 RPC에 종료 상한 가드(`ends_at<=now()` → `session ended`) 추가. 각 함수 최신 본문은 그대로 보존하고 가드만 삽입, `ends_at` NULL(즉석/미정)은 통과. 클라 시계 대신 Postgres `now()` 기준이라 stale 윈도우 차단.
- 클라(`Home.tsx`): `isPastSchedule`로 종료된 open 일정을 목록에서 제외(30초 tick 재평가), `active`(진행중)는 유지. `session ended`를 "이미 종료된 일정입니다"로 변환 — 참석·경기시작·게스트신청 모두.
- 문서: `EXPANSION_SPEC.md`에 종료 상한 가드/홈 숨김 항목 추가, RPC 표 갱신.
- 검증: 적대적 병렬 워크플로우(20에이전트)로 SQL 회귀·경계·NULL·다른 표면 점검. 17건 중 1건(게스트 에러 원문 노출)만 확정 → 수정. `tsc -b`·`eslint` 통과.

---

## #23

**Prompt**: 일정 참가자 목록이 보였으면 좋겠음. 일반적으론 프로필 사진 작게 해서 현재 목록의 카드안에서 보이고, 특정 액션을 하면 모달로 띄워서 목록이 보이는거지. 액션은 어떻게 할지는 네가 고민해.

**Answer**: 액션은 "카드 안 겹친 아바타 스택을 탭 → 바텀시트 모달"로 결정했고, 모달 표시 방식은 사용자 선택(리스트형)을 따랐다. 데이터는 이미 카드까지 일괄 전달되는 `attendances`(N+1 없음)와 이름 기반 `getPlayerPhotoUrl`을 그대로 재사용해 추가 fetch가 거의 없다. 사진 없는 회원의 fallback 색(성별 기반)을 정확히 그리려고 참석 임베드에 gender만 추가했다(skill은 목록 용도에 불필요해 제외).

- 데이터: `fetchAttendances` 임베드 `member:member_id(name, is_guest, gender)`로 확장, `AttendanceRow.member` 타입에 `gender` 추가.
- 신규 `PlayerAvatar` — PlayerCard에서 사진/성별링/이니셜 fallback만 떼어낸 라벨 없는 경량 원형 아바타(스택·리스트 공용).
- 신규 `SessionParticipantsModal` — `ModalSheet`(bottom) 기반 리스트형. 확정/대기 그룹, 본인 `(나)`·게스트 뱃지·카풀 의향(🚗/🙋)·대기순번 표시.
- `ScheduleCard` — 참석 현황 줄 아래에 확정자 우선 최대 6명 겹침 스택+`+N`+chevron 추가(탭→모달), 내부 시간 포맷은 공용 `lib/schedule/timeFmt.ts`로 추출해 카드·모달이 공유.
- 검증: `tsc -b`·`eslint` 통과. 카카오 로그인 게이팅으로 실데이터 자동확인이 막혀, 소스 미오염 임시 미리보기 엔트리(mock)로 라이트/다크 모두 시각 검증 후 임시 파일 제거.

---

## #24

**Prompt**: 일정 열릴때 전체 회원에게 푸쉬가능? 이거 작업 끝나고 커밋및 푸쉬

**Answer**: 가능했다. 웹푸시 인프라(push_subscriptions → notifications INSERT 트리거 → send-push Edge Function)는 완비·배포돼 있고 '전체 회원 푸시'도 이미 있었으나, **운영진이 일정을 추가하는 순간**에만 발송됐다. 반복 회차가 7일 전 자동으로 draft→open 전환될 때는 알림이 없었다. 사용자와 확인해 **"열릴 때(open)로 통일"**로 결정(추가/자동 구분 없이 회차가 실제 모집 공개되는 시점에 1회).

- DB: 새 마이그레이션 `20260624050000_notify_on_session_open.sql`에서 `sync_schedule_occurrences()` 재정의. E단계(draft→open UPDATE)를 CTE+RETURNING으로 감싸 새로 open된 회차마다 로그인 회원 전원에게 `session_open` 알림 INSERT. 단방향 전환 + not exists 가드로 멱등(앱 진입마다 sync가 돌아도 첫 호출만 발송).
- 메시지: `notificationMessage`(클라)·`buildBody`(Edge Function) 두 빌더에 `session_open` 케이스 동일 추가("일정이 열렸어요. 참석 신청하세요!"). Edge 핸들러는 session_id로 세션·장소를 type 무관하게 조회하므로 추가 분기 불필요.
- 일원화: `adminScheduleStore`의 addRule·addOneOff에서 기존 `notifyScheduleAdded`(추가 시점) 호출 제거 + 미사용 import/oneOffLabel 정리. notify RPC·schedule_added 케이스는 과거 알림 호환 위해 보존.
- 검증/배포: tsc·eslint·build 통과. supabase db push(마이그레이션 3개)·functions deploy send-push 프로덕션 배포 완료. 실제 푸시는 실기기 구독 필요해 수동 확인 안내.

---

## #25

**Prompt**: 설정 푸쉬알림 도움말 이미지를 만들었어. ~/Downloads/and.png, ios.png 야. 이걸로 교체해줘 (잘되면 배포까지)

**Answer**: PushSettingsSheet의 '홈 화면에 앱 설치하기' 안내가 텍스트+아이콘 단계(installSteps)로 되어 있었는데, 사용자가 만든 스크린샷 이미지(제목·단계·TIP 완결형)로 모바일 안내를 대체했다. 데스크톱은 이미지가 없어 기존 텍스트 단계를 fallback으로 유지.

- 이미지 최적화: 원본 png 각 1MB를 cwebp(q85)로 webp 변환 → 64KB/74KB로 감소(도움말 텍스트 선명도 유지). src/assets에 push-install-ios.webp·push-install-android.webp로 배치, 컴포넌트에서 import(base path 안전).
- installGuide를 isIOS→ios, isAndroid→and 이미지 분기로 교체. 모바일은 이미지만(자체 제목·TIP 포함), 데스크톱은 텍스트 유지. 미사용된 IosShareIcon 함수·아이콘 import(EllipsisVertical/Smartphone/SquarePlus)·모바일 installSteps 분기 정리.
- 검증: build·eslint 통과, 임시 preview로 모바일 폭(390px) 텍스트 선명도 확인 후 임시파일 제거.
- 프론트 변경만이라 supabase 배포 불필요. 커밋 후 git push → GitHub Pages 자동 배포.

---

## #26

**Prompt**: 세로로 너무 길 경우 스크롤이 모달안에서 이루어지지 않아. 모달 최대크기는 화면을 벗어나지 않게하고 내부에서 스크롤 일어나게 해. 끝나면 커밋하고 푸쉬

**Answer**: 근본 원인은 공통 컴포넌트 ModalSheet의 시트에 **max-height가 없고 overflow-hidden**이라, 콘텐츠(긴 도움말 이미지)가 길어지면 시트가 무한정 늘어나 화면 밖으로 잘리고 자체 스크롤도 막힌 것이었다(.lq-sheet CSS엔 overflow/max-height 정의 없음). ModalSheet 한 곳만 고쳐 모든 모달에 공통 적용.

- `overflow-hidden` → `overflow-y-auto no-sb`, 인라인 `maxHeight: '90dvh'` 추가. dvh라 모바일 주소창 변동에도 안전, no-sb로 스크롤바 숨김.
- 검증: 임시 preview로 모달에 화면 초과 콘텐츠를 넣어 확인 — clientHeight 758px(≈90dvh)로 고정, scrollHeight 1460px, 내부 스크롤로 헤더↔하단 이동 정상, 둥근 모서리 유지. build·eslint 통과.
- 짧은 모달은 90dvh 안이라 영향 없고, 내부 스크롤을 이미 가진 모달(SessionParticipantsModal 등)도 그대로 동작.
- 프론트 변경만이라 supabase 배포 불필요. 커밋 후 git push → GitHub Pages 자동 배포.

---

## #27

**Prompt**: 세션 종료했는데 새로고침하니까 다시 들어와있어.

**Answer**: 보드 '종료' 경로(handleEndSession→dbEndSession)와 RLS는 정상이라, 재입장이 일어나려면 `is_active=true` 세션이 둘 이상 남아 있어야 한다는 점에 주목했다. service_role 읽기 조회로 쌍둥이 active 세션(135·136, 어제 09:54에 2ms 차로 생성, 경기 0건)을 확인 — 근본 원인은 setup 플로우 `startSession`의 비원자적 "기존 active 끄기→insert"가 더블 서브밋(동시 클릭)에서 레이스를 일으켜 두 active 세션을 만들고, `dbEndSession`은 id 하나만 종료해 잔존 active로 새로고침 시 재입장하는 것이었다.

- 진단 확정: `is_active=true`로 만드는 곳은 `startSession`(dedupe 있음)과 `start_session_from_schedule`(dedupe 없음)뿐, sessions 트리거·sync는 is_active를 true로 만들지 않음을 전수 확인.
- 유령 세션 135·136 종료(prod) → 잔여 active 0건으로 새로고침 재입장 즉시 해소.
- 마이그레이션 20260625010000 배포: ①중복 active 정리(최근 1건만 유지) ②`start_session_from_schedule`에 활성화 전 dedupe 추가 ③`is_active=true` 부분 유니크 인덱스로 "active 세션 최대 1개"를 DB 차원에서 강제(모든 경로·동시성 backstop).
- 클라이언트: `SessionSetup`에 submitting 가드(시작/업데이트 in-flight 중 버튼 비활성·재진입 차단), `startSession` 기존 active 종료 시 status='closed' 보정.(프론트 미배포)
- 검증: tsc·eslint 0, vitest 142 통과. db push는 신규 마이그레이션 1건만 적용.

---

## #28

**Prompt**: 1. 푸쉬알림으루등록하기위한 pwa 홈화면등록을 스샷으로 햤는데 상하드래그하면 모달안이 스크롤되는게 아니고 바깥이 스크롤돼. 그리고 이ㅣ미지로 설명다되니까 텍스트 필요없음
2. 경기시작 -> 매칭확정
3. 휴식패널 열려있는상태에서 드래그시작하면 접히게
4. 백그라운드에서 포어그라운드로 올라올때 동기화가 좀 늦는거같음. 동기화중일때 작업중 표시같은게 있어야할거같음
5. 편집권한 가져올때 나 혼자 있는데도 권한획득이 늦던데 이유확인

**Answer**: 5건의 보드/모달 개선을 관련 코드(ModalSheet·PushSettingsSheet·TeamBackground·PlayerMagnet·boardStore·sessionStore·SessionBoard)를 먼저 파악한 뒤 구현했다. 모두 프론트 변경.

- **#1 모달 스크롤**: 근본 원인은 모달 위 상하 드래그가 모달이 아니라 뒤 페이지(body)를 스크롤하는 iOS 스크롤 체이닝. `ModalSheet`에 열림 동안 body 스크롤 잠금(position:fixed + 닫을 때 위치 복원) + 시트에 `overscroll-contain` 추가(전 모달 공통). PushSettingsSheet의 설치 안내는 스크린샷 이미지만 남기고 부가 텍스트 제거.
- **#2 라벨**: 보드 팀 CTA "경기시작" → "매칭확정"(TeamBackground).
- **#3 휴식 패널 접힘**: 패널이 열린 상태에서 보드 자석 드래그 시작 시 `closeRestZone`로 접음(boardStore 신규 액션, PlayerMagnet handleDragStart). 휴식 자석(패널 내부 출발)은 유지. 접힘 상태(fieldH=0)는 곧 하단 바 휴식 드롭으로 자연 전환됨을 확인.
- **#4 동기화 표시**: sessionStore에 `boardSyncing` 추가, `resyncFromServer`를 try/finally로 감싸 플래그 토글. SessionBoard 상단 중앙에 스피너+"동기화 중…" pill(포어그라운드 복귀/재연결 시 노출).
- **#5 편집권한 지연 원인**: `claimEditor`가 본래 takeover RPC 왕복을 await한 뒤에야 편집 모드로 전환(직전 보유자 heartbeat 되돌림 레이스 회피용)인 게 지연 원인. 혼자(presenceCount≤1)면 경쟁 보유자가 없어 레이스가 없으므로 즉시 낙관 전환(heartbeat는 takeover 확정 전엔 미시작 — CAS로는 유효 lease를 못 뺏어 되돌려지기 때문), 실패 시 resync로 복구. 경쟁 상황은 기존 await 유지.
- 검증: tsc 0, eslint 0, vitest 142, prod build 성공.

---

## #29

**Prompt**: 동기화 표시를 다른 케이스일때도 나오는지 확인해.

**Answer**: `boardSyncing`이 `resyncFromServer` 내부에서 토글되므로 그 함수를 호출하는 8군데 전부에서 pill이 뜨고 있었음을 확인했다. catch-up 성격(포어그라운드 복귀 App.tsx + subscribe 핸들러, 재연결 onResync)과 실패/충돌 복구 성격(board_save_drafts 충돌은 이미 toast 있음, heartbeat·assign·complete·roster·claimEditor 실패 복구)으로 나뉘었고, 후자는 순간적으로 깜빡일 수 있어 원래 의도("복귀 시 표시")와 결이 달랐다. 사용자가 "A 그룹(catch-up)만"을 선택해 그에 맞게 스코프했다.

- `resyncFromServer(opts?: { indicate?: boolean })`로 시그니처 확장 — `indicate=true`일 때만 boardSyncing 토글(pill 노출).
- A 그룹 3곳(App 포어그라운드, subscribe visibilitychange 복귀, onResync 재연결)만 `{ indicate: true }` 전달. B 그룹(실패/충돌 복구) 5곳 + boardStore 저장충돌은 인자 없이 호출 → pill 미노출.
- 참고로 포어그라운드 복귀 시 App.tsx와 subscribe 핸들러가 둘 다 resync를 도는 중복은 사용자 선택(옵션 A)에 따라 이번엔 건드리지 않음.
- 검증: tsc 0, eslint 0, vitest 142, prod build 성공.

---

## #30

**Prompt**: 구기기에서 드래그할때 프레임 너무 떨어지던데 이유확인

**Answer**: react-konva 보드의 드래그 핫패스를 분석해 근본 원인을 확정했다 — 보드가 **단일 `<Layer>`**(별도 drag layer·`.cache()` 없음)라, Konva `draggable`이 드래그 이동마다 `layer.batchDraw()`로 **Layer 전체를 매 프레임 재래스터화**하는데, 그 Layer가 `shadowBlur`(자석 이름·호버 링, 팀 박스 12~16, 코트 카드 12) + `clipFunc`·gradient로 가득 차 있었다. shadowBlur는 캔버스에서 가장 비싼 연산(픽셀별 블러×DPR)이라 fill-rate 약한 구기기 GPU가 매 프레임 ~20~30개 그림자 노드를 못 버텨 드랍. 수정 깊이는 사용자가 "그림자 경량화 + 드래그 레이어 분리"를 선택.

- **드래그 레이어 분리는 안전성 문제로 대체**: 자석이 팀/코트 Group의 자식이고 드래그 중 SessionBoard가 존 진입 등으로 재렌더되므로, 드래그 노드를 별도 Layer로 re-parent하면 react-konva 재조정이 노드를 되돌려 드래그가 깨진다(알려진 함정). 그래서 같은 목적(드래그 중 비싼 redraw 제거)을 **드래그 중 그림자 비활성화**로 달성.
- `dragging = useBoardStore(s => s.dragInfo != null)` 셀렉터를 PlayerMagnet·TeamBackground·CourtMatchCard에 추가, 그림자 노드에 `shadowEnabled={!dragging}` 적용 — 드래그 start/end에 1회만 토글되고, 그 사이 매 프레임 redraw는 그림자 없이 저렴.
- clipFunc/gradient는 사진 자석 외형상 드래그 중 끌 수 없어 유지(그림자보다 저렴). 추가 여지로 노드 `.cache()`(비트맵 블릿)는 차후 레버로 남김.
- 검증: tsc 0, eslint 0, vitest 142, prod build 성공.

---

## #31

**Prompt**: 팀 추천로직에 혼복의 경우 남녀밸런스 맞추기 힘드니 보통 남자들은 밸런스 신경안쓰고 넣어도 됨, 여자만 밸런스 고려해야함. / 8명이 1코트 쓰는 케이스같이 4/4 딱 맞게 떨어지면 ... 2번 쉬고 2번연속하게 하는거임 ... 추천점수를 올릴 방법을 고민. / 화면이 좁아서 자석이 다 안들어가면 화면 스케일을 축소(렌더없이 계산만). / 휴식에 있는 사람은 그 시간동안 경기한거랑 같은 효과 — 휴식시간만큼 추천값 보정 안 됨.

**Answer**: 팀 추천 스코어링·보드 스케일 모델을 병렬 워크플로우로 매핑 → 설계 확인(혼복 밸런스 적용 지점·연속휴식 방식·스케일 정책) → 구현 → 적대적 리뷰(4차원) 후 진행. 사용자 확인 결과 ①혼복=추천 단계의 "여자만 밸런스", ②오래 대기자 강한 우선, ③자동정렬마다 최적 배율, "페어 A/B 2:2 분할은 기획에 없음"(pairPlayers 미사용 취급).

- **A 혼복 여자만 밸런스(rankCandidates)**: skillDiff를 성별 인식으로 — 양성(혼복 지향) 그룹이면 남자 후보는 skillDiff 0(실력 무시), 여자 후보는 확정 여자들 평균과만 비교(여자끼리 균형). 단일 성별(남복/여복)은 기존 전체평균.
- **B 오래 대기자 우선(W_WAIT 0→1.0)**: 대기 분(分)에 비례 보너스(−waitMinutes×W_WAIT). 8명1코트 연속휴식 편차 완화. `waitSince`는 경기완료·휴식복귀·콕확인 시 리셋돼 "매칭 가능해진 시점부터"만 누적.
- **휴식=경기한 것과 동일(사용자 요구)**: 이미 충족 확인 — 휴식 중엔 recommendPool·arrange에서 제외, 복귀 시 `set_player_resting`이 game_count=GREATEST(활성평균)+wait_since=now()로 보정. 추가로 `set_cock_checked`도 wait_since=now() 리셋(마이그레이션 20260626010000) — W_WAIT 켜며 합류 전 대기로 과대우선되는 구멍 차단.
- **C 자동 스케일(렌더 없이)**: arrange.ts에 순수 `requiredBoardHeight`(arrangeBoard 배치공식 동일)·`computeFitScale`(큰 배율부터 내려가며 다 들어가는 최대 반환) 추가. SessionBoard 자동정렬·정렬버튼이 fitAndArrange로 스케일 계산·적용. scale 상태는 boardStore로 이전(effect의 set-state-in-effect 회피).
- **적대적 리뷰**: critical/major 2건 모두 비이슈로 판정 — (i)무한루프 주장은 effect deps에 scale 파생값 없어 미발생(setStageSize는 기존 줌-클램프 의도 코드, 미변경), (ii)수동 줌 덮임은 사용자 선택(옵션1)대로. C-logic 공식은 리뷰서 정확성 검증 통과.
- 문서: `docs/TEAM_GENERATION_RULES.md` 2·3·7절 갱신(성별 인식 skillDiff·W_WAIT·휴식=경기 동일/대기 리셋). 검증: tsc 0, vitest 152, build 성공. eslint 잔여 2건은 기존 무관 파일(useSetupPlayers·MemberAdminPage, #13 기록).

---

## #32

**Prompt**: 페이지 패딩좀 통일해줘. 메인 페이지에서 컨텐츠 좌우 패딩을 기준으로 상단네비의 로고는 좌측은 맞는데 우측 ... 은 실제 버튼크기만큼 두고 우측패딩이 있는데, 애초에 버튼에 공백이 많아서 더 좌측으로 치우쳐진거 같으니까 해당역역은 공백없이 ... 이 딱 우측라인에 맞아떨어지게 패딩수정하고
회원관리 페이지보면 컨텐츠 좌우패딩이 메인 좌우패딩보다 더 큰데 메인 좌우패딩에 맞게 통일해 이것도 수정해.

**Answer**: 상단 헤더 우측 정렬과 회원관리 콘텐츠 폭을 메인 기준으로 통일.

- **헤더 우측 ⋮ 정렬(Home.tsx)**: 우측 아이콘 버튼은 width 40·중앙정렬이라 글리프(EllipsisVertical 20px)가 버튼 우측 끝(=콘텐츠 거터선)보다 약 18px 안쪽에 그려짐. 알림벨+메뉴 그룹을 flex div로 묶고 marginRight −18 적용해 마지막 글리프 우측을 거터선에 맞춤(좌측 로고와 대칭). 보정값은 lucide 지오메트리 계산(viewBox24·cx12·r1·stroke2)으로 도출.
- **회원관리 좌우 패딩(MemberAdminPage.tsx)**: 근본 원인은 중첩 순서 차이 — 메인은 `외부 패딩→내부 max-w-sm(384)`이라 콘텐츠 최대폭 384, 회원관리는 `외부 max-w-sm→내부 패딩`이라 344. 컨테이너를 `max-w-sm` 대신 `maxWidth:424`(=384+좌우패딩40)로 바꿔 모든 화면폭에서 콘텐츠 폭·여백을 메인과 픽셀 동일하게 맞춤(flex·가상화 구조 무변경).
- JSX expression 컨테이너(right={}) 내 주석은 `{/* */}` 대신 JS 주석 사용. tsc 통과.

---

## #33

**Prompt**: 세션 열렸을때도 홈으로 갈 버튼이 필요해. 설정화면 우상단에 나가기 있으면 될듯?

**Answer**: 세션 진행 중 홈 복귀 경로를 세션 설정 화면 우상단에 추가.

- **문제**: 보드(/session)에는 설정·로그·종료 버튼만 있고 세션을 끝내지 않고 홈으로 가는 버튼이 없음. 설정(/setup)의 뒤로가기는 sessionMeta 있으면 보드로 복귀해서 홈으로 못 나감. 세션 종료는 전체 참가자 세션을 끝내는 파괴적 동작이라 단순 홈 복귀와 다름.
- **해결(SessionSetup.tsx)**: AppHeader에 right로 "나가기" 텍스트 버튼 추가 → navigate("/"). 세션은 종료하지 않고 유지(홈의 "진행 중 세션 이어하기"로 재진입 가능). 파란색(#0b84ff)으로 종료(빨강)와 구분, 우측 패딩 0으로 거터선 정렬(LogPage 클리어 버튼과 동일 패턴).
- **노출 조건**: sessionMeta 있을 때만. 세션 없이 들어온 신규 설정 플로우는 뒤로가기가 이미 홈이라 불필요.

---

## #34

**Prompt**: 팀 추천로직에 특정 멤버가 누구와 들어가길 원하는 케이스 — 임시그룹이 그 역할. 자동추천 대신 "고정배치" 뉘앙스로 UI 다르게. 이렇게 묶인 둘은 추천스코어를 낮춰(=우선추천 안 되게) 다시 안 뭉치게, 절대 금지는 아니고 꽤 많이 떨어뜨리고 다른게임/혼복 할수록 보정 감소. 전체 팀구성에 영향 먼저 고민하고 이상없으면 반영. (트리거: 2명+ 드래그해서 그룹 생성. DB컬럼 매번 추가 말고 유연한 구조로.)

**Answer**: 먼저 실제 스키마로 확인 — 그룹은 별도 DB가 아니라 구성중=`sessions.board_drafts` jsonb blob, 경기중/완료=`matches`+status. 그래서 "의도적 그룹"은 jsonb 속성 하나면 충분(마이그레이션 0). 영향 분석: forced 페널티는 유한·가산·decay라 매칭 deadlock/개인 starvation 없음(쌍 단위 회피 — 개인은 다른 팀에 계속 선발), 풀 좁으면 무력화(절대 X), decay로 영구 왜곡 방지 → 매칭 건전. 설계 확정 후 구현 + 적대적 리뷰(3차원).

- **트리거/감지**: `DraftTeam.forcedIds`(드래그로 넣은 anchor 멤버만 — createPair 2명·드래그 attach. 자동편성/다이얼로그 픽 제외) ∩ 현재 멤버 ≥2 → 의도적 그룹. detach 시 교집합으로 자동 해제.
- **저장/동기(마이그레이션 0)**: board_drafts jsonb에 `teams[].forcedIds` + top-level `forcedPairs[{a,b,fromCount}]` 추가. 기존 serialize/reconcile/canonical/save 경로 재사용 → 동기·영속 공짜. 향후 추천 룰도 이 blob에 키만 추가.
- **페널티+decay**: 의도적 그룹이 경기 시작 시 묶인 멤버 쌍을 `forcedPairs`로 기록(fromCount=matchAssignCount). 추천에서 `W_FORCED(48)×forcedDecay(경과 라운드)` 가산(confirmed별 합산, pairHistory와 동일 방식). FORCED_WINDOW=6 라운드 선형 decay → 0이면 prune. 음수(크로스클라이언트 레이스)·NaN·클럭 미정의는 클램프/스킵 가드.
- **UI**: 구성중+의도적이면 CTA "자동편성"→**"고정배치"**, 고정 멤버 자석에 "고정" 배지(PlayerMagnet forced prop).
- **적대적 리뷰(3)**: robustness 4건(미정의/음수/NaN matchAssignCount) 수정. SUM 합산·다중그룹 compounding·자동멤버 비-forced·reservePair 보류는 의도/bounded로 판정(미수정, 문서화). double-reconcile은 self-healing.
- **프론트 전용(DB 변경 0)**. 문서 `TEAM_GENERATION_RULES.md` 7절 갱신. 검증: tsc 0, eslint 0, vitest 154(forced 2건 추가), build 성공.

---

## #35

**Prompt**: (의도적 그룹 UX 개정) 자동편성 버튼을 추천 모달 안으로. 드래그로 합칠 때 "고정배치"는 락 표시+코스트 조정용이지 자동 채움 아님 — 둘/셋/넷이 락된 것처럼 보이되 실제 락 아님(드래그로 취소 가능), '고정' 텍스트 대신 이모지. 그룹박스 자동편성 버튼 제거. → (정정) 자동배치 버튼만 제거하고 고정배치 버튼은 유지. → 고정배치 버튼은 모든 구성 중 그룹에 표시(1명 비활성·2명+ 활성), 그 외 동작 없음. → 🔒/코스트는 "고정배치 누르는 시점에 그룹에 포함된 사람"에만.

**Answer**: #34의 forced-pair를 사용자 피드백 반복으로 "버튼 잠금" 모델로 개정. forced 트리거를 드래그 자동 추적 → **"고정배치" 버튼 누름(toggleForced)** 으로 변경: 누르는 시점의 `anchorMemberIds` 전체를 `forcedIds`로 잠금(드래그/+/추천 어떻게 모았든), 다시 누르면 해제. 시각/코스트 전용이라 드래그로 빼면 `∩ anchorMemberIds`로 자동 취소.

- **그룹박스 CTA**: 4명=매칭확정(경기시작) / 구성 중=고정배치 토글(1명 비활성, 2+ 활성). 라벨 "고정배치"↔"고정 해제"(잠금 시 인디고). 드래그 시 forcedIds 자동 기록 제거(createPair/attach).
- **자동편성 이동**: 그룹박스의 자동 채움 버튼 제거. `autoFillTeam`을 범용 `autoFillTarget(target, extraIds)`로 일반화(팀/시드/새팀 + 직접 선택분 유지), **추천 모달에 "자동편성" 버튼**([취소][자동편성][확인]) 추가 — 모달에서 나머지를 대기 선수로 채움.
- **🔒 배지**: "고정" 한글 텍스트 → 🔒 이모지(흰 원+인디고 테두리, PlayerMagnet forced prop). forcedIds 멤버에 표시.
- forced-pair 코스트(W_FORCED·decay)·board_drafts jsonb 저장·startMatch 기록은 #34 그대로(트리거만 버튼으로). 프론트 전용.
- 검증: tsc 0, eslint 0, vitest 154, build 성공. 문서 7절 갱신.

---

## #36

**Prompt**: 팀 추천로직에 혼복의 경우 남녀밸런스 맞추기 힘드니 보통 남자들은 밸런스 신경안쓰고 넣어도 됨, 여자만 밸런스 고려해야함 / 8명이 1코트 쓰는 케이스같이 4/4 계속 딱 맞게 떨어지면 2번 쉬고 2번연속하게 추천점수 올리기 / 혼복허용여성이란 워딩을 바꿔서 여자이지만 선택하면 남복에도 넣을수 있다는 의미의 것으로 바꿔주고, 이게 실제로 추천에 반영되어있는지 확인해 / 매칭확정전 그룹만들때, 이미 들어있어도 다른 사람을 넣으면 교체되게해 / 여기로 끌어 휴식하기도 여기로 끌어 팀빼기처럼 색깔 넣어서 눈에띄게 / 그룹에 자석 넣을때 하이라이트 되는게 그룹전체가 아닌 해당 (+)이 자리여야 하고, 빈자리처럼 취급해서 스택이 아닌 실제 빈자리처럼, 자석 빼면 아래 (+)가 사라지지 않게 / 더블탭하면 그룹에서 해체, 롱탭할때 디버그창(추천모달 상단4칸·휴식드랍존도, 어딘가에서 빠지는 개념이 있는것들 전부) / 팀구성중 상태인 사람을 다른 그룹으로 끌어가면 이동이지 예약이 아냐, 예약은 경기중일때만 / 고정배치 자물쇠 이쁘게 / 3명 락 후 한명 빼고 다시 넣으면 리셋(고정 아님). 기획적 충돌 체크하고 구현.

**Answer**: 4갈래 병렬 매핑으로 코드 표면을 정리한 뒤 "하드 충돌 없음 — R4(교체)·R5(슬롯)·R8(이동)은 하나의 슬롯 기반 드롭 모델로 묶임, R3 추천반영과 R5 슬롯모델은 데이터구조/알고리즘 갈림길"로 보고하고 두 결정을 확인받아(R5=정확 슬롯 배치, R3=추천 반영) 전건 구현. 주요 결정:
- **R5 슬롯 모델**: 멤버십 배열(anchorMemberIds)은 dense 유지하고 슬롯 위치만 별도 맵 `DraftTeam.slots`(playerId→0..3)로 분리 — sparse 배열로 바꿔 동기화 불변식 ~20곳을 건드리는 리스크를 피하면서 "가운데 빈칸 허용" 동작 동일 확보. teamMembers가 명시 슬롯 우선·나머지 빈칸 순 배정. serialize/reconcile/canonicalize에 slots 동기.
- **R4 교체**: dropResolver를 `slotIndexAt`+점유판정으로 바꿔 빈칸=attach(slot)·점유칸=replace 반환. replaceAtSlot은 anchor 점유자=in-place 스왑(해체 트리거 없이 위치 보존), ghost=예약취소+합류.
- **R5 하이라이트**: hoverTarget을 `{kind:"slot",teamId,slotIndex}`로 바꿔 박스 전체 대신 가리킨 칸에만 링. 빈 슬롯은 점유 슬롯 집합 기준 계산 → 드래그 중 (+) 안정(사라짐 해소).
- **R8 이동 vs 예약**: forming 멤버 경로의 reserve/reservePair 제거 → attach/createPair(이동). 예약은 경기중(handlePlayingMagnetDrop)에만.
- **R7 제스처**: 더블탭=빠짐(detach/예약취소/휴식복귀), 롱프레스=디버그. PlayerMagnet + 추천모달(상단4칸 제거·하단 롱탭 디버그, useLongPress 신설).
- **R3**: UI "남복 편성 허용 여성"으로 워딩 변경 + recommendTeammates에서 1F3M·allowMixedSingle 여성은 성별 페널티 면제(추천 반영). docs 갱신.
- **R9** 자물쇠=인디고 배지+벡터 Path, **R10** detach 시 forcedIds 제거(리셋), **R6** 휴식 드롭존 cold도 스카이 톤, **R1/R2**는 기구현 확인.
- 검증: tsc 0, eslint 0(변경파일), vitest 151, build 성공. docs TEAM_GENERATION_RULES 성별 균형·게임타입 표 갱신.

---

## #37

**Prompt**: 복귀되는 자석은 정렬되는 위치에 있어야해. 4명일땐 '경기시작', '경기중' 상태만 있는데 4명인데 한명이상이 예약상태라면 이건 고정배치를 하게해줘. 이렇게 할땐 4명다 락이야. 복귀라 함은 그룹또는 휴식존에서 빠지는 모든상황을 말해. 그리고 이미 올라간 자석 드래그할때 자석 아래에 (+) 안보이는데 보이게해줘

**Answer**: 세 요구를 N1(복귀 정렬배치)·N2(4명+예약→고정배치·전원 락)·N3(드래그 시 슬롯 +표시)로 구현.
- **N1 복귀=정렬 위치**: 그룹/휴식존에서 빠지는 모든 경로(detachMember·removeMemberFromBoard anchor·unrestPlayer)가 드롭 지점 대신 "정렬되는 위치"로 가게 함. `placeArranged` 헬퍼가 맵을 클론해 arrangeBoard를 돌려 그 선수의 정렬 좌표만 읽어 본문에 반영 — 다른 자석/팀의 수동 배치는 보존(전체 재정렬로 수동 레이아웃을 깨지 않음). 휴식 복귀는 restingIds 클론에서 해당 선수 제거(갱신 지연 대비).
- **N2 4명+예약 고정배치**: 4명이라도 ghost(예약=경기중 빌려온 선수)가 끼면 매칭 시작 불가 → `canStart = isFull && !hasReservation`로 CTA 분기. 예약 포함 시 "고정배치" 버튼 노출, 잠그면 ghost 포함 전원 락. `toggleForced`가 anchorMemberIds 대신 teamMembers 전체(anchor+ghost) id로 잠금. `effectiveForcedIds(t, memberIds)`를 멤버집합 기준으로 바꾸고 serialize/startMatch 호출 갱신. reconcile은 forcedIds를 anchor+이 팀 예약 멤버까지 유지(4명 락 동기 보존). 🔒 배지를 ghost 자석에도 전달.
- **N3 드래그 슬롯 +**: TeamBackground가 `dragInfo.playerId` 구독, 그 멤버를 occupiedSlots에서 제외 → 드래그 중 그 슬롯이 (+)로 노출(자석은 Konva가 들고 이동).
- 검증: tsc 0, eslint 0(변경파일), vitest 153, build 성공. docs §7(고정배치 트리거/버튼 노출) 갱신.

---

## #38

**Prompt**: 롱터치기준을 엄밀하게 해줘. 지금은 드래그하려고 잡고 이동하는데도 롱터치이벤트 일어나

**Answer**: 롱프레스가 드래그 중에도 발동하던 원인은 "이동 시 취소"가 없어서였음 — 기존엔 dragstart/pointerup에서만 취소했는데, Konva 드래그 임계(3px)·dragstart가 뜨기 전 천천히 잡고 있으면 500ms가 먼저 터짐. 포인터가 누른 지점에서 LONGPRESS_MOVE_TOL(8px) 넘게 움직이면 즉시 롱프레스를 취소하도록 변경:
- longPress ref에 누른 좌표(x,y) 저장, handlePointerDown에서 stage pointer 위치 기록.
- handlePointerMove 추가 — 타이머 대기 중 이동거리² > 8px²이면 clearLongPress. onMouseMove/onTouchMove에 연결.
- 결과: "제자리에서 꾹"만 롱프레스(디버그), 조금이라도 끌면 드래그로 처리.
- 검증: tsc 0, eslint 0, vitest 153.

---

## #39

**Prompt**: 안에있는거 드래그해서 바깥으로 뺐다가 다시 넣으면 하이라이트 되어야지. 똑같은 이유로 안에 있는것끼리도 드래그할때 하이라이트 되게 해줘. 그래야 이 그룹에 계속 들어감이 확인되나, 아니나가 시각적으로 보이지.

**Answer**: 팀구성중(anchor) 멤버를 자기 팀 위로 끌면 resolver가 `none`(하이라이트 없음)을 반환해 "이 그룹에 들어감" 피드백이 없던 문제. anchor 멤버 분기를 자기 팀 포함 단일 루프로 통합해, 어느 팀이든 슬롯 위면 그 칸을 하이라이트하도록 변경:
- 자기 슬롯 위 → attach(같은 슬롯 재설정=유지) → 하이라이트.
- 자기 팀 빈 칸 → attach(그 칸으로 재배치) → 하이라이트.
- 자기 팀 다른 멤버 칸 → replace → 핸들러에서 **같은 팀이면 슬롯 스왑**(둘 다 유지, 점유자 안 빠짐). replaceAtSlot에 same-team 스왑 분기 추가.
- 다른 팀은 기존대로 빈칸=이동/점유=교체. 슬롯 아닌 곳/빈 공간은 none/detach(하이라이트 없음) → "그룹에서 나감"이 시각적으로 구분됨.
- 검증: tsc 0, eslint 0, vitest 157, build 성공.

---

## #40

**Prompt**: 1234 가 있는 그룹이 있고 abc 가 있는 그룹이 있는데 4 를 빼서 abc4 를 만들어 고정시켰음. 그리고 1234 가 있는 그룹의 경기가 끝나면 abc4 는 경기시작버튼이 나와야하는데 고정해제 버튼이 있고 4번은 심지어 예약상태임. 확인좀

**Answer**: 증상 2개 모두 수정. 원인:
- ① 버튼: N2에서 CTA 게이트를 `canStart = isFull && !hasReservation`으로 둬서, 예약자가 자유로워져도(경기 끝나도) "예약이 있다"는 이유로 시작을 막았음. → `canStart = isFull && startable`로 변경(isTeamStartable은 ghost가 자유면 시작 가능, 경기중이면 불가로 이미 판정). 예약자 경기 끝 → startable=true → 매칭확정, 아직 경기중 → 고정배치 유지.
- ② 4번 예약상태 잔존: completeMatch가 끝난 선수를 자유화·흩뿌리기만 하고 예약(ghost)을 정식 멤버로 승격 안 함. → completeMatch에 승격 추가: 끝난 선수가 다른 팀 예약(ghost)으로 잡혀 있으면 그 팀(잠금된 팀 우선, 없으면 최古 예약) anchor로 attachAnchor 승격(ghost가 잡던 슬롯 유지) + 같은 선수 다른 예약 정리. 승격된 선수는 anchor라 scatterMagnets가 안 건드림.
- 검증: tsc 0, eslint 0, vitest 158(승격 테스트 추가), build 성공.
- 추가로 사용자 요청에 따라 예약 ghost 동기화·유니크성 예외·"원본 변경 시 복사본 미처리" 구조적 결함 감사 워크플로우 실행 중.

---

## #41

**Prompt**: 예약관련 동기화코드 확인해봐. 그리고 내가 자석들은 유니크성을 보장해야한다고 했는데 이건 예약이라 예외처리된건지 확인해봐. 그리고 구조적으로 예약같이 자석이 여러개 복사될 순간이 될때, 원본의 상태가 변경될때 같이 처리되는 구조적 결함이 있는지 체크하고 보완해.

**Answer**: 16-에이전트 적대적 감사 워크플로우(map→verify→synthesize)로 예약(ghost) 생명주기·동기화·유니크성 예외를 전수 점검. 확인 결과:
- **동기화**: 예약은 board_drafts 멤버십 직렬화로 전체 payload 동기, reconcile이 매번 teamId 초기화 후 완전 재구성. 죽은 팀/없는 자석 예약은 수신측 자동 소거.
- **유니크성 예외**: ghost는 "경기중 선수 빌려주기"로 I1(단일 anchor)/I2(경기중 비-anchor)의 의도된 예외임을 코드로 확인(맞음). I1/I2는 anchorMemberIds에만 적용.
- **구조적 결함(근본 패턴)**: 선수가 anchor로 확정/경기종료될 때 다른 팀의 ghost(복사본)가 "이 팀만" 정제돼 stale로 잔존. 보완:
  - (A) attachAnchor: 합류 시 그 선수의 **모든** 예약 정제(타 팀 포함) — anchor xor ghost. multi-ghost·cross-team 변종 일괄 해결.
  - (B) reconcile: assignedAnchor 선수의 ghost 차단 + (선수,팀) 중복 예약 dedup(최古 유지). 단 경기중 ghost는 보존(의도된 빌려주기).
  - (C) serialize: 죽은 팀 가리키는 예약 직렬화 제외.
  - (D) 공통 헬퍼 resolveFreedReservations로 completeMatch·setMatchRoster의 자유화 선수 예약을 한 팀 anchor로 승격.
  - **제외 판단**: startMatch/healPlayingAnchors의 "경기중 ghost 제거"는 의도된 기능 파괴라 미적용(A+B가 anchor+ghost 모순을 원천 차단하므로 불필요).
- 검증: tsc 0, eslint 0, vitest 160(cross-team 정리·reconcile dedup 테스트 추가), build 성공. docs §9에 "(다) ghost 정합" 불변식 명문화.

---

## #42

**Prompt**: 배치해제될때 겹쳐지지않는 좌표로 이동해야하는데 확인좀. 그리고 고정배치의 락뱃지와 예약뱃지가 같은 위치라 겹치는데 락은 우하단으로 바꿔줘

**Answer**: 두 가지 수정.
- **배치해제 겹침**: N1에서 detach/unrest 복귀를 placeArranged(클론 arrange로 정렬 슬롯 계산)로 바꾸면서 runSettle을 뺐는데, 클론 기준 비겹침이라 실제 (수동 배치된) 자석과는 겹칠 수 있었음. placeArranged 끝에 runSettle({magnetId}) 추가 → 정렬 슬롯에 둔 뒤 그 자석을 소스로 겹친 자유 자석을 밀어내 비겹침 보장(정렬 위치는 유지).
- **배지 겹침**: 락(자물쇠) 배지와 예약 배지가 둘 다 우상단(MAGNET_R-8, -MAGNET_R+8)이라 4명+예약 잠금 시 겹침. 락 배지를 우하단(MAGNET_R-8, +MAGNET_R-8)으로 이동.
- 검증: tsc 0, eslint 0, vitest 160, build 성공.

---

## #43

**Prompt**: 예약일때 오파들어가있는데 락, 예약뱃지같이 상태알려주는건 오파넣지마

**Answer**: 예약(ghost)/콕/휴식 자석은 그룹 opacity가 걸려 상태 배지(락·예약·휴식·콕)까지 흐려지던 문제. 자석 본체(사진·링·이름·외곽선·하이라이트)만 안쪽 Group으로 감싸 opacity를 적용하고, 상태 배지는 그 그룹 밖(바깥 Group, opacity 1)에 두어 본체가 흐려도 배지는 또렷하게. PlayerMagnet 렌더 구조만 변경(이벤트/드래그는 바깥 Group 유지).

## #44

**Prompt**: 오파조절만으론 한눈에 예약인 상태가 안보이는데 예약을 경기중으로 워딩 바꾸고 그레이스케일 처리해서 가시에서 확 죽이자.

**Answer**: 예약 ghost를 시각적으로 확실히 죽이도록 그레이스케일 적용 + 워딩 변경.
- 사진(KonvaImage): isGhost일 때 node.cache()+Konva.Filters.Grayscale로 흑백 처리(이미지 로드/ghost 토글 시 useEffect로 캐시 재적용).
- 벡터 요소: 성별 링·스킬 아크 fg·이니셜 bg/잉크를 ghost면 회색(#9CA3AF/#D1D5DB/#6B7280)으로.
- 배지 워딩 "예약" → "경기중"(ghost=경기중 빌려온 선수 의미 명확화). MagnetBadge 폭 32px에 3자 수용.
- 기존 RESERVATION_OPACITY는 유지(그레이스케일+흐림 이중).

---

## #45

**Prompt**: 프로필편집에 사진업로드도 가능하게 해줘.

**Answer**: ProfileSetup(가입/회원정보 수정)에 프로필 사진 업로드를 추가하고, 다각도 적대적 리뷰(5관점·재검증)에서 확정된 결함 4건을 수정했다. 기존 player-photos 버킷이 md5(name)[:12].jpg 규약으로 service_role 스크립트로만 채워지던 구조를, 클라이언트(authenticated)도 업로드할 수 있게 확장.
- 신규 playerPhotoUpload.ts: <img>+canvas로 512px 정사각 중앙크롭 JPEG 생성 후 Storage upsert.
- playerPhoto.ts: 버킷/파일명 export + localStorage 버전맵 기반 ?v= 캐시버스팅(이름고정 URL의 캐시 문제 해결, 영속되어 새로고침 후에도 신사진 표시).
- ProfileSetup: 편집 가능한 원형 아바타(로컬 프리뷰/원격/이니셜 분기) + 카메라 배지 + 파일 선택. 저장 시 사진 먼저 업로드 후 프로필 update(가입모드 언마운트 경쟁 회피).
- storage RLS 마이그레이션: 버킷 idempotent 보장 + authenticated insert/update + public read. delete 정책은 제거(키 추측 삭제 공격면 차단, 정리는 service_role 우회).
- 리뷰 수정: ①photoFailed가 로컬 프리뷰까지 가리던 버그(렌더 분기 분리+선택 시 초기화) ②RLS delete 제거 ③성별 미선택 시 중립 회색 ④배지 테두리 다크모드 대응.
- 배포 시 supabase db push 필요(미적용 시 업로드 RLS 거부).

---

## #46

**Prompt**: 우하단 카메라가 사진선택할수있단 의미인거같은데 이렇게 잘리니까 더 이상해 / 하단에 다른 사진 선택 텍스트 있으니 카메라 없어도 될거같아. 그리고 사진 올릴때 용량 줄이는 로직이 있니?

**Answer**: 프로필 아바타 UI 후속 정리. 카메라 배지가 부모 버튼의 overflow:hidden(원형 크롭용)에 잘리던 문제를 먼저 클립 래퍼 분리로 해결했으나, 하단 '다른 사진 선택' 텍스트로 의미가 충분하다는 판단에 배지 자체를 제거하고 구조를 단순 원형으로 환원. 용량 축소 로직은 이미 처리됨을 확인: 업로드 전 512×512 중앙크롭 + JPEG 품질 0.85 재인코딩으로 원본 수 MB 사진도 수십 KB로 떨어진다.

---

## #47

**Prompt**: 일정생성에 정모체크박스 넣을수 있게 하고 체크된 일정은 들어가면 지금 만든 페이지 볼 수 있게 해줘. 현재 페이지를 일반인 회원이 보는 양식으로 변경해주고, 페이지 작성은 매번 수동으로 할게.

**Answer**: 정모(정기모임) 회차에 회원 열람용 대진표·안내 페이지를 붙이는 기능 추가. 설계 결정은 사용자 확인을 거쳐 콘텐츠는 마크다운(react-markdown + remark-gfm), 정모 지정은 회차 단위(OccurrenceEditor)로 확정.

- DB: sessions에 is_regular(정모 여부)·notice_md(마크다운 본문) 컬럼 + 부분 인덱스 마이그레이션 추가·적용
- 운영진: OccurrenceEditor 카풀 아래에 정모 토글, 켜면 마크다운 입력란 노출(일회성 추가·회차 편집 양쪽 저장 연동). 정모/notice는 회차 override라 is_overridden=true로 sync 덮어쓰기 방지
- 회원: /notice/:sessionId 신규 페이지(로그인 필수, 비로그인 홈으로). 스토어 우선 + 단건 조회 폴백. notice_md를 앱 테마(코트 그린)+다크모드로 렌더, 표는 가로 스크롤 래퍼로 모바일 대응
- 진입: 정모 ScheduleCard에 '정모' 배지 + '대진표·안내 보기' 버튼 → /notice/:id
- 백워드 세이프: 마이그레이션 전엔 is_regular undefined→falsy라 기능 미노출일 뿐 무해. react-markdown은 기본 원시 HTML 비렌더라 XSS 안전
- 검증: tsc·lint(변경분)·prod 빌드·테스트 162개 통과. 마이그레이션은 supabase db push로 적용 완료

---

## #48

**Prompt**: (콘솔) `<button> cannot be a descendant of <button>` — RecurringRulesPanel.tsx hydration 에러

**Answer**: 반복 규칙 카드의 버튼 중첩으로 인한 React DOM nesting/hydration 에러 수정. 바깥 카드 전체가 `<button>`(클릭=편집)인데 그 안에 중지/켜기·삭제 액션 `<button>` 두 개가 있어 HTML 사양 위반이었다.

- 바깥 카드 `<button>` → `<div role="button" tabIndex={0}>`로 변경, 안쪽 액션 버튼(stopPropagation)은 그대로 유지
- `<button>`이 기본 제공하던 키보드 활성화(Enter/Space)를 onKeyDown 핸들러로 보존해 접근성 유지
- 코드베이스에 기존 클릭 카드 패턴이 없어 접근성 패턴을 직접 적용. tsc 통과 확인

---

## #49

**Prompt**: 로그쌓을때 팀편성 누가헀는지도 같이 기록가능? / (기준 확정) 경기시작 버튼 누른사람, 로그카드에만 작게 표현 / 니가다해

**Answer**: 매치 로그에 "경기 시작(편성)한 사람"을 기록하는 기능 추가. 핵심 통찰은 편집자 실명(_myName=auth.myName)이 이미 lease 가드용으로 assign_match RPC의 p_name으로 전달되는데 저장만 안 되고 버려지고 있었다는 점 — 새 데이터 배선 없이 저장만 추가하면 되는 저비용 작업이었다.

- 의미 확정(사용자): 기준=경기 시작 누른 사람(assign_match), 표시=로그카드에만 작게. set_match_roster(이후 팀 편집)는 안 건드려 "최초 편성자" 고정
- DB: matches.assigned_by(text, nullable) 컬럼 + assign_match RPC가 INSERT 시 p_name 저장(시그니처 동일·CREATE OR REPLACE·기존 동작 보존). supabase db push로 원격 적용 완료
- 클라: MatchRow.assigned_by, MatchLogEntry.assignedBy + fetchMatchLogs 매핑, MatchCard 헤더 시간 아래 "편성 OO" 작게(값 있을 때만)
- 백워드 세이프: select("*")라 컬럼 없으면 undefined→미표시, 적용 전엔 구 RPC가 편성자만 안 남길 뿐 무해 → 배포 순서 위험 없음
- 문서/픽스처 동기화(DATABASE.md, transformers.test.ts에 assigned_by 추가)
- 검증: tsc·eslint(변경분)·prod 빌드·테스트 162개 통과

---

## #50

**Prompt**: 편집권한 뺏길때도 누구한테 뺐겼는데 다이얼로그 띄워줘

**Answer**: 편집권을 다른 사람에게 뺏기면 누구에게 뺏겼는지 다이얼로그로 알리는 기능. 모든 편집권 전이가 거치는 단일 지점(recomputeLock)에서 "내가 편집자였다→아니게 됨 & 새 보유자가 타인" 전이만 잡는 것이 핵심.

- 순수 헬퍼 detectEditorLoss(editLock.ts) — 뺏김 전이면 가져간 사람 이름 반환(이름 없으면 "다른 사용자"), 테스트 6개
- recomputeLock에서 감지 → editorTakenBy 세팅, 내가 재획득하면 자동 닫힘. dismissEditorTakenNotice 액션
- takeover(claimEditor)만 알림 — 자발적 양도(handoffEditor)는 suppressLossNotice로 억제(오탐 방지). lease 만료(자유)는 뺏김 아님
- EditorTakenNotice 모달(ModalSheet) — SessionBoard에 마운트
- 프론트 전용(마이그레이션 없음)

---

## #51

**Prompt**: 창이 액티브 될때 인원이 3명 이상인데도 자꾸 뺏어가는게 있는데 이것좀 체크좀 / 각 회원들이 매달 콕 한개씩 지원받는걸 하려고 하는데, 콕체크 누를때 그 달 콕지원을 받지 않았다면 이사람 콕 안내도 된다또는 한개만 내도된다 노출하게 해줘. 반사적으로 확인누르는 사람도 있을테니 눈에 잘 띄게 해주고, 매달 콕 내는 양을 설정 어딘가 적을 수 있게 해줘. 남자는 2개 여자는 1개야. / 끝나면 커밋하고 푸쉬해

**Answer**: 두 작업. (1) 편집권 자동점유 버그: 자동 점유 경로 중 presence 가드가 없던 두 곳(창 복귀 재점유 sessionStore:870, 마운트 자동점유 SessionBoard:137)이 인원수와 무관하게 자유 락을 낚아채 "뺏기는 것처럼" 보였다. 사용자 확정대로 "혼자일 때만(presenceCount<=1) 자동 점유"로 일원화 — 복귀 핸들러의 무조건 재점유 제거(maybeClaimIfAlone로), 마운트 effect에 presence 가드 추가. 명시 점유(드래그)·"가져오기"는 유지.

(2) 월별 콕 지원: 회원당 매달 콕 1개 지원, 콕체크 시 그 달 미사용이면 "남:1개만/여:안 내도 됨"을 크게 노출(반사적 확인 방지로 조회 끝날 때까지 확인 비활성), 확인 시 그 달 지원 소진. 콕량(남2/여1)·지원량 설정은 회원관리>"콕 설정".
- DB(20260630030000): group_settings 싱글톤(쿼터 남2/여1+월지원1) + cock_support_grants(member_id,ym PK 멱등) + RLS(읽기 authenticated/그룹설정 쓰기 is_admin). 원격 적용 완료
- 단위 확정(사용자): 콕량=세션 콕체크 1회당, 지원 소진=콕체크 확인 시 자동(멱등 upsert), 설정=관리자 그룹설정
- SessionPlayer.memberId 노출(타입+트랜스포머), calendar.monthKST(), clubSettings.ts API, CockCheckModal/GroupSettingsModal 신규
- 검증: tsc·eslint(변경분)·prod 빌드·테스트 168개 통과

---

## #52

**Prompt**: 예약포함 경기중 그룹이 경기중과 완전히 같아 헷갈려 다른색 해줘 / 끝나면 커밋하고 푸쉬

**Answer**: 보드에서 실제 경기중 코트(CourtMatchCard)와 "4/4 · 예약 포함(경기중)" 팀 박스(TeamBackground)가 둘 다 동일한 주황색(TEAM_PLAYING_BG #451A03 / TEAM_PLAYING_STROKE #F59E0B)을 써서 구분이 안 되던 게 근본 원인. 실제 경기중 코트는 주황 유지하고, 예약 대기 팀 박스만 색을 분리.
- 프로젝트 색 규칙("경기중=주황·예약=보라")에 맞춰 예약 팀 박스 전용 색 추가: TEAM_RESERVED_BG #2E1065 / TEAM_RESERVED_STROKE #A78BFA(보라). 박스 안의 보라색 예약(ghost) 자석과 시각적으로 연결되어 의미도 일치.
- TeamBackground.tsx의 isFull(4명이지만 예약자 경기중) 분기 box style·labelColor를 새 보라 상수로 교체. CourtMatchCard는 그대로 주황.
- 검증: tsc·eslint(변경분) 통과

---

## #53

**Prompt**: https://yria.github.io/cocktime-scheduler/notice/101 이거 주소로 들어가니까 장소미정으로 뜨는데 이거 메모리로 관리해? / 아니 웹에서 메인페이지에 나오고, 대진표 눌러서 나오면 에이트민턴 장소 제대로 나와. 다만 그 페이지에서 새로고침하면 장소가 날아가 / 해줘

**Answer**: 메모리가 아니라 Supabase 데이터 문제. 정모 안내 페이지(RegularNoticePage)가 장소명을 scheduleStore.places에서 매핑하는데, 이 목록은 메인 페이지의 load()에서만 채워진다. 그래서 그 페이지에서 새로고침(직접 진입)하면 store가 비어 fetchSessionById는 세션 본문만 가져오고 places는 못 가져와 placeName이 null → "장소 미정". 근본 원인은 단건 조회가 장소명을 함께 안 가져오는 것.
- fetchSessionById가 `*, places(name)` 조인 후 place_name으로 평탄화하도록 변경(FK sessions_place_id_fkey 존재 확인, carpool_muster FK는 이미 drop돼 관계 유일 → embed 비모호).
- SessionWithPlace 타입 추가, RegularNoticePage는 스토어 매핑 실패 시 fetched.place_name 폴백. 비활성 장소도 조인으로 잡힘.

---

## #54

**Prompt**: 모달떴을때 모달에 가려지는 부분이 보여. 이거 해결 (알림 모달, 뒤 내용 비침) / 그거 외에도 다른 모달도 똑같이 되게 적용해줘. 지금 세션종료 모달도 뒤가 너무 투명

**Answer**: 모든 모달이 공용 ModalSheet(lq-sheet/lq-overlay)를 공유. 비침의 근본 원인은 시트/딤 불투명도가 backdrop-filter blur에만 의존 — blur가 약하거나 미지원인 환경에선 뒤 페이지가 그대로 읽힘.
- lq-sheet 기본 불투명도 상향: 라이트 0.82~0.65 → 0.96~0.92, 다크 0.72~0.62 → 0.95~0.91 (blur는 가장자리 질감용으로 유지).
- lq-overlay(모달 뒤 딤) 상향: 0.25 → 0.5, 다크 전용 0.6 추가. center 모달(세션종료 등)은 화면 대부분이 이 딤이라 효과 큼.
- ModalSheet 미사용 모달(일정/프로필/회원관리)은 이미 솔리드 배경+0.45~0.5 딤이라 비침 없음 → 톤 일관.

---

## #55

**Prompt**: 화면 축소한 상태에서 정렬버튼 누를때, 자꾸 확대되는데 ... 그거 취소하고 축소한상태로 정렬하면 그 화면크기에 맞게 정렬되게 해줘. 그리고 자석 왼쪽에 딱 붙어있으면 드래그 잘 안되던데 이것도 원인확인 / 모바일에서 겪었음. pwa인진 기억안남

**Answer**: 보드 두 가지.
(1) 정렬 버튼이 fitAndArrange를 호출 → setScale(fit)로 줌을 "다 들어가는 최대 배율"로 강제 변경하던 게 확대 원인. 버튼 전용 arrangeAtCurrentScale 추가(현재 줌 유지, 보이는 화면 크기 viewW×viewH 기준만 정렬)로 교체. fitAndArrange는 첫 진입/뷰어 자동정렬 effect 전용으로 유지.
(2) 자석 왼쪽 끝 드래그 안 됨: 좌/우/상/하 클램프는 대칭인데 유독 왼쪽만 문제 → 모바일 브라우저의 좌측 화면-가장자리 뒤로가기 시스템 제스처가 터치를 가로챔(touch-action:none으로도 못 막음). 보드 캔버스 컨테이너에 좌우 EDGE_GUTTER=16px(가로 노치 시 safe-area-inset) 거터를 둬 드래그 영역을 제스처 밴드 밖으로 이동. 화면 px 고정이라 줌 무관, PWA에서도 무해.
- 검증: tsc 통과.

---

## #56

**Prompt**: 일정 자동추가하는데 홀수주, 짝수주조건이 제대로 작동하지 않는것같아 확인해봐 (후속: 주차 기준을 "첫번째 월요일이 있는 주=1주차"로, 달력을 월~일 시작으로 변경)

**Answer**: 반복일정 홀수주/짝수주 오작동 근본원인 규명 및 월요일 기준 주차로 전환.
- 근본원인: 뷰 recurring_valid_occurrences 의 주차식이 floor((day-1)/7)+1 = "그 달의 N번째 해당요일"이라, 사용자가 달력에서 보는 주차와 매월 1일 시작요일에 따라 어긋나(홀/짝이 통째로 뒤집힘) 달마다 다르게 동작. RPC(sync_schedule_occurrences)·재동기화·타임존은 정상이었음.
- 새 정의(월요일 기준): 각 날짜가 속한 월~일 주의 '그 주 월요일'의 day-of-month 로 주차 매김(floor((weekMondayDay-1)/7)+1). 첫 월요일 주=1주차, 선행 부분주는 그 주 월요일이 전달에 있어 전달 마지막주(4·5)로 편입 → 매주{1,2,3,4,5} 누락 0. 신규 마이그레이션 20260701010000 로 뷰 재정의(security_invoker=on·anon/authenticated REVOKE 유지).
- 초기 first_monday 가드식은 첫 월요일 이전 날을 "0주"로 제외해 "매주" 첫 발생을 누락시키는 결함이 있어 week_monday 방식으로 교체(검증으로 발견).
- 달력 UI 월~일 시작: calendar.ts monthGrid(mondayOffset=(startDow+6)%7), ScheduleCalendar 요일헤더/ScheduleRuleEditor 요일버튼을 [1..6,0] 순서로 렌더(실제 dow 매핑 유지).
- 검증: 주차식 60개월 전수(매주 누락 0·첫월요일=1주 위반 0), tsc 통과, 테스트 168건 통과, 적대적검증 3관점(SQL·프론트 pass, 마이그레이션 concerns는 draft=회원 미노출 오판으로 무효). EXPANSION_SPEC §4.3 갱신. DB는 supabase db push 로 원격 적용 완료.

---

## #57

**Prompt**: min-width 가 너무 작은거같아 일부 폰, 타블렛에서 너무 좁게나와. 기본 min width 를 넓혀주고, 자석이 있는 세션화면은 min-width 를 없애줘 pc만 좀 더 널게 해주고

**Answer**: 앱 전체가 md+(≥768px)에서 max-w-sm(384px) 카드로 고정돼 태블릿이 좁은 띠로 나오던 문제를 반응형 폭 토큰으로 전환. 사용자가 말한 "min-width"는 실제로는 모바일 카드의 max-width 제약이었음(레이아웃에 min-width 없음). 구체 수치는 시각 영향이 커서 옵션 제시 후 확정(태블릿 448 / PC 512, 보드 풀폭+PC 1280 상한).
- 폭 토큰 --card-max 도입: 태블릿(768~1023) 448px, PC(≥1024) 512px — 단일 소스로 모든 계층이 참조.
- .app-card(본문·헤더 콘텐츠 폭, 전 폭 중앙정렬+캡) / .app-card-shell(md+ 카드 경계=폭캡+중앙+그림자) / .app-board-shell(자석 세션 풀폭, 초광각 PC만 1280 상한) 유틸 신설.
- App 최상위 래퍼가 /session 여부로 셸 분기 → 보드는 폭 제한 없이 풀폭. 기존 max-w-sm 본문은 .app-card 로, 중복 자체 카드 셸(SessionSetup·LogPage)은 제거, MemberAdmin 폭·글래스 바텀바 폭도 토큰 연동. 모달/시트는 384px 의도적 유지.
- dead variable --bottom-bar-width(소비처 없음) 정리. tsc·vite build 통과, 독립 리뷰어 4관점(누락·보드 브레이크아웃·CSS 캐스케이드·정렬/패딩) 전원 통과.

---

## #58

**Prompt**: 알림설정에 도움말 있잖아, 그거 항상 나오게 해줘.

**Answer**: 잠금화면 알림 시트(PushSettingsSheet)의 "📲 앱으로 설치하는 방법" 접히는 도움말이, 앱 미설치(!standalone) + 알림 켜기 전(구독 가능) 상태에서만 노출돼 알림을 켜거나 앱을 설치하면 사라지던 것이 원인이었음. "항상"의 범위를 물어 사용자가 '무조건 항상'을 선택.
- 도움말 <details>를 구독 가능 분기 안에서 빼내 시트 하단에 상시 렌더 → 구독/설치(standalone)/권한 상태와 무관하게 항상 노출.
- 단 iOS 미설치 상태(ios-needs-install)는 본문이 이미 설치 안내 이미지를 전면 표시하므로 중복 회피 위해 그 상태에서만 하단 도움말 생략.
- !standalone 게이팅 제거로 불필요해진 standalone/isStandalone import·변수 정리. tsc·eslint 통과.

---

## #59

**Prompt**: 카풀매칭 UX 를 좀 더 편하게 해야할듯. 미배정 동승자를 누르면 지도에 그 사람만 남고, 카풀가능사람은 다 보이게 하고 지도 확대도 같이했으면해

**Answer**: 카풀 공지 빌더의 지도(CarpoolMap)가 roster 전체만 받고 선택 상태를 몰라 전원 마커만 그리던 것이 원인. 선택 상태를 지도까지 전달해 필터링·강조·확대를 지도에서 처리하도록 개선.
- CarpoolMap에 selected prop 추가: 선택된 동승자가 있으면 운전자는 전부 유지하되 동승자는 선택한 사람만 남기고(나머지 미배정/배정 동승자 마커 숨김), 그 범위에 맞춰 setBounds로 자동 확대(여백 48px, 같은 동끼리 붙어 과확대되는 것 방지 위해 하한 레벨 4).
- 선택된 동승자 마커는 파란 테두리·확대·최상단(zIndex)으로 강조(makePin에 highlighted 인자). 선택 해제 시 전체 표시로 복귀. 마커 갱신 effect 의존성에 selected 추가.
- CarpoolAnnounceBuilder에서 지도에 selected 전달, toggleSelect에서 접힌 지도 자동 펼침(effect 내 setState 린트 위반 회피 위해 이벤트 핸들러에서 직접 호출).
- 다중 선택도 그대로 지원. tsc·eslint 통과.

---

## #60

**Prompt**: 앱으로설치를 권장이 아닌 필수로 해줘

**Answer**: 잠금화면 알림을 켜려면 홈 화면 앱 설치(standalone)를 '필수'로 강제. 문구만 바꿀지 기능까지 강제할지 물어 사용자가 '기능 강제 + 안드로이드·아이폰 둘 다 설치 필요'를 선택, 설치 감지 정확성 검증도 요청.
- getInstallState()가 iOS뿐 아니라 안드로이드·데스크톱도 미설치(비 standalone)면 needs-install 로 강제(상태명 ios-needs-install→needs-install 일반화). '알림 켜기' 버튼은 설치형(supported)에서만 노출되고, 미설치 상태는 설치 안내만 전면 표시.
- 감지 정확성: isStandalone()이 display-mode:standalone 만 보던 것을 fullscreen·minimal-ui·window-controls-overlay 까지 인정하도록 확장(삼성 인터넷 등 설치형이 minimal-ui 로 실행될 때 설치했는데 오탐 락아웃되는 것 방지). 매니페스트 display=standalone·navigator.standalone(iOS) 확인.
- 적대 검증 2관점(락아웃 감지 / 상태머신·UX)에서 나온 엣지케이스 보강: 브라우저 탭에서 설치해도 그 탭은 standalone 이 안 되므로 "설치 후 홈 화면 앱 아이콘으로 열어야 켤 수 있어요" 안내 추가, 카카오톡 등 인앱 브라우저는 설치 불가라 Chrome·Safari 로 열도록 안내(needs-install·unsupported 문구). "(권장)" 문구·직전에 넣었던 하단 상시 도움말 제거(설치 필수 전면 안내로 대체), installGuide 의 highlight 죽은 분기 정리.
- 알려진 한계(문서화): PC까지 강제라 데스크톱은 설치 안 하면 브라우저 알림도 불가(원하면 PC만 제외 가능). tsc·eslint·build 통과.

---

## #61

**Prompt**: 회원가입할때 이름, 성별, 출생년도, 사는곳 필수로 입력하게 하고, 사는곳 입력하는데에 이 정보는 카풀할때 쓰는거고 저장은 동단위로 한다고 명시해줘.

**Answer**: 회원가입/프로필 폼(ProfileSetup)을 확인하니 네 필드(이름·성별·출생년도·사는곳)는 이미 handleSave에서 전부 필수 검증(미입력 시 저장 차단)되고 있었으나, UI에 필수 표시가 없고 사는곳 안내도 없어 그 두 가지를 보강.
- 네 라벨에 빨간 별표(requiredMark) 추가로 필수 항목을 명시(프로필 사진만 선택사항이라 별표로 구분).
- 사는 곳(동) 라벨 아래에 "카풀 매칭에만 쓰이는 정보예요. 동 단위로만 저장됩니다." 안내 문구 추가.
- 검증 로직은 이미 충분해 그대로 두고 표시/문구만 변경. tsc·eslint·build 통과.

---

## #62

**Prompt**: 지금 사람 선택하면 선택한 누구 여기 태우기가 활성화되는데 그거대신 지도를 크게 만들고 거기서 사람누르면 거기배정하게 해줄 수 있나? 그리고 지도에 사람이름만 있는데 거기 현재 몇명타고있는지 보여주면 더 좋을듯.

**Answer**: 2탭('선택 → 여기 태우기' 버튼) 편성을 지도 마커 탭 배정으로 대체. 미배정 동승자를 고르면 지도가 커지고(180→340px, relayout+bounds 재조정), 운전자 마커가 클릭 가능(파란 강조)해져 누르면 선택된 동승자가 그 차에 배정된다. 운전자 마커 라벨에 현재 탑승 인원을 좌석 대비로 표시(n/좌석 또는 n명, 초과 시 경고색).
- CarpoolMap: assignedCount·onAssignToDriver·onReady prop 추가. 선택 모드에서 운전자 CustomOverlay를 clickable+pointer-events로 만들고 content에 click 리스너로 배정 콜백 연결. 상단에 "태울 운전자를 누르세요" 힌트 배너. 지도 로드 성공/실패를 onReady로 부모에 통지.
- CarpoolAnnounceBuilder: assignSelectedTo를 useCallback(selected 의존)으로 안정화해 지도·버튼 공용, assignedCount useMemo, mapActive 상태. 지도로 배정 가능(showMap&&mapActive)하면 DriverGroupCard의 '여기 태우기' 버튼 숨김.
- fallback 보존: 지도 미가용(키 없음/로드 실패)이거나 거주지 미상 운전자(지도에 마커 없음) 카드는 버튼 유지. 안내 문구도 지도/버튼 상황에 맞게 분기.
- 렌더 중 setState·ref 접근 린트 위반을 이벤트 핸들러/effect로 회피. tsc·eslint 통과.

---

## #63

**Prompt**: 처음 입장하면 지도엔 배정안된 사람만 보이게 해줘. 만약 전부 다 배정되어있음 지도는 디폴트 접기로

**Answer**: 선택 전 초기 지도 표시를 '운전자 전부 + 미배정 동승자만'으로 좁히고, 전원 배정 시 지도를 기본 접힘으로.
- CarpoolMap: assignedRiderIds prop 추가. 표시 필터를 운전자=항상, 동승자=선택 모드면 선택된 사람만·선택 전이면 미배정(assignedRiderIds에 없는)만으로 변경. 배정된 동승자는 초기 지도에서 숨김(인원은 운전자 마커 배지로 확인).
- CarpoolAnnounceBuilder: assignedRiderIds=useMemo(Object.keys(assignment)) 계산해 지도에 전달. 명단 로드 then에서 미배정 동승자 유무(need_ride 중 미배정) 판단해 없으면 setShowMap(false)로 기본 접기(초기 로드 1회).
- 배정 완료 후 selected 클리어 → 초기 모드 복귀 시 방금 배정된 동승자가 지도에서 자연히 사라져 남은 미배정만 남음. tsc·eslint·build 통과.

---

## #64

**Prompt**: 직접입력도 정규화해줘. 인풋에 입력하면 자동완성시켜주는것도.

**Answer**: 앞서 확인한 대로 동단위 정규화는 KakaoLocationSearch의 검색→선택 경로에만 있었고 직접입력은 정규화 없이 저장되던 문제를, 정규화 유틸 추출 + 자동완성 단일 필드 통합으로 해결.
- dongFromAddress를 공용 유틸(src/lib/carpool/dong.ts)로 추출. handleSave에서 residence를 이 함수로 정규화해 저장 → 직접입력·검색선택 모두 동 단위로 저장.
- KakaoLocationSearch를 자동완성+직접입력 겸용 단일 필드로 리팩터: 타이핑 시 300ms 디바운스로 자동 검색(검색 버튼 제거, Enter 즉시), value/onChangeText 제어형 지원. SDK 미로딩/키 없음이어도 입력은 항상 활성(직접입력 폴백 → 거주지 필수값 못 넣어 가입 막히는 회귀 방지).
- ProfileSetup: 중복이던 별도 직접입력 칸 제거하고 단일 필드로 통합(value=residence, onChangeText, onPick).
- 적대 검증 2관점 pass. 지적된 minor 2건 반영: dongFromAddress 정규식에서 '로' 제거(테헤란로 등 도로명 오탐 방지, 동/읍/면/가는 유지), 자동완성 검색에 seq 가드 추가(겹친 요청의 stale 응답 폐기·선택 후 무효화). tsc·eslint·build 통과.

---

## #65

**Prompt**: 편집권한 가져오는거 운영진만 하게 해줘. 일반회원은 읽기만 가능해

**Answer**: 편집권한을 얻는 유일한 두 근본 경로에서 운영진(isAdmin) 게이팅을 추가해 일반 회원은 읽기 전용으로 고정했다.
- sessionStore의 claimEditor(명시적 '편집 권한 가져오기'/강제 탈취)와 claimEditingIfFree(자유 상태 자동 점유·드래그 첫 편집) 두 함수 시작에서 useAuthStore.getState().isAdmin이 false면 즉시 return.
- 이 두 함수가 편집권을 얻는 유일한 진입점이므로 일반 회원은 isEditor가 절대 true가 되지 않음 → 이미 isEditor로 게이팅된 모든 편집 액션(드래그 배치·경기 시작/완료·콕확인·저장·세션 종료)이 자동 차단. 서버 lease row를 건드리지 않아 단일 편집자 동시편집 불변식에도 영향 없음.
- BoardToolbar에 isAdmin 구독 추가: 접속자/편집권한 모달의 '편집 권한 가져오기' 버튼을 운영진에게만 노출, 일반 회원에겐 '편집은 운영진만 가능합니다. 일반 회원은 보기 전용입니다.' 안내 문구 표시.
- tsc 통과, claim 함수 참조 테스트 없어 영향 없음.

---

## #65

**Prompt**: 현재 프로필사진없을때 이름으로 하는데 성빼고 이름첫번째로 하게 해줘.

**Answer**: 프로필 사진이 없을 때 아바타 이니셜을 '성을 제외한 이름 첫 글자'로 변경. 기존에는 4곳에서 `name.charAt(0)`(성 표시)을 각각 사용 중이었음.
- `src/lib/player.ts`에 공용 유틸 `getNameInitial()` 신설: 한글 이름은 성(1글자, 복성은 2글자)을 뺀 첫 글자(김민수→민, 남궁민수→민), 성만 있는 1글자·영문 이름은 첫 글자 그대로.
- 복성 리스트(남궁·황보·제갈·선우·독고·동방·사공·서문)로 2글자 성 판별.
- PlayerAvatar·PlayerCard·PlayerMagnet·ProfileSetup 4곳의 `charAt(0)`을 `getNameInitial()`로 교체(ProfileSetup은 `|| "+"` 유지).
- 다른 아바타 폴백 위치 없음 확인, tsc 통과.

---

## #66

**Prompt**: 서버 RPC에도 is_admin 강제 넣어줘

**Answer**: 클라이언트 게이팅에 이어 편집권을 '설정'하는 모든 서버 RPC에 public.is_admin() 강제를 추가하는 마이그레이션을 작성했다(forward-only, replay-safe).
- 대상 5개 함수 재정의(CREATE OR REPLACE, 시그니처 유지): board_claim_editor(점유/heartbeat), board_takeover_editor(탈취), board_handoff_editor(양도), board_save_drafts(저장+self-claim), board_assert_editor(경기 RPC assign/complete/set_roster의 self-claim 가드).
- 게이팅 방식: 각 함수의 UPDATE WHERE 절에 public.is_admin()을 AND로 추가. 비운영진이면 0행 → 기존 실패 경로로 수렴(SQL 함수는 RETURNING 빈 결과→클라 null 처리·resync, board_assert_editor는 'not editor' 예외로 롤백). 콘솔 에러가 안 쌓이도록 exception 대신 조용한 0행 실패 채택.
- board_release_editor(해제)는 권한 포기라 게이팅 제외. is_admin()은 SECURITY DEFINER 중첩 호출에서도 auth.uid()가 원 호출자를 가리켜 정확히 판정, search_path='' 이므로 public. 스키마 한정 호출.
- Docker 미실행으로 로컬 supabase 적용 검증은 못 함(문법 리스크는 낮음). 배포 시 supabase db push 필요.

---

## #67

**Prompt**: 이름 입력할때 성/이름 input 따로 만들고 db에 넣을땐 합쳐서 넣어줘. 사람들이 성을 입력안하는 경우가 많아서 그래. 그리고 일정이 지금은 일주일마다 추가되는데 일요일 오후 6시에 다음주 일요일 일정이 한번에 추가되게 해줘.

**Answer**: 프로필 이름 입력을 성/이름 두 필드로 분리하고, 일정 노출을 "일요일 18:00 KST 일괄 공개"로 변경했습니다.
- ProfileSetup: 성·이름 각각 필수 검증, 카카오 prefill은 첫 글자=성/나머지=이름으로 분할(재결합 시 무손실), 저장 시 합쳐 members.name 한 컬럼에 저장(DB 스키마 변경 없음)
- 새 마이그레이션: reveal_horizon_kst_date() 공개 상한 단일 기준 함수 추가, sync E단계와 join_session·add_guest_attendance 노출 가드를 "직전 일요일 18:00 공개 시점 기준 다음 일요일까지"로 교체
- pg_cron 잡(일요일 09:00 UTC=18:00 KST) 등록 — 앱 접속 없이도 정각에 open 전환 + session_open 웹푸시 발송
- EXPANSION_SPEC.md와 클라이언트 주석의 "1주 전 노출" 설명을 새 규칙으로 갱신. DB 적용은 supabase db push 필요

---

## #68

**Prompt**: (supabase db push 적용 후 원격 검증 및 후속 조치)

**Answer**: 원격 검증에서 전환기 회귀를 발견해 가드를 롤백했습니다. 옛 rolling 규칙으로 이미 open되고 참석 확정 47명이 진행 중이던 월~목 회차 4개가 새 공개 창(이번 일요일까지) 밖에 남아, 신규 참석이 'session not open yet'으로 막히는 상태였습니다.
- 원인: 참석 가드를 E단계 공개 상한과 정확히 일치시킨 것이 과함 — 가드는 stale-open 차단 백스톱이고 노출 시점은 E단계가 결정
- 공개 상한은 항상 오늘+7일 이내이므로 join_session·add_guest_attendance 가드를 기존 rolling +7d로 되돌려도 보호 범위 동일
- 롤백 마이그레이션 작성 후 supabase db push --yes로 원격 적용 완료, EXPANSION_SPEC.md도 백스톱 의미로 재서술
- 일요일 18:00 일괄 공개(E단계+pg_cron)는 그대로 유지

---

## #69

**Prompt**: 근데 다음주일정이 1주일단위로 배포되는게 이미 작업되어있어서 금토일을 미리열고 담주일요일부터 규칙작동하게 가능?

**Answer**: 전환기 일회성 마이그레이션으로 7/10(금)·7/11(토)·7/12(일) draft 회차 3개를 즉시 open하고 session_open 푸시(171건)를 발송했습니다.
- sync E단계와 동일한 로직(open 전환+알림 멱등 가드)을 고정 날짜(7/3~7/12)로 1회 실행 — 재적용 시 과거 날짜라 no-op
- 7/5(일) 18:00 cron은 열 것이 없어 no-op, 새 일괄 공개 규칙은 7/12(일) 18:00에 7/13~7/19를 열며 첫 작동
- supabase db push로 원격 적용 후 3개 회차 open 상태와 알림 발송 수를 REST로 검증 완료

---

## #70

**Prompt**: 참여도 시간제한 걸어놨을텐데, 참여가능은 시간제한로직보다 열렸니 안열렸니로 단순화하는게 좋을듯

**Answer**: join_session·add_guest_attendance의 노출 시간 가드(scheduled_at <= now()+7d)를 제거해 참여 가능 판정을 "status='open'인가"로 단일화했습니다.
- open은 sync E단계(공개 창 안)만 만들므로 status가 노출·참여의 단일 진실원천 — 이중 기준이 전환기 회귀의 근본 원인이었음
- 종료 가드(ends_at<=now())는 유지 — 종료 시각에 status가 실시간으로 closed로 안 바뀌어(일 단위 sync) 이것까지 빼면 끝난 당일 일정에 참석이 통과됨
- 마이그레이션 작성 후 supabase db push로 원격 적용, EXPANSION_SPEC.md 가드 서술 재정리

---

## #71

**Prompt**: 코드정리가 필요해. 크기가 큰 파일은 분할하고 공용 컴포넌트는 통일해줘.

**Answer**: 400줄 이상 대형 파일 9개를 분할하고 공용 UI 기반을 신설해 사용처를 일괄 교체했습니다. 분석→분할→기반 신설→교체→적대적 리뷰의 다단계 병렬 에이전트 워크플로우로 진행했으며, 모든 분할은 원본 경로의 public API를 유지해 importer 수정이 0건입니다.
- 분할: boardStore(1382→48줄, zustand 슬라이스 3개+순수 헬퍼 계층), sessionStore(930→507줄, 편집락·broadcast 핸들러·상태 분리), supabase api(도메인 3분할 후 re-export 셔임), MemberAdminPage·PlayerMagnet·SessionBoard·OccurrenceEditor·ScheduleRuleEditor·CarpoolAnnounceBuilder(훅/서브컴포넌트 추출). ProfileSetup·PlaceLocationPicker·ScheduleCard는 단일 컴포넌트 응집 구조라 분할 실익 없음 판정
- 공용 기반 신설: 색 토큰 text-strong/muted/faint(하드코딩 약 130곳 치환, 다크 알파 0.4/0.6 수렴), btn-solid-blue·btn-tint-blue/red/neutral·card-lq 유틸리티, ConfirmDialog·SheetHeader·EmptyState·fieldStyles 컴포넌트, ModalSheet(센터 변형·Escape·zIndex·title)·Switch(onColor)·PlayerBadge(count)·PlayerAvatar(preview/fallback)·timeFmt(fmtHM/fmtMDHM) 확장
- 통일: schedule의 병렬 바텀시트 시스템을 ModalSheet로 통합(표준 플로팅 수렴), 확인 다이얼로그 6곳, 빈상태/로딩 블록 10여 곳, 인라인 재구현 버튼 20여 곳, btn-lq 사이징 복붙 26곳 폴딩, 로컬 시간 포맷터 3곳 제거
- 적대적 리뷰 7영역에서 발견된 5건 수정: 중첩 ModalSheet 동시 언마운트 시 body 스크롤락 잔존(참조 카운팅으로 근본 수정), CockCheckModal 취소 버튼 busy 의미 변화(cancelDisabled), ConfirmDialog Escape 유실·폭 확대(maxWidth xs), 빈 이름 아바타 404, 디버그 모달 다크 가독성 회귀 복원. tsc·ESLint(기존 3건 외 신규 0)·테스트 168개·빌드 전부 통과. 사용자의 미커밋 기능 작업(성/이름 분리 등)은 보존

---

## #72

**Prompt**: 아 올려줘

**Answer**: GitHub Pages 배포 워크플로(deploy.yml)의 액션 버전을 최신 메이저로 업그레이드했습니다. Node 20 deprecation 경고를 없애기 위한 작업.
- 각 액션의 최신 릴리스와 내부 런타임 확인: 6개 모두 node24 런타임으로 확인됨
- packageManager 필드(pnpm@11.8.0)가 있어 pnpm/action-setup은 version 입력 없이도 호환됨을 확인
- 버전 상향: checkout v4→v7, pnpm/action-setup v4→v6, setup-node v4→v6, upload-pages-artifact v3→v5, configure-pages v4→v6, deploy-pages v4→v5
- setup-node의 `node-version: 22`(앱 빌드용 Node)는 액션 내부 런타임(경고 대상)과 무관하므로 그대로 유지
- 사용자 선택에 따라 커밋/푸시 없이 스테이징만 수행

---

## #73

**Prompt**: 모달이든 바텀시트이든 화면위에 오버레이되는 창의 스크롤액션을 하면 바닥에 깔린 창도 같이 스크롤되면서 액션이 꼬이는데 이거 근본적으로 막을 방법을 찾아서 모두에 적용해

**Answer**: 모든 스크롤 캡처 오버레이(모달·바텀시트·확인 다이얼로그·메뉴 시트)가 단일 프리미티브 `ModalSheet` 하나를 거치는 구조(포탈 없음)임을 확인하고, 근본 수정을 한 곳 + 전역 CSS에 적용해 전체에 자동 반영되게 했습니다.

- **3겹 방어**: ① 전역 `html/body { overscroll-behavior: none }` — iOS 웹뷰 전체 고무줄 바운스 + 문서 레벨 체이닝 차단 ② `ModalSheet` 백드롭 가드 — 오버레이 루트에 non-passive `touchmove`/`wheel` 리스너를 달아 타깃이 시트 바깥(백드롭)일 때만 `preventDefault`(시트 내부·지도·슬라이더·중첩 스크롤 무손상) ③ 기존 시트 `overscroll-contain` 유지
- **적대적 검증(워크플로 4관점×심판) 중 실버그 발견·수정**: 모달이 `AppScreen`(pull-to-refresh 루트) DOM 하위에 렌더될 때(Home→ScheduleCard→GuestSection→GuestModal), 모달 오픈 시 `body:fixed`로 `scrollY===0`이 되어 시트 내 하향 드래그가 PTR로 버블링돼 새로고침이 오발동 → `.lq-overlay` 안에서 시작한 터치는 PTR 대상에서 제외
- `tsc`·`vite build` 통과

---

## #74

**Prompt**: 안드로이드 푸쉬이미지가 흰색으로 나오는데 PWA에서 어떻게 해야함?
참여취소시 한번더 묻는 확인팝업나오게.
신규가입하면 운영진한테 알람
게스트옆에 신청자이름 나오게

**Answer**: 4건을 병렬 조사(워크플로) 후 구현했습니다.

- **안드로이드 푸시 흰색**: 근본 원인은 `sw.js`의 `badge`가 불투명(알파 없음) `icon-192.png`를 가리킨 것 — 안드로이드는 badge의 알파 채널만 실루엣으로 써서 통짜 흰 도형이 됨. 투명 배경 로고 실루엣 `badge-96.png`를 생성해 badge로 교체(큰 icon은 정상이라 유지)
- **참여취소 확인**: `ScheduleCard`의 취소 버튼(참석중/대기 2곳)이 즉시 취소하던 것을 `ConfirmDialog`(danger, 상태별 문구 분기)로 재확인 후 실행하도록 변경
- **신규가입 운영진 알림**: members 프로필 3필드(gender/birth_year/residence)가 NULL→채워지는 "최초 완성"에만 발화하는 AFTER UPDATE 트리거로 운영진 전원에게 `new_member` 알림 INSERT → 기존 `trg_notify_push_send` 파이프라인이 웹푸시 처리. edit/실력편집/게스트/본인은 미발화 가드. `send-push`·클라 `notificationMessage`에 케이스 추가 (배포: `supabase db push` + `functions deploy send-push` 필요)
- **게스트 신청자 이름**: 데이터(`attendances.invited_by`)는 이미 존재 → 쿼리에 `inviter:invited_by(name)` join + 타입 + `SessionParticipantsModal` 배지를 "🎫 {신청자}님 게스트"로 표시(GuestSection은 내 게스트만 보여 제외)
- `tsc`·`vite build` 통과

---

## #75

**Prompt**: 일일 게스트 최대 2명으로 제한. 이후 게스트신청은 알림띄우고, 만약 대기자일 경우 게스트가 빠지지 않으면 새로운 게스트는 참여가 불가하다는 알림표시 (후속1: "세션당 전체 게스트" / 후속2: "게스트 추가신청은 가능하되, 이미 세션에 참여한 게스트가 2명이면 후보 우선순위더라도 참여가 힘들수 있다는 알림 이후에 추가하게 해줘")

**Answer**: 기준을 사용자 확인으로 **세션(일정) 전체 게스트 2명**으로 잡되, 후속2 요청에 따라 **하드 차단이 아닌 소프트 경고** 방식으로 최종 구현했습니다.

- **방향 전환**: 처음엔 서버 RPC 하드 상한(2명 초과/정원 초과 예외)으로 작성했으나, "추가는 가능하되 경고 후 진행"으로 요청이 바뀌어 **RPC 변경을 폐기**(하드캡 마이그레이션 삭제, 원격 미적용 확인 — 원본 RPC가 이미 정원 여유면 확정/아니면 대기 처리하므로 서버 변경 불필요)
- **클라 경고 흐름**: `GuestSection`에서 일정 전체 활성 게스트 수 ≥ 2 이면 "+ 게스트 신청" 탭 시 폼 대신 `ConfirmDialog`("후보 우선순위라 기존 게스트가 빠지지 않으면 참여하지 못할 수 있어요. 그래도 신청할까요?") 표시 → 확인 시 신청 폼(GuestModal) 진행. 2명 미만이면 바로 폼
- 하드 차단용으로 넣었던 `Home.guestErrorMsg` 에러 매핑/즉시 alert 은 원복
- `tsc`·`vite build` 통과. **프론트만 배포(git push), DB 변경 없음**

---

## #76

**Prompt**: 18명에서 인원 24명으로 늘리면 대기도 참여로 바뀌어야지. 바로 이전에 24명에서 18명으로 바꿨을때 참여된인원 대기로 빼는것과 마찬가지로 작동해야하고, 해당 인원들에게 상황이 이러이러해서 참여/대기로 변경되었다 푸쉬나가게 해줘.

**Answer**: 코드·DB·git 히스토리를 전수 조사한 결과 **정원 변경 시 참석/대기를 재조정하는 로직이 애초에 존재하지 않음**을 확인(24→18 강등도 실제로는 동작한 적 없음, 승격용 `promote_waitlist` RPC는 어디에도 연결되지 않은 죽은 코드). 따라서 사용자 기대("마찬가지로 작동")대로 **양방향(증가→승격 / 감소→강등)을 모두 신규 구현**.

- **원자 RPC `set_session_capacity(p_session_id, p_capacity)`**(신규 마이그레이션): 정원 UPDATE와 재조정을 한 트랜잭션으로 처리. open 세션만 재조정 — 정원↑/무제한이면 대기자를 신청순(position ASC) 승격, 정원↓면 최근 신청 참석자(position DESC)를 초과분만큼 강등(position 보존→재상향 시 원순번 복귀). 잠금 순서 sessions→session_counters→attendances로 기존 join/cancel 규칙 준수
- **알림/푸시**: 대상별 `promoted`/`demoted` 알림 INSERT→웹푸시. 게스트는 계정이 없어 `coalesce(invited_by, member_id)`로 데려온 회원에게 발송하되, payload에 `guest_name`을 실어 "내 게스트가 변경됨"으로 문구 분기(본인이 밀린 걸로 오인 방지). 문구는 클라(`notifications.ts`)·Edge Function(`send-push`) 양쪽 동기화
- **배선**: 정원이 **실제로** 바뀐 경우에만 `overrideOccurrence`에서 원자 RPC 호출(capacity는 일반 PATCH에서 제외), 승격/강등 수를 토스트로 안내. 실패 시 throw로 부분 적용을 성공 위장하지 않음
- **적대적 리뷰 워크플로우**(4관점 리뷰+결함별 검증): 동시성·순서·카운터는 결함 0, 확정 3건 수정 — ①원자성(정원+재조정 분리 호출→한 RPC로 통합) ②게스트 강등 문구 오해(guest_name 분기) ③부정 알림 초록 토스트(App.tsx 실시간 핸들러에서 negative 타입은 info로)
- `tsc`·`eslint`·`vitest`(168) 통과. **배포 필요: `supabase db push` + `supabase functions deploy send-push`**(프론트는 git push)

---

## #77

**Prompt**: 일정 시작시간보다 10분전부터 노출되게해줘

**Answer**: 운영진 "경기 시작" 버튼을 일정 시작 10분 전부터 노출되게 변경. 기존엔 `isLive`(시작 시각 경과) 하나가 버튼·초록 하이라이트·"진행중" 배지·상단 정렬을 모두 제어했는데, 이를 통째로 앞당기면 시작 전인데 "진행중" 배지가 뜨는 문제가 생겨 **버튼 노출만 분리**하기로 결정.

- `Home.tsx`: `canStartSchedule` 판정 신설(`open && scheduled_at − 10분 ≤ now`), 리드타임은 `START_LEAD_MS` 상수로 관리, `canStart` prop 전달
- `ScheduleCard.tsx`: `canStart` prop 추가, 버튼 조건을 `isLive` → `canStart`로 교체. 하이라이트·배지·정렬은 실제 시작 시각 그대로 유지
- 서버 RPC(`start_session_from_schedule`)엔 시작 시각 하한 가드가 없어(종료 가드만 존재) 프론트 변경만으로 동작. `tsc` 통과, 프론트 전용이라 git push만으로 배포

---

## #78

**Prompt**: 모달/다이얼로그 백드롭의 gray opacity가 아이폰에서 하단 세이프에어리어만큼 적용 안 되는 문제 — 기술적으로 불가능한지 웹 조사 + sticky 편법 비교 + body-lock 맥락 반영해 수정/배포

**Answer**: iOS 26 Safari가 `position:fixed`를 inner viewport로 클리핑하는 알려진 회귀 버그로 확인(불가능한 게 아님). 웹 조사(Devon Govett PSA, MUI #46953, shadcn #8471 등)로 두 갈래 원인(iOS26 fixed 클리핑 / transform 조상)과 해결책 정리.
- sticky 편법도 유효하나, `ModalSheet`가 스크롤 체이닝 방지용 `body{position:fixed}` 락을 쓰는 구조라 sticky는 스크롤 컨테이너 충돌 소지 → 딤 오버레이엔 부적합으로 판단.
- 흔한 "body 투명" 트릭은 `backdrop-filter: blur` 대상(뒤 콘텐츠)을 없애 유리 질감이 죽으므로 배제. 대신 **background propagation** 원리 활용: `html`에 배경을 주면 body→캔버스 전파가 멈추고 캔버스=html 배경이 되어, fixed가 못 덮는 하단 스트립이 딤으로 채워짐. body 미변경이라 blur·스크롤락 불변.
- `html.modal-dim`(다크 `html.dark.modal-dim`) 색을 `.lq-overlay`와 동일하게 정의하고, `ModalSheet`의 ref-count body-lock effect에 클래스 add/remove 한 줄씩 추가. `.dark`가 `<html>`에 붙음을 확인. 대상 다이얼로그(GuestSection→ConfirmDialog→ModalSheet)가 이 경로를 탐. tsc 통과, 실기기 iOS26 검증 필요해 배포.

---

## #79

**Prompt**: (스크린샷) 그대로인데? 웹에서 된다는 게 이거맞아?

**Answer**: 배포 검증 결과 CSS(`html.modal-dim`)는 정상 반영, SW는 웹푸시 전용이라 캐시 무관으로 확인. 원인 재분석: 하단 스트립을 칠하는 주체가 환경별로 다름 — 설치형 PWA는 html 배경, Safari 브라우저(사용자 테스트 환경, 하단 주소창)는 스크롤락으로 position:fixed가 된 body의 불투명 배경(#fafbff)이 스트립을 덮어 html만 딤 처리한 게 안 보였음. Govett 레시피대로 body 배경도 딤 처리하도록 수정.
- CSS: `body.modal-dim`에 rgba 딤(html 기본색 위 합성→오버레이 톤 일치), `html.modal-dim`은 PWA에서 body 클리핑 시 폴백용 solid 값으로 유지. html/body 둘 다 토글.
- ModalSheet body-lock effect에서 documentElement와 body 양쪽에 클래스 add/remove. 배경색만 변경이라 스크롤락·blur 불변. tsc 통과.

---

## #80

**Prompt**: 이건 그냥 눈속임으로 가리는거잖아. 백그라운드 드롭에는 블러가 들어있어 뒤가 은은하게 비쳐야하는데 그게 안되는데?

**Answer**: flat 색 채움은 backdrop-filter blur를 재현 못 하는 눈속임임을 인정. 근본 해결로 방향 전환 — blur를 만드는 .lq-overlay가 position:fixed라 iOS 26이 inner viewport로 클리핑하는 게 원인이므로, 검증된 패턴(Devon Govett의 react-spectrum PR #8888)을 이식. 사용자 승인 하에 스크롤락까지 재작업.
- `.lq-overlay`를 position:fixed → **position:absolute + 문서 전체 높이**로 전환(클리핑 회피, blur가 스트립까지 이어짐). 시트는 별도 fixed 컨테이너로 visual viewport에 배치, 딤 클릭은 pointer-events로 백드롭에 통과.
- ModalSheet를 document.body로 **portal**(absolute 기준점 안정화).
- body{position:fixed} 스크롤락 → react-spectrum usePreventScroll 이식(`src/lib/scrollLock.ts` 신규): html overflow:hidden + `*{overscroll-behavior:contain}` 스타일 주입 + touchmove capture 차단 + 인풋 포커스 스크롤 억제. 문서를 들어내지 않아 absolute 백드롭과 양립하고 스크롤 복원 hack 불필요.
- 이전 flat-dim(.modal-dim) CSS/JS 롤백. tsc·vite build 통과. ModalSheet 계열 28곳 사용 → 실기기 검증 필요(blur/스트립, 배경 스크롤락, 폼 인풋 포커스, 시트 내부 스크롤, 중첩 모달).

---

## #81

**Prompt**: 잘 되는거 확인했어. 근데 body 에서 ios 는 특유의 자연스러운 스크롤 바운딩이 있는데 그게 안되네.

**Answer**: blur는 해결 확인. 바운스 부재 원인은 html/body의 전역 `overscroll-behavior: none`이 iOS 고무줄 바운스를 죽이고 있던 것(원래 모달 뒤 페이지 튕김 방지용). 이제 그 역할은 scrollLock이 정밀 처리하므로 전역 none이 과잉. 웹 조사로 `contain`은 바운스를 유지하면서 스크롤 체이닝·pull-to-refresh만 차단함을 확인(none은 바운스까지 제거). html·body의 overscroll-behavior를 none→contain으로 변경해 자연스러운 바운스 복원. CSS만 변경, build 통과.

---

## #82

**Prompt**: pull to refresh 가 있는곳도 자연스럽게 바운딩되면서 같이 작동하게 하고싶은데 웹에서 구현한 사례또는 패키지를 참조해서 수정할수 있으면 해줘

**Answer**: 기존 커스텀 P2R(usePullToRefresh+AppScreen)이 당길 때 preventDefault로 네이티브 바운스를 죽이고 content를 translateY로 직접 움직이는 방식이라, contain으로 살린 네이티브 바운스와 이질적이었음. 웹 레퍼런스(patrickhlauke overscroll+touch, pulltorefreshjs, chrome overscroll-behavior 문서) 조사 후 "네이티브 바운스에 얹는" 방식으로 전환.
- hook: touchmove의 preventDefault 제거 → iOS 네이티브 오버스크롤 바운스 그대로 유지. pull 값은 콘텐츠 이동이 아니라 스피너 진행도로만 사용(터치 델타+sqrt 감쇠 추적, 임계 트리거는 유지).
- AppScreen: content의 translateY transform 제거(네이티브 바운스가 콘텐츠를 움직임, 이중 이동 방지). 스피너를 헤더 바로 아래(top: safe-area+60px) 고정 오버레이로 띄워 당김/새로고침 두 상태에서 헤더와 안 겹치게. 알약형 배경 추가로 콘텐츠 위 가독성 확보.
- 모달이 body로 portal되므로 P2R 오발동(모달 터치 버블링) 우려도 제거됨. tsc·build 통과, 실기기 검증 필요.

---

## #83

**Prompt**: 자연스러운 바운딩이 네비보다 상단에 있는데, 네비 상단은 고정하고, 인디케이터를 네비와 본문사이에 두게 해서 할 순 없을까

**Answer**: iOS 오버스크롤이 페이지 전체(sticky 네비 포함)를 튕겨 네비 위에서 바운스되던 문제. 네비를 fixed로 흐름에서 빼면 바디만 바운스하고 네비는 고정되며, 네비-본문 사이에 gap이 열려 그 자리에 인디케이터를 둘 수 있음(네이티브 앱 방식).
- AppHeader에 `positioning?: "sticky"|"fixed"` prop 추가(기본 sticky). flex 셸 사용처(LogPage·SessionSetup·MemberAdminPage)는 기본값이라 불변.
- AppScreen: 네비 positioning="fixed" 지정 + 네비가 흐름에서 빠지므로 root에 padding-top=NAV_H(env(safe-area-inset-top)+53px) 부여. 인디케이터를 top:NAV_H(네비 바로 아래)에 고정, translateY로 네비 밑에서 슬라이드 인. box-sizing border-box라 min-h-100dvh+padding 이중 높이 없음.
- <AppScreen> 3곳(Home·SchedulePage·RegularNoticePage)에 일관 적용. tsc·build 통과, 실기기 검증 필요.

---

## #84

**Prompt**: 스크롤할때 바운딩은 잘 되는데, 멈춘상태에서 p2r 을 위해 다시한번 땡기면 네비와 본문사이에도 인디케이터가, 네비위에도 인디케이터가 생기고, 네비는 의도한것과다르게 아래로 내려가. 이거 위에 딱 붙게 고정 못해? 그리고 네비 위에 붙는건 모든 페이지 고정인데 positioning prop 을 따로 만드는 이유를 모르겠어.

**Answer**: 원인=iOS는 문서 오버스크롤 바운스 때 position:fixed 요소도 함께 끌고 내려감 → fixed 네비가 안 붙고 고정 인디케이터도 끌려가 중복으로 보임. body 스크롤을 쓰는 한 fixed로 네비 고정 불가. 사용자 선택(네비 완전고정)에 따라 내부 스크롤 셸 방식으로 전환.
- AppScreen: body 스크롤 → app-shell-h(고정높이 셸, 100dvh/설치형 100lvh) flex-col + 내부 overflow-y-auto/overscroll-contain 컨테이너. 바운스가 이 컨테이너 안에서만 일어나 바깥 네비(AppHeader, flex-shrink-0)는 진짜 고정. 인디케이터는 셸 기준 절대배치로 네비 바로 아래 앵커(중복/이동 없음).
- positioning prop 제거(불필요) → AppHeader 원복. 모든 페이지가 동일하게 네비 상단 고정으로 통일.
- usePullToRefresh: window.scrollY → 컨테이너 el.scrollTop 기준으로 감지 변경.
- 로그·회원관리와 동일한 검증된 app-shell-h 패턴이라 하단 safe-area는 content padding-bottom env()로 처리. 트레이드오프: Safari 브라우저에선 스크롤 시 주소창 자동 접힘이 사라짐(설치형 PWA엔 무관). tsc·build 통과.

---

## #85

**Prompt**: 참여자 목록에 게스트뱃지처럼 운영진도 뱃지

**Answer**: 참여자 목록(SessionParticipantsModal)에 게스트 뱃지처럼 "🛡️ 운영진" 뱃지를 추가. 근본 제약 파악이 핵심이었음 — 운영진=user_roles.role='admin'인데 기존 RLS(user_roles_select)는 일반 회원이 타인의 admin 여부를 못 봐서, 게스트 뱃지처럼 전원에게 보이려면 운영진 여부를 공개로 노출해야 했음.
- DB 마이그레이션 추가: role='admin' 행을 로그인 회원 전원에게 공개하는 permissive select 정책(user_roles_select_admin_public). 'member' 등 나머지 role은 계속 비공개.
- fetchAttendances 쿼리에 nested embed user_roles(role) 추가, AttendanceRow.member 타입에 user_roles 필드 추가.
- SessionParticipantsModal에 isAdmin 계산 + Pill 공용 컴포넌트로 게스트/운영진 뱃지 통합.
- 적대적 검증 워크플로(RLS·PostgREST·UI·완전성 4관점) 실행 → RLS/임베드/완전성은 이상 없음(참여자 목록은 이 모달 하나, 마이그레이션 미적용 시 빈 배열로 안전 degrade), UI 저심각도 2건 반영: 다크모드 대비(Pill 색 dark: 분기로 밝게), 이름 span truncate 무력화(min-w-0 추가).
- 배포 주의: DB 마이그레이션은 supabase db push 수동 적용 필요(미적용 시 프론트만 배포돼도 뱃지만 안 보이고 에러 없음).

---

## #85

**Prompt**: sticky 가 그래서 고정하려고 만든 position 이잖아

**Answer**: 맞는 지적 — sticky는 "일반 스크롤 중 top:0 고정"용으로 정확히 그 역할을 함. 다만 iOS 오버스크롤 바운스는 별개 메커니즘으로 sticky/fixed 포함 모든 요소를 통째로 끌어내려서, 그 순간엔 sticky도 못 버팀. 즉 body 스크롤에서 "P2R 당길 때 네비 고정 + 네이티브 바운스"는 동시 불가(택1). 고정높이 셸은 Safari에서 잘리므로, 잘림 없음을 우선해 body 스크롤 유지로 되돌림.
- AppScreen: app-shell-h(고정 셸) → 다시 body 자연 스크롤 + sticky 네비. 인디케이터는 커스텀 당김으로 열린 네비-본문 사이 gap(height=pull)에 표시. contentClassName도 원래대로 content 래퍼에.
- usePullToRefresh: 컨테이너 scrollTop → window.scrollY 복원 + 당김 제스처에서만 preventDefault 복원(네이티브 오버스크롤 차단 → sticky 네비 고정, 콘텐츠만 translateY). 일반 스크롤 바운스는 overscroll-behavior:contain로 네이티브 유지.
- 결과: Safari·PWA 모두 하단 잘림 없음 + 일반 스크롤 네이티브 바운스 + P2R 당길 때 네비 고정 + 인디케이터 네비-본문 사이. 트레이드오프는 P2R 당기는 그 순간만 커스텀 애니메이션(네이티브 바운스 아님). 메모리(ios-pwa-natural-scroll) 최종 상태로 갱신. tsc·build 통과.

---

## #86

**Prompt**: react-area/overlays 로 하자

**Answer**: 배경 스크롤락을 손이식본(scrollLock.ts 265줄)에서 검증된 외부 패키지 @react-aria/overlays 의 usePreventScroll 로 교체(유지보수 upstream 위임). 전수조사+반증검증 결과 우리 실격기준(body position:fixed=absolute 백드롭 붕괴)을 통과하고 iOS 입력포커스까지 처리하는 유일 후보였고, 회피 이유였던 번들 손해도 tree-shaking 실측으로 반증됨(번들 +3.6kB/gzip +1.2kB만 증가 확인).
- 프로젝트가 pnpm(11.8.0)인데 npm으로 설치 시도해 arborist 오류 → pnpm add 로 정정 설치(@react-aria/overlays 3.32.1).
- ModalSheet: lockScroll() 명령형 호출 제거하고 usePreventScroll() 훅 한 줄로 대체(모달 마운트 중 자동 잠금+내장 ref-count 중첩). docHeight 측정 로직은 유지. src/lib/scrollLock.ts 삭제.
- index.css 주석의 scrollLock 언급을 usePreventScroll 로 정정(단 이 파일엔 다른 세션 WIP=late-arrival 슬라이더 CSS가 섞여 있어 스테이징에서 제외).
- 지난번 git add -A 사고 반성 → 이번엔 내 파일만 명시 스테이징. tsc·build 통과.

---

## #87

**Prompt**: 카풀 선택하는것처럼 세션마다 늦참체크를 하는게 있으면 좋겠는데 슬라이더같은걸 만들어서 좌우로 땡기는 방식으로 체크하는건 어떨까. 세션 이동량은 30분 단위로. (+ 후속: 디자인 개선 → 카풀과 통일(세그먼트) → 낙관적 업데이트 → 다크 톤 조정)

**Answer**: 카풀 의향(carpool_role) 패턴을 그대로 미러링해 세션×회원 단위 "늦참" 기능을 추가. 절대 도착시각이 아니라 scheduled_at 기준 오프셋(분)으로 저장(시각 변경에도 의미 유지, 30분 스냅 자연스러움).
- DB: attendances.late_minutes(int, 30분 배수 체크) 컬럼 + set_late_minutes RPC(본인·범위·세션길이 상한·종료 가드) + cancel_attendance에 취소 시 late_minutes=0 리셋(재참석 부활 방지) 추가. 마이그레이션은 supabase db push 별도 필요.
- 데이터/배선: types(AttendanceRow.late_minutes)·schedule.ts(setLateMinutes)·store(setLate)·Home·ScheduleCard(슬라이더)·SessionParticipantsModal(⏰ 도착시각 뱃지). v1 표시 전용이라 팀편성/보드 미연동.
- 슬라이더: 커스텀 드래그 대신 네이티브 range를 pseudo-element로 커스텀(터치/스냅/접근성 무료). 3줄→1줄로 압축.
- 디자인 통일(옵션 B 채택, 미리보기 아티팩트로 A/B 비교 후 결정): 카풀 3버튼→iOS식 세그먼트 컨트롤, 늦참은 같은 높이·라운드의 알약 트랙 안 슬라이더. 라벨 타이포 12px/600/faint로 통일. index.css에 .ctl-row/.ctl-label/.ctl-seg/.ctl-pill/.ctl-val + 토큰(--seg-track/--seg-track-deep/--late-amber, 라이트/다크 스왑) 신설.
- 낙관적 업데이트: authStore.memberId로 내 참석행을 즉시 in-place 패치(화면 선반영) 후 서버 전송. 카풀=즉시 전송+실패 시 롤백, 늦참=즉시 화면+마지막 조작 후 500ms 디바운스 전송(세션별 타이머). 성공 시 reloadAttendances 왕복 제거. 홈 화면은 attendances 실시간 구독이 없어 에코 덮임 없음.
- 다크 톤: 세그먼트/트랙 컨테이너가 어두운 카드 위에서 떠 보여 다크값 하향(--seg-track 흰10%→5%, --seg-track-deep 흰22%→14%). 라이트는 유지.
- tsc·eslint·build 전부 통과.

---

## #88

**Prompt**: 참여자목록에서 운영진 뱃지가 있는데 왕관모양으로 교체해줘 (+ 후속: 운영진 텍스트 없이 왕관만, 이모지는 플랫폼마다 다르니 웹에서 어울리는 왕관 찾아 SVG로 → 색을 더 눈에 띄게)

**Answer**: SessionParticipantsModal의 참가자 행 운영진 표식을 `🛡️ 운영진` pill에서 왕관 아이콘 단독 표기로 교체.
- 이모지는 플랫폼별 렌더 편차가 있어 인라인 SVG로 고정. lucide(선형·받침선)보다 작은 뱃지에서 또렷한 Tabler 채운(fill) 왕관 채택(24 그리드라 앱 lucide 아이콘과 비율 일관, currentColor로 색 주입).
- CrownIcon 컴포넌트 신설, isAdmin 분기를 Pill 대신 role="img"/aria-label="운영진" span + CrownIcon(16px)로 변경. Pill은 게스트 전용으로 남기고 주석 갱신.
- 색은 눈에 잘 띄고 왕관에 어울리는 골드/앰버로(라이트 #f59e0b / 다크 #fbbf24). 바탕이 바제이라 게스트(갈색계 pill)와도 구분. 격리 프리뷰 스크린샷으로 라이트/다크 가독성 확인.
- 색 방향은 사용자 확인 대기 중 무응답이라 추천안(골드)으로 진행. tsc 통과.

---

## #89

**Prompt**: (admin 참석자 제거 변경 적대적 리뷰 결과 검토) 둘 다 수정 → (문구이슈 확인 후) 전부수정하고 메인에 커밋해

**Answer**: 적대적 리뷰(3렌즈)가 짚은 낮은 심각도 2건을 고치고, 후속 검증 워크플로우(3렌즈)가 발견한 인접 RPC/문서 이슈까지 사용자 승인 하에 전부 정합화. 대기 승급 'promoted' 알림의 수신자/문구를 4개 경로(set_session_capacity 기준)로 통일하는 것이 핵심.
- admin_cancel_attendance: 승급 알림 payload에 게스트면 guest_name 병합(초대회원에게 "게스트 X 확정"으로 렌더), 헤더 주석도 removed 알림과 대칭화.
- 신규 마이그레이션 20260707020000: cancel_attendance는 승급 알림을 게스트 본인 id로 직접 보내 초대회원이 영영 못 받던 실제 알림 유실 버그 수정(coalesce(invited_by,member_id)+guest_name). cancel_guest_attendance는 라우팅 유지하고 guest_name만 병합. 두 함수 본문은 원본과 알림 INSERT만 다름(diff 대조로 재현 오류 없음 확인).
- SessionParticipantsModal.removeMessage: 승급 안내는 open 세션에서만 노출(active는 승급 없이 확정 해제만), 운영진이 본인 초대 게스트 제거 시 RPC가 알림을 생략하므로 안내 문구도 생략.
- docs/EXPANSION_SPEC.md: notifications.type에 'removed', RPC 표에 admin_cancel_attendance 추가.
- tsc 통과. 신규 마이그레이션 2건은 supabase db push 필요(미실행).

---

## #90

**Prompt**: 8시 이후 늦참인원은 현재 참석정원으로 정해져있는 큐와 분리된 독립된 형태로 받고싶은데, 이렇게 하는 사람들은 실제론 참석은 가능하되, 왔을때 자리 있으면 하고 없으면 대기해야하는걸로 할거야. 이건 현실에서 사람들에게 통보할건데, 시스템적으로 되게 해줘. 8시 늦참으로 슬라이드해서 적용되면 이를 알리는 확인 다이얼로그 띄우고, ui 도 약간 다르게 표현
(추가 정정: 늦참을 절대값 8시라고 했는데 정확히는 6~9시면 8시, 그러니까 2/3 이후를 말해.)

**Answer**: 늦참 슬라이더로 도착시각을 경기 후반 2/3 지점(예: 18:00~21:00이면 20:00) 이후로 넘기면 정원 큐와 분리된 독립 접수 상태(late_pool)로 전환되는 기능을 구현. 핵심 결정:
- late_pool을 attendances.status 4번째 값으로 모델링 — session_counters.confirmed_count(정원)에 미포함(독립). "왔을때 자리 있으면 참여/없으면 대기"의 현장 판정은 기존 보드 대기 로테이션이 담당하고, RSVP 단계는 정원 분리 + 표기까지만 책임(start_session_from_schedule은 confirmed만 편입, 무변경).
- 경계는 절대 20:00이 아니라 v_start + (v_end - v_start)*2/3로 계산(사용자 정정 반영). 클라 latePool.ts와 서버 set_late_minutes가 동일 산식·타임스탬프 비교로 판정 일치.
- set_late_minutes RPC를 void→jsonb로 바꿔 경계 크로싱을 원자 처리: 확정→풀 시 정원 1칸 반납+대기 1순위 자동 승급(promoted), 풀→복귀 시 여유면 confirmed 없으면 waitlisted(position 재발급). 초대자가 풀이면 게스트도 풀 상속. 잠금 순서는 기존 join/cancel과 동일.
- UI: 슬라이더 앰버→바이올렛 2톤, 경계 크로싱 시 확인 다이얼로그(실제 경계 시각·정원 외 규칙 안내), 카드 배지/카운트/아바타 스택/참가자 모달 별도 섹션. 색은 --late-pool 토큰(라이트/다크 스왑).
- 디바운스 전송과 경계 전환의 순서 역전 경쟁 조건을 세션별 직렬화 체인(enqueueLate)으로 선제 수정.
- 4개 관점 애드버서리얼 리뷰 결과 DB 정합성·경계 산식 지적 0건, 확정 경미 3건(전환 실패 무피드백→에러 알림, 다크모드 색 토큰 불일치 2건) 반영. tsc·build·테스트(168)·lint 통과.
- 신규 마이그레이션 20260708010000_late_pool.sql은 supabase db push 필요(미실행).

---

## #91

**Prompt**: 이론상 경기 끝나는 시간엔 늦참이 없으니 미만으로 셋팅해서 6~9시면 9시는 선택못하게 하고 불참/정원외늦참이 전환될때만 모달띄워줘 / 그리고 참여목록에서도 정원외늦참자는 따로 표기해줘

**Answer**: late_pool 기능 후속 다듬기. 결정:
- 슬라이더 상한을 "종료 미만" 최대 30분 스텝으로 변경(Math.floor((durationMin-1)/30)*30) — 6~9시 세션이면 8:30까지, 9시(종료)는 선택 불가. 서버 set_late_minutes v_max도 동일 산식 + greatest(0,…)로 정합화.
- 모달 트리거는 사용자 확인 결과 '진입할 때만'으로 확정: 일반→정원외늦참 진입 시에만 확인 다이얼로그, 정원외늦참→일반 복귀와 같은 존 시간 조정은 모달 없이 바로 적용. handleSlide를 진입(setPendingLate)·복귀(applyLate 즉시)·동일존(onSetLate)으로 분기, pendingLate 타입에서 toPool 제거, 다이얼로그를 진입 문구만으로 단순화, 미사용 hasRoom 제거.
- 참여목록(SessionParticipantsModal)이 유일한 참가자 목록임을 확인. 정원 외 늦참 전용 섹션(바이올렛 아바타 링 + 🌙 도착시각)은 이미 존재 → 섹션 제목을 카드 배지와 일관되게 "정원 외 늦참 N명"으로 정리.
- tsc·lint·build 통과.

---

## #92

**Prompt**: 홈화면에 pwa로 등록하기를 유도하는 유도토스트를 띄우고싶은데

**Answer**: 로그인된 홈 화면 하단에 "홈 화면에 앱으로 추가" 설치 유도 토스트를 추가. 결정:
- 신규 installPromptStore: 모듈 top-level 로 beforeinstallprompt(preventDefault+저장)·appinstalled 리스너 등록(컴포넌트 마운트 전 발생 대비, main.tsx side-effect import). shouldShowInstallPrompt = 미설치(standalone 아님)·미닫음(localStorage)·미설치완료·모바일·인앱브라우저 아님. dismiss()/promptInstall() 액션.
- 기존 PushSettingsSheet 의 설치 안내(모바일 스크린샷 webp/데스크톱 단계)를 공용 InstallGuide 컴포넌트로 추출해 재사용.
- InstallPromptToast: 하단 고정 토스트, Android=네이티브 설치 프롬프트(원탭), iOS/폴백='설치 방법'→InstallGuide 시트. X=닫음(영속). 1.5s 후 슬라이드업.
- Home: 프로필 완성 + 미편집 + 노출조건 충족일 때만 마운트.
- 3관점 애드버서리얼 리뷰 확정 3건 반영: (medium) 토스트가 하단 버튼(매치로그/즉석세션) 탭을 가림 → 표시 시 스크롤 콘텐츠 끝 92px 스페이서, (low) 전역 Toaster 와 겹침 → 알림 있으면 토스트를 스택 위로 오프셋, (low) role="dialog"→"region"(비모달 배너).
- 카카오 로그인+모바일 게이팅으로 E2E 자동 구동은 불가 → dev 서버 로드 스모크(콘솔 에러 0)로 임포트 크래시 없음 확인. tsc·lint·build 통과.

---

## #93

**Prompt**: 홈 화면에 앱으로 추가 토스트가 뜰때 이렇게 해야 참여알림이 간다는 설명도 달아줘

**Answer**: 설치 유도 토스트 부제를 "그래야 대기→참석 확정, 일정 변경 등 참여 알림을 받을 수 있어요"로 교체(설치가 참여 알림의 전제임을 명시, 기존 PushSettingsSheet 알림 문구와 일관). '설치 방법' 안내 시트 문구에도 같은 취지를 덧붙임. tsc·lint·build 통과.

---

## #94

**Prompt**: 세션당 게스트는 최대 2명이 참여하고 나머진 게스트가 빠지기전까지 대기에 있어야해. 지금 db 잘못된것도 있는데 같이 수정해주고, 알림은 따로 안해도 돼. 그리고 게스트로 이름을 넣는데 회원중 있으면 게스트가 회원인것처럼 들어가는데 그것도 수정해줘.

**Answer**: 프로덕션 DB 진단으로 근본 원인을 먼저 규명한 뒤 서버·클라를 함께 고침.
- **게스트 확정 상한(세션당 2명)**: 마이그레이션 20260712010000. 정원(capacity)과 별개 하위상한 — 3번째부터 waitlisted, 확정 게스트 이탈 시에만 승급. 승급 로직을 헬퍼 promote_next_waitlisted 로 일원화해 5개 취소/승급 RPC + set_session_capacity 에 상한 규칙 반영(누락 방지). 확정 게스트 수는 별도 카운터 대신 session_counters FOR UPDATE 락 안 count(*) 로 판정(6개 전이지점 카운터 배선 드리프트 회피).
- **동명 회원 게스트 차단**: add_guest_attendance 가 활성 회원(is_guest=false)과 같은 이름은 거부(name_is_member) + 클라 친절 안내. 회원 본인은 직접 참석 신청 유도.
- **기존 위반 DB 정리**: open 세션 #117(확정 게스트 4명)을 상한 2명으로 강등 + 빈 정원은 대기 회원 재승급, 알림 없음. 적용 후 전 세션 카운터/정원/게스트상한 정합성 검증.
- **"게스트가 회원처럼 보임" 근본 원인**: 프로필 사진이 md5(이름) 기반이라 동명 회원 사진을 그대로 끌어옴(계정 연결이 아니라 사진 파일 충돌). PlayerAvatar 에 isGuest 추가 → 게스트는 원격 사진 미로드(이니셜만), 일정카드 스택·참여목록 호출부에 게스트 여부 전달. 이름엔 "게스트" 표기 안 함(뱃지로 구분).
- 6렌즈 애드버서리얼 리뷰로 마이그레이션 검증(정합성 버그 0, 확정 지적은 stale doc·경미 UX 문구뿐→반영). 보드(경기 화면) 게스트 사진은 session_players 에 is_guest 배선 필요라 후속 과제로 남김. EXPANSION_SPEC 문서 갱신. tsc 통과.

---

## #95

**Prompt**: 해당 클리어기능을 제거해

**Answer**: 매치 로그의 "클리어(기록 초기화)" 기능을 완전히 제거. 이 기능은 되돌릴 수 없는 하드 삭제(완료 매치·game_count·mixed_count·match_assign_count·pair_history 전부)인데도 관리자 게이트·RLS 보호가 없어, 앞선 조사에서 비관리자 회원이 진행 중이던 7/12 세션(104) 기록을 통째로 날린 원인으로 확인됨. 방어 보강보다 기능 자체를 삭제하는 방향 선택.
- LogPage.tsx: "클리어" 버튼·확인 모달·handleClear·관련 state(showClearConfirm/clearing) 제거. 이에 따라 불필요해진 import(dbClearSessionLogs·ClearConfirmModal·appActions·useAppStore·useRef)와 isCurrentSession/selectedSession/sessionMeta/sessionsRef까지 연쇄 정리.
- ClearConfirmModal.tsx 파일 삭제.
- matchLog.ts: dbClearSessionLogs 함수 삭제.
- ConfirmDialog.tsx: 삭제된 컴포넌트를 예시로 언급하던 주석 2곳 갱신.
- 잔여 참조 0, tsc 통과. DB 마이그레이션 변경 없음(클라이언트 직접 삭제 경로였음).

---

## #96

**Prompt**: 현재 실력계산을 단순히 1~10의 그레이드로 변경하고 선택하게 해줘. 만약 점수계산이 힘들면 임의로 몇명을 뽑아 얘보다 잘한다 못한다 선택해서 추정점수를 넣게 해줘. 동성끼리만 비교하고, 현재 입력되어있는 값은 보정해서 변경해. 그리고 구글시트연동코드는 전부 삭제해 해당 기능은 게스트의 실력매길때도 동일해야해

**Answer**: 실력 모델을 6종 스킬(클리어/스매시 등 O·V·X)에서 단일 등급(1~10)으로 전환. 자가 채점이 어려울 때를 위해 동성 회원과 1:1 비교(더 잘함/비슷/더 못함)로 등급을 이진탐색 추정하는 UI를 추가. 요청대로 구글시트 연동을 전면 제거하고 선수 명단 출처를 Supabase members로 대체, 세션 시작 시 member_id를 연결해 회원=선수로 통합. 대규모·비가역 변경이라 계획 수립 후 다차원 애드버서리얼 리뷰(13에이전트)로 검증하고 확정 4건을 반영.
- 데이터모델: PlayerSkills={grade}; skillScoreOf가 구 6종/상·중·하를 하위호환 환산; 표시(뱃지·자석 아크) 및 팀선발 W_SKILL을 등급 폭(9) 스케일에 맞춰 3.0→0.67 보정
- 신규 GradeInput: 1~10 직접선택 + 동성 이진탐색 "비교로 추정"; 편집 4경로(회원관리·보드·셋업편집·게스트[설정/일정]) 전부 배선. 동성끼리만 비교
- 구글시트 전면 제거(sheetsApi·googleAuth·edge function·gsi 스크립트·env), fetchMembers/updateMemberProfile 신설
- 기존값 보정 마이그레이션(6종→등급 선형 환산) + 일정시작 브릿지 미채점 회원 기본등급 5 보정
- 리뷰 반영: rowToSessionPlayer 정규화(등급0 소비 방지), updateMemberProfile RLS 조용한 실패 판정(.select), 비교 문구 주체 중립화, pairPlayers 균형메모 임계 재보정
- tsc·174 테스트·빌드 통과. DB 마이그레이션 2건은 db push 미적용(수동 배포 필요)

---

## #97

**Prompt**: pwa 설치안했을때 뜨는 토스트보면 안내만 하던데 직접적으로 설치버튼을 노출하고 누르면 설치되게 해줘

**Answer**: 토스트는 이미 beforeinstallprompt가 잡히면 "추가"로 원탭 설치를 하는 구조였는데, "안내만 뜬다"는 건 그 이벤트가 안 잡히는 환경이라는 뜻이라 원인을 나눠 진단. 웹 검색과 Chrome 공식 블로그로 확인한 결론: iOS Safari는 설치 API 자체가 없어 원탭 설치가 원천 불가능(navigator.share 시트에도 '홈 화면에 추가' 없음), 안드로이드는 sw.js에 fetch 핸들러가 없어서 Chrome이 beforeinstallprompt를 안 띄운 것이 근본 원인. 사용자와 협의해 "안드=원탭 활성화, iOS=안내 UX 정리"로 진행.
- sw.js: 내비게이션 요청만 네트워크 통과시키는 최소 fetch 핸들러 추가(빈 핸들러는 Chrome이 무시하므로 실동작 필요, 오프라인 캐싱은 없음) → 안드/데스크톱 Chrome에서 원탭 "추가" 활성화
- InstallPromptToast.tsx: iOS 안내 시트의 3중 중복(헤더+단계텍스트+스크린샷) 정리 — 스크린샷이 단계를 설명하므로 문구는 설치 동기(참여 알림) 한 줄로 슬림화, 미사용 isIOS import 제거
- 프론트(GitHub Pages)만 배포 대상, DB/Edge Function 무변경. tsc·eslint·sw.js 문법 검사 통과

---

## #98

**Prompt**: 회계가 필요한데 통장내역을 네가 직접 볼 순 없으니 메일로 통장거래내역이 전송되면 그걸 감지해서 디비에 올리고 정해진 로직으로 입금내역 체크해서 회원의 회비입금내역같은거 체크하는걸 만들 수 있을까? 설계만 해보자

**Answer**: 메일로 오는 통장 입금내역을 감지→파싱→DB 적재→회비·대관비 자동 대사하는 회계 기능을 설계(구현 없이 설계 문서만). 코드베이스를 병렬 조사해 실제 인프라(웹푸시 notifications→트리거→send-push 체인, pg_cron, is_admin SECURITY DEFINER RPC, group_settings+cock_support_grants 월단위 멱등 패턴, attendances.invited_by 게스트 초대자)에 맞춰 설계. 두 현실 제약을 핵심 전제로 삼음 — ①도메인에 MX 없어 메일 수신 불가 → 이미 도착하는 Gmail을 소스로, ②members.name이 인증 실명 아니고 동명이인 허용 → 자동확정 금지·항상 제안+관리자 확정. 여러 차례 규칙 문답으로 도메인 규칙을 확정하고 docs/ACCOUNTING_DESIGN.md(14개 섹션) 작성.
- 수집: 관리자 수동 버튼 → Edge Function → Apps Script 웹앱(원문만 반환) 구조로 DNS 변경·Gmail OAuth 토큰만료 부담 회피, service_role은 Supabase 안에 격리
- 매칭: 입금액을 그 회원의 미납 회비(5000)·대관비(6000) 항목 조합으로 분해 제안, 관리자 1-click 확정 + 입금자명↔회원 별칭 학습, 가역 배분 레코드로 취소/재매칭 안전
- 회비 규칙: 월 5000, 운영진 면제, 당월 가입 면제 + 월말(+3일) 오프셋 면제
- 대관비 규칙: 대관 여부를 장소(places.court_fee_per_head) 플래그로 결정, 대관 세션의 confirmed 로스터(당일 no-show 포함) + 당일 취소자(confirmed_at 존재 & cancelled_at=세션당일) 부과, 운영진 제외·게스트 포함(invited_by로 초대자 대납 제안)
- 데이터모델: bank_transactions·dues_charges(회비 ym/대관비 session_id XOR)·가역 dues_allocations·member_name_aliases·매칭큐·append-only 감사로그 신규, 전부 관리자 전용 RLS
- 지출(출금)은 카테고리 태깅으로 월별 수지 요약(부수 기능)

---

## #99

**Prompt**: 주말에 코트 열릴때 푸쉬여러개 한번에 가는데 2개 이상이면 그냥 일정이 열렸다는 간단한 메세지로 퉁쳐줘

**Answer**: 주말 일괄 공개 시 회원이 세션별 푸시를 N개 받던 것을, 한 번의 sync 호출에서 2개 이상 회차가 동시에 open되면 회원당 합친 알림 1건으로 바꿨습니다. 주요 판단:
- 증폭 근본 원인이 `sync_schedule_occurrences()` E단계의 `opened × members` 데카르트 곱이라, Edge Function(행 단위 트리거)이 아닌 SQL E단계에서 개수 분기 처리
- 신규 마이그레이션에서 `array_agg`로 이번에 열린 회차 id를 모아 개수 집계 → 1개면 기존 `session_open`(장소·시각 포함) 유지, 2개 이상이면 신규 타입 `sessions_opened`(payload.count, session_id 없음)로 회원당 1건 insert
- `notifications.type`이 text(enum/CHECK 없음)라 새 타입 도입에 스키마 변경 불필요
- 멱등성: `opened` CTE가 draft→open으로 새로 flip된 회차만 반환 + 회차는 한 번만 open되므로 bulk 알림도 배치당 1회만 생성(동시 sync는 행 잠금). 별도 가드 불필요
- Edge Function `buildBody()`와 클라이언트 `notificationMessage()`에 미러 케이스 추가(문구 "새 일정 N개가 열렸어요")
- bulk 알림은 session_id 없어 SW 빈 url→앱 홈으로 열림(기존 new_member와 동일). tsc 통과
- 배포는 수동: DB `supabase db push`, Edge Function `supabase functions deploy send-push`, 프론트 git push

---

## #100

**Prompt**: 제곱으로

**Answer**: 팀 후보 선발의 동반 회피(`pairOverlap`)를 선형 합산에서 상대별 제곱 합산(`Σc²`)으로 변경했습니다. (직전 대화에서 "같은 2~3명이 자주 나온다"는 근본 원인 분석 → 곱셈 방식 제안 → 사용자가 제곱 선택)

- **핵심 판단**: 제곱을 "합계에 씌우기(`(Σc)²`)"는 여러 명을 한 번씩 만난 경우까지 과벌해 경기수 균등을 해치므로 배제. "상대별로 제곱 후 합산(`Σc²`)"이 특정 상대와의 반복만 정확히 겨냥 → 1회=1(저렴), 2회=4, 3회=9로 급증
- `rankCandidates.ts`의 `pairOverlap` 계산 한 곳 수정(제곱). `recommendTeammates`는 이 base를 그대로 쓰므로 단일 변경점
- 제곱 동작 고정 회귀 테스트 추가(선형이면 동점인 두 후보를 제곱이 갈라내는지)
- `docs/TEAM_GENERATION_RULES.md` 2·4·7절 반영. 덤으로 문서 오류 수정: "DB `complete_match`는 팀 2쌍만 누적" → 실제 최신 마이그레이션은 클라이언트와 동일 6쌍 전부 누적(`20260611120000`에서 그룹 전환 확인)
- 세션 스코프 리셋 문제(세션마다 이력 0에서 재시작)는 이번 변경 범위 밖으로 남김
- `tsc --noEmit` 통과, 관련 테스트 99개 통과

---

## #101

**Prompt**: 현재 게스트 최대 2명만 참여가능한데, 게스트대기는 다른 대기풀인거 맞지? 예를 들어 취소를 일반인이 했는데 게스트가 1번인데 참여중 게스트가 2명이만 2번 일반유저를 참여로 바꾸고 같은상황에서 취소가 게스트이면 1번게스트가 참여되고 맞지? 그럼 일반대기와 게스트대기의 표현을 다르게 해줘야할거같아

**Answer**: 서버 승격 로직(`20260712010000_guest_confirm_cap.sql`)을 확인해 사용자 이해를 검증하고, 대기 표시를 회원/게스트로 구분했다.

- **검증**: 두 예시(일반인 취소→회원#2 승격 / 게스트 취소→게스트#1 승급)는 둘 다 맞음. 다만 "다른 대기풀"은 아니고 **단일 FIFO 대기열 + 게스트 확정 상한(2) 게이트** 구조. 승급은 "빈 자리 1칸 + 자격(회원은 항상, 게스트는 확정<2일 때만)"으로 결정 → `[회원#1, 게스트#2]`에서 게스트 취소 시 회원#1이 올라감(빈 자리가 게스트에 예약되지 않음).
- **문제**: 기존 "대기 N번째"가 회원·게스트 합산 순번이라, 막힌 게스트가 회원 순번을 부풀리고, 게이트 닫힌 게스트의 "1번째"가 실제 의미와 다름.
- **결정(사용자 선택)**: "상한 찼을 때만 분리". 확정 게스트 2명이면 대기 게스트=`게스트 정원 대기`(번호 없음)·회원=회원끼리 순번, 2명 미만이면 전원 통합 순번.
- **구현**: 공용 헬퍼 `src/lib/schedule/waitStatus.ts`(서버 자격 규칙과 동일하게 계산)를 만들어 `ScheduleCard`·`GuestSection`·`SessionParticipantsModal` 세 곳에 일관 적용. 유닛 테스트 5개로 고정. tsc·eslint·vitest 통과.

---
