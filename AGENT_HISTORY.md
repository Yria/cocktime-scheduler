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
