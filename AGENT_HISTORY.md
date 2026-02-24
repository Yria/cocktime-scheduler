# Branch: main

## #1

**Prompt**: 데이터흐름을 확인하자. 컴포넌트 렌더는 스토어만 바라보고 디비 업데이트는 스토어만 건드려야해. 그래서 유기적으로 반영되야 하는데 디비의 데이터를 직접 바라보는 컴포넌트가 있는지, 스토어에 밸류가 있는데 컴포넌트에서 각자 처리하고 있는지 이런것들을 확인해봐

**Answer**: 전체 데이터 흐름을 분석하여 3가지 위반 지점을 발견했습니다:
- Home.tsx, App.tsx, SessionSetup.tsx에서 직접 DB/API를 호출하고 결과를 수동으로 스토어에 넣는 패턴
- courtCount, singleWomanIds, selected 등 설정 값이 SessionSetup 로컬 useState로만 존재하여 외부 동기화 불가
- 스냅샷 덮어쓰기 시 진행 중인 게임 상태가 소실될 위험

---

## #2

**Prompt**: 먼저 디비에서 가져온 값은 전부 스토어에서 처리하는 것부터 작업하자

**Answer**: appStore에 비동기 액션(Thunk) 패턴을 도입하여 DB/API 호출 로직을 스토어로 이전했습니다:
- fetchPlayersAction, loadSessionAction, checkActiveSessionAction, startOrUpdateSessionAction, updatePlayerAction 추가
- Home.tsx에서 직접 sheetsApi를 호출하던 코드를 fetchPlayersAction으로 대체
- App.tsx에서 fetchSessionSnapshot, startSession 등을 직접 호출하던 코드를 스토어 액션으로 대체
- SessionSetup.tsx에서 OAUTH/Script URL 분기 저장 로직을 updatePlayerAction으로 대체

---

## #3

**Prompt**: 다음 작업 진행해 / 계속해

**Answer**: SessionSetup 컴포넌트의 로컬 상태(courtCount, singleWomanIds, selectedIds, guests)를 appStore의 setup* 필드로 이전했습니다:
- appStore에 setupCourtCount, setupSingleWomanIds, setupSelectedIds, setupGuests 상태와 setter 추가
- loadSessionAction, startOrUpdateSessionAction에서 무시 DB 값 변경 시 setup 상태도 자동 동기화
- SessionSetup에서 useState 대신 스토어 값을 바쓸 수 있도록 변환 (useEffect로 초기 선택 처리)
- onUpdatePlayer prop 제거 — updatePlayerAction이 스토어의 allPlayers를 직접 업데이트하므로 불필요
- TypeScript 컴파일 및 lint 통과 확인

---

## #4

**Prompt**: 세션의 대기목록에 사용자 목록을 좀 더 디자인적으로 퀄업해줘. 요소를 새로 추가할거면 추가하기전에 나한테 물어봐. 만약 추가할 요소가 없다면 그대로 진행해

**Answer**: 새 요소 추가 없이 기존 요소 스타일만 개선했습니다. 주요 변경:
- 성별 이모지(🔴/🔵) → 디자인 시스템 색상(`#007aff`/`#ff2d55`)의 작은 컬러 dot으로 교체
- 칩에 glassmorphism(backdrop-filter) + 미세 그림자 + hover 시 `translateY(-1px)` 부상 효과 적용
- 대기 인원 배지를 4명 이상(초록)/1~3명(주황)/0명(회색)으로 동적 색상 변화
- 게임 수 뱃지 및 경고 메시지 배경색+라운드 처리로 시각적 완성도 개선
- CSS `<style>` 블록으로 hover/active transition 처리

---

## #5

**Prompt**: 코트수 수정 막아놓은거 풀어줘

**Answer**: `SessionSetup.tsx:73`에서 세션 중 코트 수 감소를 막기 위해 `minCourtCount = sessionMeta.courtCount`로 설정한 부분을 `minCourtCount = 0`으로 변경. 이제 세션 도중에도 코트 수를 자유롭게 증감할 수 있음.

---

## #6

**Prompt**: 전체적으로 코드보면서 퍼포먼스저하에 영향이 있을것 같은 코드를 찾아봐. 위에서 언급한 것들 하나씩 수정하자. 일단 3번부터. 2번 하자. 같이 고쳐줘

