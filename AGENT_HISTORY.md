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
