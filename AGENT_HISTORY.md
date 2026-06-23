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