**Answer**: 렌더링 성능 최적화 및 린트 경고를 해결했습니다:
- `useSessionState` 로직 분리로 무거운 배열·Map 생성 함수들에 `useMemo` 및 `useCallback` 적용
- 배열 재생성 방지를 위해 `SessionMain` 컴포넌트 하위 `singleWomanIds`에 빈 배열 상수 참조(`EMPTY_SINGLE_WOMAN_IDS`) 연결
- 불필요한 하위 리스트 통째 재렌더링 방지를 위해 주요 대규모 리스트 컴포넌트(`CourtList`, `WaitingList`, `ReservedList`, `RestingList`)에 `React.memo` 도입
- ESLint 경고(`react-refresh/only-export-components`, `react-hooks/set-state-in-effect`) 제거를 위해 `src/lib/constants.ts` 신규 생성 및 상수 이동, Fetch 로직 리팩토링 진행
- TypeScript의 `Promise.all` 내 Supabase query builder(`insert`, `upsert`, `delete`) 반환 타입 에러 수정을 위해 명시적 `PromiseLike<unknown>[]` 타입 지정 및 `.then()` 체이닝 활용

---

## #7

**Prompt**: 통일좋은데 배경색은 왜 냅둠?

**Answer**: `SingleWomanSelector.tsx`의 미선택 칩 배경색을 `WaitingList.tsx`와 동일한 glassmorphism 스타일(투명도, 반투명 blur, 동일한 border 처리)로 변경하여 디자인 통일성을 높였습니다.

---

## #8

**Prompt**: 디자인통일 한번더 보자.
코트 현황내부의 현재 경기중인 선수들의 디자인과 로그의 디자인을 보면 라운딩과 높이가 달라. 현재 경기중인 선수들의 디자인의 것으로 통일해

**Answer**: `MatchCard.tsx` 내부 구조를 `CourtList.tsx`의 개별 매치 레이아웃(VS 구분선 포함, 패딩 16px 28px)과 동일하게 전면 개편했습니다. 또한 `MatchSummary.tsx` 및 `MatchCard.tsx` 안의 플레이어 뱃지 간격(gap) 및 크기를 `md` 사이즈 규격으로 통일하여, 로그 화면에서도 현재 경기 중인 선수들 목록과 완벽히 동일한 디자인(라운딩, 높이, 간격 등)을 유지하도록 개선했습니다.

---

## #9

**Action**: 백그라운드/포그라운드 전환 시 실시간 세션 동기화 구현

**Answer**: 브라우저 `visibilitychange` 이벤트를 감지하는 `usePageVisibility` 커스텀 훅을 신규 생성. 모바일 백그라운드 제어 등으로 Supabase 웹소켓 동기화가 끊기는 상황을 방지하기 위해, `App.tsx`에서 화면이 다시 켜졌을 때(`isVisible === true`) 활성 세션 정보(`checkActiveSessionAction`)를 강제로 다시 불러오도록 로직 보완.

---

## #10

**Prompt**: 두명이 동시에 셋팅화면 들어가서 수정할때 문제가 생길 수 있을거같은데... 구현해. 이때 서버의 값과 로컬에서 들고있는 값이 다르다면 서버에 저장된 값이 어떻게 저장되어있었는지 나한테 알려줬음 좋겠어.

**Answer**: 낙관적 동시성 제어(OCC) 방식으로 두 가지 충돌 감지를 구현했습니다:
- **세션 설정 충돌**: "세션 업데이트" 버튼 클릭 시 서버의 현재 상태(코트 수, 참가자 목록, 혼복 싱글 여성)를 fetch하여 내가 알고 있는 sessionMeta와 비교. 차이가 있으면 서버에 저장된 설정을 항목별로 보여주는 충돌 다이얼로그를 띄움. 덮어쓰기 또는 취소 선택 가능
- **플레이어 스킬/성별 편집 충돌**: 편집 모달을 열 때 원본값(gender, skills)을 ref로 기록. 저장 시 서버에서 해당 플레이어의 현재 데이터를 가져와 원본과 비교. 다른 관리자가 이미 변경했으면 변경된 스킬을 항목별로 보여주는 충돌 다이얼로그 표시
- 신규 파일: `SessionConflictDialog.tsx`, `PlayerConflictDialog.tsx`, `fetchSessionSettingsForConflictCheck`, `fetchSessionPlayerForConflictCheck`
- TypeScript 컴파일 통과 확인

---

## #11

**Prompt**: 현재 서버상태와 로컬상태의 비교를 updated_time 만으로 하고있는데 쿼리를 보니까 전체데이터를 가져와서 비교하더라고. 그럼 updated_time 말고 내가 변경하려는 데이터와 서버의 데이터를 비교해서 다를경우에 그 다른것만 다이얼로그에 노출하는걸로 하고싶어

