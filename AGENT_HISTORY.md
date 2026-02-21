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
