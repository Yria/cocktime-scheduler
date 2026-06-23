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
