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
- loadSessionAction, startOrUpdateSessionAction에서 DB 값 변경 시 setup 상태도 자동 동기화
- SessionSetup에서 useState 대신 스토어 값을 바쓸 수 있도록 변환 (useEffect로 초기 선택 처리)
- onUpdatePlayer prop 제거 — updatePlayerAction이 스토어의 allPlayers를 직접 업데이트하므로 불필요
- TypeScript 컴파일 및 lint 통과 확인

---