**Answer**: 충돌 비교 기준을 "내가 알고 있던 서버 상태 vs 서버 실제 상태"에서 "내가 저장하려는 값 vs 서버 현재값"으로 변경했습니다:
- 세션 설정: 내가 설정한 courtCount, selectedPlayerIds, singleWomanIds를 서버와 직접 비교. 내가 보내려는 값과 서버가 이미 같으면 충돌 아님
- 플레이어 편집: 모달 열 때 원본값 기록(editOriginalGender/Skills) 제거. 대신 내가 수정한 editGender/editSkills를 서버 현재값과 직접 비교
- 다이얼로그 라벨을 "내 설정" vs "서버" 형식으로 명확화. 참가자 차이도 "서버에만 있음" / "내 설정에만 있음"으로 변경

---

## #12

**Prompt**: @docs/TEAM_GENERATION_RULES.md 대로 @src/lib/teamGenerator.ts 가 구현됐는지 확인하고 수정해

**Answer**: `selectMenForMixed` 함수에서 규칙 2 위반을 발견하고 수정했습니다.
- **버그**: `eligible`(mixedCount ≤ minMixed+1) 전체에서 실력 차이 최솟값 쌍을 탐색하다가 minMixed 선수가 아닌 쌍이 선택되는 경우 발생 → 규칙 2 "mixedCount가 가장 적은 선수를 무조건 1명 이상 포함" 위반
- **수정**: minMixed 선수들을 앵커로 고정하고, 각 앵커별로 최적 파트너를 탐색하여 전체 중 실력 차이 최솟값 쌍 선택
- 전체 24개 테스트 통과 확인

---

## #13

**Prompt**: 지금 말한 내용을 코드베이스 없이 문서로 작성해 @docs/TEAM_GENERATION_RULES.md 에 먼저 넣어줘

**Answer**: `docs/TEAM_GENERATION_RULES.md`에 "혼복 남자 후보 풀 범위 (구현 유의사항)" 섹션을 추가했습니다.
- 문제 배경: 후보 풀을 상위 N명으로 제한하면 여자 비중이 높을 때 남자 후보가 극소수로 줄어 특정 남자가 혼복 기회를 얻지 못하는 구조적 불균형 설명
- 올바른 동작: 혼복 여부 판단·여자 선발은 상위 N명 기준, 남자 선발만 전체 대기열 대상으로 해야 규칙 1(mixedCount 균등)이 제대로 작동함을 명시
- 코드 변경 없이 문서만 업데이트

---

## #14

**Prompt**: hook.js:608  Failed to update player: Error: Google 로그인 라이브러리 로딩 중. 잠시 후 다시 시도하세요.
    at googleAuth.ts:54:5

**Answer**: Google Identity Services 라이브러리 로딩 지연 및 광고 차단기 차단 문제 해결:
- `googleAuth.ts`에 `loadGoogleScript` 함수를 추가하여 스크립트 로딩 상태를 확인하고 대기하도록 개선
- 스크립트 로드 실패(광고 차단기 등) 시 에러를 명확히 반환하도록 처리
- `appStore.ts`의 `updatePlayerAction`에서 OAuth 초기화 실패 시 `scriptUrl`이 설정되어 있다면 이를 대체 수단(Fallback)으로 사용하도록 예외 처리 추가

---

---
## #17

**Prompt**: 현재 상황에서 하단 주소줄은 계속 커진상태로 있어. 다른 모바일페이지를 보면 스크롤하면 주소창이 작아지는데 아마 하단에 버튼이 있는 디자인을 하려고 해서 그런거같아. 이대로는 넓은 화면이 아쉬운데 좋은 방법이 있을까?

**Answer**: body 스크롤 방식으로 전환하여 Safari 주소창이 스크롤 시 자동으로 접히도록 수정했습니다. 기존 레이아웃은 외부 div가 `h-[100dvh]`로 화면을 꽉 채우고 내부 div만 스크롤되는 구조여서 body가 스크롤되지 않아 Safari 주소창이 항상 펼쳐져 있었습니다.
- `SessionMain.tsx`: `h-[100dvh] flex flex-col` 제거, 내부 스크롤 div 제거, 하단 고정 바 높이만큼 스페이서 추가
- `SessionHeader.tsx`: `position: sticky; top: 0; z-index: 50` 추가
- `SessionControls.tsx`: `position: fixed; bottom: 0; left: 0; right: 0` 추가
- `SessionSetup.tsx`: 동일 패턴 (sticky 헤더, fixed 하단 CTA, 스페이서)
- `LogPage.tsx`: `h-[100dvh] flex flex-col` 제거 + sticky 헤더
- `LogList.tsx`: `flex-1 overflow-y-auto no-sb` 제거

---
## #16

**Prompt**: 아이폰에서 보면 safearea 를 활용하지 못하는데 이 영역도 디스플레이에 활용해줘.

**Answer**: iPhone safe area를 활용하도록 여러 파일을 수정했습니다.
- `index.html`: viewport 메타 태그에 `viewport-fit=cover` 추가, `theme-color`, `apple-mobile-web-app-capable` 등 PWA 관련 메타 태그 추가
- `index.css`: `.lq-header`에 `padding-top: env(safe-area-inset-top)` 추가, `body` 배경색을 `#fafbff`(페이지 컨테이너와 동일)로 설정하여 safe area가 분리된 느낌 없이 매끄럽게 연결되도록 처리
- `SessionHeader.tsx`, `SessionSetup.tsx`, `LogPage.tsx`: 헤더 높이를 `calc(60px + env(safe-area-inset-top))`으로 확장하고 컨텐츠를 `paddingTop: env(safe-area-inset-top)` 으로 내려 status bar와 겹치지 않도록 조정
- `Home.tsx`: 상하 safe area 패딩 적용
- `LogList.tsx`: 하단 스크롤 영역에 bottom safe area 패딩 추가
- 다크모드용 `.dark body { background-color: #0f172a }` 추가

---
## #15

**Action**: Google Sheets API 호출 방식 프록시 전환 및 Supabase Edge Function 구현

**Answer**: 클라이언트에서 직접 Google Sheets API를 호출하던 방식을 Supabase Edge Function을 통한 프록시 방식으로 전환했습니다.
- supabase/functions/sheets: Google Sheets API 호출을 대행하는 Edge Function 구현
- src/lib/sheetsApi.ts: supabase.functions.invoke를 사용하여 프록시 함수 호출하도록 수정
- src/components/setup/EditModal.tsx & src/store/appStore.ts: 플레이어 정보 수정 기능 안정화 및 API 연동
- 환경 설정 파일(.vscode/extensions.json, supabase/config.toml 등) 추가 및 테스트 코드 업데이트

---

## #18

**Prompt**: 다크테마 만들수있나?

**Answer**: 시스템 다크모드(prefers-color-scheme)를 따르는 방식으로 다크테마를 구현했습니다. App.tsx에 이미 OS 감지 코드와 CSS 변수가 준비되어 있었으나, 대부분의 컴포넌트가 인라인 스타일로 하드코딩된 색상을 사용해 다크모드가 동작하지 않는 상태였습니다. Tailwind `dark:` 클래스를 활용하여 다음 컴포넌트들을 수정했습니다:
- 페이지 컨테이너: Home, SessionMain, LogPage, SessionSetup (배경색)
- 헤더/바: SessionHeader, LogPage 헤더, SessionControls, SessionSetup 하단 바
- 카드/리스트: StatsSummary, PlayerSelectionList, CourtList, ReservedList, RestingList, CourtCountSelector, SingleWomanSelector
- 로그 컴포넌트: MatchCard, SessionSelector, MatchSummary, LogList
- WaitingList의 `<style>` 태그에 `.dark` 오버라이드 규칙 추가
- CourtsHeader, PlayerRow 텍스트 색상 적용

---

## #19

**Prompt**: 세션페이지의 로그버튼을 세션설정 우상단으로 옮기고 원래 위치에 도움말 버튼을 넣고싶어.

**Answer**: 버튼 위치 변경 및 Spotlight 온보딩 도움말 구현.
- SessionHeader에서 로그 버튼 제거, `?` 아이콘 도움말 버튼 추가 (`onHelp` prop)
- SessionSetup 헤더 우상단에 로그 버튼 추가
- HelpOverlay 컴포넌트 신규 생성: 코트→대기명단→휴식→팀생성 순 Spotlight 온보딩
- SessionMain에 섹션별 id 부여 및 showHelp 상태 추가

---

## #20

**Prompt**: pc보기에서 하단 버튼 너비가 최대인 부분 고쳐줘

**Answer**: SessionSetup과 SessionControls의 fixed 하단 바에서 `left: 0, right: 0` 대신 `left: 50%, transform: translateX(-50%), maxWidth: 384px`로 변경하여 PC 화면에서도 컨테이너 너비에 맞게 제한되도록 수정.

---

## #21

**Action**: 전체적인 UI/UX 프리미엄화 및 플로팅 글래스 바 도입

**Answer**: 앱 전반의 디자인 완성도를 높이기 위해 다음과 같은 변경사항을 적용했습니다:
- 메인 하단 제어 바를 '플로팅 리퀴드 글래스' 스타일로 변경하여 모던한 감성 부여
- PC/데스크탑 뷰에서 모바일 컨테이너 주변에 섀도우를 추가하고 배경색을 조정하여 카드 스타일 구현
- iOS Safe Area 처리 로직 개선 및 바텀 스페이서 높이 최적화
- `index.css`에 UI 토큰(글래스 스타일, 섀도우 등)을 추가하고 기본 오버레이/시트의 블러 및 투명도 조정
- 헤더 및 컨트롤 레이아웃의 디자인 디테일(보더 컬러, 보더 레디우스 등) 정교화

